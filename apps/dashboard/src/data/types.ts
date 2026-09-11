import type { Address, Hex } from 'viem';

export type Policy = {
  facilityId: Hex; settlementCurrency: Hex; exposureCurrency: Hex;
  minCoverageBps: number; credentialMaxAge: number; maturityTolerance: number;
  defaultHaircutBps: number; reserveAmount: bigint; curePeriod: number;
  maxWaiverDuration: number; maxActiveHedges: number; settlementAsset: Address;
  admin: Address; operator: Address; frozen: boolean;
};
export type Exposure = {
  credential: { facilityId: Hex; exposureCurrency: Hex; settlementCurrency: Hex;
    outstandingValue: bigint; exposureMaturity: bigint; observedAt: bigint;
    validUntil: bigint; sequence: bigint; sourceCommitment: Hex };
  issuer: Address; digest: Hex; acceptedAt: bigint; issuerEpoch: bigint;
};
export type Hedge = {
  credential: { facilityId: Hex; tradeIdCommitment: Hex; baseCurrency: Hex; quoteCurrency: Hex;
    remainingNotional: bigint; maturity: bigint; status: number; observedAt: bigint;
    validUntil: bigint; sequence: bigint; sourceCommitment: Hex };
  issuer: Address; digest: Hex; acceptedAt: bigint; issuerEpoch: bigint;
  eligibilityReason: number | null; adjustedNotional: bigint | null;
};
export type Coverage = {
  assessed: boolean; compliant: boolean; outstandingValue: bigint; grossEligible: bigint;
  countedEligible: bigint; coverageBps: number; requiredCoverageBps: number;
  eligibleHedgeCount: number; totalHedgeCount: number; exposureReason: number; resultReason: number;
};
export type BlockContext = { number: bigint; hash: Hex; timestamp: bigint };
export type Snapshot = {
  block: BlockContext; receivedAt: number; mode: 'live' | 'fixture';
  policy: Policy | null; exposure: Exposure | null; coverage: Coverage | null;
  state: number | null; principal: bigint | null; cureDeadline: bigint | null;
  available: bigint | null; balance: bigint | null; activeWaiver: boolean | null;
  waiverEndsAt: bigint | null; waiverReason: Hex | null; stateBeforeWaiver: number | null;
  hedges: Hedge[] | null; issues: string[];
};
export type Action = 'draw' | 'syncCovenant' | 'restoreCompliance' | 'repay' | 'approve';
export type Verdict = {
  kind: 'permitted' | 'held' | 'input' | 'authorization' | 'system';
  code: string; args: readonly unknown[]; amount: bigint; action: Action;
  sender: Address; block: BlockContext; request?: unknown;
};
export type LedgerRow = {
  id: string; source: 'recorded' | 'local'; kind: 'simulation' | 'transaction';
  action: Action | string; amount?: string; actor?: string; target?: string;
  status: 'held' | 'confirmed' | 'pending' | 'reverted' | 'cancelled' | 'awaiting' | 'declined' | 'unknown';
  timestamp: string; hash?: Hex; originalHash?: Hex; block?: string; blockTimestamp?: string;
  code?: string; message?: string; coverageBps?: number;
  before?: { balance?: string; principal?: string; coverageBps?: number; state?: number };
  after?: { balance?: string; principal?: string; coverageBps?: number; state?: number };
  gasUsed?: string; feeNative?: string; nonce?: number; input?: string;
  chainId: number; facilityId: string; events?: unknown[];
};
export const STATES = ['UNASSESSED','COMPLIANT','CURE','BREACH','WAIVED'] as const;
export const EXPOSURE_REASONS = ['ELIGIBLE','MISSING','ZERO_VALUE','ISSUER_NOT_APPROVED','PAIR_MISMATCH','NOT_YET_OBSERVED','EXPIRED','STALE','REVOKED','ISSUER_AUTHORIZATION_STALE'] as const;
export const HEDGE_REASONS = ['ELIGIBLE','MISSING','ISSUER_NOT_APPROVED','SAME_AS_EXPOSURE_ISSUER','PAIR_MISMATCH','NOT_ACTIVE','NOT_YET_OBSERVED','EXPIRED','STALE','MATURITY_MISMATCH','REVOKED','ISSUER_AUTHORIZATION_STALE'] as const;
export const RESULT_REASONS = ['NONE','MISSING_EXPOSURE','INVALID_EXPOSURE','BELOW_THRESHOLD','RESERVE_VIOLATION'] as const;
