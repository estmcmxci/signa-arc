import assert from "node:assert/strict";
import test from "node:test";

import { numberToHex } from "viem";

import { SignaError, readDeploymentStatus } from "../src/index.ts";
import { FIXTURE_BLOCK, fakeArcClient, type FakeArcOptions } from "./fixtures/arc-rpc.ts";

async function refusal(options: FakeArcOptions, rpcUrl?: string): Promise<SignaError> {
  const { client, manifest } = fakeArcClient(options);
  try {
    await readDeploymentStatus(client, manifest, rpcUrl ?? manifest.rpcUrl);
  } catch (error) {
    assert.ok(error instanceof SignaError, `expected a SignaError, got ${String(error)}`);
    return error;
  }
  assert.fail("readDeploymentStatus succeeded");
}

test("status checks chain, code and wiring, with every read pinned to one block", async () => {
  const { client, requests, manifest } = fakeArcClient();
  const status = await readDeploymentStatus(client, manifest, manifest.rpcUrl);

  assert.equal(status.chainId, 5_042_002);
  assert.deepEqual(status.block, {
    number: "61500000",
    hash: FIXTURE_BLOCK.hash,
    timestamp: new Date(Number(FIXTURE_BLOCK.timestamp) * 1_000).toISOString(),
  });
  assert.deepEqual(
    status.checks.map((check) => check.check),
    [
      "chain",
      "code.facilityRegistry",
      "code.credentialRegistry",
      "code.coverageEngine",
      "code.covenantVault",
      "vault.facilityId",
      "vault.facilityRegistry",
      "vault.coverageEngine",
      "vault.settlementAsset",
      "coverageEngine.facilityRegistry",
      "coverageEngine.credentialRegistry",
      "credentialRegistry.facilityRegistry",
      "facilityRegistry.facilityExists",
    ],
  );
  const pinned = requests.filter((request) => request.method === "eth_call" || request.method === "eth_getCode");
  assert.equal(pinned.length, 12, "four code reads and eight contract reads");
  assert.ok(pinned.every((request) => request.params[1] === numberToHex(FIXTURE_BLOCK.number)), "every read uses the same block");
});

test("an RPC on another chain is CHAIN_MISMATCH, and nothing else is read", async () => {
  const { client, requests, manifest } = fakeArcClient({ chainId: 1 });
  await assert.rejects(readDeploymentStatus(client, manifest, manifest.rpcUrl), (error: unknown) => {
    return error instanceof SignaError && error.code === "CHAIN_MISMATCH" && /reports chain 1; this manifest is for Arc Testnet \(5042002\)/.test(error.message);
  });
  assert.deepEqual(requests.map((request) => request.method), ["eth_chainId"]);
});

test("a deployment that does not match the manifest is DEPLOYMENT_MISMATCH, never an empty success", async () => {
  const { manifest } = fakeArcClient();
  const { contracts } = manifest;
  const cases: [string, FakeArcOptions, RegExp][] = [
    ["no code at the engine", { missingCode: contracts.coverageEngine.address }, /no contract code at coverageEngine 0x3341B76fEFF4CE691781fEAa4C76EA95479b9b6b/],
    ["vault bound to another facility", { vaultFacilityId: `0x${"11".repeat(32)}` }, /is bound to facility 0x1111.*not the manifest's 0x899d/],
    ["vault wired to another engine", { vaultCoverageEngine: contracts.facilityRegistry.address }, /vault\.coverageEngine is 0xB54f.*but the manifest names 0x3341/],
    ["facility missing from the registry", { facilityExists: false }, /does not exist in registry/],
    ["a read that returns no data", { emptyCall: "settlementAsset" }, /CovenantVault\.settlementAsset\(\) reverted or returned no data/],
  ];
  for (const [label, options, pattern] of cases) {
    const error = await refusal(options);
    assert.equal(error.code, "DEPLOYMENT_MISMATCH", label);
    assert.match(error.message, pattern, label);
  }
});

test("an unreachable RPC is RPC_UNAVAILABLE and retryable, and never prints the raw URL", async () => {
  const secret = "https://arc.example/v2/abcdefghijklmnop1234?apikey=s3cret";
  const error = await refusal({ failWith: new Error(`connect ECONNREFUSED ${secret}`) }, secret);
  assert.equal(error.code, "RPC_UNAVAILABLE");
  assert.equal(error.retryable, true);
  assert.match(error.message, /https:\/\/arc\.example\/v2\/redacted\?apikey=redacted/);
  assert.doesNotMatch(error.message, /s3cret|abcdefghijklmnop1234/);
});
