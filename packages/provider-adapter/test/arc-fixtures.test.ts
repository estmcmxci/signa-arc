import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AmountScaleError,
  CREDENTIAL_CHAIN_ID,
  hashHedgeCredential,
  hedgeStatuses,
  LOCAL_REPLAY_CHAIN_ID,
  recoverHedgeIssuer,
  type HedgeCredential,
} from "@fx-coverage/credentials";
import { privateKeyToAccount } from "viem/accounts";

import {
  bookedMaturity,
  mapProviderFixture,
  observeAt,
  signHedgeCredential,
} from "../src/index.ts";

// The Arc EUR/USD demo, EED.md §5: a 1.000000 USD settlement obligation
// against one forward, a 500 bps haircut and a 24h credentialMaxAge (PRD §7).
const EXPOSURE = 1_000_000n;
const HAIRCUT_BPS = 500n;
const CREDENTIAL_MAX_AGE = 86_400n;

const LOCAL_TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const facilityId =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const registry = "0x0000000000000000000000000000000000001234";

const [active, refreshed, restored, cancelled] = await Promise.all(
  ["active", "refreshed", "restored", "cancelled"].map(loadArcFixture),
);
const sequence = [active, refreshed, restored, cancelled];

test("restores with a strictly higher sequence, never a replay (E-FIX-1)", () => {
  const hedges = sequence.map((fixture) => mapProviderFixture(fixture, facilityId));
  // Sequence 3 was the cancellation before restoration existed. It is retired,
  // not reissued, so no sequence number ever names two different payloads.
  assert.deepEqual(
    hedges.map((hedge) => hedge.sequence),
    [1n, 2n, 4n, 5n],
  );
  assert.deepEqual(
    hedges.map((hedge) => hedge.observedAt),
    ["08", "09", "10", "11"].map((hour) => seconds(`2026-09-10T${hour}:00:00.000Z`)),
  );
  const [booked] = hedges;
  for (const hedge of hedges) {
    assert.equal(hedge.tradeIdCommitment, booked?.tradeIdCommitment);
    assert.equal(hedge.maturity, booked?.maturity);
  }

  // Restoration carries the booked notional, but is a new assertion.
  const original = mapProviderFixture(active, facilityId);
  const restoration = mapProviderFixture(restored, facilityId);
  assert.equal(restoration.remainingNotional, original.remainingNotional);
  assert.notEqual(
    hashHedgeCredential(CREDENTIAL_CHAIN_ID, registry, restoration),
    hashHedgeCredential(CREDENTIAL_CHAIN_ID, registry, original),
  );
});

test("produces 10000 → 6840 → 10000 bps, then 0 on cancellation", () => {
  const hedges = sequence.map((fixture) => mapProviderFixture(fixture, facilityId));
  assert.deepEqual(
    hedges.map((hedge) => hedge.remainingNotional),
    [1_060_000n, 720_000n, 1_060_000n, 0n],
  );
  assert.deepEqual(
    hedges.map((hedge) => hedge.status),
    [hedgeStatuses.ACTIVE, hedgeStatuses.ACTIVE, hedgeStatuses.ACTIVE, hedgeStatuses.CANCELLED],
  );
  // 1.060000 × 0.95 = 1.007000, counted at the 1.000000 exposure: over-hedging
  // is visible, never counted (R-F2-3). 0.720000 × 0.95 = 0.684000.
  assert.deepEqual(
    hedges.map((hedge) => coverage(hedge).grossEligible),
    [1_007_000n, 684_000n, 1_007_000n, 0n],
  );
  assert.deepEqual(
    hedges.map((hedge) => coverage(hedge).coverageBps),
    [10_000n, 6_840n, 10_000n, 0n],
  );
});

test("checked-in fixtures are current on their own date and stale by the 12th", () => {
  const hedges = sequence.map((fixture) => mapProviderFixture(fixture, facilityId));
  const lastObservation = seconds("2026-09-10T11:00:00.000Z");
  assert.ok(hedges.every((hedge) => isCurrent(hedge, lastObservation)));

  // The target submission date. Fixed dates keep local tests deterministic,
  // and cannot carry a public run.
  const targetDate = seconds("2026-09-12T12:00:00.000Z");
  assert.ok(hedges.every((hedge) => !isCurrent(hedge, targetDate)));
});

test("a public run re-observes each fixture at a recorded chain timestamp (E-FIX-2)", () => {
  const start = { timestamp: seconds("2026-09-12T16:00:00.000Z") };
  const maturity = bookedMaturity(active, start);
  // The checked-in trade's tenor, 2026-09-10 → 2027-03-15.
  assert.equal(maturity - start.timestamp, 186n * 86_400n);

  // One recorded block per signed observation, as the run moves along.
  const steps = [
    [active, 0n],
    [refreshed, 45n],
    [restored, 90n],
    [cancelled, 135n],
  ] as const;
  const hedges = steps.map(([template, offset]) =>
    mapProviderFixture(
      observeAt(template, { timestamp: start.timestamp + offset }, maturity),
      facilityId,
    ),
  );
  const checkedIn = sequence.map((fixture) => mapProviderFixture(fixture, facilityId));

  hedges.forEach((hedge, index) => {
    assert.equal(hedge.observedAt, start.timestamp + (steps[index]?.[1] ?? -1n));
    assert.equal(hedge.validUntil - hedge.observedAt, CREDENTIAL_MAX_AGE);
    assert.equal(hedge.maturity, maturity);
    assert.ok(isCurrent(hedge, hedge.observedAt));
    assert.ok(isCurrent(hedge, hedge.observedAt + CREDENTIAL_MAX_AGE));
    assert.notEqual(hedge.sourceCommitment, checkedIn[index]?.sourceCommitment);
  });

  // Only time moved: trade, amount, status and sequence are the fixture's own.
  assert.deepEqual(hedges.map(untimed), checkedIn.map(untimed));
  assert.deepEqual(
    hedges.map((hedge) => coverage(hedge).coverageBps),
    [10_000n, 6_840n, 10_000n, 0n],
  );
});

test("a generated observation signs for chain 5042002 and reproduces from its saved JSON (E-FIX-3)", async () => {
  const start = { timestamp: seconds("2026-09-12T16:00:00.000Z") };
  const fixture = observeAt(
    restored,
    { timestamp: start.timestamp + 90n },
    bookedMaturity(active, start),
  );
  const signed = await signHedgeCredential({
    credential: mapProviderFixture(fixture, facilityId),
    chainId: CREDENTIAL_CHAIN_ID,
    verifyingContract: registry,
    privateKey: LOCAL_TEST_PRIVATE_KEY,
  });

  const saved = mapProviderFixture(JSON.parse(JSON.stringify(fixture)) as unknown, facilityId);
  assert.deepEqual(saved, signed.credential);
  assert.equal(
    await recoverHedgeIssuer(CREDENTIAL_CHAIN_ID, registry, saved, signed.signature),
    privateKeyToAccount(LOCAL_TEST_PRIVATE_KEY).address,
  );
  assert.notEqual(hashHedgeCredential(LOCAL_REPLAY_CHAIN_ID, registry, saved), signed.digest);
});

test("maturity is booked at sequence 1, and nothing is observed past it", () => {
  const start = { timestamp: seconds("2026-09-12T16:00:00.000Z") };
  assert.throws(() => bookedMaturity(refreshed, start), /sequence 1/);
  const maturity = bookedMaturity(active, start);
  assert.throws(
    () => observeAt(refreshed, { timestamp: maturity + 1n }, maturity),
    /maturity/,
  );
});

test("a native-scaled amount in a fixture is refused at the credential boundary (E-FIX-4)", () => {
  // 1.06 USDC read from Arc's 18-decimal native view and formatted as though
  // it were the 6-decimal ERC-20 view: the 10^12 bug, arriving as a string.
  const nativeScaled = structuredClone(active) as { trade: { remaining_buy_amount: string } };
  nativeScaled.trade.remaining_buy_amount = "1060000000000.000000";
  assert.throws(() => mapProviderFixture(nativeScaled, facilityId), AmountScaleError);
});

/**
 * Test oracle for R-F2-1 … R-F2-4 over a single hedge, mirroring
 * CoverageEngine.evaluate. It checks the fixture arithmetic; it is not a
 * verdict. Only the chain rules on coverage (R-F4-2).
 */
function coverage(hedge: HedgeCredential) {
  const grossEligible =
    hedge.status === hedgeStatuses.ACTIVE
      ? (hedge.remainingNotional * (10_000n - HAIRCUT_BPS)) / 10_000n
      : 0n;
  const countedEligible = grossEligible < EXPOSURE ? grossEligible : EXPOSURE;
  return { grossEligible, coverageBps: (countedEligible * 10_000n) / EXPOSURE };
}

/** R-F1-4's time conditions, as CoverageEngine applies them at `now`. */
function isCurrent(hedge: HedgeCredential, now: bigint): boolean {
  return (
    hedge.observedAt <= now &&
    now <= hedge.validUntil &&
    now - hedge.observedAt <= CREDENTIAL_MAX_AGE
  );
}

function untimed({
  observedAt,
  validUntil,
  maturity,
  sourceCommitment,
  ...fields
}: HedgeCredential) {
  return fields;
}

function seconds(iso: string): bigint {
  return BigInt(Date.parse(iso) / 1_000);
}

async function loadArcFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/arc-forward-${name}.json`, import.meta.url), "utf8"),
  ) as unknown;
}
