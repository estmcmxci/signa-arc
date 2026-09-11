import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  numberToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";

import { coverageEngineAbi, covenantVaultAbi, credentialRegistryAbi, facilityRegistryAbi } from "../../src/abis.ts";
import { bundledManifest } from "../../src/bundled.ts";

/**
 * A stand-in for Arc's JSON-RPC, reached through viem's real client and `custom` transport. It
 * answers the reads `signa status` makes, from the bundled manifest, and records every request so
 * tests can check which block each read was pinned to.
 */

export const FIXTURE_BLOCK = {
  number: 61_500_000n,
  hash: `0x${"ab".repeat(32)}` as Hex,
  timestamp: 1_789_100_000n,
};

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
};

export type RecordedRequest = { method: string; params: readonly unknown[] };

const ALL_ABIS = [...facilityRegistryAbi, ...credentialRegistryAbi, ...coverageEngineAbi, ...covenantVaultAbi] as Abi;

export function fakeArcClient(options: FakeArcOptions = {}) {
  const manifest = bundledManifest();
  const { contracts } = manifest;
  const requests: RecordedRequest[] = [];

  const results: Record<string, Record<string, [Abi, unknown]>> = {
    [contracts.covenantVault.address.toLowerCase()]: {
      facilityId: [covenantVaultAbi, options.vaultFacilityId ?? manifest.facility.id],
      facilityRegistry: [covenantVaultAbi, contracts.facilityRegistry.address],
      coverageEngine: [covenantVaultAbi, options.vaultCoverageEngine ?? contracts.coverageEngine.address],
      settlementAsset: [covenantVaultAbi, manifest.settlementAsset.address],
    },
    [contracts.coverageEngine.address.toLowerCase()]: {
      facilityRegistry: [coverageEngineAbi, contracts.facilityRegistry.address],
      credentialRegistry: [coverageEngineAbi, contracts.credentialRegistry.address],
    },
    [contracts.credentialRegistry.address.toLowerCase()]: {
      facilityRegistry: [credentialRegistryAbi, contracts.facilityRegistry.address],
    },
    [contracts.facilityRegistry.address.toLowerCase()]: {
      facilityExists: [facilityRegistryAbi, options.facilityExists ?? true],
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
      case "eth_call": {
        const call = list[0] as { to: Address; data: Hex };
        const { functionName } = decodeFunctionData({ abi: ALL_ABIS, data: call.data });
        if (functionName === options.emptyCall) return "0x";
        const answer = results[call.to.toLowerCase()]?.[functionName];
        if (!answer) throw new Error(`the fake RPC has no answer for ${functionName} on ${call.to}`);
        const [abi, result] = answer;
        return encodeFunctionResult({ abi, functionName, result } as never);
      }
      default:
        throw new Error(`the fake RPC does not implement ${method}`);
    }
  };

  const client = createPublicClient({ chain: arcTestnet, transport: custom({ request }, { retryCount: 0 }) });
  return { client, requests, manifest };
}
