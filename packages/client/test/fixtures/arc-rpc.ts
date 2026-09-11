import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  keccak256,
  numberToHex,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";

import { coverageEngineAbi, covenantVaultAbi, credentialRegistryAbi, facilityRegistryAbi } from "../../src/abis.ts";
import { bundledManifest } from "../../src/bundled.ts";

/**
 * A stand-in for Arc's JSON-RPC, reached through viem's real client and `custom` transport. It
 * answers every read the P0 commands make, from the bundled manifest and a small fixture facility,
 * and records each request so tests can check which block and sender each read used. By default
 * the facility is compliant, like the live one after its restoration; options change what the
 * contracts report.
 */

export const FIXTURE_BLOCK = {
  number: 61_500_000n,
  hash: `0x${"ab".repeat(32)}` as Hex,
  timestamp: 1_789_100_000n,
};
export const FIXTURE_TRADE_ID = keccak256(stringToHex("ARC-EUR-USD-001"));
export const FIXTURE_OBSERVED_AT = FIXTURE_BLOCK.timestamp - 3_600n;

const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export type DrawOutcome = "permitted" | "revert-without-data" | "transport-failure" | { revert: Hex };

export type FakeArcOptions = {
  chainId?: number;
  /** A contract with no code. */
  missingCode?: Address;
  vaultFacilityId?: Hex;
  vaultCoverageEngine?: Address;
  facilityExists?: boolean;
  /** A function that returns no data, as an address without that contract would. */
  emptyCall?: string;
  /** Every request fails with this error, as an unreachable RPC would. */
  failWith?: Error;
  /** Overrides on CoverageEngine.evaluate. Reasons are enum indices. */
  coverage?: Partial<{ assessed: boolean; compliant: boolean; coverageBps: number; exposureReason: number; resultReason: number }>;
  exposureReason?: number;
  hedgeReason?: number;
  storedState?: number;
  activeWaiver?: boolean;
  waiverEndsAt?: bigint;
  policyOperator?: Address;
  noExposure?: boolean;
  draw?: DrawOutcome;
};

export type RecordedRequest = { method: string; params: readonly unknown[] };

const ALL_ABIS = [...facilityRegistryAbi, ...credentialRegistryAbi, ...coverageEngineAbi, ...covenantVaultAbi, ...erc20Abi] as Abi;

export function fakeArcClient(options: FakeArcOptions = {}) {
  const manifest = bundledManifest();
  const { contracts, roles } = manifest;
  const id = manifest.facility.id;
  const requests: RecordedRequest[] = [];

  const policy = {
    facilityId: id,
    settlementCurrency: "0x555344",
    exposureCurrency: "0x455552",
    minCoverageBps: 10_000,
    credentialMaxAge: 86_400,
    maturityTolerance: 604_800,
    defaultHaircutBps: 500,
    reserveAmount: 500_000n,
    curePeriod: 432_000,
    maxWaiverDuration: 259_200,
    maxActiveHedges: 8,
    settlementAsset: manifest.settlementAsset.address,
    admin: roles.facilityAdmin,
    operator: options.policyOperator ?? roles.operator,
    frozen: true,
  };
  const validity = { observedAt: FIXTURE_OBSERVED_AT, validUntil: FIXTURE_OBSERVED_AT + 86_400n };
  const maturity = FIXTURE_BLOCK.timestamp + 30n * 86_400n;
  const exposure = options.noExposure
    ? {
        credential: { facilityId: ZERO32, exposureCurrency: "0x000000", settlementCurrency: "0x000000", outstandingValue: 0n, exposureMaturity: 0n, observedAt: 0n, validUntil: 0n, sequence: 0n, sourceCommitment: ZERO32 },
        issuer: ZERO_ADDRESS,
        digest: ZERO32,
        acceptedAt: 0n,
        issuerEpoch: 0n,
      }
    : {
        credential: { facilityId: id, exposureCurrency: "0x455552", settlementCurrency: "0x555344", outstandingValue: 1_000_000n, exposureMaturity: maturity, ...validity, sequence: 1n, sourceCommitment: `0x${"e1".repeat(32)}` },
        issuer: roles.exposureIssuer,
        digest: `0x${"d1".repeat(32)}`,
        acceptedAt: FIXTURE_OBSERVED_AT + 10n,
        issuerEpoch: 1n,
      };
  const hedge = {
    credential: {
      facilityId: id,
      tradeIdCommitment: FIXTURE_TRADE_ID,
      baseCurrency: "0x555344",
      quoteCurrency: "0x455552",
      remainingNotional: 1_060_000n,
      maturity,
      status: 0,
      ...validity,
      sequence: 6n,
      sourceCommitment: `0x${"e2".repeat(32)}`,
    },
    issuer: roles.hedgeIssuer,
    digest: `0x${"d2".repeat(32)}`,
    acceptedAt: FIXTURE_OBSERVED_AT + 20n,
    issuerEpoch: 1n,
  };
  const evaluation = {
    assessed: true,
    compliant: true,
    outstandingValue: 1_000_000n,
    grossEligible: 1_007_000n,
    countedEligible: 1_000_000n,
    coverageBps: 10_000,
    requiredCoverageBps: 10_000,
    eligibleHedgeCount: 1,
    totalHedgeCount: 1,
    exposureReason: 0,
    resultReason: 0,
    ...options.coverage,
  };

  const answers: Record<string, Record<string, (args: readonly unknown[]) => [Abi, unknown]>> = {
    [contracts.covenantVault.address.toLowerCase()]: {
      facilityId: () => [covenantVaultAbi, options.vaultFacilityId ?? id],
      facilityRegistry: () => [covenantVaultAbi, contracts.facilityRegistry.address],
      coverageEngine: () => [covenantVaultAbi, options.vaultCoverageEngine ?? contracts.coverageEngine.address],
      settlementAsset: () => [covenantVaultAbi, manifest.settlementAsset.address],
      principal: () => [covenantVaultAbi, 2_000_000n],
      availableToDraw: () => [covenantVaultAbi, 2_000_000n],
      covenantState: () => [covenantVaultAbi, options.storedState ?? 1],
      stateBeforeWaiver: () => [covenantVaultAbi, 0],
      cureDeadline: () => [covenantVaultAbi, 0n],
      activeWaiver: () => [covenantVaultAbi, options.activeWaiver ?? false],
      waiverEndsAt: () => [covenantVaultAbi, options.waiverEndsAt ?? 0n],
      waiverReasonCommitment: () => [covenantVaultAbi, ZERO32],
    },
    [contracts.coverageEngine.address.toLowerCase()]: {
      facilityRegistry: () => [coverageEngineAbi, contracts.facilityRegistry.address],
      credentialRegistry: () => [coverageEngineAbi, contracts.credentialRegistry.address],
      evaluate: () => [coverageEngineAbi, evaluation],
      exposureEligibility: () => [coverageEngineAbi, options.exposureReason ?? 0],
      hedgeEligibility: () => [coverageEngineAbi, [options.hedgeReason ?? 0, (options.hedgeReason ?? 0) === 0 ? 1_007_000n : 0n]],
    },
    [contracts.credentialRegistry.address.toLowerCase()]: {
      facilityRegistry: () => [credentialRegistryAbi, contracts.facilityRegistry.address],
      currentExposure: () => [credentialRegistryAbi, exposure],
      hedgeTradeIds: () => [credentialRegistryAbi, [FIXTURE_TRADE_ID]],
      currentHedge: () => [credentialRegistryAbi, hedge],
    },
    [contracts.facilityRegistry.address.toLowerCase()]: {
      facilityExists: () => [facilityRegistryAbi, options.facilityExists ?? true],
      getFacility: () => [facilityRegistryAbi, policy],
      isExposureIssuer: () => [facilityRegistryAbi, true],
      isHedgeIssuer: () => [facilityRegistryAbi, true],
    },
    [manifest.settlementAsset.address.toLowerCase()]: {
      balanceOf: () => [erc20Abi as Abi, 2_500_000n],
    },
  };

  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    const list = (Array.isArray(params) ? params : []) as readonly unknown[];
    requests.push({ method, params: list });
    if (options.failWith) throw options.failWith;
    switch (method) {
      case "eth_chainId":
        return numberToHex(options.chainId ?? arcTestnet.id);
      case "eth_getBlockByNumber":
        return {
          number: numberToHex(FIXTURE_BLOCK.number),
          hash: FIXTURE_BLOCK.hash,
          parentHash: `0x${"cd".repeat(32)}`,
          timestamp: numberToHex(FIXTURE_BLOCK.timestamp),
          gasLimit: "0x1c9c380",
          gasUsed: "0x0",
          baseFeePerGas: "0x4a817c800",
          transactions: [],
        };
      case "eth_getCode": {
        const address = String(list[0]).toLowerCase();
        return options.missingCode && address === options.missingCode.toLowerCase() ? "0x" : "0x60806040";
      }
      // No transaction the fixture knows about: `tx show` reports it as unknown to this node.
      case "eth_getTransactionByHash":
      case "eth_getTransactionReceipt":
        return null;
      case "eth_call": {
        const call = list[0] as { to: Address; data: Hex };
        const { functionName, args } = decodeFunctionData({ abi: ALL_ABIS, data: call.data });
        if (functionName === options.emptyCall) return "0x";
        if (functionName === "draw" && call.to.toLowerCase() === contracts.covenantVault.address.toLowerCase()) return drawResult(options.draw ?? "permitted");
        const answer = answers[call.to.toLowerCase()]?.[functionName];
        if (!answer) throw new Error(`the fake RPC has no answer for ${functionName} on ${call.to}`);
        const [abi, result] = answer(args ?? []);
        return encodeFunctionResult({ abi, functionName, result } as never);
      }
      default:
        throw new Error(`the fake RPC does not implement ${method}`);
    }
  };

  const client = createPublicClient({ chain: arcTestnet, transport: custom({ request }, { retryCount: 0 }) });
  return { client, requests, manifest };
}

/** `draw` returns nothing when it succeeds; a revert is the node's JSON-RPC error, code 3. */
function drawResult(outcome: DrawOutcome): Hex {
  if (outcome === "permitted") return "0x";
  if (outcome === "transport-failure") throw new Error("connect ECONNREFUSED 127.0.0.1:8545");
  throw Object.assign(new Error("execution reverted"), { code: 3, ...(outcome === "revert-without-data" ? {} : { data: outcome.revert }) });
}
