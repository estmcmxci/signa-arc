/// <reference types="vite/client" />
import { isAddress, getAddress, type Address, type Hex } from "viem";

import bundledFixture from "../fixtures/arc-testnet.fixture.json";

// Schema per EED.md §4. `deployments/arc-testnet.json` is written once by Lane A's
// deploy step and is the single source of truth for "what is deployed" (E-MAN-4):
// nothing outside this file hardcodes a deployed contract address.
export type ContractRecord = { address: Address; deployTx: Hex; block: number };

export type ArcTestnetManifest = {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  sourceCommit: string;
  deployedAt: string;
  contracts: {
    facilityRegistry: ContractRecord;
    credentialRegistry: ContractRecord;
    coverageEngine: ContractRecord;
    covenantVault: ContractRecord;
  };
  settlementAsset: { address: Address; decimals: number; symbol: string };
  roles: {
    facilityAdmin: Address;
    operator: Address;
    exposureIssuer: Address;
    hedgeIssuer: Address;
  };
  facility: {
    id: Hex;
    policy: {
      minCoverageBps: number;
      defaultHaircutBps: number;
      credentialMaxAgeSeconds: number;
      maturityToleranceSeconds: number;
      reserveAmount: string;
      cureWindowSeconds: number;
      maxWaiverDurationSeconds: number;
    };
  };
  // Not in the EED §4 template verbatim, but Lane A's deploy step writes it (E-EUR-1):
  // the exposure's denominating asset, referenced only — optional so older/fixture
  // manifests without it still validate.
  exposureDenomination?:
    | {
        currency: string;
        referenceAsset: { address: Address; decimals: number; symbol: string };
        note: string;
      }
    | undefined;
  // Optional for the same reason: the fixture manifest predates the Privy quorum and
  // must keep validating. facilityAdmin (roles.facilityAdmin) is this wallet's address;
  // this block is who may ever move it and how.
  facilityAdminQuorum?:
    | {
        provider: string;
        note: string;
        keyQuorumId: string;
        walletId: string;
        threshold: number;
        approvers: { role: string; publicKey: string }[];
        policyId: string;
      }
    | undefined;
};

export const ARC_TESTNET_CHAIN_ID = 5_042_002;

export type ManifestSource = "deployed" | "fixture";
export type ManifestState =
  | { status: "ready"; manifest: ArcTestnetManifest; source: ManifestSource }
  | { status: "invalid"; source: ManifestSource; error: string }
  | { status: "missing"; error: string };

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const COMMIT_RE = /^[0-9a-fA-F]{40}$/;

export function validateManifest(data: unknown): { ok: true; manifest: ArcTestnetManifest } | { ok: false; error: string } {
  if (typeof data !== "object" || data === null) return fail("manifest is not an object");
  const record = data as Record<string, unknown>;

  if (record["chainId"] !== ARC_TESTNET_CHAIN_ID) {
    return fail(`chainId must be ${ARC_TESTNET_CHAIN_ID}, received ${String(record["chainId"])}`);
  }
  const rpcUrl = record["rpcUrl"];
  const explorer = record["explorer"];
  const sourceCommit = record["sourceCommit"];
  const deployedAt = record["deployedAt"];
  if (typeof rpcUrl !== "string" || !rpcUrl) return fail("rpcUrl must be a non-empty string");
  if (typeof explorer !== "string" || !explorer) return fail("explorer must be a non-empty string");
  if (typeof sourceCommit !== "string" || !COMMIT_RE.test(sourceCommit)) {
    return fail("sourceCommit must be a 40-character hex git sha (E-MAN-2)");
  }
  if (typeof deployedAt !== "string" || !deployedAt) return fail("deployedAt must be a non-empty ISO 8601 string");

  const contractsRaw = record["contracts"];
  if (typeof contractsRaw !== "object" || contractsRaw === null) return fail("contracts must be an object");
  const contractNames = ["facilityRegistry", "credentialRegistry", "coverageEngine", "covenantVault"] as const;
  const contracts = {} as ArcTestnetManifest["contracts"];
  for (const name of contractNames) {
    const entry = (contractsRaw as Record<string, unknown>)[name];
    const parsed = parseContractRecord(entry, name);
    if (!parsed.ok) return parsed;
    contracts[name] = parsed.value;
  }

  const settlementAssetRaw = record["settlementAsset"];
  if (typeof settlementAssetRaw !== "object" || settlementAssetRaw === null) {
    return fail("settlementAsset must be an object");
  }
  const settlementAssetRecord = settlementAssetRaw as Record<string, unknown>;
  const settlementAddress = settlementAssetRecord["address"];
  const decimals = settlementAssetRecord["decimals"];
  const symbol = settlementAssetRecord["symbol"];
  if (typeof settlementAddress !== "string" || !isNonZeroAddress(settlementAddress)) {
    return fail("settlementAsset.address must be a nonzero address");
  }
  if (typeof decimals !== "number") return fail("settlementAsset.decimals must be a number");
  if (typeof symbol !== "string" || !symbol) return fail("settlementAsset.symbol must be a non-empty string");

  const rolesRaw = record["roles"];
  if (typeof rolesRaw !== "object" || rolesRaw === null) return fail("roles must be an object");
  const roleNames = ["facilityAdmin", "operator", "exposureIssuer", "hedgeIssuer"] as const;
  const roles = {} as ArcTestnetManifest["roles"];
  for (const name of roleNames) {
    const value = (rolesRaw as Record<string, unknown>)[name];
    if (typeof value !== "string" || !isNonZeroAddress(value)) {
      return fail(`roles.${name} must be a nonzero address`);
    }
    roles[name] = getAddress(value);
  }

  const facilityRaw = record["facility"];
  if (typeof facilityRaw !== "object" || facilityRaw === null) return fail("facility must be an object");
  const facilityRecord = facilityRaw as Record<string, unknown>;
  const facilityId = facilityRecord["id"];
  if (typeof facilityId !== "string" || !BYTES32_RE.test(facilityId)) {
    return fail("facility.id must be a bytes32 hex string");
  }
  const policyRaw = facilityRecord["policy"];
  if (typeof policyRaw !== "object" || policyRaw === null) return fail("facility.policy must be an object");
  const policyRecord = policyRaw as Record<string, unknown>;
  const numericFields = [
    "minCoverageBps",
    "defaultHaircutBps",
    "credentialMaxAgeSeconds",
    "maturityToleranceSeconds",
    "cureWindowSeconds",
    "maxWaiverDurationSeconds",
  ] as const;
  for (const field of numericFields) {
    if (typeof policyRecord[field] !== "number") return fail(`facility.policy.${field} must be a number`);
  }
  const reserveAmount = policyRecord["reserveAmount"];
  if (typeof reserveAmount !== "string" || !/^\d+$/.test(reserveAmount)) {
    return fail("facility.policy.reserveAmount must be a decimal string");
  }

  return {
    ok: true,
    manifest: {
      chainId: ARC_TESTNET_CHAIN_ID,
      rpcUrl,
      explorer,
      sourceCommit: sourceCommit.toLowerCase(),
      deployedAt,
      contracts,
      settlementAsset: { address: getAddress(settlementAddress), decimals, symbol },
      roles,
      facility: {
        id: facilityId as Hex,
        policy: {
          minCoverageBps: policyRecord["minCoverageBps"] as number,
          defaultHaircutBps: policyRecord["defaultHaircutBps"] as number,
          credentialMaxAgeSeconds: policyRecord["credentialMaxAgeSeconds"] as number,
          maturityToleranceSeconds: policyRecord["maturityToleranceSeconds"] as number,
          reserveAmount,
          cureWindowSeconds: policyRecord["cureWindowSeconds"] as number,
          maxWaiverDurationSeconds: policyRecord["maxWaiverDurationSeconds"] as number,
        },
      },
      exposureDenomination: parseExposureDenomination(record["exposureDenomination"]),
      facilityAdminQuorum: parseFacilityAdminQuorum(record["facilityAdminQuorum"]),
    },
  };
}

function parseFacilityAdminQuorum(raw: unknown): ArcTestnetManifest["facilityAdminQuorum"] {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const provider = record["provider"];
  const note = record["note"];
  const keyQuorumId = record["keyQuorumId"];
  const walletId = record["walletId"];
  const threshold = record["threshold"];
  const policyId = record["policyId"];
  const approversRaw = record["approvers"];
  if (
    typeof provider !== "string" ||
    typeof note !== "string" ||
    typeof keyQuorumId !== "string" ||
    typeof walletId !== "string" ||
    typeof threshold !== "number" ||
    typeof policyId !== "string" ||
    !Array.isArray(approversRaw)
  ) {
    return undefined;
  }
  const approvers: { role: string; publicKey: string }[] = [];
  for (const entry of approversRaw) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const role = (entry as Record<string, unknown>)["role"];
    const publicKey = (entry as Record<string, unknown>)["publicKey"];
    if (typeof role !== "string" || typeof publicKey !== "string") return undefined;
    approvers.push({ role, publicKey });
  }
  return { provider, note, keyQuorumId, walletId, threshold, approvers, policyId };
}

function parseExposureDenomination(
  raw: unknown,
): ArcTestnetManifest["exposureDenomination"] {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const currency = record["currency"];
  const note = record["note"];
  const refRaw = record["referenceAsset"];
  if (typeof currency !== "string" || typeof note !== "string") return undefined;
  if (typeof refRaw !== "object" || refRaw === null) return undefined;
  const refRecord = refRaw as Record<string, unknown>;
  const address = refRecord["address"];
  const decimals = refRecord["decimals"];
  const symbol = refRecord["symbol"];
  if (typeof address !== "string" || !isAddress(address)) return undefined;
  if (typeof decimals !== "number" || typeof symbol !== "string") return undefined;
  return { currency, referenceAsset: { address: getAddress(address), decimals, symbol }, note };
}

function parseContractRecord(
  entry: unknown,
  name: string,
): { ok: true; value: ContractRecord } | { ok: false; error: string } {
  if (typeof entry !== "object" || entry === null) return fail(`contracts.${name} must be an object`);
  const record = entry as Record<string, unknown>;
  const address = record["address"];
  const deployTx = record["deployTx"];
  const block = record["block"];
  if (typeof address !== "string" || !isNonZeroAddress(address)) {
    return fail(`contracts.${name}.address must be a nonzero address`);
  }
  if (typeof deployTx !== "string" || !BYTES32_RE.test(deployTx)) {
    return fail(`contracts.${name}.deployTx must be a transaction hash`);
  }
  if (typeof block !== "number" || block < 0) return fail(`contracts.${name}.block must be a non-negative number`);
  return { ok: true, value: { address: getAddress(address), deployTx: deployTx as Hex, block } };
}

function isNonZeroAddress(value: string): value is Address {
  return isAddress(value) && value.toLowerCase() !== "0x0000000000000000000000000000000000000000";
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

// `deployments/arc-testnet.json` does not exist until Lane A's deploy step writes it.
// `import.meta.glob` resolves to an empty object rather than a build failure when no
// file matches, which is what lets Lane C build against the schema ahead of the file.
const deployedManifestModules = import.meta.glob<{ default: unknown }>(
  "../../../deployments/arc-testnet.json",
  { eager: true },
);

export function loadManifest(): ManifestState {
  const deployed = Object.values(deployedManifestModules)[0];
  if (deployed) {
    const result = validateManifest(deployed.default);
    if (result.ok) return { status: "ready", manifest: result.manifest, source: "deployed" };
    return { status: "invalid", source: "deployed", error: result.error };
  }
  const fixtureResult = validateManifest(bundledFixture);
  if (fixtureResult.ok) {
    return { status: "ready", manifest: fixtureResult.manifest, source: "fixture" };
  }
  return {
    status: "missing",
    error: `deployments/arc-testnet.json does not exist yet, and the bundled fixture failed its own validation: ${fixtureResult.error}`,
  };
}
