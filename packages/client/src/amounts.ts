import { AmountScaleError, CANONICAL_DECIMALS, assertCanonicalScale } from "@fx-coverage/credentials";
import { parseSixDecimalAmount } from "@fx-coverage/provider-adapter";

import { SignaError } from "./errors.ts";

/**
 * An amount in the settlement asset's six-decimal ERC-20 view: exact units, and the same value
 * written as USDC. Both are decimal strings; JSON never carries a floating-point amount
 * (ERD C-06).
 */
export type Amount = { units: string; usdc: string };

const SCALE = 10n ** BigInt(CANONICAL_DECIMALS);

export function formatAmount(units: bigint): Amount {
  const magnitude = units < 0n ? -units : units;
  const text = `${magnitude / SCALE}.${(magnitude % SCALE).toString().padStart(CANONICAL_DECIMALS, "0")}`;
  return { units: units.toString(), usdc: units < 0n ? `-${text}` : text };
}

/**
 * Parses a draw amount (ERD C-06): `1` is one USDC, 1000000 units. It uses the repository's one
 * six-decimal conversion, `parseSixDecimalAmount`, which refuses signs, exponents and more than six
 * decimal places. It then applies the credentials package's plausibility bound, and refuses zero,
 * which a draw may not be. Credential fields have their own rules: a hedge's zero notional is valid.
 */
export function parseDrawAmount(value: string): bigint {
  let units: bigint;
  try {
    units = parseSixDecimalAmount(value);
  } catch {
    throw new SignaError(
      "INVALID_INPUT",
      `--amount must be a plain decimal number of USDC with at most ${CANONICAL_DECIMALS} decimal places, such as 1 or 0.5; received ${JSON.stringify(value)}`,
    );
  }
  if (units === 0n) throw new SignaError("INVALID_INPUT", "--amount must be greater than zero");
  try {
    assertCanonicalScale(units, "draw amount");
  } catch (error) {
    if (error instanceof AmountScaleError) throw new SignaError("INVALID_INPUT", `--amount ${value} is out of range: ${error.message}`);
    throw error;
  }
  return units;
}
