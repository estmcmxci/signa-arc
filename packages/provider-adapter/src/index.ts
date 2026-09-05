import {
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
    remainingNotional: parseSixDecimalAmount(fixture.trade.remaining_buy_amount),
    maturity,
    status: mapProviderStatus(fixture.trade.status),
    observedAt,
    validUntil,
    sequence: BigInt(fixture.trade.sequence),
    sourceCommitment: keccak256(toBytes(canonicalJson(fixture))),
  };
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

