import { getAddress, hexToString, isAddress, isAddressEqual, type Address, type Hex } from "viem";

import {
  CREDENTIAL_DOMAIN_NAME,
  CREDENTIAL_DOMAIN_VERSION,
  hashExposureCredential,
  hashHedgeCredential,
  recoverExposureIssuer,
  recoverHedgeIssuer,
  type ExposureCredential,
  type HedgeCredential,
  type HedgeStatus,
} from "@fx-coverage/credentials";

import type { DeploymentManifest } from "./deployment.ts";
import { HEDGE_STATUSES } from "./enums.ts";
import { SignaError } from "./errors.ts";

/**
 * The signed-credential envelope, version 1 (ERD §7). An envelope carries one exposure or hedge
 * credential exactly as its issuer signed it, with the EIP-712 domain, the signature, and the
 * issuer and digest it claims. Offline inspection never trusts the claims: it recomputes the
 * digest with the credentials package, recovers the signer, and checks the domain and facility
 * against the selected deployment. It proves formatting, domain consistency and signature
 * recovery. It does not prove live authorization, revocation, the registry's current sequence
 * or eligibility.
 *
 * These field lists are the one definition the parser and the generated reference both use.
 */

export const ENVELOPE_SCHEMA_VERSION = 1;

export type EnvelopeFieldType = "bytes32" | "bytes3" | "uint64" | "uint128" | "hedgeStatus";
export type EnvelopeField = { name: string; type: EnvelopeFieldType; description: string };

export const ENVELOPE_KEYS: readonly { name: string; type: string; description: string }[] = [
  { name: "schemaVersion", type: "1", description: "The envelope format version." },
  { name: "kind", type: '"exposure" or "hedge"', description: "Which credential the envelope carries." },
  { name: "domain", type: "object", description: "The EIP-712 domain it was signed under: `name` FXCoverageCredentials, `version` 1, `chainId`, and `verifyingContract`, the credential registry." },
  { name: "credential", type: "object", description: "The credential's fields, listed below for each kind." },
  { name: "signature", type: "65-byte hex", description: "The issuer's EIP-712 signature over the credential." },
  { name: "issuer", type: "address", description: "The issuer the envelope claims. Compared with the recovered signer, never trusted." },
  { name: "digest", type: "bytes32 hex", description: "The EIP-712 digest the envelope claims. Recomputed, never trusted." },
];

const COMMON_TAIL: readonly EnvelopeField[] = [
  { name: "observedAt", type: "uint64", description: "When the issuer observed the facts, in Unix seconds." },
  { name: "validUntil", type: "uint64", description: "When the assertion expires, in Unix seconds." },
];

export const EXPOSURE_FIELDS: readonly EnvelopeField[] = [
  { name: "facilityId", type: "bytes32", description: "The facility the exposure belongs to." },
  { name: "exposureCurrency", type: "bytes3", description: "The exposure's currency as three ASCII bytes: EUR is 0x455552." },
  { name: "settlementCurrency", type: "bytes3", description: "The settlement currency as three ASCII bytes: USD is 0x555344." },
  { name: "outstandingValue", type: "uint128", description: "Outstanding value in six-decimal settlement units, as a decimal string." },
  { name: "exposureMaturity", type: "uint64", description: "When the exposure matures, in Unix seconds." },
  ...COMMON_TAIL,
  { name: "sequence", type: "uint64", description: "Scoped to the facility. The registry accepts only a sequence above its current one." },
  { name: "sourceCommitment", type: "bytes32", description: "A commitment to the private source record." },
];

export const HEDGE_FIELDS: readonly EnvelopeField[] = [
  { name: "facilityId", type: "bytes32", description: "The facility the hedge covers." },
  { name: "tradeIdCommitment", type: "bytes32", description: "A commitment to the trade identifier." },
  { name: "baseCurrency", type: "bytes3", description: "The currency the hedge delivers, the settlement currency: USD is 0x555344." },
  { name: "quoteCurrency", type: "bytes3", description: "The currency hedged, the exposure currency: EUR is 0x455552." },
  { name: "remainingNotional", type: "uint128", description: "Remaining notional in six-decimal units, as a decimal string. `0` is valid, for a terminal update." },
  { name: "maturity", type: "uint64", description: "When the hedge matures, in Unix seconds." },
  { name: "status", type: "hedgeStatus", description: "ACTIVE, CANCELLED, SETTLED or DISPUTED." },
  ...COMMON_TAIL,
  { name: "sequence", type: "uint64", description: "Scoped to the facility and trade commitment. The registry accepts only a sequence above its current one." },
  { name: "sourceCommitment", type: "bytes32", description: "A commitment to the private source record." },
];

export type EnvelopeDomain = { name: string; version: string; chainId: number; verifyingContract: Address };

export type ParsedEnvelope =
  | { kind: "exposure"; domain: EnvelopeDomain; credential: ExposureCredential; signature: Hex; issuer: Address; digest: Hex }
  | { kind: "hedge"; domain: EnvelopeDomain; credential: HedgeCredential; signature: Hex; issuer: Address; digest: Hex };

const UINT_MAX: Record<"uint64" | "uint128", bigint> = { uint64: 2n ** 64n - 1n, uint128: 2n ** 128n - 1n };
const HEX_BYTES: Record<"bytes32" | "bytes3", number> = { bytes32: 32, bytes3: 3 };

/** Parses and validates an envelope strictly, or throws INVALID_INPUT naming the first bad field. */
export function parseEnvelope(data: unknown): ParsedEnvelope {
  const envelope = record(data, "the envelope");
  exactKeys(envelope, ENVELOPE_KEYS.map((key) => key.name), "the envelope");
  if (envelope["schemaVersion"] !== ENVELOPE_SCHEMA_VERSION) throw invalid(`schemaVersion must be ${ENVELOPE_SCHEMA_VERSION}`);
  const kind = envelope["kind"];
  if (kind !== "exposure" && kind !== "hedge") throw invalid('kind must be "exposure" or "hedge"');

  const domainRecord = record(envelope["domain"], "domain");
  exactKeys(domainRecord, ["name", "version", "chainId", "verifyingContract"], "domain");
  if (domainRecord["name"] !== CREDENTIAL_DOMAIN_NAME) throw invalid(`domain.name must be ${CREDENTIAL_DOMAIN_NAME}`);
  if (domainRecord["version"] !== CREDENTIAL_DOMAIN_VERSION) throw invalid(`domain.version must be ${CREDENTIAL_DOMAIN_VERSION}`);
  const chainId = domainRecord["chainId"];
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) throw invalid("domain.chainId must be a positive whole number");
  const domain: EnvelopeDomain = {
    name: CREDENTIAL_DOMAIN_NAME,
    version: CREDENTIAL_DOMAIN_VERSION,
    chainId,
    verifyingContract: address(domainRecord["verifyingContract"], "domain.verifyingContract"),
  };

  const fields = kind === "exposure" ? EXPOSURE_FIELDS : HEDGE_FIELDS;
  const credentialRecord = record(envelope["credential"], "credential");
  exactKeys(credentialRecord, fields.map((field) => field.name), "credential");
  const credential: Record<string, unknown> = {};
  for (const field of fields) credential[field.name] = parseField(credentialRecord[field.name], field);

  const common = {
    domain,
    signature: hex(envelope["signature"], "signature", 65),
    issuer: address(envelope["issuer"], "issuer"),
    digest: hex(envelope["digest"], "digest", 32),
  };
  return kind === "exposure"
    ? { kind, credential: credential as ExposureCredential, ...common }
    : { kind, credential: credential as HedgeCredential, ...common };
}

export type EnvelopeInspection = {
  kind: "exposure" | "hedge";
  digest: Hex;
  recoveredSigner: Address;
  claimedIssuer: Address;
  manifestRole: "exposureIssuer" | "hedgeIssuer" | null;
  domain: EnvelopeDomain;
  credential: Record<string, string | number>;
};

/**
 * Checks a parsed envelope against the selected deployment:
 * - the domain names this chain and credential registry, or INVALID_INPUT;
 * - the credential names this facility, or INVALID_INPUT;
 * - the claimed digest equals the recomputed one, or INVALID_SIGNATURE;
 * - the signature recovers to the claimed issuer, or INVALID_SIGNATURE.
 */
export async function inspectEnvelope(envelope: ParsedEnvelope, manifest: DeploymentManifest): Promise<EnvelopeInspection> {
  const registry = manifest.contracts.credentialRegistry.address;
  if (envelope.domain.chainId !== manifest.chainId) {
    throw new SignaError("INVALID_INPUT", `the envelope was signed for chain ${envelope.domain.chainId}; the selected deployment is Arc Testnet (${manifest.chainId})`);
  }
  if (!isAddressEqual(envelope.domain.verifyingContract, registry)) {
    throw new SignaError("INVALID_INPUT", `the envelope was signed for credential registry ${envelope.domain.verifyingContract}, not the selected deployment's ${registry}`);
  }
  if (envelope.credential.facilityId.toLowerCase() !== manifest.facility.id.toLowerCase()) {
    throw new SignaError("INVALID_INPUT", `the credential is for facility ${envelope.credential.facilityId}, not the selected manifest's ${manifest.facility.id}`);
  }

  const digest =
    envelope.kind === "exposure"
      ? hashExposureCredential(manifest.chainId, registry, envelope.credential)
      : hashHedgeCredential(manifest.chainId, registry, envelope.credential);
  if (digest.toLowerCase() !== envelope.digest.toLowerCase()) {
    throw new SignaError("INVALID_SIGNATURE", `the envelope claims digest ${envelope.digest}, but its credential hashes to ${digest}`);
  }
  let recoveredSigner: Address;
  try {
    recoveredSigner =
      envelope.kind === "exposure"
        ? await recoverExposureIssuer(manifest.chainId, registry, envelope.credential, envelope.signature)
        : await recoverHedgeIssuer(manifest.chainId, registry, envelope.credential, envelope.signature);
  } catch (error) {
    throw new SignaError("INVALID_SIGNATURE", `the signature does not recover a signer: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  if (!isAddressEqual(recoveredSigner, envelope.issuer)) {
    throw new SignaError("INVALID_SIGNATURE", `the signature recovers to ${recoveredSigner}, not the claimed issuer ${envelope.issuer}`);
  }

  const manifestRole = isAddressEqual(recoveredSigner, manifest.roles.exposureIssuer)
    ? "exposureIssuer"
    : isAddressEqual(recoveredSigner, manifest.roles.hedgeIssuer)
      ? "hedgeIssuer"
      : null;
  return {
    kind: envelope.kind,
    digest,
    recoveredSigner,
    claimedIssuer: envelope.issuer,
    manifestRole,
    domain: envelope.domain,
    credential: display(envelope),
  };
}

/** The credential for people: decimal strings, currencies and status by name, times as ISO 8601. */
function display(envelope: ParsedEnvelope): Record<string, string | number> {
  const fields = envelope.kind === "exposure" ? EXPOSURE_FIELDS : HEDGE_FIELDS;
  const values = envelope.credential as unknown as Record<string, unknown>;
  const shown: Record<string, string | number> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.type === "bytes3") shown[field.name] = hexToString(value as Hex, { size: 3 });
    else if (field.type === "hedgeStatus") shown[field.name] = HEDGE_STATUSES[value as number] ?? String(value);
    else if (field.type === "uint64" && /At$|Until$|[Mm]aturity$/.test(field.name)) shown[field.name] = new Date(Number(value as bigint) * 1_000).toISOString();
    else shown[field.name] = typeof value === "bigint" ? value.toString() : (value as string);
  }
  return shown;
}

function parseField(value: unknown, field: EnvelopeField): unknown {
  const path = `credential.${field.name}`;
  switch (field.type) {
    case "bytes32":
    case "bytes3":
      return hex(value, path, HEX_BYTES[field.type]);
    case "uint64":
    case "uint128": {
      if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw invalid(`${path} must be a decimal string with no sign, exponent or leading zeros`);
      const parsed = BigInt(value);
      if (parsed > UINT_MAX[field.type]) throw invalid(`${path} exceeds ${field.type}`);
      return parsed;
    }
    case "hedgeStatus": {
      const index = HEDGE_STATUSES.indexOf(value as (typeof HEDGE_STATUSES)[number]);
      if (index < 0) throw invalid(`${path} must be one of ${HEDGE_STATUSES.join(", ")}`);
      return index as HedgeStatus;
    }
  }
}

function hex(value: unknown, path: string, bytes: number): Hex {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)) {
    throw invalid(`${path} must be exactly ${bytes} bytes of 0x-prefixed hex`);
  }
  return value as Hex;
}

function address(value: unknown, path: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) throw invalid(`${path} must be an address`);
  return getAddress(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(`${path} must be a JSON object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const missing = allowed.filter((key) => !(key in value));
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (missing.length > 0) throw invalid(`${path} is missing ${missing.join(", ")}`);
  if (unknown.length > 0) throw invalid(`${path} has unknown fields: ${unknown.join(", ")}`);
}

function invalid(message: string): SignaError {
  return new SignaError("INVALID_INPUT", `invalid envelope: ${message}`);
}
