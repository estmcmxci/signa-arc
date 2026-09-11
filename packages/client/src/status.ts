import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { arcTestnet } from "viem/chains";

import { coverageEngineAbi, covenantVaultAbi, credentialRegistryAbi, facilityRegistryAbi } from "./abis.ts";
import type { DeploymentManifest } from "./deployment.ts";
import { SignaError } from "./errors.ts";
import { redactRpcUrl } from "./redact.ts";

/** The reads `readDeploymentStatus` makes. A viem PublicClient provides them; tests inject one. */
export type StatusClient = Pick<PublicClient, "getChainId" | "getBlock" | "getCode" | "readContract">;

export type BlockContext = { number: string; hash: Hex; timestamp: string };

export type StatusCheck = { check: string; detail: string };

export type DeploymentStatus = { chainId: number; block: BlockContext; checks: StatusCheck[] };

/**
 * Connectivity and deployment wiring (ERD C-03, C-05):
 * - the RPC is on Arc Testnet;
 * - each of the four contracts has code;
 * - the vault is bound to the manifest's facility and wired to its registry, engine and settlement
 *   asset;
 * - the engine and the credential registry point at the same facility registry;
 * - the facility exists.
 * Every read after the chain check is pinned to one block. A mismatch throws rather than
 * reporting `false`, so no later command runs against it. It says nothing about coverage or
 * covenant state.
 */
export async function readDeploymentStatus(
  client: StatusClient,
  manifest: DeploymentManifest,
  rpcUrl: string,
): Promise<DeploymentStatus> {
  const rpc = redactRpcUrl(rpcUrl);
  const transport = <T>(read: () => Promise<T>) => rpcRead(rpc, rpcUrl, read);

  const chainId = await transport(() => client.getChainId());
  if (chainId !== arcTestnet.id) {
    throw new SignaError("CHAIN_MISMATCH", `the RPC at ${rpc} reports chain ${chainId}; this manifest is for Arc Testnet (${arcTestnet.id})`);
  }
  const block = await transport(() => client.getBlock({ blockTag: "latest" }));
  const blockNumber = block.number;
  const checks: StatusCheck[] = [{ check: "chain", detail: `the RPC reports chain ${chainId}, Arc Testnet` }];

  for (const [name, record] of Object.entries(manifest.contracts)) {
    const code = await transport(() => client.getCode({ address: record.address, blockNumber }));
    if (!code || code === "0x") {
      throw new SignaError("DEPLOYMENT_MISMATCH", `no contract code at ${name} ${record.address} at block ${blockNumber}`);
    }
    checks.push({ check: `code.${name}`, detail: `${record.address} has ${(code.length - 2) / 2} bytes of code` });
  }

  const { facilityRegistry, credentialRegistry, coverageEngine, covenantVault } = manifest.contracts;
  const read = <T>(label: string, call: () => Promise<T>) => contractRead(rpc, rpcUrl, label, call);
  const vault = { address: covenantVault.address, abi: covenantVaultAbi, blockNumber } as const;
  const engine = { address: coverageEngine.address, abi: coverageEngineAbi, blockNumber } as const;

  const vaultFacility = await read("CovenantVault.facilityId()", () => client.readContract({ ...vault, functionName: "facilityId" }));
  if (vaultFacility.toLowerCase() !== manifest.facility.id.toLowerCase()) {
    throw new SignaError("DEPLOYMENT_MISMATCH", `vault ${covenantVault.address} is bound to facility ${vaultFacility}, not the manifest's ${manifest.facility.id}`);
  }
  checks.push({ check: "vault.facilityId", detail: `the vault is bound to facility ${vaultFacility}` });

  const wiring: [string, Address, () => Promise<Address>][] = [
    ["vault.facilityRegistry", facilityRegistry.address, () => read("CovenantVault.facilityRegistry()", () => client.readContract({ ...vault, functionName: "facilityRegistry" }))],
    ["vault.coverageEngine", coverageEngine.address, () => read("CovenantVault.coverageEngine()", () => client.readContract({ ...vault, functionName: "coverageEngine" }))],
    ["vault.settlementAsset", manifest.settlementAsset.address, () => read("CovenantVault.settlementAsset()", () => client.readContract({ ...vault, functionName: "settlementAsset" }))],
    ["coverageEngine.facilityRegistry", facilityRegistry.address, () => read("CoverageEngine.facilityRegistry()", () => client.readContract({ ...engine, functionName: "facilityRegistry" }))],
    ["coverageEngine.credentialRegistry", credentialRegistry.address, () => read("CoverageEngine.credentialRegistry()", () => client.readContract({ ...engine, functionName: "credentialRegistry" }))],
    [
      "credentialRegistry.facilityRegistry",
      facilityRegistry.address,
      () => read("CredentialRegistry.facilityRegistry()", () => client.readContract({ address: credentialRegistry.address, abi: credentialRegistryAbi, blockNumber, functionName: "facilityRegistry" })),
    ],
  ];
  for (const [check, expected, actual] of wiring) {
    const address = await actual();
    if (!isAddressEqual(address, expected)) {
      throw new SignaError("DEPLOYMENT_MISMATCH", `${check} is ${address}, but the manifest names ${expected}`);
    }
    checks.push({ check, detail: address });
  }

  const exists = await read("FacilityRegistry.facilityExists()", () =>
    client.readContract({ address: facilityRegistry.address, abi: facilityRegistryAbi, blockNumber, functionName: "facilityExists", args: [manifest.facility.id] }),
  );
  if (!exists) throw new SignaError("DEPLOYMENT_MISMATCH", `facility ${manifest.facility.id} does not exist in registry ${facilityRegistry.address}`);
  checks.push({ check: "facilityRegistry.facilityExists", detail: `facility ${manifest.facility.id} exists` });

  return {
    chainId,
    block: { number: blockNumber.toString(), hash: block.hash, timestamp: new Date(Number(block.timestamp) * 1_000).toISOString() },
    checks,
  };
}

/** A transport failure. The message never carries the raw URL, which may hold a key. */
async function rpcRead<T>(rpc: string, rawUrl: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new SignaError("RPC_UNAVAILABLE", scrub(`RPC request to ${rpc} failed: ${reason(error)}`, rawUrl, rpc), true);
  }
}

/** A revert or empty return means the address is not the contract the manifest says it is. */
async function contractRead<T>(rpc: string, rawUrl: string, label: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const contractFailure =
      error instanceof BaseError &&
      error.walk((cause) => cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError) !== null;
    if (contractFailure) throw new SignaError("DEPLOYMENT_MISMATCH", `${label} reverted or returned no data: ${reason(error)}`);
    throw new SignaError("RPC_UNAVAILABLE", scrub(`RPC request to ${rpc} failed during ${label}: ${reason(error)}`, rawUrl, rpc), true);
  }
}

function reason(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}

function scrub(message: string, rawUrl: string, redacted: string): string {
  return rawUrl ? message.split(rawUrl).join(redacted) : message;
}
