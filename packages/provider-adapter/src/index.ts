import {
  assertCanonicalScale,
  currencyToBytes3,
  credentialDomain,
  hashHedgeCredential,
  hedgeCredentialTypes,
  hedgeStatuses,
  type HedgeCredential,
} from "@fx-coverage/credentials";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

export const MOCK_PROVIDER_DISCLAIMER =
  "Mock provider data — no Ebury connection or endorsement." as const;

const providerStatusSchema = z.enum([
  "booked",
  "partially_funded",
  "cancelled",
  "closed",
  "disputed",
]);

const isoDateTime = z.string().datetime({ offset: true });

export const providerFixtureSchema = z
  .object({
    mock: z.literal(true),
    disclaimer: z.literal(MOCK_PROVIDER_DISCLAIMER),
    provider_name: z.string().min(1),
    trade: z
      .object({
        id: z.string().min(1),
        buy_currency: z.string().regex(/^[A-Z]{3}$/),
        sell_currency: z.string().regex(/^[A-Z]{3}$/),
        remaining_buy_amount: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
        maturity_date: isoDateTime,
        status: providerStatusSchema,
        updated_at: isoDateTime,
        credential_valid_until: isoDateTime,
        sequence: z.number().int().positive().safe(),
        receipt_reference: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type ProviderFixture = z.infer<typeof providerFixtureSchema>;

export type SignedHedgeCredential = {
  disclaimer: typeof MOCK_PROVIDER_DISCLAIMER;
  issuer: Address;
  digest: Hex;
  credential: HedgeCredential;
  signature: Hex;
};

export function parseProviderFixture(input: unknown): ProviderFixture {
  return providerFixtureSchema.parse(input);
}

export function mapProviderFixture(
  input: unknown,
  facilityId: Hex,
): HedgeCredential {
  const fixture = parseProviderFixture(input);
  const observedAt = toUnixSeconds(fixture.trade.updated_at);
  const validUntil = toUnixSeconds(fixture.trade.credential_valid_until);
  const maturity = toUnixSeconds(fixture.trade.maturity_date);
  if (validUntil < observedAt || maturity < observedAt) {
    throw new Error("Fixture validity and maturity must not precede observation");
  }

  return {
    facilityId,
    tradeIdCommitment: keccak256(toBytes(fixture.trade.id)),
    baseCurrency: currencyToBytes3(fixture.trade.buy_currency),
    quoteCurrency: currencyToBytes3(fixture.trade.sell_currency),
    // E-FIX-4 — every amount reaching a credential passes through decimals.ts.
    remainingNotional: assertCanonicalScale(
      parseSixDecimalAmount(fixture.trade.remaining_buy_amount),
      "remainingNotional",
    ),
    maturity,
    status: mapProviderStatus(fixture.trade.status),
    observedAt,
    validUntil,
    sequence: BigInt(fixture.trade.sequence),
    sourceCommitment: keccak256(toBytes(canonicalJson(fixture))),
  };
}

/**
 * E-FIX-2 — the maturity a public run books its trade at.
 *
 * `booking` is the sequence-1 fixture and `start` the chain block recorded as
 * the run begins. The trade keeps its booked tenor. Compute it once per run,
 * so every later sequence of the trade carries the same maturity.
 */
export function bookedMaturity(booking: unknown, start: { timestamp: bigint }): bigint {
  const { trade } = parseProviderFixture(booking);
  if (trade.sequence !== 1) {
    throw new Error(`A trade is booked at sequence 1; received sequence ${trade.sequence}`);
  }
  return (
    start.timestamp + toUnixSeconds(trade.maturity_date) - toUnixSeconds(trade.updated_at)
  );
}

/**
 * E-FIX-2 — re-observe a checked-in fixture at a recorded chain block.
 *
 * Checked-in fixtures keep fixed dates so local tests stay deterministic, and
 * go stale a day later. Public runs time each observation from the chain,
 * never the local clock, which can run ahead of it and evaluate
 * NOT_YET_OBSERVED. Only the time fields move: observedAt becomes the block's
 * timestamp, validUntil keeps the fixture's validity window, and maturity is
 * the run's. Trade, amount, status and sequence stay the fixture's own.
 */
export function observeAt(
  template: unknown,
  block: { timestamp: bigint },
  maturity: bigint,
): ProviderFixture {
  const fixture = parseProviderFixture(template);
  if (maturity < block.timestamp) {
    throw new Error("Cannot observe a trade past its maturity");
  }
  const validFor =
    toUnixSeconds(fixture.trade.credential_valid_until) -
    toUnixSeconds(fixture.trade.updated_at);
  return parseProviderFixture({
    ...fixture,
    trade: {
      ...fixture.trade,
      maturity_date: toIsoTimestamp(maturity),
      updated_at: toIsoTimestamp(block.timestamp),
      credential_valid_until: toIsoTimestamp(block.timestamp + validFor),
    },
  });
}

export async function signHedgeCredential(args: {
  credential: HedgeCredential;
  chainId: number;
  verifyingContract: Address;
  privateKey: Hex;
}): Promise<SignedHedgeCredential> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(args.privateKey)) {
    throw new Error("A 32-byte private key is required");
  }
  const account = privateKeyToAccount(args.privateKey);
  const signature = await account.signTypedData({
    domain: credentialDomain(args.chainId, args.verifyingContract),
    types: hedgeCredentialTypes,
    primaryType: "HedgeCredential",
    message: args.credential,
  });
  return {
    disclaimer: MOCK_PROVIDER_DISCLAIMER,
    issuer: account.address,
    digest: hashHedgeCredential(
      args.chainId,
      args.verifyingContract,
      args.credential,
    ),
    credential: args.credential,
    signature,
  };
}

export function parseSixDecimalAmount(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new Error(`Invalid six-decimal settlement amount: ${value}`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (amount > (1n << 128n) - 1n) {
    throw new Error("Settlement amount exceeds uint128");
  }
  return amount;
}

function mapProviderStatus(status: ProviderFixture["trade"]["status"]) {
  switch (status) {
    case "booked":
    case "partially_funded":
      return hedgeStatuses.ACTIVE;
    case "cancelled":
      return hedgeStatuses.CANCELLED;
    case "closed":
      return hedgeStatuses.SETTLED;
    case "disputed":
      return hedgeStatuses.DISPUTED;
  }
}

function toUnixSeconds(value: string): bigint {
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return BigInt(milliseconds / 1_000);
}

function toIsoTimestamp(seconds: bigint): string {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

