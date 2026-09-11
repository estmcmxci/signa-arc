/// <reference types="vite/client" />
import type { Address, Hex } from 'viem';
import type { BlockContext, Coverage, Exposure, Hedge, Policy, Snapshot, Verdict } from '../data/types';

// Fabricated facility states for the dedicated UI test entry, /test-ui/ (FRONTEND-PLAN
// stage 2, output/FRONTEND-CONTRACT.md). None of this is chain data. Identifiers are
// ASCII labels encoded as hex, so each decodes to "FIXTURE-…" rather than passing for
// a live hash or address. The module creates no client, holds no key and returns no
// transaction request, so a fixture verdict cannot be signed or sent.

export const FIXTURE_STATES = [
  'compliant',
  'reserve',
  'cure',
  'breach',
  'waived',
  'expired-waiver',
  'stale',
  'missing',
  'revoked',
  'maturity',
  'partial',
  'rpc-error',
  'slow',
] as const;
export type FixtureState = (typeof FIXTURE_STATES)[number];

export const SLOW_SNAPSHOT_MS = 6_000;
export const SLOW_VERDICT_MS = 1_500;
const RPC_FAILURE = 'UI fixture: this read was made to fail. No RPC endpoint was contacted.';

/** Refuses every browser context except the Vite dev server's /test-ui/ entry. */
export function assertFixtureContext(dev: boolean | undefined, pathname: string | undefined): void {
  if (pathname === undefined) return; // not a browser: focused unit tests
  if (!dev || !pathname.startsWith('/test-ui/')) {
    throw new Error('UI fixtures load only on the development /test-ui/ entry.');
  }
}
assertFixtureContext(import.meta.env?.DEV, typeof location === 'undefined' ? undefined : location.pathname);

const UNIT = 1_000_000n;
const MINUTE = 60n;
const HOUR = 3_600n;
const DAY = 86_400n;
const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as Address;

function label(text: string, bytes: 20 | 32): Hex {
  const hex = [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `0x${hex.padEnd(bytes * 2, '0').slice(0, bytes * 2)}` as Hex;
}

// The frozen policy's published values. Addresses are labels, not the deployment's.
const POLICY: Policy = {
  facilityId: label('FIXTURE-FACILITY', 32),
  settlementCurrency: '0x555344',
  exposureCurrency: '0x455552',
  minCoverageBps: 10_000,
  credentialMaxAge: 86_400,
  maturityTolerance: 604_800,
  defaultHaircutBps: 500,
  reserveAmount: 500_000n,
  curePeriod: 432_000,
  maxWaiverDuration: 259_200,
  maxActiveHedges: 8,
  settlementAsset: label('FIXTURE-USDC', 20),
  admin: label('FIXTURE-QUORUM-ADMIN', 20),
  operator: label('FIXTURE-OPERATOR', 20),
  frozen: true,
};

function coverage(
  fields: Omit<Coverage, 'outstandingValue' | 'requiredCoverageBps'>,
  outstandingValue = UNIT,
): Coverage {
  return { ...fields, outstandingValue, requiredCoverageBps: POLICY.minCoverageBps };
}
const MET = coverage({ assessed: true, compliant: true, grossEligible: 1_007_000n, countedEligible: UNIT, coverageBps: 10_000, eligibleHedgeCount: 1, totalHedgeCount: 1, exposureReason: 0, resultReason: 0 });
const BELOW = coverage({ assessed: true, compliant: false, grossEligible: 684_000n, countedEligible: 684_000n, coverageBps: 6_840, eligibleHedgeCount: 1, totalHedgeCount: 1, exposureReason: 0, resultReason: 3 });
const EXCLUDED = coverage({ assessed: true, compliant: false, grossEligible: 0n, countedEligible: 0n, coverageBps: 0, eligibleHedgeCount: 0, totalHedgeCount: 1, exposureReason: 0, resultReason: 3 });

type HedgeSpec = { remaining: bigint; reason: number; adjusted: bigint; sequence: bigint; maturityShift?: bigint };
type Spec = {
  state: number;
  balance: bigint;
  principal: bigint;
  coverage: Coverage;
  exposure: 'current' | 'aged' | 'absent';
  hedge: HedgeSpec | null;
  cureDeadlineIn: bigint | null;
  waiver?: { active: boolean; endsIn: bigint };
  /** The state a draw's own sync moves to before DrawNotAllowed; absent when the gate permits. */
  heldAs?: number;
};

const BOOKED: HedgeSpec = { remaining: 1_060_000n, reason: 0, adjusted: 1_007_000n, sequence: 1n };
const REDUCED: HedgeSpec = { remaining: 720_000n, reason: 0, adjusted: 684_000n, sequence: 2n };
const COMPLIANT: Spec = { state: 1, balance: 3n * UNIT, principal: 2n * UNIT, coverage: MET, exposure: 'current', hedge: BOOKED, cureDeadlineIn: null };
const IN_CURE = { balance: 3n * UNIT / 2n, principal: UNIT, coverage: BELOW, exposure: 'current', hedge: REDUCED } as const;

const SPECS: Record<Exclude<FixtureState, 'partial' | 'rpc-error' | 'slow'>, Spec> = {
  compliant: COMPLIANT,
  // Coverage is met; every remaining vault dollar is the retained reserve.
  reserve: { ...COMPLIANT, balance: POLICY.reserveAmount, principal: 4_500_000n },
  cure: { ...IN_CURE, state: 2, cureDeadlineIn: 4n * DAY + 6n * HOUR, heldAs: 2 },
  // The cure deadline has passed and a sync recorded BREACH.
  breach: { ...IN_CURE, state: 3, cureDeadlineIn: -2n * HOUR, heldAs: 3 },
  // An active waiver permits draws while coverage stays below policy; the reserve still applies.
  waived: { ...IN_CURE, state: 4, cureDeadlineIn: 4n * DAY, waiver: { active: true, endsIn: 45n * MINUTE } },
  // The waiver lapsed with no sync since: storage still reads WAIVED, and a draw's own
  // sync falls back to CURE, not COMPLIANT (R-F3-7).
  'expired-waiver': { ...IN_CURE, state: 4, cureDeadlineIn: 4n * DAY, waiver: { active: false, endsIn: -10n * MINUTE }, heldAs: 2 },
  // Observed 30h ago but still inside its signed validity, so the engine reports STALE
  // rather than EXPIRED. Storage still reads COMPLIANT until a sync runs.
  stale: {
    ...COMPLIANT,
    exposure: 'aged',
    coverage: coverage({ assessed: false, compliant: false, grossEligible: 0n, countedEligible: 0n, coverageBps: 0, eligibleHedgeCount: 0, totalHedgeCount: 0, exposureReason: 7, resultReason: 2 }),
    heldAs: 2,
  },
  // No exposure was ever accepted: the registry returns a zeroed record, not a failed read.
  missing: {
    state: 0,
    balance: 5n * UNIT,
    principal: 0n,
    exposure: 'absent',
    hedge: null,
    cureDeadlineIn: null,
    coverage: coverage({ assessed: false, compliant: false, grossEligible: 0n, countedEligible: 0n, coverageBps: 0, eligibleHedgeCount: 0, totalHedgeCount: 0, exposureReason: 1, resultReason: 1 }, 0n),
    heldAs: 2,
  },
  revoked: { ...COMPLIANT, state: 2, coverage: EXCLUDED, hedge: { ...BOOKED, reason: 10, adjusted: 0n }, cureDeadlineIn: 4n * DAY, heldAs: 2 },
  maturity: { ...COMPLIANT, state: 2, coverage: EXCLUDED, hedge: { ...BOOKED, reason: 9, adjusted: 0n, maturityShift: -10n * DAY }, cureDeadlineIn: 4n * DAY, heldAs: 2 },
};

function exposureRecord(kind: Spec['exposure'], now: bigint): Exposure {
  if (kind === 'absent') {
    return {
      credential: { facilityId: ZERO_HASH, exposureCurrency: '0x000000', settlementCurrency: '0x000000', outstandingValue: 0n, exposureMaturity: 0n, observedAt: 0n, validUntil: 0n, sequence: 0n, sourceCommitment: ZERO_HASH },
      issuer: ZERO_ADDRESS,
      digest: ZERO_HASH,
      acceptedAt: 0n,
      issuerEpoch: 0n,
    };
  }
  const observedAt = kind === 'aged' ? now - 30n * HOUR : now - 20n * MINUTE;
  return {
    credential: {
      facilityId: POLICY.facilityId,
      exposureCurrency: POLICY.exposureCurrency,
      settlementCurrency: POLICY.settlementCurrency,
      outstandingValue: UNIT,
      exposureMaturity: now + 186n * DAY,
      observedAt,
      validUntil: observedAt + (kind === 'aged' ? 2n * DAY : DAY),
      sequence: 1n,
      sourceCommitment: label('FIXTURE-EXPOSURE-SOURCE', 32),
    },
    issuer: label('FIXTURE-EXPOSURE-ISSUER', 20),
    digest: label('FIXTURE-EXPOSURE-DIGEST', 32),
    acceptedAt: observedAt + 5n,
    issuerEpoch: 1n,
  };
}

function hedgeRecord(spec: HedgeSpec, now: bigint, exposureMaturity: bigint): Hedge {
  const observedAt = now - 15n * MINUTE;
  return {
    credential: {
      facilityId: POLICY.facilityId,
      tradeIdCommitment: label('FIXTURE-TRADE-EUR-USD', 32),
      baseCurrency: POLICY.settlementCurrency,
      quoteCurrency: POLICY.exposureCurrency,
      remainingNotional: spec.remaining,
      maturity: exposureMaturity + (spec.maturityShift ?? 0n),
      status: 0,
      observedAt,
      validUntil: observedAt + DAY,
      sequence: spec.sequence,
      sourceCommitment: label('FIXTURE-HEDGE-SOURCE', 32),
    },
    issuer: label('FIXTURE-HEDGE-ISSUER', 20),
    digest: label('FIXTURE-HEDGE-DIGEST', 32),
    acceptedAt: observedAt + 5n,
    issuerEpoch: 1n,
    eligibilityReason: spec.reason,
    adjustedNotional: spec.adjusted,
  };
}

let blockCount = 0n;
function snapshotOf(spec: Spec, nowMs: number): Snapshot {
  const now = BigInt(Math.floor(nowMs / 1000));
  blockCount += 1n;
  const exposure = exposureRecord(spec.exposure, now);
  return {
    block: { number: blockCount, hash: label(`FIXTURE-BLOCK-${blockCount}`, 32), timestamp: now },
    receivedAt: nowMs,
    mode: 'fixture',
    policy: POLICY,
    exposure,
    coverage: spec.coverage,
    state: spec.state,
    principal: spec.principal,
    cureDeadline: spec.cureDeadlineIn === null ? 0n : now + spec.cureDeadlineIn,
    available: spec.balance > POLICY.reserveAmount ? spec.balance - POLICY.reserveAmount : 0n,
    balance: spec.balance,
    activeWaiver: spec.waiver?.active ?? false,
    waiverEndsAt: spec.waiver ? now + spec.waiver.endsIn : 0n,
    waiverReason: spec.waiver ? label('FIXTURE-WAIVER-REASON', 32) : ZERO_HASH,
    stateBeforeWaiver: spec.waiver ? 2 : 0,
    hedges: spec.hedge ? [hedgeRecord(spec.hedge, now, exposure.credential.exposureMaturity)] : [],
    issues: [],
  };
}

function parseState(state: string): FixtureState {
  if ((FIXTURE_STATES as readonly string[]).includes(state)) return state as FixtureState;
  throw new Error(`Unknown UI fixture state "${state}".`);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fixtureSnapshot(state: string, nowMs = Date.now(), slowMs = SLOW_SNAPSHOT_MS): Promise<Snapshot> {
  const fixture = parseState(state);
  if (fixture === 'rpc-error') throw new Error(RPC_FAILURE);
  if (fixture === 'slow') {
    await delay(slowMs);
    return snapshotOf(SPECS.compliant, nowMs + slowMs);
  }
  if (fixture === 'partial') {
    return { ...snapshotOf(SPECS.compliant, nowMs), coverage: null, available: null, issues: ['evaluate', 'availableToDraw'] };
  }
  return snapshotOf(SPECS[fixture], nowMs);
}

/**
 * The vault's draw outcome for a fixture state. Roles are not modelled: the sender is
 * echoed, and the desk's own operator check still applies. No request is ever returned.
 */
export async function fixtureVerdict(
  state: string,
  amount: bigint,
  sender: Address,
  block: BlockContext,
  slowMs = SLOW_VERDICT_MS,
): Promise<Verdict> {
  const fixture = parseState(state);
  if (fixture === 'rpc-error') throw new Error(RPC_FAILURE);
  if (fixture === 'slow') await delay(slowMs);
  const spec = fixture === 'partial' || fixture === 'slow' ? SPECS.compliant : SPECS[fixture];
  const base = { action: 'draw' as const, amount, sender, block };
  if (spec.heldAs !== undefined) return { ...base, kind: 'held', code: 'DrawNotAllowed', args: [spec.heldAs] };
  const reserve = POLICY.reserveAmount;
  if (amount > spec.balance || spec.balance - amount < reserve) {
    return { ...base, kind: 'held', code: 'ReserveViolation', args: [spec.balance, amount, reserve] };
  }
  return { ...base, kind: 'permitted', code: 'PERMITTED', args: [] };
}
