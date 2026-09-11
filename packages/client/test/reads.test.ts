import assert from "node:assert/strict";
import test from "node:test";

import { encodeErrorResult, numberToHex, type Hex } from "viem";

import { SignaError, covenantVaultAbi, readCoverage, readCredentials, readFacility, simulateDraw } from "../src/index.ts";
import { FIXTURE_BLOCK, FIXTURE_TRADE_ID, fakeArcClient, type FakeArcOptions } from "./fixtures/arc-rpc.ts";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const pinnedToOneBlock = (requests: { method: string; params: readonly unknown[] }[]) =>
  requests.filter((request) => request.method === "eth_call").every((request) => request.params[1] === numberToHex(FIXTURE_BLOCK.number));

test("facility show reads the frozen policy, roles, vault and stored state, all at one block", async () => {
  const { client, requests, manifest } = fakeArcClient();
  const report = await readFacility(client, manifest, manifest.rpcUrl);
  assert.equal(report.block.number, "61500000");
  assert.equal(report.policy.minCoverageBps, 10_000);
  assert.equal(report.policy.settlementCurrency, "USD");
  assert.equal(report.policy.exposureCurrency, "EUR");
  assert.deepEqual(report.policy.reserve, { units: "500000", usdc: "0.500000" });
  assert.equal(report.policy.frozen, true);
  assert.equal(report.roles.operator, manifest.roles.operator);
  assert.deepEqual(report.roles.hedgeIssuer, { address: manifest.roles.hedgeIssuer, approved: true });
  assert.deepEqual(report.vault.balance, { units: "2500000", usdc: "2.500000" });
  assert.deepEqual(report.vault.availableToDraw, { units: "2000000", usdc: "2.000000" });
  assert.equal(report.covenant.storedState, "COMPLIANT");
  assert.deepEqual(report.covenant.waiver, { active: false, endsAt: null, reasonCommitment: null, stateBeforeWaiver: null });
  assert.deepEqual(report.manifestDifferences, []);
  assert.ok(pinnedToOneBlock(requests));
});

test("facility show reports where the chain differs from the manifest, rather than hiding it", async () => {
  const { client, manifest } = fakeArcClient({ policyOperator: DEAD });
  const report = await readFacility(client, manifest, manifest.rpcUrl);
  assert.deepEqual(report.manifestDifferences, [{ field: "roles.operator", manifest: manifest.roles.operator, chain: DEAD }]);
});

test("coverage show reports the engine's verdicts at one block, and the stored state separately", async () => {
  const { client, requests, manifest } = fakeArcClient({ coverage: { compliant: false, coverageBps: 6_840, resultReason: 3 }, storedState: 1 });
  const report = await readCoverage(client, manifest, manifest.rpcUrl);
  assert.equal(report.evaluation.compliant, false);
  assert.equal(report.evaluation.coverageBps, 6_840);
  assert.equal(report.evaluation.resultReason, "BELOW_THRESHOLD");
  assert.deepEqual(report.evaluation.countedEligible, { units: "1000000", usdc: "1.000000" });
  assert.deepEqual(report.hedges, [{ tradeIdCommitment: FIXTURE_TRADE_ID, eligibility: "ELIGIBLE", adjustedNotional: { units: "1007000", usdc: "1.007000" } }]);
  assert.deepEqual(report.covenant, { storedState: "COMPLIANT", activeWaiver: false });
  assert.match(report.explanation, /Coverage is 6840 of the 10000 bps required: not compliant at this block \(BELOW_THRESHOLD\)\./);
  assert.match(report.explanation, /The vault's stored state is COMPLIANT\. The vault records it and updates it only when it syncs/);
  assert.ok(pinnedToOneBlock(requests));
});

test("coverage show names ineligible credentials: a stale exposure and an expired hedge", async () => {
  const { client, manifest } = fakeArcClient({ coverage: { compliant: false, coverageBps: 0, exposureReason: 7, resultReason: 2 }, exposureReason: 7, hedgeReason: 7 });
  const report = await readCoverage(client, manifest, manifest.rpcUrl);
  assert.equal(report.exposure.eligibility, "STALE");
  assert.equal(report.hedges[0]?.eligibility, "EXPIRED");
  assert.match(report.explanation, /not compliant at this block \(INVALID_EXPOSURE\)\. The exposure credential is STALE\. 1 of 1 hedge\(s\) are not eligible: EXPIRED\./);
});

test("credentials list reports current assertions, sequences and age at the report block, with no verdict", async () => {
  const { client, manifest } = fakeArcClient();
  const report = await readCredentials(client, manifest, manifest.rpcUrl);
  assert.equal(report.credentialMaxAgeSeconds, 86_400);
  assert.equal(report.exposure?.sequence, "1");
  assert.equal(report.exposure?.issuer, manifest.roles.exposureIssuer);
  assert.deepEqual(report.exposure?.outstandingValue, { units: "1000000", usdc: "1.000000" });
  assert.equal(report.exposure?.ageSeconds, 3_600);
  assert.equal(report.exposure?.validForSeconds, 82_800);
  assert.equal(report.hedges.length, 1);
  assert.equal(report.hedges[0]?.status, "ACTIVE");
  assert.equal(report.hedges[0]?.sequence, "6");
  assert.equal("eligibility" in (report.hedges[0] ?? {}), false, "eligibility is coverage show's, not this report's");
  assert.match(report.note, /Accepted by the registry is not the same as eligible/);

  const empty = fakeArcClient({ noExposure: true });
  assert.equal((await readCredentials(empty.client, empty.manifest, empty.manifest.rpcUrl)).exposure, null);
});

test("draw simulate runs the real vault's draw as the operator, at one block: a permitted draw", async () => {
  const { client, requests, manifest } = fakeArcClient();
  const result = await simulateDraw(client, manifest, manifest.rpcUrl, 1_000_000n);
  assert.equal(result.allowed, true);
  assert.equal(result.outcome, "permitted");
  assert.deepEqual(result.request, { function: "draw", amount: { units: "1000000", usdc: "1.000000" }, sender: manifest.roles.operator, vault: manifest.contracts.covenantVault.address });
  const draw = requests.find((request) => request.method === "eth_call" && String((request.params[0] as { data: string }).data).startsWith("0x3b304147"));
  assert.ok(draw, "the vault's draw(uint256) was called");
  assert.equal(String((draw.params[0] as { from?: string }).from).toLowerCase(), manifest.roles.operator.toLowerCase(), "sent as the operator");
  assert.equal(draw.params[1], numberToHex(FIXTURE_BLOCK.number));
});

test("draw simulate decodes a refusal in CURE and a reserve refusal, as completed inquiries", async () => {
  const cure = fakeArcClient({
    coverage: { compliant: false, coverageBps: 6_840, resultReason: 3 },
    draw: { revert: encodeErrorResult({ abi: covenantVaultAbi, errorName: "DrawNotAllowed", args: [2] }) },
  });
  const refused = await simulateDraw(cure.client, cure.manifest, cure.manifest.rpcUrl, 1_000_000n);
  assert.equal(refused.allowed, false);
  assert.equal(refused.outcome, "refused");
  assert.equal(refused.refusal?.error, "DrawNotAllowed");
  assert.deepEqual(refused.refusal?.args, { state: "CURE" });
  assert.match(refused.refusal?.explanation ?? "", /after its own covenant sync the facility is CURE.*6840 of 10000 bps, not compliant \(BELOW_THRESHOLD\)/);

  const reserve = fakeArcClient({
    draw: { revert: encodeErrorResult({ abi: covenantVaultAbi, errorName: "ReserveViolation", args: [2_500_000n, 2_100_000n, 500_000n] }) },
  });
  const tooMuch = await simulateDraw(reserve.client, reserve.manifest, reserve.manifest.rpcUrl, 2_100_000n);
  assert.equal(tooMuch.allowed, false);
  assert.deepEqual(tooMuch.refusal?.args, { balance: "2.500000", requested: "2.100000", reserve: "0.500000" });
  assert.match(tooMuch.refusal?.explanation ?? "", /below its reserve/);
});

test("draw simulate: an undecodable revert, a revert without data and a transport failure are failed inquiries", async () => {
  const cases: [string, NonNullable<FakeArcOptions["draw"]>, string][] = [
    ["undecodable", { revert: "0xdeadbeef" as Hex }, "SIMULATION_FAILED"],
    ["no revert data", "revert-without-data", "SIMULATION_FAILED"],
    ["transport", "transport-failure", "RPC_UNAVAILABLE"],
  ];
  for (const [label, draw, code] of cases) {
    const { client, manifest } = fakeArcClient({ draw });
    await assert.rejects(simulateDraw(client, manifest, manifest.rpcUrl, 1_000_000n), (error: unknown) => error instanceof SignaError && error.code === code, label);
  }
});

test("draw simulate refuses to simulate as anyone but the facility's operator", async () => {
  const { client, requests, manifest } = fakeArcClient({ policyOperator: DEAD });
  await assert.rejects(simulateDraw(client, manifest, manifest.rpcUrl, 1_000_000n), (error: unknown) => {
    return error instanceof SignaError && error.code === "DEPLOYMENT_MISMATCH" && /is not the facility's operator 0x0000/.test(error.message);
  });
  assert.equal(requests.some((request) => String((request.params[0] as { data?: string } | undefined)?.data ?? "").startsWith("0x3b304147")), false, "no draw was simulated");
});
