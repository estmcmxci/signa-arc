import {
  SignaError,
  awaitReceipt,
  decodeContractError,
  isRevert,
  reason,
  revertData,
  type MinedTransaction,
  type ReceiptClient,
  type Session,
} from "@signa/client";
import { isAddressEqual, type Address, type Hex } from "viem";

import type { Journal } from "./journal.ts";
import type { Signer } from "./signer.ts";

/**
 * The one path every write command takes (ERD §6). In order, and never out of it:
 *
 *   verify the signer's role -> simulate the exact call as that signer -> journal -> broadcast
 *   once -> journal the hash before waiting -> wait for the receipt -> decide by the receipt.
 *
 * A refusal happens before anything is broadcast. A send is never retried automatically: a
 * timeout leaves the hash journalled and reported, and re-sending is always an explicit choice.
 */

export type SendContext = {
  session: Session;
  client: ReceiptClient;
  signer: Signer;
  journal: Journal;
  timeoutMs: number;
  command: string;
  chainId: number;
  facilityId: string;
};

export type SendRequest = {
  contract: Address;
  data: Hex;
  functionName: string;
};

/** Refuses before anything is simulated when the signer is not the role the operation needs. */
export function requireSignerRole(signer: Signer, expected: Address, role: string): void {
  if (!isAddressEqual(signer.address, expected)) {
    throw new SignaError(
      "SIGNER_ROLE_MISMATCH",
      `--account ${signer.account} is ${signer.address}, but this operation must be sent by the facility's ${role}, ${expected}. Nothing was simulated or broadcast.`,
    );
  }
}

/**
 * Simulates the exact call that would be sent, as the signer, at the session's block. A decoded
 * refusal here is final: ACTION_REFUSED, and nothing is broadcast.
 */
export async function simulateCall(session: Session, client: ReceiptClient, signer: Signer, request: SendRequest, rpcUrl: string): Promise<void> {
  try {
    await client.call({ account: signer.address, to: request.contract, data: request.data, blockNumber: session.blockNumber });
  } catch (error) {
    if (!isRevert(error)) {
      const message = `RPC request to ${session.rpc} failed while simulating ${request.functionName}: ${reason(error)}`;
      throw new SignaError("RPC_UNAVAILABLE", rpcUrl ? message.split(rpcUrl).join(session.rpc) : message, true);
    }
    const data = revertData(error);
    if (!data || data === "0x") {
      throw new SignaError("SIMULATION_FAILED", `the simulated ${request.functionName} reverted without revert data, so its reason cannot be decoded. Nothing was broadcast.`);
    }
    const decoded = decodeContractError(data);
    if (!decoded) {
      throw new SignaError("SIMULATION_FAILED", `the simulated ${request.functionName} reverted with data no known contract error decodes: ${data}. Nothing was broadcast.`);
    }
    throw new SignaError(
      "ACTION_REFUSED",
      `${request.functionName} was refused: ${decoded.error}, because ${decoded.explanation}. Nothing was broadcast.`,
      false,
      { error: decoded.error, data: decoded.data },
    );
  }
}

/**
 * Broadcasts one transaction and resolves its fate by the receipt. `cast` exits 0 on a
 * transaction whose receipt reverts, so the subprocess result decides nothing here.
 */
export async function performSend(context: SendContext, request: SendRequest, rpcUrl: string): Promise<MinedTransaction> {
  const { session, client, signer, journal } = context;
  const entry = {
    command: context.command,
    chainId: context.chainId,
    facilityId: context.facilityId,
    account: signer.account,
    signer: signer.address,
    contract: request.contract,
    function: request.functionName,
  };

  await simulateCall(session, client, signer, request, rpcUrl);
  journal.append({ ...entry, event: "simulated", status: "permitted" });

  const hash = await signer.send({ to: request.contract, data: request.data });
  // Before any wait: a timeout, an interruption or a kill must still leave the hash recorded.
  journal.append({ ...entry, event: "broadcast", hash });

  const outcome = await awaitReceipt(client, hash, { timeoutMs: context.timeoutMs });
  if (outcome.state === "pending") {
    journal.append({ ...entry, event: "outcome", hash, status: "pending", detail: `no receipt after ${outcome.waitedSeconds}s` });
    throw new SignaError(
      "TRANSACTION_PENDING",
      `${request.functionName} was broadcast as ${hash} but no receipt arrived within ${outcome.waitedSeconds}s. It was not retried or replaced, and it may still be mined. Reconcile it with \`signa tx show ${hash}\`.`,
      true,
      { hash, broadcast: "true", waitedSeconds: String(outcome.waitedSeconds) },
    );
  }
  journal.append({ ...entry, event: "outcome", hash, status: outcome.status });
  if (outcome.status === "reverted") {
    const why = outcome.revert
      ? `${outcome.revert.error}, because ${outcome.revert.explanation}`
      : outcome.undecodableRevert
        ? `revert data no known contract error decodes: ${outcome.undecodableRevert}`
        : "no revert reason the node will disclose";
    throw new SignaError(
      "TRANSACTION_REVERTED",
      `${request.functionName} was mined in block ${outcome.block.number} with receipt status 0x0: ${why}. The transaction was broadcast and it failed; nothing changed.`,
      false,
      { hash, broadcast: "true" },
    );
  }
  return outcome;
}
