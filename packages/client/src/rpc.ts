import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  type Hex,
  type PublicClient,
} from "viem";
import { arcTestnet } from "viem/chains";

import { SignaError } from "./errors.ts";
import { redactRpcUrl } from "./redact.ts";

/** The reads Signa's live commands make. A viem PublicClient provides them; tests inject one. */
export type ReadClient = Pick<PublicClient, "getChainId" | "getBlock" | "getCode" | "readContract" | "call">;

export type BlockContext = { number: string; hash: Hex; timestamp: string };

/**
 * One RPC endpoint on Arc Testnet and the block every read of one report is pinned to
 * (ERD C-03, C-05). Opening a session checks the chain before anything else is read.
 */
export type Session = {
  client: ReadClient;
  /** The RPC URL, redacted for output. */
  rpc: string;
  chainId: number;
  blockNumber: bigint;
  blockTimestamp: bigint;
  block: BlockContext;
  /** A transport read. Any failure is RPC_UNAVAILABLE. */
  transport: <T>(read: () => Promise<T>) => Promise<T>;
  /** A contract read. A revert or an empty return is DEPLOYMENT_MISMATCH; anything else is RPC_UNAVAILABLE. */
  contract: <T>(label: string, read: () => Promise<T>) => Promise<T>;
};

export async function openSession(client: ReadClient, rpcUrl: string): Promise<Session> {
  const rpc = redactRpcUrl(rpcUrl);
  const transport = <T>(read: () => Promise<T>) => rpcRead(rpc, rpcUrl, read);
  const contract = <T>(label: string, read: () => Promise<T>) => contractRead(rpc, rpcUrl, label, read);
  const chainId = await transport(() => client.getChainId());
  if (chainId !== arcTestnet.id) {
    throw new SignaError("CHAIN_MISMATCH", `the RPC at ${rpc} reports chain ${chainId}; this manifest is for Arc Testnet (${arcTestnet.id})`);
  }
  const block = await transport(() => client.getBlock({ blockTag: "latest" }));
  return {
    client,
    rpc,
    chainId,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    block: { number: block.number.toString(), hash: block.hash, timestamp: isoTime(block.timestamp) ?? "" },
    transport,
    contract,
  };
}

/** Unix seconds as ISO 8601, or null for zero, which the contracts use for "unset". */
export function isoTime(seconds: bigint): string | null {
  return seconds === 0n ? null : new Date(Number(seconds) * 1_000).toISOString();
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

export function reason(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}

export function scrub(message: string, rawUrl: string, redacted: string): string {
  return rawUrl ? message.split(rawUrl).join(redacted) : message;
}
