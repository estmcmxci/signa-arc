import { readFileSync } from "node:fs";
import {
  BaseError,
  RawContractError,
  createPublicClient,
  decodeErrorResult,
  decodeFunctionData,
  encodeFunctionData,
  http,
  isAddressEqual,
  keccak256,
  numberToHex,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  toBytes,
  type Address,
  type Hex,
  type TransactionReceipt,
  type TransactionSerializedEIP1559,
} from "viem";
import { arcTestnet } from "viem/chains";

/**
 * Everything on the Arc side of the quorum flow. Privy signs an RLP transaction and never learns
 * Arc exists; this module pins what it signs, checks what comes back, and broadcasts it.
 */

export const COVENANT_STATES = ["UNASSESSED", "COMPLIANT", "CURE", "BREACH", "WAIVED"] as const;
export type CovenantState = (typeof COVENANT_STATES)[number];

export const covenantVaultAbi = parseAbi([
  "function createWaiver(uint32 duration, bytes32 reasonCommitment)",
  "function revokeWaiver()",
  "function activeWaiver() view returns (bool)",
  "function covenantState() view returns (uint8)",
  "function waiverEndsAt() view returns (uint64)",
  "function facilityId() view returns (bytes32)",
  "event WaiverCreated(bytes32 indexed facilityId, bytes32 indexed reasonCommitment, uint64 startsAt, uint64 endsAt)",
  "event WaiverRevoked(bytes32 indexed facilityId, bytes32 indexed reasonCommitment)",
]);

export const facilityRegistryAbi = parseAbi([
  "struct FacilityPolicy { bytes32 facilityId; bytes3 settlementCurrency; bytes3 exposureCurrency; uint16 minCoverageBps; uint32 credentialMaxAge; uint32 maturityTolerance; uint16 defaultHaircutBps; uint128 reserveAmount; uint32 curePeriod; uint32 maxWaiverDuration; uint8 maxActiveHedges; address settlementAsset; address admin; address operator; bool frozen; }",
  "function getFacility(bytes32 facilityId) view returns (FacilityPolicy)",
  "function facilityExists(bytes32 facilityId) view returns (bool)",
  "function isExposureIssuer(bytes32 facilityId, address issuer) view returns (bool)",
  "function isHedgeIssuer(bytes32 facilityId, address issuer) view returns (bool)",
  "function createFacility(FacilityPolicy policy)",
  "function setExposureIssuer(bytes32 facilityId, address issuer, bool authorized)",
  "function setHedgeIssuer(bytes32 facilityId, address issuer, bool authorized)",
  "function freezeFacility(bytes32 facilityId)",
]);

const adminErrorsAbi = parseAbi([
  "error NotOperator(address caller)",
  "error NotAdmin(address caller)",
  "error DrawNotAllowed(uint8 state)",
  "error ReserveViolation(uint256 balance, uint256 requested, uint256 reserve)",
  "error InvalidAmount()",
  "error InvalidWaiver()",
  "error NoActiveWaiver()",
  "error FacilityAlreadyExists(bytes32 facilityId)",
  "error FacilityNotFound(bytes32 facilityId)",
  "error InvalidPolicy()",
  "error NotFacilityAdmin(bytes32 facilityId, address caller)",
  "error IssuerRoleConflict(bytes32 facilityId, address issuer)",
  "error MissingIssuerRole(bytes32 facilityId)",
  "error FacilityAlreadyFrozen(bytes32 facilityId)",
]);

const adminCallAbi = [...covenantVaultAbi, ...facilityRegistryAbi];

export type FacilityPolicy = {
  facilityId: Hex;
  settlementCurrency: Hex;
  exposureCurrency: Hex;
  minCoverageBps: number;
  credentialMaxAge: number;
  maturityTolerance: number;
  defaultHaircutBps: number;
  reserveAmount: bigint;
  curePeriod: number;
  maxWaiverDuration: number;
  maxActiveHedges: number;
  settlementAsset: Address;
  admin: Address;
  operator: Address;
  frozen: boolean;
};

export type ArcManifest = {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  sourceCommit: string;
  contracts: Record<
    "facilityRegistry" | "credentialRegistry" | "coverageEngine" | "covenantVault",
    { address: Address; deployTx: Hex; block: number }
  >;
  settlementAsset: { address: Address; decimals: number; symbol: string };
  roles: { facilityAdmin: Address; operator: Address; exposureIssuer: Address; hedgeIssuer: Address };
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
      settlementCurrency: string;
      exposureCurrency: string;
      maxActiveHedges: number;
    };
  };
};

/** A call the admin wallet will make, before anything is pinned. */
export type AdminCall = { from: Address; to: Address; data: Hex };

/** Every field the signed transaction must carry. Pinned at proposal, checked before broadcast. */
export type PinnedTransaction = AdminCall & {
  chainId: number;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

export type ArcReceipt = Pick<TransactionReceipt, "transactionHash" | "status" | "blockNumber" | "logs">;

export type VaultStatus = {
  facilityId: Hex;
  covenantState: CovenantState | `UNKNOWN(${number})`;
  activeWaiver: boolean;
  waiverEndsAt: bigint;
};

/** The chain operations the flow needs. `createArcGateway` implements it; tests fake it. */
export type ArcGateway = {
  chainId(): Promise<number>;
  simulate(call: AdminCall): Promise<void>;
  estimateGas(call: AdminCall): Promise<bigint>;
  feesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  pendingNonce(address: Address): Promise<number>;
  sendRawTransaction(serialized: Hex): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<ArcReceipt>;
  facilityExists(registry: Address, facilityId: Hex): Promise<boolean>;
  getFacility(registry: Address, facilityId: Hex): Promise<FacilityPolicy>;
  isExposureIssuer(registry: Address, facilityId: Hex, issuer: Address): Promise<boolean>;
  isHedgeIssuer(registry: Address, facilityId: Hex, issuer: Address): Promise<boolean>;
  vaultStatus(vault: Address): Promise<VaultStatus>;
};

const DEFAULT_MANIFEST = new URL("../../../deployments/arc-testnet.json", import.meta.url);

/** `deployments/arc-testnet.json` is the only source of addresses (E-MAN-4). */
export function loadManifest(path: string | URL = DEFAULT_MANIFEST): ArcManifest {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as ArcManifest;
  if (manifest.chainId !== arcTestnet.id) {
    throw new Error(`manifest chainId ${manifest.chainId} is not Arc Testnet (${arcTestnet.id})`);
  }
  return manifest;
}

export function createArcGateway(manifest: ArcManifest): ArcGateway {
  const client = createPublicClient({ chain: arcTestnet, transport: http(manifest.rpcUrl) });
  const readRegistry = { abi: facilityRegistryAbi } as const;
  return {
    chainId: () => client.getChainId(),
    async simulate({ from, to, data }) {
      try {
        await client.call({ account: from, to, data });
      } catch (error) {
        throw new Error(`simulation from ${from} reverted: ${describeRevert(error)}`, {
          cause: error,
        });
      }
    },
    estimateGas: ({ from, to, data }) => client.estimateGas({ account: from, to, data }),
    async feesPerGas() {
      const fees = await client.estimateFeesPerGas();
      return { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
    },
    pendingNonce: (address) => client.getTransactionCount({ address, blockTag: "pending" }),
    sendRawTransaction: (serialized) =>
      client.sendRawTransaction({ serializedTransaction: serialized }),
    waitForReceipt: (hash) => client.waitForTransactionReceipt({ hash }),
    facilityExists: (registry, facilityId) =>
      client.readContract({
        ...readRegistry,
        address: registry,
        functionName: "facilityExists",
        args: [facilityId],
      }),
    getFacility: (registry, facilityId) =>
      client.readContract({
        ...readRegistry,
        address: registry,
        functionName: "getFacility",
        args: [facilityId],
      }),
    isExposureIssuer: (registry, facilityId, issuer) =>
      client.readContract({
        ...readRegistry,
        address: registry,
        functionName: "isExposureIssuer",
        args: [facilityId, issuer],
      }),
    isHedgeIssuer: (registry, facilityId, issuer) =>
      client.readContract({
        ...readRegistry,
        address: registry,
        functionName: "isHedgeIssuer",
        args: [facilityId, issuer],
      }),
    async vaultStatus(vault) {
      const read = { address: vault, abi: covenantVaultAbi } as const;
      const [facilityId, state, activeWaiver, waiverEndsAt] = await Promise.all([
        client.readContract({ ...read, functionName: "facilityId" }),
        client.readContract({ ...read, functionName: "covenantState" }),
        client.readContract({ ...read, functionName: "activeWaiver" }),
        client.readContract({ ...read, functionName: "waiverEndsAt" }),
      ]);
      return {
        facilityId,
        covenantState: COVENANT_STATES[state] ?? `UNKNOWN(${state})`,
        activeWaiver,
        waiverEndsAt,
      };
    },
  };
}

export function reasonCommitment(reason: string): Hex {
  return keccak256(toBytes(reason));
}

export function encodeCreateWaiver(durationSeconds: number, commitment: Hex): Hex {
  return encodeFunctionData({
    abi: covenantVaultAbi,
    functionName: "createWaiver",
    args: [durationSeconds, commitment],
  });
}

export function encodeRevokeWaiver(): Hex {
  return encodeFunctionData({ abi: covenantVaultAbi, functionName: "revokeWaiver" });
}

/** Names the admin call in `data`, so an approver sees the function and its arguments. */
export function describeAdminCall(data: Hex): { functionName: string; args: readonly unknown[] } {
  const decoded = decodeFunctionData({ abi: adminCallAbi, data });
  return { functionName: decoded.functionName, args: decoded.args ?? [] };
}

/**
 * Pins nonce, gas and fees. `eth_signTransaction` signs exactly what it is given and an intent can
 * wait hours for approvers, so nothing may be left for Privy to fill in. The call is simulated
 * first: a quorum should never be asked to approve a transaction that will revert.
 */
export async function pinAdminTransaction(arc: ArcGateway, call: AdminCall): Promise<PinnedTransaction> {
  const chainId = await arc.chainId();
  if (chainId !== arcTestnet.id) {
    throw new Error(`connected to chain ${chainId}, not Arc Testnet (${arcTestnet.id})`);
  }
  await arc.simulate(call);
  const [nonce, gasEstimate, fees] = await Promise.all([
    arc.pendingNonce(call.from),
    arc.estimateGas(call),
    arc.feesPerGas(),
  ]);
  return {
    ...call,
    chainId,
    nonce,
    gas: (gasEstimate * 12n) / 10n,
    // A signed transaction cannot be re-priced. The cap bounds what it may pay, not what it pays.
    maxFeePerGas: fees.maxFeePerGas * 2n,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };
}

/** The `params.transaction` object for Privy's `eth_signTransaction`. */
export function toPrivyTransaction(tx: PinnedTransaction) {
  return {
    to: tx.to,
    data: tx.data,
    value: "0x0",
    chain_id: tx.chainId,
    nonce: numberToHex(tx.nonce),
    gas_limit: numberToHex(tx.gas),
    max_fee_per_gas: numberToHex(tx.maxFeePerGas),
    max_priority_fee_per_gas: numberToHex(tx.maxPriorityFeePerGas),
    type: 2,
  } as const;
}

/**
 * Checks the RLP Privy returned against what was pinned at proposal, field by field, and that the
 * admin wallet signed it. Two humans approved a specific transaction; this proves it is that one.
 */
export async function verifySignedTransaction(
  serialized: Hex,
  expected: PinnedTransaction,
): Promise<{ signer: Address; hash: Hex }> {
  if (!serialized.startsWith("0x02")) {
    throw new Error(`expected an EIP-1559 transaction, got type prefix ${serialized.slice(0, 4)}`);
  }
  const tx = parseTransaction(serialized as TransactionSerializedEIP1559);
  const mismatches: string[] = [];
  if (tx.chainId !== expected.chainId) mismatches.push(`chainId ${tx.chainId}`);
  if (!tx.to || !isAddressEqual(tx.to, expected.to)) mismatches.push(`to ${tx.to}`);
  // RLP encodes zero as an empty string, which viem parses as an absent field: absent means zero.
  if ((tx.data ?? "0x").toLowerCase() !== expected.data.toLowerCase()) mismatches.push("data");
  if ((tx.value ?? 0n) !== 0n) mismatches.push(`value ${tx.value}`);
  if ((tx.nonce ?? 0) !== expected.nonce) mismatches.push(`nonce ${tx.nonce}`);
  if ((tx.gas ?? 0n) !== expected.gas) mismatches.push(`gas ${tx.gas}`);
  if ((tx.maxFeePerGas ?? 0n) !== expected.maxFeePerGas) mismatches.push(`maxFeePerGas ${tx.maxFeePerGas}`);
  if ((tx.maxPriorityFeePerGas ?? 0n) !== expected.maxPriorityFeePerGas) {
    mismatches.push(`maxPriorityFeePerGas ${tx.maxPriorityFeePerGas}`);
  }
  if (mismatches.length > 0) {
    throw new Error(`signed transaction differs from the approved one: ${mismatches.join(", ")}`);
  }
  const signer = await recoverTransactionAddress({
    serializedTransaction: serialized as TransactionSerializedEIP1559,
  });
  if (!isAddressEqual(signer, expected.from)) {
    throw new Error(`signed by ${signer}, not the admin wallet ${expected.from}`);
  }
  return { signer, hash: keccak256(serialized) };
}

/**
 * Broadcasts and waits. Asserts receipt status, never an exit code or a returned hash (A-9).
 * A transaction the node already knows is not an error: the receipt is what counts.
 */
export async function broadcastAndConfirm(arc: ArcGateway, serialized: Hex): Promise<ArcReceipt> {
  const hash = keccak256(serialized);
  try {
    await arc.sendRawTransaction(serialized);
  } catch (error) {
    if (!/already known|nonce too low/i.test(describeRevert(error))) throw error;
  }
  const receipt = await arc.waitForReceipt(hash);
  if (receipt.status !== "success") {
    throw new Error(`transaction ${hash} failed on Arc: receipt status ${receipt.status}`);
  }
  return receipt;
}

export function describeRevert(error: unknown): string {
  if (error instanceof BaseError) {
    const raw = error.walk((cause) => cause instanceof RawContractError);
    const data = raw instanceof RawContractError ? raw.data : undefined;
    const revertData = typeof data === "object" ? data.data : data;
    if (revertData) {
      try {
        const decoded = decodeErrorResult({ abi: adminErrorsAbi, data: revertData });
        return `${decoded.errorName}(${(decoded.args ?? []).join(", ")})`;
      } catch {
        return `revert data ${revertData}`;
      }
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
