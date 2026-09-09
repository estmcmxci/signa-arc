import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANONICAL_DECIMALS,
  NATIVE_DECIMALS,
  NATIVE_TO_CANONICAL,
  AmountScaleError,
  toCanonical,
  toCanonicalExact,
  assertCanonicalScale,
} from "../src/decimals.ts";

// R-F2-7 — all amounts are normalised to a single decimals convention at the
// credential boundary. On Arc the native USDC gas token carries 18 decimals and
// the USDC ERC-20 interface at 0x3600…0000 carries 6, over the same balance.
// If the two views meet inside coverageBps the ratio is wrong by 10^12 and the
// vault releases capital while reporting compliance.
//
// See ARC-FIELD-NOTES.md §3 and circlefin/arc-node#91.

test("the canonical convention is the 6-decimal ERC-20 view", () => {
  assert.equal(CANONICAL_DECIMALS, 6);
  assert.equal(NATIVE_DECIMALS, 18);
  assert.equal(NATIVE_TO_CANONICAL, 10n ** 12n);
});

test("a native 18-decimal amount converts to the canonical view", () => {
  // 1 USDC held natively is 1 USDC in the ERC-20 view — same balance, two views.
  assert.equal(toCanonical(1_000_000_000_000_000_000n, NATIVE_DECIMALS), 1_000_000n);
  assert.equal(toCanonical(2_500_000_000_000_000_000n, NATIVE_DECIMALS), 2_500_000n);
});

test("an amount already in the canonical view is unchanged", () => {
  assert.equal(toCanonical(1_000_000n, CANONICAL_DECIMALS), 1_000_000n);
  assert.equal(toCanonical(0n, CANONICAL_DECIMALS), 0n);
});

test("sub-micro-dollar native dust truncates, matching Arc's ERC-20 view", () => {
  // Arc: "amounts smaller than 1e-6 USDC are not represented in balanceOf but
  // are still present in the native balance."
  assert.equal(toCanonical(999_999_999_999n, NATIVE_DECIMALS), 0n);
  assert.equal(toCanonical(1_000_000_999_999n, NATIVE_DECIMALS), 1n);
});

test("truncation is never silent when the caller demands exactness", () => {
  assert.equal(toCanonicalExact(1_000_000_000_000n, NATIVE_DECIMALS), 1n);
  assert.throws(
    () => toCanonicalExact(1_000_000_000_001n, NATIVE_DECIMALS),
    AmountScaleError,
    "a native amount carrying dust must not be silently rounded into a credential",
  );
});

test("negative and non-integer scales are rejected outright", () => {
  assert.throws(() => toCanonical(1n, -1), AmountScaleError);
  assert.throws(() => toCanonical(1n, 6.5), AmountScaleError);
  assert.throws(() => toCanonical(-1n, CANONICAL_DECIMALS), AmountScaleError);
});

test("scaling up from canonical to a wider convention is refused", () => {
  // Only one direction is meaningful here. Widening invents precision the
  // source never had, and is the shape of the 10^12 bug in reverse.
  assert.throws(() => toCanonical(1_000_000n, 2), AmountScaleError);
});

// --- the guard that actually catches the 10^12 mistake -----------------------

test("a native-scaled amount passed as though canonical is caught", () => {
  // The bug: someone reads eth_getBalance (18 dec) and drops the value straight
  // into outstandingValue. 1 USDC becomes 1,000,000,000,000 USDC. Nothing in
  // Solidity can tell — uint128 is uint128 — so the boundary has to refuse it.
  assert.throws(
    () => assertCanonicalScale(1_000_000_000_000_000_000n, "outstandingValue"),
    AmountScaleError,
    "1e18 as a canonical amount is a trillion USDC — reject it",
  );
});

test("the guard names the field and the likely cause", () => {
  try {
    assertCanonicalScale(5_000_000_000_000_000_000n, "remainingNotional");
    assert.fail("expected AmountScaleError");
  } catch (error) {
    assert.ok(error instanceof AmountScaleError);
    assert.match(error.message, /remainingNotional/);
    assert.match(error.message, /18-decimal|native/i);
  }
});

test("plausible facility amounts pass the guard untouched", () => {
  // Fractional testnet facility through to a large real one.
  for (const amount of [0n, 1n, 1_000_000n, 5_000_000_000_000n]) {
    assert.equal(assertCanonicalScale(amount, "outstandingValue"), amount);
  }
});

// --- the invariant the ratio depends on --------------------------------------

test("mixed-scale inputs cannot reach the ratio", () => {
  // An exposure normalised from the ERC-20 view and a hedge left in native
  // units is the exact failure R-F2-7 exists to prevent. Coverage would read
  // 10000 bps on a position with a millionth of the cover it claims.
  const exposure = toCanonical(1_000_000_000_000_000_000n, NATIVE_DECIMALS); // 1.000000
  const hedgeStillNative = 1_060_000_000_000_000_000n; // never normalised

  assert.equal(exposure, 1_000_000n);
  assert.throws(
    () => assertCanonicalScale(hedgeStillNative, "remainingNotional"),
    AmountScaleError,
  );

  // And once it is normalised, the ratio is the one the demo asserts.
  const hedge = toCanonical(hedgeStillNative, NATIVE_DECIMALS);
  const adjusted = (hedge * (10_000n - 500n)) / 10_000n;
  const counted = adjusted > exposure ? exposure : adjusted;
  assert.equal((counted * 10_000n) / exposure, 10_000n);
});
