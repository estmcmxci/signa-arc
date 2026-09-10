import {
  hashTypedData,
  recoverTypedDataAddress,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";

// R-F2-7 — the single decimals boundary. Every amount reaching a credential is
// in the canonical 6-decimal ERC-20 view; nothing else gets past decimals.ts.
export {
  CANONICAL_DECIMALS,
  NATIVE_DECIMALS,
  NATIVE_TO_CANONICAL,
  MAX_PLAUSIBLE_CANONICAL,
  AmountScaleError,
  toCanonical,
  toCanonicalExact,
  assertCanonicalScale,
} from "./decimals.ts";

export const CREDENTIAL_DOMAIN_NAME = "FXCoverageCredentials" as const;
export const CREDENTIAL_DOMAIN_VERSION = "1" as const;

export const hedgeStatuses = {
  ACTIVE: 0,
  CANCELLED: 1,
  SETTLED: 2,
  DISPUTED: 3,
} as const;

export type HedgeStatus = (typeof hedgeStatuses)[keyof typeof hedgeStatuses];

export type ExposureCredential = {
  facilityId: Hex;
  exposureCurrency: Hex;
  settlementCurrency: Hex;
  outstandingValue: bigint;
  exposureMaturity: bigint;
  observedAt: bigint;
  validUntil: bigint;
  sequence: bigint;
  sourceCommitment: Hex;
};

export type HedgeCredential = {
  facilityId: Hex;
  tradeIdCommitment: Hex;
  baseCurrency: Hex;
  quoteCurrency: Hex;
  remainingNotional: bigint;
  maturity: bigint;
  status: HedgeStatus;
  observedAt: bigint;
  validUntil: bigint;
  sequence: bigint;
  sourceCommitment: Hex;
};

export const exposureCredentialTypes = {
  ExposureCredential: [
    { name: "facilityId", type: "bytes32" },
    { name: "exposureCurrency", type: "bytes3" },
    { name: "settlementCurrency", type: "bytes3" },
    { name: "outstandingValue", type: "uint128" },
    { name: "exposureMaturity", type: "uint64" },
    { name: "observedAt", type: "uint64" },
    { name: "validUntil", type: "uint64" },
    { name: "sequence", type: "uint64" },
    { name: "sourceCommitment", type: "bytes32" },
  ],
} as const;

export const hedgeCredentialTypes = {
  HedgeCredential: [
    { name: "facilityId", type: "bytes32" },
    { name: "tradeIdCommitment", type: "bytes32" },
    { name: "baseCurrency", type: "bytes3" },
    { name: "quoteCurrency", type: "bytes3" },
    { name: "remainingNotional", type: "uint128" },
    { name: "maturity", type: "uint64" },
    { name: "status", type: "uint8" },
    { name: "observedAt", type: "uint64" },
    { name: "validUntil", type: "uint64" },
    { name: "sequence", type: "uint64" },
    { name: "sourceCommitment", type: "bytes32" },
  ],
} as const;

/**
 * R-F1-1 — credentials are bound to Arc Testnet, taken from viem's chain
 * definition rather than hand-rolled. The registry builds its domain from
 * `block.chainid`, so a credential signed for any other chain recovers the
 * wrong issuer there; refusing to build that domain makes the mistake loud.
 */
export const CREDENTIAL_CHAIN_ID = arcTestnet.id;

/** Local Anvil, for deterministic replay of the same contracts. Never public evidence. */
export const LOCAL_REPLAY_CHAIN_ID = 31_337;

export function credentialDomain(chainId: number, verifyingContract: Address) {
  if (chainId !== CREDENTIAL_CHAIN_ID && chainId !== LOCAL_REPLAY_CHAIN_ID) {
    throw new Error(
      `Credentials are bound to Arc Testnet (${CREDENTIAL_CHAIN_ID}); refusing a domain ` +
        `for chain ${chainId}. Local replay (${LOCAL_REPLAY_CHAIN_ID}) is the only other chain accepted.`,
    );
  }
  return {
    name: CREDENTIAL_DOMAIN_NAME,
    version: CREDENTIAL_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const;
}

export function currencyToBytes3(currency: string): Hex {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Invalid ISO-like currency code: ${currency}`);
  }
  return stringToHex(currency, { size: 3 });
}

export function hashExposureCredential(
  chainId: number,
  verifyingContract: Address,
  credential: ExposureCredential,
): Hex {
  return hashTypedData({
    domain: credentialDomain(chainId, verifyingContract),
    types: exposureCredentialTypes,
    primaryType: "ExposureCredential",
    message: credential,
  });
}

export function hashHedgeCredential(
  chainId: number,
  verifyingContract: Address,
  credential: HedgeCredential,
): Hex {
  return hashTypedData({
    domain: credentialDomain(chainId, verifyingContract),
    types: hedgeCredentialTypes,
    primaryType: "HedgeCredential",
    message: credential,
  });
}

export function recoverExposureIssuer(
  chainId: number,
  verifyingContract: Address,
  credential: ExposureCredential,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: credentialDomain(chainId, verifyingContract),
    types: exposureCredentialTypes,
    primaryType: "ExposureCredential",
    message: credential,
    signature,
  });
}

export function recoverHedgeIssuer(
  chainId: number,
  verifyingContract: Address,
  credential: HedgeCredential,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: credentialDomain(chainId, verifyingContract),
    types: hedgeCredentialTypes,
    primaryType: "HedgeCredential",
    message: credential,
    signature,
  });
}

