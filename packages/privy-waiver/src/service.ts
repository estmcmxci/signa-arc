import { parseEventLogs, type Address, type Hex } from "viem";

import {
  formatAuthorizationPayload,
  intentAuthorizationInput,
  normalizePublicKey,
  p1363ToDer,
  verifyAuthorizationSignature,
} from "./authorization.ts";
import {
  broadcastAndConfirm,
  covenantVaultAbi,
  describeAdminCall,
  encodeCreateWaiver,
  encodeRevokeWaiver,
  pinAdminTransaction,
  reasonCommitment,
  toPrivyTransaction,
  verifySignedTransaction,
  type ArcGateway,
  type PinnedTransaction,
} from "./arc.ts";
import { nextFacilitySetupStep, type QuorumFacilityPlan } from "./facility-setup.ts";
import { keyMembers, signedTransactionOf, type PrivyClient, type RpcIntent } from "./privy-client.ts";
import {
  deserializePinned,
  serializePinned,
  type ActionKind,
  type ActionStore,
  type BroadcastRecord,
  type StoredAction,
} from "./store.ts";

/**
 * The quorum-gated admin flow: propose an admin call as a Privy intent, collect one authorization
 * signature per approver, then check the transaction Privy signs and broadcast it to Arc.
 *
 * R-F3-7: a waiver is the one place a human overrides the covenant, so under Privy it takes m-of-n.
 * The facility's admin check is `msg.sender == admin`, so the quorum-owned wallet only has to be
 * the sender. No contract changes.
 */

export type ServiceConfig = {
  walletId: string;
  walletAddress: Address;
  explorer: string;
  vault?: Address;
  /** Which Privy headers the approval payload carries. See `intentAuthorizationInput`. */
  signedHeaders: "app-id" | "app-id+expiry";
};

/** One approver's signature, as the UI sends it. Browsers produce P1363; SDKs produce DER. */
export type Approval = {
  publicKey: string;
  signature: string;
  encoding: "der" | "p1363";
  timestamp: number;
};

export type ActionView = {
  intentId: string;
  kind: ActionKind;
  description: string;
  reason?: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  call: {
    to: Address;
    data: Hex;
    functionName: string;
    args: string[];
    chainId: number;
    nonce: number;
    gasLimit: string;
    maxFeePerGasWei: string;
  };
  approvals: { threshold: number; members: { publicKey: string; signedAt: number | null }[] };
  /** The exact text an approver signs. Present only while the intent can take approvals. */
  signingPayload?: string;
  broadcast?: BroadcastRecord & { explorerUrl: string };
};

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const OPEN_STATUSES = new Set(["pending", "granted", "processing", "executed"]);
const QUANTITY_FIELDS = new Set(["chain_id", "nonce", "gas_limit", "max_fee_per_gas", "max_priority_fee_per_gas", "value", "type"]);
const MAX_UINT32 = 2 ** 32 - 1;
const APPROVAL_CLOCK_SKEW_MS = 10 * 60 * 1000;

export class QuorumAdminService {
  constructor(
    private readonly privy: PrivyClient,
    private readonly arc: ArcGateway,
    private readonly store: ActionStore,
    private readonly config: ServiceConfig,
    private readonly facilityPlan?: QuorumFacilityPlan,
    private readonly now: () => number = Date.now,
  ) {}

  async proposeWaiver(input: { durationSeconds: number; reason: string }): Promise<ActionView> {
    const vault = this.requireVault();
    const reason = input.reason.trim();
    const { durationSeconds } = input;
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_UINT32) {
      throw new ServiceError("durationSeconds must be a positive whole number of seconds");
    }
    if (!reason) throw new ServiceError("a waiver needs a stated reason; its hash is committed on chain");
    const commitment = reasonCommitment(reason);
    return this.propose(
      "waiver.create",
      vault,
      encodeCreateWaiver(durationSeconds, commitment),
      `Waive the coverage covenant on ${vault} for ${formatDuration(durationSeconds)}, reason commitment ${commitment}`,
      reason,
    );
  }

  async proposeWaiverRevocation(): Promise<ActionView> {
    const vault = this.requireVault();
    return this.propose("waiver.revoke", vault, encodeRevokeWaiver(), `Revoke the active waiver on ${vault}`);
  }

  /** Proposes whatever facility setup is still missing on chain, or reports that none is. */
  async proposeNextSetupStep(): Promise<ActionView | { complete: true; description: string }> {
    if (!this.facilityPlan) throw new ServiceError("no quorum facility is configured", 409);
    const step = await nextFacilitySetupStep(this.arc, this.facilityPlan);
    if (step.kind === "complete") return { complete: true, description: step.description };
    return this.propose(step.kind, step.to, step.data, step.description);
  }

  async list(): Promise<ActionView[]> {
    return Promise.all(this.store.all().map(async (action) => this.view(action, await this.privy.getIntent(action.intentId))));
  }

  async get(intentId: string): Promise<ActionView> {
    const action = this.requireAction(intentId);
    return this.view(action, await this.privy.getIntent(intentId));
  }

  /** The bytes an approver signs: the intent's recorded request, canonicalized. */
  signingPayload(intent: RpcIntent): { text: string; bytes: Uint8Array<ArrayBuffer> } {
    const extra =
      this.config.signedHeaders === "app-id+expiry" ? { "privy-request-expiry": String(intent.expires_at) } : {};
    const bytes = formatAuthorizationPayload(intentAuthorizationInput(intent.request_details, this.privy.appId, extra));
    return { text: new TextDecoder().decode(bytes), bytes };
  }

  /**
   * Forwards one approver's signature to Privy, after checking it verifies over this intent's
   * payload under a key that belongs to the quorum. A bad signature never reaches Privy.
   */
  async approve(intentId: string, approval: Approval): Promise<ActionView> {
    const action = this.requireAction(intentId);
    const intent = await this.privy.getIntent(intentId);
    if (intent.status !== "pending") {
      throw new ServiceError(`intent is ${intent.status}; only pending intents take approvals`, 409);
    }
    this.assertIntentMatches(intent, deserializePinned(action.pinned));
    const member = keyMembers(intent).find((candidate) => sameKey(candidate.publicKey, approval.publicKey));
    if (!member) throw new ServiceError("that public key is not a member of this intent's quorum", 403);
    if (Math.abs(this.now() - approval.timestamp) > APPROVAL_CLOCK_SKEW_MS) {
      throw new ServiceError("approval timestamp is not current");
    }
    const signature =
      approval.encoding === "p1363"
        ? Buffer.from(p1363ToDer(Buffer.from(approval.signature, "base64"))).toString("base64")
        : approval.signature;
    if (!verifyAuthorizationSignature(member.publicKey, this.signingPayload(intent).bytes, signature)) {
      throw new ServiceError("signature does not verify over this intent's payload");
    }
    const updated = await this.privy.authorizeIntent(intentId, { signature, timestamp: approval.timestamp });
    return this.view(action, updated);
  }

  async reject(intentId: string): Promise<ActionView> {
    const action = this.requireAction(intentId);
    return this.view(action, await this.privy.rejectIntent(intentId));
  }

  /**
   * Once Privy has signed, checks the signed transaction is exactly the one approved and that the
   * quorum wallet signed it, then broadcasts to Arc and asserts the receipt succeeded.
   */
  async execute(intentId: string): Promise<ActionView> {
    const action = this.requireAction(intentId);
    const intent = await this.privy.getIntent(intentId);
    if (action.broadcast) return this.view(action, intent);
    if (intent.status !== "executed") {
      throw new ServiceError(`intent is ${intent.status}; Privy signs only once the threshold is met`, 409);
    }
    const signed = signedTransactionOf(intent);
    if (!signed) throw new ServiceError("the executed intent carries no signed transaction", 502);
    const pinned = deserializePinned(action.pinned);
    this.assertIntentMatches(intent, pinned);
    const { hash } = await verifySignedTransaction(signed, pinned);
    const receipt = await broadcastAndConfirm(this.arc, signed);
    const [waiver] = parseEventLogs({ abi: covenantVaultAbi, logs: receipt.logs, eventName: "WaiverCreated" });
    const updated = this.store.recordBroadcast(intentId, {
      hash,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
      ...(waiver ? { waiverEndsAt: waiver.args.endsAt.toString() } : {}),
    });
    return this.view(updated, intent);
  }

  private async propose(
    kind: ActionKind,
    to: Address,
    data: Hex,
    description: string,
    reason?: string,
  ): Promise<ActionView> {
    await this.assertNoOpenAction();
    const pinned = await pinAdminTransaction(this.arc, { from: this.config.walletAddress, to, data });
    const intent = await this.privy.proposeRpcIntent(this.config.walletId, {
      method: "eth_signTransaction",
      params: { transaction: toPrivyTransaction(pinned) },
    });
    this.assertIntentMatches(intent, pinned);
    const action: StoredAction = {
      intentId: intent.intent_id,
      kind,
      description,
      pinned: serializePinned(pinned),
      proposedAt: this.now(),
      ...(reason === undefined ? {} : { reason }),
    };
    this.store.save(action);
    return this.view(action, intent);
  }

  /** Each proposal pins the wallet's next nonce, so only one may be in flight at a time. */
  private async assertNoOpenAction(): Promise<void> {
    for (const action of this.store.all()) {
      if (action.broadcast) continue;
      const intent = await this.privy.getIntent(action.intentId);
      if (OPEN_STATUSES.has(intent.status)) {
        throw new ServiceError(
          `intent ${action.intentId} (${action.kind}) is still ${intent.status}; execute or reject it first`,
          409,
        );
      }
    }
  }

  /** Privy must have recorded exactly the transaction that was pinned, or approvers would sign another. */
  private assertIntentMatches(intent: RpcIntent, pinned: PinnedTransaction): void {
    const request = intent.request_details;
    const body = request.body as { method?: unknown; params?: { transaction?: Record<string, unknown> } } | null;
    const problems: string[] = [];
    if (request.method !== "POST") problems.push(`HTTP method ${request.method}`);
    if (!request.url.endsWith(`/v1/wallets/${encodeURIComponent(this.config.walletId)}/rpc`)) {
      problems.push(`url ${request.url}`);
    }
    if (body?.method !== "eth_signTransaction") problems.push(`RPC method ${String(body?.method)}`);
    const recorded = body?.params?.transaction ?? {};
    for (const [field, expected] of Object.entries(toPrivyTransaction(pinned))) {
      if (!sameField(field, recorded[field], expected)) problems.push(`${field}=${String(recorded[field])}`);
    }
    if (problems.length > 0) {
      throw new ServiceError(`Privy recorded a different request than was proposed: ${problems.join(", ")}`, 502);
    }
  }

  private view(action: StoredAction, intent: RpcIntent): ActionView {
    const pinned = action.pinned;
    const call = describeAdminCall(pinned.data);
    const members = keyMembers(intent);
    const threshold = intent.authorization_details.reduce((total, detail) => total + detail.threshold, 0);
    return {
      intentId: action.intentId,
      kind: action.kind,
      description: action.description,
      ...(action.reason === undefined ? {} : { reason: action.reason }),
      status: intent.status,
      createdAt: intent.created_at,
      expiresAt: intent.expires_at,
      call: {
        to: pinned.to,
        data: pinned.data,
        functionName: call.functionName,
        args: call.args.map((arg) => JSON.stringify(arg, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))),
        chainId: pinned.chainId,
        nonce: pinned.nonce,
        gasLimit: pinned.gas,
        maxFeePerGasWei: pinned.maxFeePerGas,
      },
      approvals: { threshold, members },
      ...(intent.status === "pending" ? { signingPayload: this.signingPayload(intent).text } : {}),
      ...(action.broadcast
        ? { broadcast: { ...action.broadcast, explorerUrl: `${this.config.explorer}/tx/${action.broadcast.hash}` } }
        : {}),
    };
  }

  private requireAction(intentId: string): StoredAction {
    const action = this.store.get(intentId);
    if (!action) throw new ServiceError(`no proposal from this server matches intent ${intentId}`, 404);
    return action;
  }

  private requireVault(): Address {
    if (!this.config.vault) {
      throw new ServiceError("PRIVY_WAIVER_VAULT is not set: the quorum's vault has not been deployed yet", 409);
    }
    return this.config.vault;
  }
}

function sameKey(a: string, b: string): boolean {
  try {
    return normalizePublicKey(a) === normalizePublicKey(b);
  } catch {
    return false;
  }
}

function sameField(field: string, actual: unknown, expected: string | number): boolean {
  if (QUANTITY_FIELDS.has(field)) {
    try {
      return typeof actual === "number" || typeof actual === "string"
        ? BigInt(actual) === BigInt(expected)
        : false;
    } catch {
      return false;
    }
  }
  return typeof actual === "string" && actual.toLowerCase() === String(expected).toLowerCase();
}

function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day(s)`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour(s)`;
  return `${seconds} seconds`;
}
