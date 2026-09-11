import assert from "node:assert/strict";
import test from "node:test";

import { SignaError, formatAmount, parseDrawAmount } from "../src/index.ts";

test("a draw amount parses exactly into six-decimal units", () => {
  assert.equal(parseDrawAmount("1"), 1_000_000n);
  assert.equal(parseDrawAmount("0.5"), 500_000n);
  assert.equal(parseDrawAmount("0.000001"), 1n);
  assert.equal(parseDrawAmount("2500.25"), 2_500_250_000n);
  assert.equal(parseDrawAmount("1000000000"), 1_000_000_000_000_000n, "one billion USDC is the plausible maximum");
  assert.deepEqual(formatAmount(1_000_000n), { units: "1000000", usdc: "1.000000" });
  assert.deepEqual(formatAmount(1n), { units: "1", usdc: "0.000001" });
  assert.deepEqual(formatAmount(0n), { units: "0", usdc: "0.000000" });
});

test("a draw amount refuses zero, signs, exponents, excess decimals, stray text and implausible sizes", () => {
  const cases: [string, RegExp][] = [
    ["0", /greater than zero/],
    ["0.000000", /greater than zero/],
    ["-1", /plain decimal number/],
    ["+1", /plain decimal number/],
    ["1e6", /plain decimal number/],
    ["1.0000001", /plain decimal number/],
    ["", /plain decimal number/],
    [" 1", /plain decimal number/],
    ["1,000", /plain decimal number/],
    ["0x10", /plain decimal number/],
    ["1.", /plain decimal number/],
    ["1000000000.000001", /out of range/],
  ];
  for (const [value, pattern] of cases) {
    assert.throws(
      () => parseDrawAmount(value),
      (error: unknown) => error instanceof SignaError && error.code === "INVALID_INPUT" && pattern.test(error.message),
      JSON.stringify(value),
    );
  }
});
