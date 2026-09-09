/**
 * R-F2-7 — the single decimals boundary.
 *
 * On Arc, USDC is one balance exposed through two interfaces:
 *
 *   native view    18 decimals   gas accounting, msg.value, native sends
 *   ERC-20 view     6 decimals   0x3600…0000 — balances, transfers, approvals
 *
 * They are not two assets. They differ by exactly 10^12. Every amount that
 * reaches a credential — and therefore the coverage ratio — is in the 6-decimal
 * ERC-20 view, and nothing else is allowed past this module.
 *
 * The failure this prevents is not a revert. An 18-decimal value dropped into
 * `outstandingValue` or `remainingNotional` produces a ratio that is wrong by a
 * factor of a trillion, and `CovenantVault` then releases capital while
 * reporting compliance. Solidity cannot catch it: a uint128 is a uint128.
 *
 * See ARC-FIELD-NOTES.md §3 and circlefin/arc-node#91.
 */

/** The convention every credential, policy and ratio is denominated in. */
export const CANONICAL_DECIMALS = 6;

/** Arc's native gas view. Only ever appears in gas math, never in a credential. */
export const NATIVE_DECIMALS = 18;

/** The factor separating the two views of the same balance. */
export const NATIVE_TO_CANONICAL = 10n ** 12n;

/**
 * The largest amount we will accept as canonical: one billion USDC.
 *
 * This is a heuristic, and worth being honest about — 10^18 is a legitimate
 * 6-decimal quantity in the abstract (a trillion USDC), so no guard can be
 * exact. What makes it work in practice is the size of the mistake. The bug
 * scales by 10^12, so a facility of even 1 USDC arrives here as 10^18, three
 * orders of magnitude above this ceiling, while every plausible real facility
 * sits below it. The guard catches the error class it was written for and says
 * so in the message rather than failing quietly.
 */
export const MAX_PLAUSIBLE_CANONICAL = 10n ** 15n;

export class AmountScaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountScaleError";
  }
}

function assertScale(sourceDecimals: number): void {
  if (!Number.isInteger(sourceDecimals) || sourceDecimals < 0) {
    throw new AmountScaleError(
      `Source decimals must be a non-negative integer; received ${sourceDecimals}`,
    );
  }
  if (sourceDecimals < CANONICAL_DECIMALS) {
    throw new AmountScaleError(
      `Refusing to widen a ${sourceDecimals}-decimal amount to ${CANONICAL_DECIMALS} decimals. ` +
        "Widening invents precision the source never had — the 10^12 bug in reverse. " +
        "Normalise at the source instead.",
    );
  }
}

function assertNonNegative(amount: bigint): void {
  if (amount < 0n) {
    throw new AmountScaleError(`Amounts are unsigned; received ${amount}`);
  }
}

/**
 * Narrow an amount to the canonical 6-decimal view, truncating.
 *
 * Truncation is deliberate and matches Arc: "amounts smaller than 1×10⁻⁶ USDC
 * are not represented in balanceOf but are still present in the native balance."
 * Where losing that dust would be wrong, use {@link toCanonicalExact}.
 */
export function toCanonical(amount: bigint, sourceDecimals: number): bigint {
  assertNonNegative(amount);
  assertScale(sourceDecimals);
  return amount / 10n ** BigInt(sourceDecimals - CANONICAL_DECIMALS);
}

/**
 * Narrow an amount to the canonical view, refusing to discard anything.
 *
 * Use at any boundary where a credential asserts a precise figure — a hedge
 * notional a counterparty could dispute — so the rounding is never silent.
 */
export function toCanonicalExact(amount: bigint, sourceDecimals: number): bigint {
  assertNonNegative(amount);
  assertScale(sourceDecimals);
  const divisor = 10n ** BigInt(sourceDecimals - CANONICAL_DECIMALS);
  const remainder = amount % divisor;
  if (remainder !== 0n) {
    throw new AmountScaleError(
      `Narrowing ${amount} from ${sourceDecimals} to ${CANONICAL_DECIMALS} decimals would ` +
        `discard ${remainder}. Use toCanonical if the truncation is intended.`,
    );
  }
  return amount / divisor;
}

/**
 * Assert an amount is already in the canonical view, and return it.
 *
 * The last line of defence before a value becomes a signed credential field.
 * Catches the specific mistake of reading an 18-decimal native balance —
 * `eth_getBalance`, `address.balance`, wagmi's `useBalance` — and using it as
 * though it were the ERC-20 view.
 */
export function assertCanonicalScale(amount: bigint, field: string): bigint {
  assertNonNegative(amount);
  if (amount > MAX_PLAUSIBLE_CANONICAL) {
    throw new AmountScaleError(
      `${field} = ${amount} exceeds the plausible canonical maximum ` +
        `(${MAX_PLAUSIBLE_CANONICAL}, one billion USDC). This is the signature of an ` +
        "18-decimal native amount used as a 6-decimal ERC-20 amount — the two Arc views " +
        `of the same balance differ by ${NATIVE_TO_CANONICAL}. Convert with ` +
        "toCanonical(amount, NATIVE_DECIMALS) at the source.",
    );
  }
  return amount;
}
