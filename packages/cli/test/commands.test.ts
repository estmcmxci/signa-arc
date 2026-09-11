import assert from "node:assert/strict";
import test from "node:test";

import { encodeErrorResult, type Hex } from "viem";

import { bundledManifest, covenantVaultAbi } from "@signa/client";

import { envelopeFile, onlyJson, runSigna } from "./helpers.ts";

const manifest = bundledManifest();
const noClient = {
  publicClient: () => {
    throw new Error("this command must not create an RPC client");
  },
};

test("facility show --json: a live report of the policy, roles, vault and stored state at one block", async () => {
  const run = await runSigna(["facility", "show", "--json"]);
  assert.equal(run.exitCode, 0);
  const report = onlyJson(run);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, "report");
  assert.equal(report.dataMode, "live");
  assert.equal(report.context.block.number, "61500000");
  assert.equal(report.context.vault, manifest.contracts.covenantVault.address);
  assert.equal(report.policy.minCoverageBps, 10_000);
  assert.equal(report.covenant.storedState, "COMPLIANT");
  assert.deepEqual(report.manifestDifferences, []);
  assert.match(report.scope, /not a fresh coverage evaluation/);
});

test("coverage show --json: the engine's verdicts, with the stored state reported separately", async () => {
  const run = await runSigna(["coverage", "show", "--json"], { rpc: { coverage: { compliant: false, coverageBps: 6_840, resultReason: 3 }, storedState: 1 } });
  assert.equal(run.exitCode, 0);
  const report = onlyJson(run);
  assert.equal(report.evaluation.compliant, false);
  assert.equal(report.evaluation.resultReason, "BELOW_THRESHOLD");
  assert.equal(report.covenant.storedState, "COMPLIANT");
  assert.match(report.explanation, /not compliant at this block/);
  assert.match(report.scope, /Coverage evidence expires/);
});

test("credentials list --json: current assertions and their age, with no eligibility verdict", async () => {
  const run = await runSigna(["credentials", "list", "--json"]);
  assert.equal(run.exitCode, 0);
  const report = onlyJson(run);
  assert.equal(report.dataMode, "live");
  assert.equal(report.exposure.sequence, "1");
  assert.equal(report.hedges[0].status, "ACTIVE");
  assert.equal(report.hedges[0].eligibility, undefined);
  assert.match(report.note, /not the same as eligible/);
});

test("credentials inspect: a recorded signed envelope, checked offline with no block and no RPC client", async () => {
  const path = envelopeFile();
  const run = await runSigna(["credentials", "inspect", path, "--json"], { dependencies: noClient });
  assert.equal(run.exitCode, 0, run.stdout);
  const report = onlyJson(run);
  assert.equal(report.dataMode, "offline");
  assert.equal(report.context.block, undefined, "offline output carries no block");
  assert.equal(report.context.input.path, path);
  assert.match(report.context.input.sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.envelope.recoveredSigner, manifest.roles.hedgeIssuer);
  assert.equal(report.envelope.manifestRole, "hedgeIssuer");
  assert.equal(report.envelope.digest, "0xdcc126e864cbd24517abef3cbf2166bed00f6131ef75b101ab0244a8c7b5d396");
  assert.ok(report.notEstablished.some((line: string) => /currently authorizes the signer/.test(line)));
  assert.ok(report.notEstablished.some((line: string) => /count toward coverage/.test(line)));
});

test("credentials inspect refuses a forged, foreign, malformed or unreadable envelope, exiting 1", async () => {
  const cases: [string, string, string, RegExp][] = [
    ["forged digest", envelopeFile((e) => (e.digest = `0x${"00".repeat(32)}`)), "INVALID_SIGNATURE", /claims digest/],
    ["claimed issuer", envelopeFile((e) => (e.issuer = manifest.roles.exposureIssuer)), "INVALID_SIGNATURE", /not the claimed issuer/],
    ["another facility", envelopeFile((e) => (e.credential.facilityId = `0x${"11".repeat(32)}`)), "INVALID_INPUT", /is for facility/],
    ["another chain", envelopeFile((e) => (e.domain.chainId = 1)), "INVALID_INPUT", /signed for chain 1/],
    ["malformed width", envelopeFile((e) => (e.credential.baseCurrency = "USD")), "INVALID_INPUT", /exactly 3 bytes/],
    ["not JSON", envelopeFile(undefined, "{ not json"), "INVALID_INPUT", /is not valid JSON/],
    ["missing file", "/nonexistent/envelope.json", "INVALID_INPUT", /cannot read the envelope at \/nonexistent\/envelope\.json \(ENOENT\)/],
  ];
  for (const [label, path, code, pattern] of cases) {
    const run = await runSigna(["credentials", "inspect", path, "--json"], { dependencies: noClient });
    assert.equal(run.exitCode, 1, label);
    const error = onlyJson(run);
    assert.equal(error.code, code, label);
    assert.match(error.message, pattern, label);
  }
});

test("draw simulate --json: a permitted draw and a refused one are both completed inquiries, exiting 0", async () => {
  const permitted = await runSigna(["draw", "simulate", "--amount", "1", "--json"]);
  assert.equal(permitted.exitCode, 0);
  const allowed = onlyJson(permitted);
  assert.equal(allowed.kind, "simulation");
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.outcome, "permitted");
  assert.deepEqual(allowed.request.amount, { units: "1000000", usdc: "1.000000" });
  assert.equal(allowed.request.sender, manifest.roles.operator);
  assert.match(allowed.scope, /Nothing was sent and no state changed/);

  const refusedRun = await runSigna(["draw", "simulate", "--amount", "1", "--json"], {
    rpc: { coverage: { compliant: false, coverageBps: 6_840, resultReason: 3 }, draw: { revert: encodeErrorResult({ abi: covenantVaultAbi, errorName: "DrawNotAllowed", args: [2] }) } },
  });
  assert.equal(refusedRun.exitCode, 0, "a refusal is a valid answer, not a failure");
  const refused = onlyJson(refusedRun);
  assert.equal(refused.allowed, false);
  assert.equal(refused.outcome, "refused");
  assert.equal(refused.refusal.error, "DrawNotAllowed");
  assert.deepEqual(refused.refusal.args, { state: "CURE" });
  assert.match(refused.refusal.data, /^0x[0-9a-f]+$/);
});

test("draw simulate: a bad amount fails before any RPC client exists, and a failed simulation exits 1", async () => {
  for (const amount of ["0", "1e6", "-1", "1.0000001", "one"]) {
    const run = await runSigna(["draw", "simulate", "--amount", amount, "--json"], { dependencies: noClient });
    assert.equal(run.exitCode, 1, amount);
    assert.equal(onlyJson(run).code, "INVALID_INPUT", amount);
  }
  const missing = await runSigna(["draw", "simulate", "--json"], { dependencies: noClient });
  assert.equal(missing.exitCode, 1);
  assert.equal(onlyJson(missing).code, "VALIDATION_ERROR", "--amount is required");

  const cases: [string, Parameters<typeof runSigna>[1], string][] = [
    ["undecodable revert", { rpc: { draw: { revert: "0xdeadbeef" as Hex } } }, "SIMULATION_FAILED"],
    ["transport failure", { rpc: { draw: "transport-failure" } }, "RPC_UNAVAILABLE"],
  ];
  for (const [label, options, code] of cases) {
    const run = await runSigna(["draw", "simulate", "--amount", "1", "--json"], options);
    assert.equal(run.exitCode, 1, label);
    assert.equal(onlyJson(run).code, code, label);
  }
});
