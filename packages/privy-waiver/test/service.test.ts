import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { encodeAbiParameters, encodeEventTopics, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  formatAuthorizationPayload,
  intentAuthorizationInput,
  verifyAuthorizationSignature,
} from "../src/authorization.ts";
import { covenantVaultAbi, reasonCommitment, type ArcGateway, type ArcReceipt } from "../src/arc.ts";
import { PrivyClient, type RpcIntent } from "../src/privy-client.ts";
import { createApproverServer } from "../src/server.ts";
import { QuorumAdminService, ServiceError, type ActionView, type Approval } from "../src/service.ts";
import { MemoryActionStore } from "../src/store.ts";

// The Privy wallet is a local key here; in production it lives in Privy's enclave.
const WALLET_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const walletAccount = privateKeyToAccount(WALLET_KEY);
const WALLET_ID = "wallet-under-quorum";
const APP_ID = "test-app-id";
const VAULT: Address = "0x1970feb699BCd4dd268a3A8c2590929fc8fd67c2";
const FACILITY_ID: Hex = "0x39cbb5ce0d83241c8fe2be217023dd05dc80cecce06fb7df109a6c50452c4d1c";

type RecordedRequest = { method: string; path: string; headers: Headers; body: unknown };
type FakeIntent = RpcIntent & { authorization_details: { threshold: number; members: { type: "key"; public_key: string; signed_at: number | null }[] }[] };

/**
 * An in-memory stand-in for Privy's API, reached through PrivyClient's real HTTP code. It checks an
 * approval exactly as Privy is documented to: over the intent's recorded request, under a member key.
 */
function fakePrivy(options: {
  members: string[];
  alterRecordedTransaction?: (tx: Record<string, unknown>) => void;
  signWithKey?: Hex;
  signOverrides?: { nonce?: number };
}) {
  const requests: RecordedRequest[] = [];
  const intents = new Map<string, FakeIntent>();
  let count = 0;

  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: url.pathname, headers: new Headers(init?.headers), body });

    const propose = url.pathname.match(/^\/v1\/intents\/wallets\/([^/]+)\/rpc$/);
    if (method === "POST" && propose) {
      const recorded = structuredClone(body) as { params: { transaction: Record<string, unknown> } };
      options.alterRecordedTransaction?.(recorded.params.transaction);
      const intent: FakeIntent = {
        intent_id: `intent-${++count}`,
        intent_type: "RPC",
        status: "pending",
        resource_id: decodeURIComponent(propose[1] ?? ""),
        created_at: Date.now(),
        expires_at: Date.now() + 72 * 3_600_000,
        authorization_details: [
          { threshold: 2, members: options.members.map((key) => ({ type: "key", public_key: key, signed_at: null })) },
        ],
        // Privy adds fields of its own to what it records, which is why approvers sign its copy.
        request_details: { method: "POST", url: `https://api.privy.io/v1/wallets/${propose[1]}/rpc`, body: { ...recorded, chain_type: "ethereum" } },
      };
      intents.set(intent.intent_id, intent);
      return json(200, intent);
    }

    const byId = url.pathname.match(/^\/v1\/intents\/([^/]+)(?:\/(authorize|reject))?$/);
    const intent = byId ? intents.get(decodeURIComponent(byId[1] ?? "")) : undefined;
    if (!byId || !intent) return json(404, { error: "not found" });
    if (method === "GET") return json(200, intent);
    if (byId[2] === "reject") {
      intent.status = "rejected";
      return json(200, intent);
    }
    const { signature, timestamp } = body as { signature: string; timestamp: number };
    const payload = formatAuthorizationPayload(intentAuthorizationInput(intent.request_details, APP_ID));
    const members = intent.authorization_details[0]?.members ?? [];
    const member = members.find(
      (candidate) =>
        candidate.public_key !== undefined && verifyAuthorizationSignature(candidate.public_key, payload, signature),
    );
    if (!member) return json(401, { error: "Invalid authorization signature" });
    member.signed_at = timestamp;
    if (members.filter((candidate) => candidate.signed_at).length >= 2) {
      const tx = (intent.request_details.body as { params: { transaction: Record<string, string | number> } }).params.transaction;
      const quantity = (value: string | number | undefined) => BigInt(value ?? 0);
      const signed = await privateKeyToAccount(options.signWithKey ?? WALLET_KEY).signTransaction({
        type: "eip1559",
        chainId: Number(quantity(tx.chain_id)),
        to: tx.to as Address,
        data: tx.data as Hex,
        value: quantity(tx.value),
        nonce: options.signOverrides?.nonce ?? Number(quantity(tx.nonce)),
        gas: quantity(tx.gas_limit),
        maxFeePerGas: quantity(tx.max_fee_per_gas),
        maxPriorityFeePerGas: quantity(tx.max_priority_fee_per_gas),
      });
      intent.status = "executed";
      intent.action_result = {
        status_code: 200,
        executed_at: Date.now(),
        response_body: { method: "eth_signTransaction", data: { signed_transaction: signed, encoding: "rlp" } },
      };
    }
    return json(200, intent);
  };
  return { fetchImpl, requests };
}

function fakeArc(): ArcGateway & { broadcast: Hex[] } {
  const broadcast: Hex[] = [];
  return {
    broadcast,
    chainId: async () => 5_042_002,
    simulate: async () => {},
    estimateGas: async () => 90_000n,
    feesPerGas: async () => ({ maxFeePerGas: 25_000_000_000n, maxPriorityFeePerGas: 0n }),
    pendingNonce: async () => 3,
    sendRawTransaction: async (raw) => {
      broadcast.push(raw);
      return keccak256(raw);
    },
    waitForReceipt: async (hash) => ({
      transactionHash: hash,
      status: "success",
      blockNumber: 61_500_000n,
      logs: [
        {
          address: VAULT,
          topics: encodeEventTopics({
            abi: covenantVaultAbi,
            eventName: "WaiverCreated",
            args: { facilityId: FACILITY_ID, reasonCommitment: reasonCommitment("mock signer outage") },
          }),
          data: encodeAbiParameters([{ type: "uint64" }, { type: "uint64" }], [1_800_000_000n, 1_800_086_400n]),
          blockNumber: 61_500_000n,
          blockHash: `0x${"11".repeat(32)}`,
          logIndex: 0,
          transactionHash: hash,
          transactionIndex: 0,
          removed: false,
        } as unknown as ArcReceipt["logs"][number],
      ],
    }),
    facilityExists: async () => true,
    getFacility: async () => {
      throw new Error("unused");
    },
    isExposureIssuer: async () => true,
    isHedgeIssuer: async () => true,
    vaultStatus: async () => ({ facilityId: FACILITY_ID, covenantState: "CURE", activeWaiver: false, waiverEndsAt: 0n }),
  };
}

/** An approver as the browser UI is one: a WebCrypto key that never leaves, signing P1363. */
async function browserApprover() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey)).toString("base64");
  return {
    publicKey,
    async sign(view: ActionView, text = view.signingPayload): Promise<Approval> {
      assert.ok(text, "a pending action exposes the payload to sign");
      const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(text));
      return { publicKey, signature: Buffer.from(signature).toString("base64"), encoding: "p1363", timestamp: Date.now() };
    },
  };
}

async function setup(privyOptions: Omit<Parameters<typeof fakePrivy>[0], "members"> = {}, members?: string[]) {
  const risk = await browserApprover();
  const treasury = await browserApprover();
  const privy = fakePrivy({ ...privyOptions, members: members ?? [risk.publicKey, treasury.publicKey] });
  const arc = fakeArc();
  const service = new QuorumAdminService(
    new PrivyClient({ appId: APP_ID, appSecret: "test-app-secret", apiUrl: "https://api.privy.io" }, privy.fetchImpl),
    arc,
    new MemoryActionStore(),
    { walletId: WALLET_ID, walletAddress: walletAccount.address, explorer: "https://testnet.arcscan.app", vault: VAULT, signedHeaders: "app-id" },
  );
  return { service, privy, arc, risk, treasury };
}

test("a waiver goes propose, two approvals, Privy signs, verified broadcast", async () => {
  const { service, privy, arc, risk, treasury } = await setup();

  const proposed = await service.proposeWaiver({ durationSeconds: 86_400, reason: "mock signer outage" });
  assert.equal(proposed.status, "pending");
  assert.equal(proposed.call.functionName, "createWaiver");
  assert.deepEqual(proposed.call.args, ["86400", JSON.stringify(reasonCommitment("mock signer outage"))]);
  assert.equal(proposed.approvals.threshold, 2);

  const proposal = privy.requests[0];
  assert.equal(proposal?.path, `/v1/intents/wallets/${WALLET_ID}/rpc`);
  assert.equal(proposal?.headers.get("authorization"), `Basic ${Buffer.from(`${APP_ID}:test-app-secret`).toString("base64")}`);
  assert.equal(proposal?.headers.get("privy-app-id"), APP_ID);
  assert.equal(proposal?.headers.get("privy-request-expiry"), null, "no expiry header on proposals");
  const sent = (proposal?.body as { method: string; params: { transaction: Record<string, unknown> } }).params.transaction;
  assert.equal(sent.chain_id, 5_042_002);
  assert.equal(sent.to, VAULT);

  const afterOne = await service.approve(proposed.intentId, await risk.sign(proposed));
  assert.equal(afterOne.status, "pending");
  assert.equal(afterOne.approvals.members.filter((member) => member.signedAt).length, 1);
  await assert.rejects(service.execute(proposed.intentId), (error: unknown) => error instanceof ServiceError && error.status === 409);

  const authorize = privy.requests.find((request) => request.path.endsWith("/authorize"));
  const sentApproval = authorize?.body as { signature: string; timestamp: number };
  assert.deepEqual(Object.keys(sentApproval).sort(), ["signature", "timestamp"]);
  assert.ok(sentApproval.signature.startsWith("ME"), "Privy receives a DER signature, not the browser's P1363");

  const afterTwo = await service.approve(proposed.intentId, await treasury.sign(afterOne));
  assert.equal(afterTwo.status, "executed");

  const done = await service.execute(proposed.intentId);
  assert.equal(arc.broadcast.length, 1);
  assert.equal(done.broadcast?.hash, keccak256(arc.broadcast[0] as Hex));
  assert.equal(done.broadcast?.status, "success");
  assert.equal(done.broadcast?.waiverEndsAt, "1800086400");
  assert.equal(done.broadcast?.explorerUrl, `https://testnet.arcscan.app/tx/${done.broadcast?.hash}`);

  const again = await service.execute(proposed.intentId);
  assert.equal(again.broadcast?.hash, done.broadcast?.hash);
  assert.equal(arc.broadcast.length, 1, "executing twice broadcasts once");
});

test("one proposal at a time: each pins the wallet's next nonce", async () => {
  const { service } = await setup();
  const first = await service.proposeWaiver({ durationSeconds: 3_600, reason: "first" });
  await assert.rejects(service.proposeWaiver({ durationSeconds: 3_600, reason: "second" }), /still pending/);
  await service.reject(first.intentId);
  assert.equal((await service.proposeWaiver({ durationSeconds: 3_600, reason: "second" })).status, "pending");
});

test("a signature that does not verify over the payload never reaches Privy", async () => {
  const { service, privy, risk } = await setup();
  const proposed = await service.proposeWaiver({ durationSeconds: 3_600, reason: "mock" });
  const forged = await risk.sign(proposed, (proposed.signingPayload ?? "").replace('"nonce":"0x3"', '"nonce":"0x4"'));
  await assert.rejects(service.approve(proposed.intentId, forged), /does not verify/);
  assert.equal(privy.requests.filter((request) => request.path.endsWith("/authorize")).length, 0);
});

test("a key outside the quorum is refused", async () => {
  const outsider = await browserApprover();
  const { service, risk } = await setup({}, undefined);
  const proposed = await service.proposeWaiver({ durationSeconds: 3_600, reason: "mock" });
  await assert.rejects(service.approve(proposed.intentId, await outsider.sign(proposed)), /not a member/);
  assert.ok(await service.approve(proposed.intentId, await risk.sign(proposed)));
});

test("a signed transaction that differs from the approved one is not broadcast", async () => {
  for (const privyOptions of [{ signOverrides: { nonce: 9 } }, { signWithKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex }]) {
    const { service, arc, risk, treasury } = await setup(privyOptions);
    const proposed = await service.proposeWaiver({ durationSeconds: 3_600, reason: "mock" });
    const afterOne = await service.approve(proposed.intentId, await risk.sign(proposed));
    await service.approve(proposed.intentId, await treasury.sign(afterOne));
    await assert.rejects(service.execute(proposed.intentId), /differs from the approved one|not the admin wallet/);
    assert.equal(arc.broadcast.length, 0);
  }
});

test("if Privy records a different transaction than proposed, nothing is stored to approve", async () => {
  const { service } = await setup({ alterRecordedTransaction: (tx) => (tx.to = "0x000000000000000000000000000000000000dEaD") });
  await assert.rejects(service.proposeWaiver({ durationSeconds: 3_600, reason: "mock" }), /different request than was proposed/);
  assert.deepEqual(await service.list(), []);
});

test("waiver proposals need a stated reason and a whole number of seconds", async () => {
  const { service } = await setup();
  await assert.rejects(service.proposeWaiver({ durationSeconds: 3_600, reason: "   " }), /stated reason/);
  await assert.rejects(service.proposeWaiver({ durationSeconds: 1.5, reason: "x" }), /whole number/);
});

test("the approver server serves the page and the flow over HTTP", async () => {
  const { service, risk } = await setup();
  const server = createApproverServer(service, async () => ({ chainId: 5_042_002 }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Covenant waiver approvals/);

    const created = await fetch(`${base}/api/waivers`, { method: "POST", body: JSON.stringify({ durationSeconds: 3_600, reason: "mock" }) });
    assert.equal(created.status, 201);
    const view = (await created.json()) as ActionView;

    const malformed = await fetch(`${base}/api/actions/${view.intentId}/approve`, { method: "POST", body: JSON.stringify({}) });
    assert.equal(malformed.status, 400);

    const approved = await fetch(`${base}/api/actions/${view.intentId}/approve`, { method: "POST", body: JSON.stringify(await risk.sign(view)) });
    assert.equal(approved.status, 200);
    const listed = (await (await fetch(`${base}/api/actions`)).json()) as ActionView[];
    assert.equal(listed[0]?.approvals.members.filter((member) => member.signedAt).length, 1);
  } finally {
    server.close();
  }

  const noWallet = createApproverServer(undefined, async () => ({ walletId: null }));
  noWallet.listen(0, "127.0.0.1");
  await once(noWallet, "listening");
  try {
    const port = (noWallet.address() as AddressInfo).port;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/info`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/actions`)).status, 409);
  } finally {
    noWallet.close();
  }
});
