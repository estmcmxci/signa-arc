import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";

const broadcastSchema = z
  .object({
    chain: z.number().int().positive().optional(),
    transactions: z.array(
      z
        .object({
          hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
          transactionType: z.string(),
          contractName: z.string().optional(),
          contractAddress: z.string().optional(),
          transaction: z
            .object({ from: z.string().optional() })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
    receipts: z
      .array(
        z
          .object({
            transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
            blockNumber: z.union([z.string(), z.number()]),
            status: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export type DeploymentRoles = {
  facilityAdmin: Address;
  originatorOperator: Address;
  exposureIssuer: Address;
  hedgeIssuer: Address;
};

export type DeploymentRecord = {
  address: Address;
  transactionHash: Hex;
  blockNumber: string;
};

export type BaseSepoliaManifest = {
  schemaVersion: 1;
  network: "base-sepolia";
  chainId: 84532;
  rpcUrl: "https://sepolia.base.org";
  explorerUrl: "https://sepolia.basescan.org";
  generatedAt: string;
  sourceCommit: string;
  deployer: Address;
  facilityId: Hex;
  roles: DeploymentRoles;
  contracts: {
    mockSettlementAsset: DeploymentRecord;
    facilityRegistry: DeploymentRecord;
    credentialRegistry: DeploymentRecord;
    coverageEngine: DeploymentRecord;
    covenantVault: DeploymentRecord;
  };
};

const expectedContracts = {
  MockUSDC: "mockSettlementAsset",
  FacilityRegistry: "facilityRegistry",
  CredentialRegistry: "credentialRegistry",
  CoverageEngine: "coverageEngine",
  CovenantVault: "covenantVault",
} as const;

export function buildBaseSepoliaManifest(args: {
  broadcast: unknown;
  roles: DeploymentRoles;
  sourceCommit: string;
  facilityId: Hex;
  generatedAt?: string;
}): BaseSepoliaManifest {
  const broadcast = broadcastSchema.parse(args.broadcast);
  if (broadcast.chain !== undefined && broadcast.chain !== 84_532) {
    throw new Error(`Broadcast chain must be 84532, received ${broadcast.chain}`);
  }
  if (!/^[0-9a-fA-F]{40,64}$/.test(args.sourceCommit)) {
    throw new Error("SOURCE_COMMIT must be a 40–64 character hexadecimal commit hash");
  }
  validateRoles(args.roles);
  if (!/^0x[0-9a-fA-F]{64}$/.test(args.facilityId)) {
    throw new Error("facilityId must be bytes32");
  }

  const receiptByHash = new Map(
    broadcast.receipts.map((receipt) => [receipt.transactionHash.toLowerCase(), receipt]),
  );
  const deployments = new Map<string, DeploymentRecord>();
  let deployer: Address | undefined;

  for (const transaction of broadcast.transactions) {
    if (transaction.transactionType !== "CREATE" || !transaction.contractName) continue;
    if (!(transaction.contractName in expectedContracts)) continue;
    if (!transaction.contractAddress || !isAddress(transaction.contractAddress)) {
      throw new Error(`${transaction.contractName} has no valid contract address`);
    }
    const receipt = receiptByHash.get(transaction.hash.toLowerCase());
    if (!receipt) throw new Error(`${transaction.contractName} has no matching receipt`);
    if (receipt.status !== undefined && BigInt(receipt.status) !== 1n) {
      throw new Error(`${transaction.contractName} deployment receipt is not successful`);
    }
    const from = transaction.transaction?.from;
    if (!deployer && from && isAddress(from)) deployer = getAddress(from);
    deployments.set(transaction.contractName, {
      address: getAddress(transaction.contractAddress),
      transactionHash: transaction.hash as Hex,
      blockNumber: parseBlockNumber(receipt.blockNumber).toString(),
    });
  }

  for (const contractName of Object.keys(expectedContracts)) {
    if (!deployments.has(contractName)) {
      throw new Error(`Missing ${contractName} deployment in broadcast`);
    }
  }
  if (!deployer) throw new Error("Could not determine deployer from broadcast transactions");
  if (deployer !== getAddress(args.roles.facilityAdmin)) {
    throw new Error("Broadcast deployer does not match FACILITY_ADMIN");
  }

  return {
    schemaVersion: 1,
    network: "base-sepolia",
    chainId: 84_532,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    sourceCommit: args.sourceCommit.toLowerCase(),
    deployer,
    facilityId: args.facilityId,
    roles: normalizeRoles(args.roles),
    contracts: {
      mockSettlementAsset: deployments.get("MockUSDC")!,
      facilityRegistry: deployments.get("FacilityRegistry")!,
      credentialRegistry: deployments.get("CredentialRegistry")!,
      coverageEngine: deployments.get("CoverageEngine")!,
      covenantVault: deployments.get("CovenantVault")!,
    },
  };
}

export function validateRoles(roles: DeploymentRoles) {
  for (const [name, value] of Object.entries(roles)) {
    if (!isAddress(value) || /^0x0{40}$/i.test(value)) {
      throw new Error(`${name} must be a nonzero address`);
    }
  }
  const distinctRoles = new Set(Object.values(roles).map((value) => getAddress(value)));
  if (distinctRoles.size !== Object.keys(roles).length) {
    throw new Error("All four Base Sepolia demo roles must be distinct");
  }
}

function normalizeRoles(roles: DeploymentRoles): DeploymentRoles {
  return {
    facilityAdmin: getAddress(roles.facilityAdmin),
    originatorOperator: getAddress(roles.originatorOperator),
    exposureIssuer: getAddress(roles.exposureIssuer),
    hedgeIssuer: getAddress(roles.hedgeIssuer),
  };
}

function parseBlockNumber(value: string | number): bigint {
  if (typeof value === "number") return BigInt(value);
  return BigInt(value);
}
