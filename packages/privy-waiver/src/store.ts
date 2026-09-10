import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Address, Hex } from "viem";

import type { PinnedTransaction } from "./arc.ts";
import type { SetupStepKind } from "./facility-setup.ts";

/**
 * Our own record of every proposal. Privy returns what it recorded, but the transaction the
 * approvers were shown is checked against this copy before broadcast, so it must outlive a restart.
 * It holds no secrets. It lives outside the repository by default.
 */

export type ActionKind = "waiver.create" | "waiver.revoke" | SetupStepKind;

export type SerializedPinned = {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  nonce: number;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
};

/** The chain as it stood when a waiver was proposed: why the approvers were asked. */
export type WaiverContext = {
  checkedAt: number;
  covenantState: string;
  coverageBps: number;
  requiredCoverageBps: number;
  resultReason: string;
  exposureReason: string;
  maxWaiverDurationSeconds: number;
};

/** The WaiverCreated a waiver's receipt carried, and whether it records what was approved. */
export type WaiverCreatedRecord = {
  facilityId: Hex;
  reasonCommitment: Hex;
  startsAt: string;
  endsAt: string;
  logIndex: number;
  facilityMatches: boolean;
  reasonCommitmentMatches: boolean;
};

export type BroadcastRecord = {
  hash: Hex;
  /** Recovered from the signed transaction before it was broadcast. */
  signer?: Address;
  blockNumber: string;
  status: string;
  waiverCreated?: WaiverCreatedRecord;
};

export type StoredAction = {
  intentId: string;
  kind: ActionKind;
  description: string;
  reason?: string;
  context?: WaiverContext;
  pinned: SerializedPinned;
  proposedAt: number;
  broadcast?: BroadcastRecord;
};

export interface ActionStore {
  all(): StoredAction[];
  get(intentId: string): StoredAction | undefined;
  save(action: StoredAction): void;
  recordBroadcast(intentId: string, broadcast: BroadcastRecord): StoredAction;
}

export function serializePinned(tx: PinnedTransaction): SerializedPinned {
  return {
    chainId: tx.chainId,
    from: tx.from,
    to: tx.to,
    data: tx.data,
    nonce: tx.nonce,
    gas: tx.gas.toString(),
    maxFeePerGas: tx.maxFeePerGas.toString(),
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString(),
  };
}

export function deserializePinned(tx: SerializedPinned): PinnedTransaction {
  return {
    ...tx,
    gas: BigInt(tx.gas),
    maxFeePerGas: BigInt(tx.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
  };
}

export function defaultStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRIVY_WAIVER_STORE?.trim() || join(homedir(), ".signa-privy-waiver", "actions.json");
}

export class MemoryActionStore implements ActionStore {
  protected readonly actions = new Map<string, StoredAction>();

  all(): StoredAction[] {
    return [...this.actions.values()].sort((a, b) => b.proposedAt - a.proposedAt);
  }

  get(intentId: string): StoredAction | undefined {
    return this.actions.get(intentId);
  }

  save(action: StoredAction): void {
    this.actions.set(action.intentId, action);
  }

  recordBroadcast(intentId: string, broadcast: BroadcastRecord): StoredAction {
    const action = this.actions.get(intentId);
    if (!action) throw new Error(`no proposal recorded for intent ${intentId}`);
    const updated = { ...action, broadcast };
    this.actions.set(intentId, updated);
    return updated;
  }
}

export class JsonFileStore extends MemoryActionStore {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) {
      for (const action of JSON.parse(readFileSync(path, "utf8")) as StoredAction[]) {
        this.actions.set(action.intentId, action);
      }
    }
  }

  override save(action: StoredAction): void {
    super.save(action);
    this.flush();
  }

  override recordBroadcast(intentId: string, broadcast: BroadcastRecord): StoredAction {
    const updated = super.recordBroadcast(intentId, broadcast);
    this.flush();
    return updated;
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.all(), null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
