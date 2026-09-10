import assert from "node:assert/strict";
import test from "node:test";

import type { Address } from "viem";

import {
  formatAuthorizationPayload,
  generateAuthorizationKeyPair,
  signAuthorizationPayload,
  verifyAuthorizationSignature,
} from "../src/authorization.ts";
import { describeAdminCall } from "../src/arc.ts";
import { policyControls, policyProblems, waiverOnlyPolicy, walletUpdateAuthorizationInput } from "../src/policy.ts";
import { PrivyClient, type Policy } from "../src/privy-client.ts";

const VAULT: Address = "0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51";
const REGISTRY: Address = "0xB54fe913C4a7dE73Bc285338dCbb384AEec5e448";
const WALLET: Address = "0x55C4DD3770A44695735717CB7b7005AC7dE9edA1";
const DEAD: Address = "0x000000000000000000000000000000000000dEaD";

test("the policy allows one call, createWaiver on the vault on Arc moving no value, and never reads duration", () => {
  const policy = waiverOnlyPolicy(VAULT, 5_042_002, "quorum-1");
  assert.equal(policy.owner_id, "quorum-1", "the key quorum owns it, so changing it takes both approvers");
  assert.equal(policy.rules.length, 1);
  const [rule] = policy.rules;
  assert.equal(rule?.action, "ALLOW");
  assert.equal(rule?.method, "eth_signTransaction");
  assert.deepEqual(
    rule?.conditions.map((condition) => [condition.field_source, condition.field, condition.operator, condition.value]),
    [
      ["ethereum_transaction", "chain_id", "eq", "5042002"],
      ["ethereum_transaction", "to", "eq", VAULT],
      ["ethereum_transaction", "value", "eq", "0x0"],
      ["ethereum_calldata", "function_name", "eq", "createWaiver"],
    ],
  );
});

test("a stored policy is compared with the expected one, not trusted by its name", () => {
  const expected = waiverOnlyPolicy(VAULT, 5_042_002, "quorum-1");
  const stored: Policy = {
    ...structuredClone(expected),
    id: "policy-1",
    owner_id: "quorum-1",
    rules: expected.rules.map((rule) => ({ ...rule, id: "rule-1" })),
  };
  assert.deepEqual(policyProblems(stored, expected), []);

  const loosened: Policy = {
    ...stored,
    rules: stored.rules.map((rule) => ({
      ...rule,
      conditions: rule.conditions.map((condition) => (condition.field === "to" ? { ...condition, value: DEAD } : condition)),
    })),
  };
  assert.match(policyProblems(loosened, expected).join(), /rules/);
  assert.match(policyProblems({ ...stored, owner_id: null }, expected).join(), /owner/);
});

test("the controls: the allowed call, one denied variant per condition, and every probe unmineable", () => {
  const controls = policyControls({
    wallet: WALLET,
    vault: VAULT,
    otherContract: REGISTRY,
    chainId: 5_042_002,
    maxWaiverDurationSeconds: 259_200,
  });
  assert.deepEqual(
    controls.map((control) => control.expect),
    ["allowed", "denied", "denied", "denied", "allowed"],
  );
  for (const control of controls) {
    assert.equal(control.tx.nonce, 1_000_000_000, control.name);
    assert.equal(control.tx.maxFeePerGas, 1n, control.name);
    assert.equal(control.tx.from, WALLET, control.name);
  }
  const [allowed, otherFunction, otherContract, otherChain, tooLong] = controls;
  assert.equal(describeAdminCall(allowed?.tx.data ?? "0x").functionName, "createWaiver");
  assert.equal(allowed?.tx.to, VAULT);
  assert.equal(describeAdminCall(otherFunction?.tx.data ?? "0x").functionName, "revokeWaiver");
  assert.equal(otherFunction?.tx.to, VAULT);
  assert.equal(otherContract?.tx.to, REGISTRY);
  assert.equal(otherContract?.tx.data, allowed?.tx.data);
  assert.equal(otherChain?.tx.chainId, 1);
  assert.equal(otherChain?.tx.data, allowed?.tx.data);
  assert.equal(describeAdminCall(tooLong?.tx.data ?? "0x").args[0], 2_592_000);
});

test("attaching the policy is a PATCH of the wallet that every approver signs, comma-joined", async () => {
  const keys = [generateAuthorizationKeyPair(), generateAuthorizationKeyPair()];
  const requests: { method: string; url: string; headers: Headers; body: unknown }[] = [];
  const client = new PrivyClient(
    { appId: "test-app-id", appSecret: "test-app-secret", apiUrl: "https://api.privy.io" },
    async (input, init) => {
      requests.push({ method: init?.method ?? "GET", url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "wallet-1", address: WALLET, policy_ids: ["policy-1"] }), { status: 200 });
    },
  );
  const body = { policy_ids: ["policy-1"] };
  const payload = formatAuthorizationPayload(walletUpdateAuthorizationInput(client.walletUrl("wallet-1"), body, client.appId));
  assert.equal(
    new TextDecoder().decode(payload),
    '{"body":{"policy_ids":["policy-1"]},"headers":{"privy-app-id":"test-app-id"},"method":"PATCH","url":"https://api.privy.io/v1/wallets/wallet-1","version":1}',
  );

  const wallet = await client.updateWallet("wallet-1", body, keys.map((key) => signAuthorizationPayload(key.privateKey, payload)));
  assert.deepEqual(wallet.policy_ids, ["policy-1"]);
  const [request] = requests;
  assert.equal(request?.method, "PATCH");
  assert.equal(request?.url, "https://api.privy.io/v1/wallets/wallet-1");
  assert.deepEqual(request?.body, body);
  const signatures = request?.headers.get("privy-authorization-signature")?.split(",") ?? [];
  assert.equal(signatures.length, 2);
  signatures.forEach((signature, index) => {
    assert.ok(verifyAuthorizationSignature(keys[index]?.publicKey ?? "", payload, signature), `approver ${index + 1}`);
  });
});
