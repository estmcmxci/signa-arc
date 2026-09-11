import { isAddressEqual, type Address } from "viem";

import { coverageEngineAbi, covenantVaultAbi, credentialRegistryAbi, facilityRegistryAbi } from "./abis.ts";
import type { DeploymentManifest } from "./deployment.ts";
import { SignaError } from "./errors.ts";
import { openSession, type BlockContext, type ReadClient, type Session } from "./rpc.ts";

/** The reads `readDeploymentStatus` makes. Kept as its own name for callers that only check status. */
export type StatusClient = ReadClient;

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
export async function readDeploymentStatus(client: ReadClient, manifest: DeploymentManifest, rpcUrl: string): Promise<DeploymentStatus> {
  const session = await openSession(client, rpcUrl);
  const { blockNumber } = session;
  const checks: StatusCheck[] = [{ check: "chain", detail: `the RPC reports chain ${session.chainId}, Arc Testnet` }];

  for (const [name, record] of Object.entries(manifest.contracts)) {
    const code = await session.transport(() => client.getCode({ address: record.address, blockNumber }));
    if (!code || code === "0x") {
      throw new SignaError("DEPLOYMENT_MISMATCH", `no contract code at ${name} ${record.address} at block ${blockNumber}`);
    }
    checks.push({ check: `code.${name}`, detail: `${record.address} has ${(code.length - 2) / 2} bytes of code` });
  }

  const vaultFacility = await requireVaultBinding(session, manifest);
  checks.push({ check: "vault.facilityId", detail: `the vault is bound to facility ${vaultFacility}` });

  const { facilityRegistry, credentialRegistry, coverageEngine, covenantVault } = manifest.contracts;
  const read = session.contract;
  const vault = { address: covenantVault.address, abi: covenantVaultAbi, blockNumber } as const;
  const engine = { address: coverageEngine.address, abi: coverageEngineAbi, blockNumber } as const;
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

  return { chainId: session.chainId, block: session.block, checks };
}

/** The vault must be bound to the manifest's facility before anything is read through it. */
export async function requireVaultBinding(session: Session, manifest: DeploymentManifest): Promise<string> {
  const { covenantVault } = manifest.contracts;
  const facilityId = await session.contract("CovenantVault.facilityId()", () =>
    session.client.readContract({ address: covenantVault.address, abi: covenantVaultAbi, blockNumber: session.blockNumber, functionName: "facilityId" }),
  );
  if (facilityId.toLowerCase() !== manifest.facility.id.toLowerCase()) {
    throw new SignaError("DEPLOYMENT_MISMATCH", `vault ${covenantVault.address} is bound to facility ${facilityId}, not the manifest's ${manifest.facility.id}`);
  }
  return facilityId;
}
