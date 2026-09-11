import { parseEventLogs, type Abi, type Address, type Hex, type PublicClient } from "viem";

import { coverageEngineAbi, covenantVaultAbi, credentialRegistryAbi, facilityRegistryAbi } from "./abis.ts";
import { decodeContractError, revertData, type DecodedError } from "./revert.ts";
import { isoTime, type BlockContext, type ReadClient } from "./rpc.ts";

/**
 * Receipt handling for P1 operations (ERD §6). A broadcast transaction's fate is decided here,
 * by its receipt, never by whether the signer subprocess exited 0: the keystore spike showed
 * `cast send` exiting 0 on a transaction whose receipt carried `status 0x0`.
 */

export type ReceiptClient = ReadClient & Pick<PublicClient, "getTransaction" | "getTransactionReceipt">;

const KNOWN_EVENTS = [...covenantVaultAbi, ...coverageEngineAbi, ...credentialRegistryAbi, ...facilityRegistryAbi].filter(
  (item) => item.type === "event",
) as Abi;

export type MinedTransaction = {
  state: "mined";
  hash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
  block: BlockContext;
  from: Address;
  to: Address | null;
  nonce: number;
  gasUsed: string;
  effectiveGasPrice: string;
  events: { name: string; args: Record<string, string> }[];
  /** Set when the transaction reverted and a deployed contract's error decodes its data. */
  revert: DecodedError | null;
  /** Revert data that no known contract error decodes. Never guessed at. */
  undecodableRevert: Hex | null;
};

export type PendingTransaction = {
  state: "pending";
  hash: Hex;
  waitedSeconds: number;
  /** Present once the node has seen the transaction; absent while it is unknown to this node. */
  nonce: number | null;
  from: Address | null;
};

export type TransactionState = MinedTransaction | PendingTransaction | { state: "unknown"; hash: Hex };

function scalar(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : typeof value === "string" ? value : JSON.stringify(value);
}

/** Decodes the logs a receipt carries against the deployed contracts' events. */
function decodeEvents(logs: readonly unknown[]): { name: string; args: Record<string, string> }[] {
  const parsed = parseEventLogs({ abi: KNOWN_EVENTS, logs: logs as never });
  return parsed.map((log) => ({
    name: log.eventName as string,
    args: Object.fromEntries(Object.entries((log.args ?? {}) as Record<string, unknown>).map(([key, value]) => [key, scalar(value)])),
  }));
}

async function receiptOrNull(client: ReceiptClient, hash: Hex): Promise<Awaited<ReturnType<PublicClient["getTransactionReceipt"]>> | null> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch {
    return null;
  }
}

async function transactionOrNull(client: ReceiptClient, hash: Hex): Promise<{ from: Address; nonce: number; to: Address | null; input: Hex } | null> {
  try {
    const tx = await client.getTransaction({ hash });
    return { from: tx.from, nonce: tx.nonce, to: tx.to ?? null, input: tx.input };
  } catch {
    return null;
  }
}

/**
 * Replays a reverted transaction as a call at its own block, which is the only way to recover the
 * revert data a receipt does not carry. Failure to replay is not an error: the reason is reported
 * as undecodable rather than invented.
 */
async function revertReason(client: ReceiptClient, hash: Hex, blockNumber: bigint): Promise<{ revert: DecodedError | null; undecodable: Hex | null }> {
  const tx = await transactionOrNull(client, hash);
  if (!tx || !tx.to) return { revert: null, undecodable: null };
  try {
    await client.call({ account: tx.from, to: tx.to, data: tx.input, blockNumber });
    return { revert: null, undecodable: null };
  } catch (error) {
    const data = revertData(error);
    if (!data || data === "0x") return { revert: null, undecodable: null };
    const decoded = decodeContractError(data);
    return decoded ? { revert: decoded, undecodable: null } : { revert: null, undecodable: data };
  }
}

/** Reads a transaction's current state without waiting. */
export async function readTransaction(client: ReceiptClient, hash: Hex): Promise<TransactionState> {
  const receipt = await receiptOrNull(client, hash);
  if (!receipt) {
    const tx = await transactionOrNull(client, hash);
    if (!tx) return { state: "unknown", hash };
    return { state: "pending", hash, waitedSeconds: 0, nonce: tx.nonce, from: tx.from };
  }
  return describeReceipt(client, hash, receipt);
}

async function describeReceipt(client: ReceiptClient, hash: Hex, receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>): Promise<MinedTransaction> {
  const status = receipt.status === "success" ? ("success" as const) : ("reverted" as const);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const tx = await transactionOrNull(client, hash);
  const { revert, undecodable } = status === "reverted" ? await revertReason(client, hash, receipt.blockNumber) : { revert: null, undecodable: null };
  return {
    state: "mined",
    hash,
    status,
    blockNumber: receipt.blockNumber,
    block: { number: receipt.blockNumber.toString(), hash: receipt.blockHash, timestamp: isoTime(block.timestamp) ?? "" },
    from: receipt.from,
    to: receipt.to ?? null,
    nonce: tx?.nonce ?? 0,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    events: decodeEvents(receipt.logs),
    revert,
    undecodableRevert: undecodable,
  };
}

/**
 * Waits for a receipt, bounded. On timeout the transaction is reported pending with its hash
 * retained, never retried and never replaced: re-sending is always the caller's explicit choice.
 */
export async function awaitReceipt(
  client: ReceiptClient,
  hash: Hex,
  options: { timeoutMs: number; pollMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<MinedTransaction | PendingTransaction> {
  const pollMs = options.pollMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  for (;;) {
    const receipt = await receiptOrNull(client, hash);
    if (receipt) return describeReceipt(client, hash, receipt);
    const waited = Date.now() - started;
    if (waited >= options.timeoutMs) {
      const tx = await transactionOrNull(client, hash);
      return { state: "pending", hash, waitedSeconds: Math.round(waited / 1_000), nonce: tx?.nonce ?? null, from: tx?.from ?? null };
    }
    await sleep(Math.min(pollMs, Math.max(0, options.timeoutMs - waited)));
  }
}
