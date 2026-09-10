import assert from "node:assert/strict";
import test from "node:test";

import { keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  broadcastAndConfirm,
  describeAdminCall,
  encodeCreateWaiver,
  loadManifest,
  pinAdminTransaction,
  reasonCommitment,
  toPrivyTransaction,
  verifySignedTransaction,
  type ArcGateway,
  type PinnedTransaction,
} from "../src/arc.ts";
import { nextFacilitySetupStep, quorumFacilityPlan } from "../src/facility-setup.ts";

const LOCAL_TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const adminWallet = privateKeyToAccount(LOCAL_TEST_PRIVATE_KEY);
const VAULT: Address = "0x1970feb699BCd4dd268a3A8c2590929fc8fd67c2";
const COMMITMENT = reasonCommitment("mock signer outage");

const pinned: PinnedTransaction = {
  chainId: 5_042_002,
  from: adminWallet.address,
  to: VAULT,
  data: encodeCreateWaiver(86_400, COMMITMENT),
  nonce: 7,
  gas: 120_000n,
  maxFeePerGas: 50_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
};

type Overrides = { to?: Address; data?: Hex; nonce?: number; chainId?: number; gas?: bigint; maxFeePerGas?: bigint; value?: bigint };

function signed(overrides: Overrides = {}, key: Hex = LOCAL_TEST_PRIVATE_KEY): Promise<Hex> {
  return privateKeyToAccount(key).signTransaction({
    type: "eip1559",
    chainId: overrides.chainId ?? pinned.chainId,
    to: overrides.to ?? pinned.to,
    data: overrides.data ?? pinned.data,
    value: overrides.value ?? 0n,
    nonce: overrides.nonce ?? pinned.nonce,
    gas: overrides.gas ?? pinned.gas,
    maxFeePerGas: overrides.maxFeePerGas ?? pinned.maxFeePerGas,
    maxPriorityFeePerGas: pinned.maxPriorityFeePerGas,
  });
}

function fakeArc(overrides: Partial<ArcGateway> = {}): ArcGateway & { calls: string[] } {
  const calls: string[] = [];
  const base: ArcGateway = {
    chainId: async () => 5_042_002,
    simulate: async () => {
      calls.push("simulate");
    },
    estimateGas: async () => {
      calls.push("estimateGas");
      return 100_000n;
    },
    feesPerGas: async () => ({ maxFeePerGas: 25_000_000_000n, maxPriorityFeePerGas: 0n }),
    pendingNonce: async () => 7,
    sendRawTransaction: async (raw) => {
      calls.push("send");
      return keccak256(raw);
    },
    waitForReceipt: async (hash) => ({ transactionHash: hash, status: "success", blockNumber: 1n, logs: [] }),
    facilityExists: async () => false,
    getFacility: async () => {
      throw new Error("no facility");
    },
    isExposureIssuer: async () => false,
    isHedgeIssuer: async () => false,
    vaultStatus: async () => {
      throw new Error("no vault");
    },
  };
  return Object.assign(base, overrides, { calls });
}

test("createWaiver calldata is the vector the authorization tests sign", () => {
  assert.equal(
    encodeCreateWaiver(86_400, COMMITMENT),
    "0x6738bca70000000000000000000000000000000000000000000000000000000000015180a7289906731da2d914d0e1aedbabe029e40e24f2b456644c95c136a03892e2d1",
  );
  assert.deepEqual(describeAdminCall(pinned.data), { functionName: "createWaiver", args: [86_400, COMMITMENT] });
});

test("the Privy transaction carries every pinned field, quantities as hex", () => {
  assert.deepEqual(toPrivyTransaction(pinned), {
    to: VAULT,
    data: pinned.data,
    value: "0x0",
    chain_id: 5_042_002,
    nonce: "0x7",
    gas_limit: "0x1d4c0",
    max_fee_per_gas: "0xba43b7400",
    max_priority_fee_per_gas: "0x3b9aca00",
    type: 2,
  });
});

test("a transaction signed exactly as approved, by the admin wallet, verifies", async () => {
  const raw = await signed();
  assert.deepEqual(await verifySignedTransaction(raw, pinned), { signer: adminWallet.address, hash: keccak256(raw) });
});

test("zero fields verify although RLP drops them: a zero nonce or priority fee is not a mismatch", async () => {
  const zeroes: PinnedTransaction = { ...pinned, nonce: 0, maxPriorityFeePerGas: 0n };
  const raw = await adminWallet.signTransaction({
    type: "eip1559",
    chainId: zeroes.chainId,
    to: zeroes.to,
    data: zeroes.data,
    value: 0n,
    nonce: 0,
    gas: zeroes.gas,
    maxFeePerGas: zeroes.maxFeePerGas,
    maxPriorityFeePerGas: 0n,
  });
  assert.equal((await verifySignedTransaction(raw, zeroes)).signer, adminWallet.address);
});

test("any field that differs from the approved transaction is refused", async () => {
  const variants: [string, Overrides][] = [
    ["to", { to: "0x000000000000000000000000000000000000dEaD" }],
    ["data", { data: encodeCreateWaiver(86_401, COMMITMENT) }],
    ["nonce", { nonce: 8 }],
    ["chainId", { chainId: 1 }],
    ["gas", { gas: 120_001n }],
    ["fee cap", { maxFeePerGas: pinned.maxFeePerGas + 1n }],
    ["value", { value: 1n }],
  ];
  for (const [label, overrides] of variants) {
    await assert.rejects(verifySignedTransaction(await signed(overrides), pinned), /differs from the approved one/, label);
  }
});

test("a transaction signed by anyone but the admin wallet is refused", async () => {
  await assert.rejects(verifySignedTransaction(await signed({}, OTHER_TEST_PRIVATE_KEY), pinned), /not the admin wallet/);
});

test("pinning simulates first, then pins nonce, gas with headroom and a doubled fee cap", async () => {
  const arc = fakeArc();
  const tx = await pinAdminTransaction(arc, { from: adminWallet.address, to: VAULT, data: pinned.data });
  assert.deepEqual(arc.calls, ["simulate", "estimateGas"]);
  assert.equal(tx.nonce, 7);
  assert.equal(tx.gas, 120_000n);
  assert.equal(tx.maxFeePerGas, 50_000_000_000n);

  const reverting = fakeArc({
    simulate: async () => {
      throw new Error("simulation reverted: InvalidWaiver()");
    },
  });
  await assert.rejects(pinAdminTransaction(reverting, { from: adminWallet.address, to: VAULT, data: pinned.data }), /InvalidWaiver/);
  assert.deepEqual(reverting.calls, [], "nothing is estimated for a call that reverts");

  await assert.rejects(
    pinAdminTransaction(fakeArc({ chainId: async () => 1 }), { from: adminWallet.address, to: VAULT, data: pinned.data }),
    /not Arc Testnet/,
  );
});

test("broadcast asserts the receipt, and treats an already-known transaction as sent", async () => {
  const raw = await signed();
  assert.equal((await broadcastAndConfirm(fakeArc(), raw)).status, "success");
  const reverted = fakeArc({ waitForReceipt: async (hash) => ({ transactionHash: hash, status: "reverted", blockNumber: 1n, logs: [] }) });
  await assert.rejects(broadcastAndConfirm(reverted, raw), /receipt status reverted/);
  const known = fakeArc({
    sendRawTransaction: async () => {
      throw new Error("already known");
    },
  });
  assert.equal((await broadcastAndConfirm(known, raw)).transactionHash, keccak256(raw));
});

test("facility setup proposes exactly what the chain is missing, in order, then the vault deploy", async () => {
  const manifest = loadManifest();
  const plan = quorumFacilityPlan(manifest, adminWallet.address);
  assert.equal(plan.policy.admin, adminWallet.address);
  assert.equal(plan.policy.operator, manifest.roles.operator);
  assert.equal(plan.policy.minCoverageBps, 10_000);
  assert.equal(plan.policy.reserveAmount, 500_000n);
  assert.equal(plan.policy.settlementCurrency, "0x555344");
  assert.equal(plan.policy.exposureCurrency, "0x455552");
  assert.equal(plan.facilityId, manifest.facility.id, "the manifest records the quorum's facility");

  const state = { exists: false, exposure: false, hedge: false, frozen: false, admin: adminWallet.address as Address };
  const arc = fakeArc({
    facilityExists: async () => state.exists,
    getFacility: async () => ({ ...plan.policy, admin: state.admin, frozen: state.frozen }),
    isExposureIssuer: async () => state.exposure,
    isHedgeIssuer: async () => state.hedge,
  });
  const kinds: string[] = [];
  const functions: string[] = [];
  for (const advance of [
    () => (state.exists = true),
    () => (state.exposure = true),
    () => (state.hedge = true),
    () => (state.frozen = true),
  ]) {
    const step = await nextFacilitySetupStep(arc, plan);
    kinds.push(step.kind);
    if (step.kind !== "complete") {
      assert.equal(step.to, plan.registry);
      functions.push(describeAdminCall(step.data).functionName);
    }
    advance();
  }
  assert.deepEqual(kinds, ["facility.create", "facility.setExposureIssuer", "facility.setHedgeIssuer", "facility.freeze"]);
  assert.deepEqual(functions, ["createFacility", "setExposureIssuer", "setHedgeIssuer", "freezeFacility"]);
  const done = await nextFacilitySetupStep(arc, plan);
  assert.equal(done.kind, "complete");
  assert.match(done.description, new RegExp(`--constructor-args ${plan.facilityId} ${plan.registry} ${plan.engine}`));

  state.admin = "0x000000000000000000000000000000000000dEaD";
  await assert.rejects(nextFacilitySetupStep(arc, plan), /already exists with admin/);
});
