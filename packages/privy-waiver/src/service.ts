import { isAddressEqual, parseEventLogs, type Address, type Hex } from "viem";

import {
  INTENT_SIGNATURE_WINDOW_MS,
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
  pinAdminTransaction,
  reasonCommitment,
  toPrivyTransaction,
  verifySignedTransaction,
  type ArcGateway,
  type ArcReceipt,
  type CoverageEvaluation,
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
  type WaiverContext,
  type WaiverCreatedRecord,
} from "./store.ts";

/**
 * The quorum-gated admin flow: propose an admin call as a Privy intent, collect one authorization
 * signature per approver, then check the transaction Privy signs and broadcast it to Arc
 * ourselves, because Privy cannot (see arc.ts).
 *
 * R-F3-7: a waiver is the one place a human overrides the covenant, so under Privy it takes m-of-n.
 * The facility's admin check is `msg.sender == admin`, so the quorum-owned wallet only has to be
 * the sender. No contract changes.
 */

/** The facility whose waivers the service proposes. Every address comes from the manifest. */
export type FacilityConfig = {
  id: Hex;
  vault: Address;
  registry: Address;
  coverageEngine: Address;
};

export type ServiceConfig = {
  walletId: string;
  walletAddress: Address;
  explorer: string;
  facility?: FacilityConfig;
};

/** One approver's signature, as the UI sends it. Browsers produce P1363; SDKs produce DER. */
export type Approval = {
  publicKey: string;
  signature: string;
  encoding: "der" | "p1363";
  /** The timestamp inside the signed payload, as `signingPayloadFor` returned it. */
  timestamp: number;
};

/** Whether the contract would accept a waiver now, as read from Arc, and if not, why not. */
export type WaiverReadiness = {
  facilityId: Hex;
  vault: Address;
  covenantState: string;
  activeWaiver: boolean;
  waiverEndsAt: string;
  coverage: CoverageEvaluation;
  maxWaiverDurationSeconds: number;
  /** Every reason the contract would refuse a waiver of any duration. Empty when it would accept one. */
  refusals: string[];
};

export type ActionView = {
  intentId: string;
  kind: ActionKind;
  description: string;
  reason?: string;
  /** For a waiver: the chain as it stood when the waiver was proposed. */
  context?: WaiverContext;
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
  /**
   * What an approver signs, stamped with the time this view was built. Present only while the
   * intent can take approvals. Approvers sign a fresh copy from `signingPayloadFor`.
   */
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

export class QuorumAdminService {
  constructor(
    private readonly privy: PrivyClient,
    private readonly arc: ArcGateway,
    private readonly store: ActionStore,
    private readonly config: ServiceConfig,
    private readonly facilityPlan?: QuorumFacilityPlan,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Proposes a waiver only if the contract would accept it now. Privy checks the wallet's policy
   * when it executes an intent, not when it takes one, and the contract checks a waiver only when
   * it is mined. Without this, a waiver doomed by either would collect both approvals first. The
   * duration cap is checked here too, because the policy cannot check it (see policy.ts).
   */
  async proposeWaiver(input: { durationSeconds: number; reason: string }): Promise<ActionView> {
    const facility = this.requireFacility();
    const reason = input.reason.trim();
    const { durationSeconds } = input;
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
      throw new ServiceError("durationSeconds must be a positive whole number of seconds");
    }
    if (!reason) throw new ServiceError("a waiver needs a stated reason; its hash is committed on chain");
    const readiness = await this.waiverReadiness();
    if (durationSeconds > readiness.maxWaiverDurationSeconds) {
      throw new ServiceError(
        `the facility's longest waiver is ${formatDuration(readiness.maxWaiverDurationSeconds)} (maxWaiverDuration); ${formatDuration(durationSeconds)} would revert`,
      );
    }
    if (readiness.refusals.length > 0) {
      throw new ServiceError(`not proposed, because the contract would refuse it: ${readiness.refusals.join("; ")}`, 409);
    }
    const commitment = reasonCommitment(reason);
    const { coverage } = readiness;
    return this.propose(
      "waiver.create",
      facility.vault,
      encodeCreateWaiver(durationSeconds, commitment),
      `Waive the coverage covenant on ${facility.vault} for ${formatDuration(durationSeconds)}, reason commitment ${commitment}`,
      {
        reason,
        context: {
          checkedAt: this.now(),
          covenantState: readiness.covenantState,
          coverageBps: coverage.coverageBps,
          requiredCoverageBps: coverage.requiredCoverageBps,
          resultReason: coverage.resultReason,
          exposureReason: coverage.exposureReason,
          maxWaiverDurationSeconds: readiness.maxWaiverDurationSeconds,
        },
      },
    );
  }

  /**
   * Reads what `createWaiver` will check: the vault belongs to this facility, the facility's admin
   * is this wallet, no waiver is active, and a fresh coverage evaluation is not compliant. The
   * contract syncs before it checks, so the stored covenant state alone would mislead.
   */
  async waiverReadiness(): Promise<WaiverReadiness> {
    const facility = this.requireFacility();
    const [status, policy, coverage] = await Promise.all([
      this.arc.vaultStatus(facility.vault),
      this.arc.getFacility(facility.registry, facility.id),
      this.arc.evaluateCoverage(facility.coverageEngine, facility.id),
    ]);
    const refusals = waiverRefusals({
      facility,
      walletAddress: this.config.walletAddress,
      vaultFacilityId: status.facilityId,
      admin: policy.admin,
      activeWaiver: status.activeWaiver,
      waiverEndsAt: status.waiverEndsAt,
      coverage,
    });
    return {
      facilityId: facility.id,
      vault: facility.vault,
      covenantState: status.covenantState,
      activeWaiver: status.activeWaiver,
      waiverEndsAt: status.waiverEndsAt.toString(),
      coverage,
      maxWaiverDurationSeconds: policy.maxWaiverDuration,
      refusals,
    };
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

  /** The bytes an approver signs to authorize `intent` at `timestamp`. */
  signingPayload(intent: RpcIntent, timestamp: number): { text: string; bytes: Uint8Array<ArrayBuffer> } {
    const bytes = formatAuthorizationPayload(intentAuthorizationInput(intent, this.privy.appId, timestamp));
    return { text: new TextDecoder().decode(bytes), bytes };
  }

  /**
   * A payload to sign now. It embeds the current time and Privy accepts it for 300 seconds, so an
   * approver fetches one when approving rather than signing whatever the page showed earlier.
   */
  async signingPayloadFor(intentId: string): Promise<{ text: string; timestamp: number }> {
    const action = this.requireAction(intentId);
    const intent = await this.privy.getIntent(intentId);
    if (intent.status !== "pending") {
      throw new ServiceError(`intent is ${intent.status}; only pending intents take approvals`, 409);
    }
    this.assertIntentMatches(intent, deserializePinned(action.pinned));
    const timestamp = this.now();
    return { text: this.signingPayload(intent, timestamp).text, timestamp };
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
    if (Math.abs(this.now() - approval.timestamp) > INTENT_SIGNATURE_WINDOW_MS) {
      throw new ServiceError("approval timestamp is outside Privy's 300-second window; sign a fresh payload");
    }
    const signature =
      approval.encoding === "p1363"
        ? Buffer.from(p1363ToDer(Buffer.from(approval.signature, "base64"))).toString("base64")
        : approval.signature;
    const payload = this.signingPayload(intent, approval.timestamp).bytes;
    if (!verifyAuthorizationSignature(member.publicKey, payload, signature)) {
      throw new ServiceError("signature does not verify over this intent's payload at that timestamp");
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
   * quorum wallet signed it, then broadcasts to Arc and asserts the receipt succeeded. For a
   * waiver it also asserts the receipt's WaiverCreated records what the approvers were shown.
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
    const { signer, hash } = await verifySignedTransaction(signed, pinned);
    const receipt = await broadcastAndConfirm(this.arc, signed);
    const waiver = action.kind === "waiver.create" ? this.waiverCreatedIn(receipt, action) : undefined;
    // Recorded before any assertion can throw: the transaction is mined either way.
    const updated = this.store.recordBroadcast(intentId, {
      hash,
      signer,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
      ...(waiver?.record ? { waiverCreated: waiver.record } : {}),
    });
    if (waiver && waiver.problems.length > 0) {
      throw new ServiceError(
        `transaction ${hash} succeeded in block ${receipt.blockNumber}, but ${waiver.problems.join("; ")}`,
        502,
      );
    }
    return this.view(updated, intent);
  }

  /**
   * A successful receipt is not enough: it must carry exactly one WaiverCreated from the approved
   * vault, naming this facility and committing to the stated reason.
   */
  private waiverCreatedIn(
    receipt: ArcReceipt,
    action: StoredAction,
  ): { record?: WaiverCreatedRecord; problems: string[] } {
    const facility = this.requireFacility();
    const vault = action.pinned.to;
    const events = parseEventLogs({ abi: covenantVaultAbi, logs: receipt.logs, eventName: "WaiverCreated" }).filter(
      (log) => isAddressEqual(log.address, vault),
    );
    const [event] = events;
    if (!event || events.length !== 1) {
      return { problems: [`the receipt carries ${events.length} WaiverCreated events from ${vault}, not exactly one`] };
    }
    const expectedCommitment = reasonCommitment(action.reason ?? "");
    const record: WaiverCreatedRecord = {
      facilityId: event.args.facilityId,
      reasonCommitment: event.args.reasonCommitment,
      startsAt: event.args.startsAt.toString(),
      endsAt: event.args.endsAt.toString(),
      logIndex: event.logIndex,
      facilityMatches: event.args.facilityId.toLowerCase() === facility.id.toLowerCase(),
      reasonCommitmentMatches: event.args.reasonCommitment.toLowerCase() === expectedCommitment.toLowerCase(),
    };
    const problems: string[] = [];
    if (!record.facilityMatches) problems.push(`WaiverCreated names facility ${record.facilityId}, not ${facility.id}`);
    if (!record.reasonCommitmentMatches) {
      problems.push(
        `WaiverCreated commits to ${record.reasonCommitment}, not to keccak256 of the stated reason, ${expectedCommitment}`,
      );
    }
    return { record, problems };
  }

  private async propose(
    kind: ActionKind,
    to: Address,
    data: Hex,
    description: string,
    extra: { reason?: string; context?: WaiverContext } = {},
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
      ...extra,
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
      ...(action.context === undefined ? {} : { context: action.context }),
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
      ...(intent.status === "pending" ? { signingPayload: this.signingPayload(intent, this.now()).text } : {}),
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

  private requireFacility(): FacilityConfig {
    if (!this.config.facility) {
      throw new ServiceError("no facility is configured: the manifest's facility admin is not this wallet", 409);
    }
    return this.config.facility;
  }
}

/**
 * Every reason `createWaiver` would refuse a waiver of any duration, given the chain's state. Pure,
 * so the same rule can be applied to state read at any block.
 */
export function waiverRefusals(input: {
  facility: FacilityConfig;
  walletAddress: Address;
  vaultFacilityId: Hex;
  admin: Address;
  activeWaiver: boolean;
  waiverEndsAt: bigint;
  coverage: CoverageEvaluation;
}): string[] {
  const { facility, coverage } = input;
  const refusals: string[] = [];
  if (input.vaultFacilityId.toLowerCase() !== facility.id.toLowerCase()) {
    refusals.push(`vault ${facility.vault} belongs to facility ${input.vaultFacilityId}, not ${facility.id}`);
  }
  if (!isAddressEqual(input.admin, input.walletAddress)) {
    refusals.push(`the facility's admin is ${input.admin}, not this quorum's wallet ${input.walletAddress}`);
  }
  if (input.activeWaiver) {
    refusals.push(`a waiver is already active, until ${new Date(Number(input.waiverEndsAt) * 1_000).toISOString()}`);
  }
  if (coverage.compliant) {
    refusals.push(
      `the facility is compliant (coverage ${coverage.coverageBps} bps, ${coverage.requiredCoverageBps} required), and createWaiver refuses a compliant facility`,
    );
  }
  return refusals;
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

export function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day(s)`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour(s)`;
  return `${seconds} seconds`;
}
