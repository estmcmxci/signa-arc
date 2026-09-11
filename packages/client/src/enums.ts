/**
 * Solidity enums by index, as the contracts declare them. The ABI carries them as uint8, so the
 * names live here; `test/enums.test.ts` fails if a contract's declaration drifts from this list.
 */

/** CovenantVault.CovenantState */
export const COVENANT_STATES = ["UNASSESSED", "COMPLIANT", "CURE", "BREACH", "WAIVED"] as const;

/** CoverageEngine.ExposureReason */
export const EXPOSURE_REASONS = [
  "ELIGIBLE",
  "MISSING",
  "ZERO_VALUE",
  "ISSUER_NOT_APPROVED",
  "PAIR_MISMATCH",
  "NOT_YET_OBSERVED",
  "EXPIRED",
  "STALE",
  "REVOKED",
  "ISSUER_AUTHORIZATION_STALE",
] as const;

/** CoverageEngine.HedgeReason */
export const HEDGE_REASONS = [
  "ELIGIBLE",
  "MISSING",
  "ISSUER_NOT_APPROVED",
  "SAME_AS_EXPOSURE_ISSUER",
  "PAIR_MISMATCH",
  "NOT_ACTIVE",
  "NOT_YET_OBSERVED",
  "EXPIRED",
  "STALE",
  "MATURITY_MISMATCH",
  "REVOKED",
  "ISSUER_AUTHORIZATION_STALE",
] as const;

/** CoverageEngine.ResultReason. RESERVE_VIOLATION comes only from `assess`. */
export const RESULT_REASONS = ["NONE", "MISSING_EXPOSURE", "INVALID_EXPOSURE", "BELOW_THRESHOLD", "RESERVE_VIOLATION"] as const;

/** CredentialRegistry.HedgeStatus */
export const HEDGE_STATUSES = ["ACTIVE", "CANCELLED", "SETTLED", "DISPUTED"] as const;

export function enumName(names: readonly string[], index: number | bigint): string {
  return names[Number(index)] ?? `UNKNOWN(${index})`;
}
