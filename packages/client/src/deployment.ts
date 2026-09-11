import type { Hex } from "viem";

import { SignaError } from "./errors.ts";
import { validateManifest, type ArcTestnetManifest } from "./manifest.ts";

/**
 * The deployment manifest as a Signa command trusts it. `validateManifest`, copied from the
 * dashboard, checks the schema. On top of it this enforces what a command needs before it reads
 * the chain (ERD C-03):
 * - Solidity integer widths;
 * - the six-decimal settlement view;
 * - four distinct contracts;
 * - URLs that parse.
 * It also checks strictly the optional sections the dashboard's validator drops or tolerates, and
 * keeps them: the exposure's denominating asset, the policy's currency codes and hedge limit, and
 * the facility admin's quorum metadata.
 */

export type FacilityAdminQuorum = {
  provider: string;
  keyQuorumId: string;
  walletId: string;
  threshold: number;
  approvers: { role: string; publicKey: string }[];
  policyId?: string;
  note?: string;
};

export type DeploymentPolicy = ArcTestnetManifest["facility"]["policy"] & {
  settlementCurrency?: string;
  exposureCurrency?: string;
  maxActiveHedges?: number;
};

export type DeploymentManifest = Omit<ArcTestnetManifest, "facility" | "exposureDenomination"> & {
  facility: { id: Hex; policy: DeploymentPolicy };
  exposureDenomination?: NonNullable<ArcTestnetManifest["exposureDenomination"]>;
  facilityAdminQuorum?: FacilityAdminQuorum;
};

const UINT8_MAX = 2 ** 8 - 1;
const UINT16_MAX = 2 ** 16 - 1;
const UINT32_MAX = 2 ** 32 - 1;
const UINT128_MAX = 2n ** 128n - 1n;

/** Parses and validates a manifest, or throws `INVALID_MANIFEST` naming the first bad field. */
export function parseDeploymentManifest(data: unknown): DeploymentManifest {
  const base = validateManifest(data);
  if (!base.ok) throw invalid(base.error);
  const { manifest } = base;
  const raw = data as Record<string, unknown>;

  requireUrl("rpcUrl", manifest.rpcUrl);
  requireUrl("explorer", manifest.explorer);
  if (Number.isNaN(Date.parse(manifest.deployedAt))) throw invalid("deployedAt must be an ISO 8601 date");

  const contracts = Object.entries(manifest.contracts);
  for (const [name, record] of contracts) {
    if (!Number.isSafeInteger(record.block)) throw invalid(`contracts.${name}.block must be a whole block number`);
  }
  const distinct = new Set(contracts.map(([, record]) => record.address.toLowerCase()));
  if (distinct.size !== contracts.length) throw invalid("contracts must name four different addresses");

  if (manifest.settlementAsset.decimals !== 6) {
    throw invalid(
      "settlementAsset.decimals must be 6: Arc's USDC ERC-20 view accounts in six decimals, and the 18-decimal native balance only pays gas",
    );
  }

  const policy = manifest.facility.policy;
  requireUint("facility.policy.minCoverageBps", policy.minCoverageBps, UINT16_MAX);
  requireUint("facility.policy.defaultHaircutBps", policy.defaultHaircutBps, UINT16_MAX);
  requireUint("facility.policy.credentialMaxAgeSeconds", policy.credentialMaxAgeSeconds, UINT32_MAX);
  requireUint("facility.policy.maturityToleranceSeconds", policy.maturityToleranceSeconds, UINT32_MAX);
  requireUint("facility.policy.cureWindowSeconds", policy.cureWindowSeconds, UINT32_MAX);
  requireUint("facility.policy.maxWaiverDurationSeconds", policy.maxWaiverDurationSeconds, UINT32_MAX);
  if (BigInt(policy.reserveAmount) > UINT128_MAX) throw invalid("facility.policy.reserveAmount exceeds uint128");

  const rawPolicy = (raw["facility"] as Record<string, unknown>)["policy"] as Record<string, unknown>;
  const extras: Omit<DeploymentPolicy, keyof ArcTestnetManifest["facility"]["policy"]> = {};
  for (const field of ["settlementCurrency", "exposureCurrency"] as const) {
    const value = rawPolicy[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
      throw invalid(`facility.policy.${field} must be a three-letter currency code`);
    }
    extras[field] = value;
  }
  if (rawPolicy["maxActiveHedges"] !== undefined) {
    requireUint("facility.policy.maxActiveHedges", rawPolicy["maxActiveHedges"], UINT8_MAX);
    extras.maxActiveHedges = rawPolicy["maxActiveHedges"] as number;
  }

  // The copied validator ignores a malformed exposureDenomination; a command may not.
  if (raw["exposureDenomination"] !== undefined) {
    if (!manifest.exposureDenomination) throw invalid("exposureDenomination is present but malformed");
    requireUint("exposureDenomination.referenceAsset.decimals", manifest.exposureDenomination.referenceAsset.decimals, UINT8_MAX);
  }
  const quorum = raw["facilityAdminQuorum"] === undefined ? undefined : parseQuorum(raw["facilityAdminQuorum"]);

  const { exposureDenomination, facility, ...rest } = manifest;
  return {
    ...rest,
    facility: { id: facility.id, policy: { ...policy, ...extras } },
    ...(exposureDenomination ? { exposureDenomination } : {}),
    ...(quorum ? { facilityAdminQuorum: quorum } : {}),
  };
}

function parseQuorum(value: unknown): FacilityAdminQuorum {
  if (typeof value !== "object" || value === null) throw invalid("facilityAdminQuorum must be an object");
  const record = value as Record<string, unknown>;
  for (const field of ["provider", "keyQuorumId", "walletId"] as const) {
    if (typeof record[field] !== "string" || !record[field]) throw invalid(`facilityAdminQuorum.${field} must be a non-empty string`);
  }
  const approvers = record["approvers"];
  if (!Array.isArray(approvers) || approvers.length === 0) throw invalid("facilityAdminQuorum.approvers must be a non-empty array");
  const parsedApprovers = approvers.map((approver, index) => {
    const entry = (typeof approver === "object" && approver !== null ? approver : {}) as Record<string, unknown>;
    if (typeof entry["role"] !== "string" || !entry["role"] || typeof entry["publicKey"] !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry["publicKey"])) {
      throw invalid(`facilityAdminQuorum.approvers[${index}] needs a role and a base64 publicKey`);
    }
    return { role: entry["role"], publicKey: entry["publicKey"] };
  });
  const threshold = record["threshold"];
  if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1 || threshold > parsedApprovers.length) {
    throw invalid("facilityAdminQuorum.threshold must be a whole number between 1 and the number of approvers");
  }
  for (const field of ["policyId", "note"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") throw invalid(`facilityAdminQuorum.${field} must be a string`);
  }
  return {
    provider: record["provider"] as string,
    keyQuorumId: record["keyQuorumId"] as string,
    walletId: record["walletId"] as string,
    threshold,
    approvers: parsedApprovers,
    ...(typeof record["policyId"] === "string" ? { policyId: record["policyId"] } : {}),
    ...(typeof record["note"] === "string" ? { note: record["note"] } : {}),
  };
}

function requireUrl(field: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid(`${field} must be an http(s) URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw invalid(`${field} must be an http(s) URL`);
}

function requireUint(field: string, value: unknown, max: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw invalid(`${field} must be a whole number from 0 to ${max}`);
  }
}

function invalid(message: string): SignaError {
  return new SignaError("INVALID_MANIFEST", message);
}
