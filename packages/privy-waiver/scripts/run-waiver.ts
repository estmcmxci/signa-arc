import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  createPublicClient,
  formatEther,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseEventLogs,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Log,
  type TransactionSerializedEIP1559,
} from "viem";
import { arcTestnet } from "viem/chains";

import { APPROVER_ROLES, approverKeyDirectory, readApprover, readQuorumRecord } from "../src/approvers.ts";
import {
  formatAuthorizationPayload,
  intentAuthorizationInput,
  normalizePublicKey,
  signAuthorizationPayload,
  verifyAuthorizationSignature,
} from "../src/authorization.ts";
import {
  COVENANT_STATES,
  RESULT_REASONS,
  coverageEngineAbi,
  covenantVaultAbi,
  createArcGateway,
  describeAdminCall,
  enumName,
  facilityRegistryAbi,
  loadManifest,
  reasonCommitment,
  toCoverageEvaluation,
} from "../src/arc.ts";
import { PrivyClient, keyMembers, loadPrivyConfig, signedTransactionOf } from "../src/privy-client.ts";
import { QuorumAdminService, waiverRefusals, type ActionView, type FacilityConfig } from "../src/service.ts";
import { JsonFileStore, defaultStorePath } from "../src/store.ts";

/**
 * REQUIRES CREDENTIALS, the quorum and its policy provisioned, gas in the admin wallet, and a
 * facility the contract would accept a waiver for: not compliant, no waiver active.
 *
 * One waiver, end to end, through the QuorumAdminService the approver console uses:
 *   1. pre-validate against the chain;
 *   2. propose createWaiver as a Privy intent: 0 of 2;
 *   3. approve as the risk officer: 1 of 2, still pending;
 *   4. approve as the treasury lead: 2 of 2, and Privy signs;
 *   5. broadcast the transaction Privy signed to Arc ourselves, because Privy cannot;
 *   6. assert the receipt is 0x1 and WaiverCreated names this facility and the stated reason;
 *   7. read activeWaiver() and covenantState() back from the chain.
 * It then re-reads the intent from Privy and the receipt from Arc, independently of the service,
 * and writes evidence/arc-waiver-evidence.{json,md}.
 *
 *   set -a; . ./.env; set +a
 *   node --import tsx packages/privy-waiver/scripts/run-waiver.ts --check
 *   node --import tsx packages/privy-waiver/scripts/run-waiver.ts --duration=3600 --reason="..." \
 *     [--earlier-refusal-block=<block where pre-validation refused>]
 *
 * --check only reads the chain and says whether the contract would accept a waiver now.
 * --earlier-refusal-block re-reads the chain at that block and records the same guard's refusal.
 */

const EVIDENCE = new URL("../evidence/", import.meta.url);
const OPEN = ["pending", "granted", "processing", "executed"];
const LOG_CHUNK = 2_000n;

const credentialEventsAbi = parseAbi([
  "event ExposureCredentialAccepted(bytes32 indexed facilityId, address indexed issuer, bytes32 indexed digest, uint64 sequence, uint128 outstandingValue, uint64 acceptedAt)",
  "event HedgeCredentialAccepted(bytes32 indexed facilityId, bytes32 indexed tradeIdCommitment, address indexed issuer, bytes32 digest, uint64 sequence, uint8 status, uint128 remainingNotional, uint64 acceptedAt)",
]);

const options = new Map(
  process.argv.slice(2).map((arg) => {
    const [key = "", ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")] as const;
  }),
);
const earlierRefusalBlock = options.get("earlier-refusal-block") ? BigInt(options.get("earlier-refusal-block") ?? "") : undefined;

const env = process.env;
const directory = approverKeyDirectory(env);
const approvers = APPROVER_ROLES.map(({ role }) => {
  const key = readApprover(directory, role);
  if (!key) throw new Error(`no ${role} key in ${directory}: run provision-quorum.ts first`);
  return key;
});
const record = readQuorumRecord(directory);
if (!record?.walletId || !record.walletAddress) {
  throw new Error(`no quorum recorded in ${directory}: run provision-quorum.ts first`);
}
const { walletId, keyQuorumId } = record;
const policyId = record.policyId ?? null;

const privy = new PrivyClient(loadPrivyConfig(env));
const wallet = await privy.getWallet(walletId);
const walletAddress = getAddress(wallet.address);
if (wallet.owner_id !== keyQuorumId || !isAddressEqual(walletAddress, record.walletAddress)) {
  throw new Error("the Privy wallet no longer matches the recorded quorum; rerun provision-quorum.ts");
}
const manifest = loadManifest();
if (!isAddressEqual(manifest.roles.facilityAdmin, walletAddress)) {
  throw new Error(`the manifest's facility admin is ${manifest.roles.facilityAdmin}, not this wallet`);
}
const facility: FacilityConfig = {
  id: manifest.facility.id,
  vault: manifest.contracts.covenantVault.address,
  registry: manifest.contracts.facilityRegistry.address,
  coverageEngine: manifest.contracts.coverageEngine.address,
};
const policyAttached = policyId !== null && (wallet.policy_ids ?? []).includes(policyId);
const client = createPublicClient({ chain: arcTestnet, transport: http(manifest.rpcUrl) });
const service = new QuorumAdminService(privy, createArcGateway(manifest), new JsonFileStore(defaultStorePath(env)), {
  walletId,
  walletAddress,
  explorer: manifest.explorer,
  facility,
});
const link = (kind: "address" | "tx" | "block", value: string) => `${manifest.explorer}/${kind}/${value}`;

/** The chain as `createWaiver` would see it at `blockNumber`, and the guard's verdict on it. */
async function stateAt(blockNumber: bigint) {
  const vault = { address: facility.vault, abi: covenantVaultAbi, blockNumber } as const;
  const [vaultFacilityId, state, activeWaiver, waiverEndsAt, policy, result, block] = await Promise.all([
    client.readContract({ ...vault, functionName: "facilityId" }),
    client.readContract({ ...vault, functionName: "covenantState" }),
    client.readContract({ ...vault, functionName: "activeWaiver" }),
    client.readContract({ ...vault, functionName: "waiverEndsAt" }),
    client.readContract({ address: facility.registry, abi: facilityRegistryAbi, functionName: "getFacility", args: [facility.id], blockNumber }),
    client.readContract({ address: facility.coverageEngine, abi: coverageEngineAbi, functionName: "evaluate", args: [facility.id], blockNumber }),
    client.getBlock({ blockNumber }),
  ]);
  const coverage = toCoverageEvaluation(result);
  return {
    block: blockNumber.toString(),
    blockTimestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
    covenantState: enumName(COVENANT_STATES, state),
    activeWaiver,
    waiverEndsAt: waiverEndsAt > 0n ? new Date(Number(waiverEndsAt) * 1_000).toISOString() : null,
    coverage,
    refusals: waiverRefusals({ facility, walletAddress, vaultFacilityId, admin: policy.admin, activeWaiver, waiverEndsAt, coverage }),
  };
}

const gas = await client.getBalance({ address: walletAddress });
const beforeBlock = await client.getBlockNumber();
const before = await stateAt(beforeBlock);
console.log(`facility ${facility.id}`);
console.log(`vault    ${facility.vault}`);
console.log(`admin    ${walletAddress} (Privy wallet ${walletId}, key quorum ${keyQuorumId})`);
console.log(`policy   ${policyId ?? "none"}${policyAttached ? ", attached" : ", NOT attached"}`);
console.log(`gas      ${formatEther(gas)} USDC`);
console.log(
  `\nblock ${beforeBlock}: covenant state ${before.covenantState}, coverage ${before.coverage.coverageBps} of ${before.coverage.requiredCoverageBps} bps (${before.coverage.resultReason}), waiver active: ${before.activeWaiver}`,
);

const open = (await service.list()).find((action) => action.kind === "waiver.create" && !action.broadcast && OPEN.includes(action.status));
if (!open && before.refusals.length > 0) {
  console.log(`\nThe contract would refuse a waiver now, so none is proposed:\n  - ${before.refusals.join("\n  - ")}`);
  process.exit(options.has("check") ? 0 : 1);
}
if (options.has("check")) {
  console.log(open ? `\nWaiver intent ${open.intentId} is open (${open.status}).` : "\nThe contract would accept a waiver now.");
  process.exit(0);
}
if (!policyAttached) throw new Error("the admin wallet's policy is not attached: run provision-policy.ts first");
if (gas < 10n ** 16n) throw new Error("the admin wallet needs gas: fund it with USDC first");

// The same guard, applied to the chain at the block where it refused earlier. Not fatal: evidence only.
const earlierRefusal = earlierRefusalBlock === undefined
  ? null
  : await stateAt(earlierRefusalBlock).catch((error: unknown) => ({ block: earlierRefusalBlock.toString(), error: String(error) }));

type Step = { step: number; what: string; result: string; intentStatus?: string; approvals?: string; at: string; trace: string };
const steps: Step[] = [];
const signedCount = (view: ActionView) => `${view.approvals.members.filter((member) => member.signedAt).length} of ${view.approvals.threshold}`;
const say = (step: Step) => {
  steps.push(step);
  console.log(`[${step.step}] ${step.what}: ${step.result}${step.intentStatus ? ` (intent ${step.intentStatus}, ${step.approvals})` : ""}`);
};

say({
  step: 1,
  what: "Pre-validation against the chain",
  result: open ? `resumed intent ${open.intentId}, proposed earlier` : "passed: the contract would accept a waiver",
  at: new Date().toISOString(),
  trace: `block ${beforeBlock}`,
});

let proposed: ActionView;
if (open) {
  proposed = open;
} else {
  const durationSeconds = Number(options.get("duration"));
  const reason = options.get("reason")?.trim() ?? "";
  if (!reason || !Number.isInteger(durationSeconds)) throw new Error('pass --duration=<seconds> and --reason="<why>"');
  proposed = await service.proposeWaiver({ durationSeconds, reason });
}
say({
  step: 2,
  what: "Intent proposed to Privy",
  result: `intent ${proposed.intentId}: ${proposed.call.functionName}(${proposed.call.args.join(", ")})`,
  intentStatus: proposed.status,
  approvals: signedCount(proposed),
  at: new Date(proposed.createdAt).toISOString(),
  trace: `Privy intent ${proposed.intentId}`,
});

// Collects both approvals, keeping each signature so the evidence can be re-verified.
const sent = new Map<string, { signature: string; timestamp: number; payloadSha256: string }>();
let view = proposed;
for (const [index, approver] of approvers.entries()) {
  view = await service.get(proposed.intentId);
  if (view.status !== "pending") break;
  const publicKey = normalizePublicKey(approver.publicKey);
  const member = view.approvals.members.find((candidate) => candidate.publicKey === publicKey);
  if (!member) throw new Error(`${approver.label}'s key is not a member of intent ${proposed.intentId}`);
  if (member.signedAt) continue;
  const payload = await service.signingPayloadFor(proposed.intentId);
  const bytes = new TextEncoder().encode(payload.text);
  const signature = signAuthorizationPayload(approver.privateKey, bytes);
  const payloadSha256 = createHash("sha256").update(bytes).digest("hex");
  view = await service.approve(proposed.intentId, { publicKey: approver.publicKey, signature, encoding: "der", timestamp: payload.timestamp });
  sent.set(publicKey, { signature, timestamp: payload.timestamp, payloadSha256 });
  say({
    step: 3 + index,
    what: `${approver.label} authorized`,
    result: "signature checked against the quorum member key, then accepted by POST /v1/intents/{id}/authorize",
    intentStatus: view.status,
    approvals: signedCount(view),
    at: new Date(payload.timestamp).toISOString(),
    trace: `signed payload sha256 ${payloadSha256}`,
  });
}
for (let attempt = 0; attempt < 30 && ["pending", "granted", "processing"].includes(view.status); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  view = await service.get(proposed.intentId);
}
const lastApproval = steps.at(-1);
if (lastApproval && lastApproval.intentStatus !== view.status) lastApproval.result += `; the intent then became ${view.status}`;
if (view.status !== "executed") throw new Error(`STOPPED after approvals: intent ${proposed.intentId} is ${view.status}, not executed`);

let assertionError: string | null = null;
let executed: ActionView;
try {
  executed = await service.execute(proposed.intentId);
} catch (error) {
  assertionError = error instanceof Error ? error.message : String(error);
  executed = await service.get(proposed.intentId);
}
const broadcast = executed.broadcast;
if (!broadcast) throw new Error(`STOPPED at step 5: nothing was broadcast: ${assertionError}`);
say({
  step: 5,
  what: "Signed transaction broadcast to Arc with viem",
  result: "eth_sendRawTransaction of action_result.response_body.data.signed_transaction; Privy cannot send on Arc",
  at: new Date().toISOString(),
  trace: broadcast.hash,
});

// Everything below is re-read from Privy and from Arc, not taken from the service.
const intent = await privy.getIntent(proposed.intentId);
const signedTransaction = signedTransactionOf(intent);
if (!signedTransaction) throw new Error("the executed intent carries no signed transaction");
const serialized = signedTransaction as TransactionSerializedEIP1559;
const decoded = parseTransaction(serialized);
const recoveredSigner = await recoverTransactionAddress({ serializedTransaction: serialized });
const receipt = await client.getTransactionReceipt({ hash: broadcast.hash });
const transaction = await client.getTransaction({ hash: broadcast.hash });
const block = await client.getBlock({ blockNumber: receipt.blockNumber });
const call = describeAdminCall(proposed.call.data);
const statedReason = proposed.reason ?? "";
const expectedCommitment = reasonCommitment(statedReason);

const events = parseEventLogs({ abi: covenantVaultAbi, logs: receipt.logs }).map((log) => ({
  contract: isAddressEqual(log.address, facility.vault) ? "CovenantVault" : log.address,
  event: log.eventName,
  logIndex: log.logIndex,
  args: readable(log.eventName, log.args as Record<string, unknown>),
}));
const waiverEvents = events.filter((event) => event.contract === "CovenantVault" && event.event === "WaiverCreated");
const waiverArgs = waiverEvents[0]?.args ?? {};
const receiptOk = receipt.status === "success";
const facilityOk = String(waiverArgs.facilityId).toLowerCase() === facility.id.toLowerCase();
const commitmentOk = String(waiverArgs.reasonCommitment).toLowerCase() === expectedCommitment.toLowerCase();
say({
  step: 6,
  what: "Receipt and WaiverCreated asserted",
  result:
    receiptOk && waiverEvents.length === 1 && facilityOk && commitmentOk
      ? "receipt status 0x1; exactly one WaiverCreated, naming this facility and committing to keccak256 of the stated reason"
      : `FAILED: receipt ${receipt.status}, ${waiverEvents.length} WaiverCreated, facility ${facilityOk}, commitment ${commitmentOk}`,
  at: new Date(Number(block.timestamp) * 1_000).toISOString(),
  trace: `${receipt.transactionHash}, block ${receipt.blockNumber}`,
});

const readBackBlock = await client.getBlockNumber();
const readBack = await stateAt(readBackBlock > receipt.blockNumber ? readBackBlock : receipt.blockNumber);
say({
  step: 7,
  what: "Read back from the chain",
  result: `activeWaiver() = ${readBack.activeWaiver}, covenantState() = ${readBack.covenantState}, waiver ends ${readBack.waiverEndsAt}`,
  at: readBack.blockTimestamp,
  trace: `block ${readBack.block}`,
});

// What set the state the waiver started from: the vault's last sync, and the credentials behind it.
const historyFrom = (earlierRefusalBlock ?? beforeBlock - 10_000n) + 1n;
async function logsIn(address: Address, fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
  const logs: Log[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n < toBlock ? start + LOG_CHUNK - 1n : toBlock;
    logs.push(...(await client.getLogs({ address, fromBlock: start, toBlock: end })));
  }
  return logs;
}
const history = await (async () => {
  const syncs = parseEventLogs({ abi: covenantVaultAbi, logs: await logsIn(facility.vault, historyFrom, beforeBlock), eventName: "CovenantSynchronized" });
  const credentials = parseEventLogs({ abi: credentialEventsAbi, logs: await logsIn(manifest.contracts.credentialRegistry.address, historyFrom, beforeBlock) })
    .filter((log) => String(log.args.facilityId).toLowerCase() === facility.id.toLowerCase());
  const described = (log: { eventName: string; transactionHash: string | null; blockNumber: bigint | null; args: unknown }) => ({
    event: log.eventName,
    transactionHash: log.transactionHash,
    explorer: log.transactionHash ? link("tx", log.transactionHash) : null,
    blockNumber: String(log.blockNumber),
    args: readable(log.eventName, log.args as Record<string, unknown>),
  });
  const lastSync = syncs.at(-1);
  return {
    searchedBlocks: `${historyFrom}..${beforeBlock}`,
    stateSetBy: lastSync ? described(lastSync) : null,
    credentialUpdates: credentials.map(described),
  };
})().catch((error: unknown) => ({ searchedBlocks: `${historyFrom}..${beforeBlock}`, error: String(error) }));

const approvals = keyMembers(intent)
  .map((member) => {
    const approver = approvers.find((candidate) => normalizePublicKey(candidate.publicKey) === member.publicKey);
    const ours = sent.get(member.publicKey);
    const signatureVerifies = ours
      ? verifyAuthorizationSignature(
          member.publicKey,
          formatAuthorizationPayload(intentAuthorizationInput(intent, privy.appId, ours.timestamp)),
          ours.signature,
        )
      : null;
    return {
      role: approver?.label ?? "not one of our approvers",
      publicKey: member.publicKey,
      signedAt: member.signedAt === null ? null : privyTime(member.signedAt),
      signedPayloadTimestamp: ours ? new Date(ours.timestamp).toISOString() : null,
      signedPayloadSha256: ours?.payloadSha256 ?? null,
      signature: ours?.signature ?? null,
      signatureVerifies,
    };
  })
  .sort((a, b) => (a.signedAt ?? "").localeCompare(b.signedAt ?? ""));

const assertions = {
  preValidationPassed: before.refusals.length === 0,
  bothApproversSigned: approvals.filter((approval) => approval.signedAt !== null && approval.role !== "not one of our approvers").length === 2,
  everyRecordedSignatureVerifies: approvals.every((approval) => approval.signatureVerifies !== false),
  signedByTheAdminWallet: isAddressEqual(recoveredSigner, walletAddress),
  signedTransactionIsTheApprovedOne:
    decoded.chainId === proposed.call.chainId &&
    isAddressEqual(decoded.to ?? "0x0000000000000000000000000000000000000000", proposed.call.to) &&
    (decoded.data ?? "0x").toLowerCase() === proposed.call.data.toLowerCase() &&
    (decoded.nonce ?? 0) === proposed.call.nonce &&
    (decoded.value ?? 0n) === 0n,
  broadcastHashIsTheSignedTransaction: keccak256(signedTransaction) === receipt.transactionHash,
  receiptStatusIs0x1: receiptOk,
  exactlyOneWaiverCreated: waiverEvents.length === 1,
  waiverCreatedNamesThisFacility: facilityOk,
  waiverCreatedCommitsToTheStatedReason: commitmentOk,
  activeWaiverReadBackTrue: readBack.activeWaiver === true,
  covenantStateReadBackWaived: readBack.covenantState === "WAIVED",
  serviceAssertionsPassed: assertionError === null,
};
const outcome = Object.values(assertions).every(Boolean) ? "waiver created and verified" : "FAILED";

const policyEvidence = new URL("arc-policy-evidence.json", EVIDENCE);
const policyControls = existsSync(policyEvidence)
  ? (JSON.parse(readFileSync(policyEvidence, "utf8")) as {
      generatedAt: string;
      controls: { name: string; expected: string; actual: string }[];
      governance: { name: string; refused: boolean }[];
    })
  : null;

const evidence = {
  title: "Signa Covenant: a waiver approved by a 2-of-2 Privy quorum, on Arc Testnet",
  generatedAt: new Date().toISOString(),
  outcome,
  network: { chainId: manifest.chainId, explorer: manifest.explorer },
  deployment: {
    sourceCommit: manifest.sourceCommit,
    facilityId: facility.id,
    covenantVault: { address: facility.vault, explorer: link("address", facility.vault) },
    facilityRegistry: facility.registry,
    coverageEngine: facility.coverageEngine,
    credentialRegistry: manifest.contracts.credentialRegistry.address,
  },
  admin: {
    address: walletAddress,
    explorer: link("address", walletAddress),
    privyWalletId: walletId,
    keyQuorumId,
    threshold: view.approvals.threshold,
    policyId,
    policyAttached,
  },
  steps,
  preValidation: {
    passed: before.refusals.length === 0,
    statement:
      before.refusals.length === 0
        ? `Passed at block ${beforeBlock}: the facility was ${before.covenantState} and not compliant (${before.coverage.coverageBps} of ${before.coverage.requiredCoverageBps} bps, ${before.coverage.resultReason}), no waiver was active, the vault is this facility's and its admin is this wallet, so the contract would accept a waiver and it was proposed.`
        : `Did not pass at block ${beforeBlock}; an intent proposed earlier was resumed.`,
    ...before,
    maxWaiverDurationSeconds: manifest.facility.policy.maxWaiverDurationSeconds,
    ...history,
  },
  earlierRefusal: earlierRefusal
    ? {
        ...earlierRefusal,
        statement:
          "The same guard refused a waiver at this block, while the facility was compliant. scripts/run-waiver.ts --check and the console's POST /api/waivers (HTTP 409) both answered with the refusal below, and nothing was proposed to Privy. It is re-derived here from the chain's state at that block.",
      }
    : null,
  proposal: {
    intentId: proposed.intentId,
    createdAt: privyTime(intent.created_at),
    statedReason,
    reasonCommitment: expectedCommitment,
    call: { to: proposed.call.to, functionName: call.functionName, args: proposed.call.args, data: proposed.call.data },
    pinned: {
      chainId: proposed.call.chainId,
      nonce: proposed.call.nonce,
      gasLimit: proposed.call.gasLimit,
      maxFeePerGasWei: proposed.call.maxFeePerGasWei,
    },
  },
  approvals,
  privySigned: {
    intentStatus: intent.status,
    executedAt: intent.action_result ? privyTime(intent.action_result.executed_at) : null,
    signedTransaction,
    decoded: {
      type: decoded.type,
      chainId: decoded.chainId,
      nonce: decoded.nonce ?? 0,
      to: decoded.to,
      value: (decoded.value ?? 0n).toString(),
      gas: (decoded.gas ?? 0n).toString(),
      maxFeePerGas: (decoded.maxFeePerGas ?? 0n).toString(),
      maxPriorityFeePerGas: (decoded.maxPriorityFeePerGas ?? 0n).toString(),
      data: decoded.data,
    },
    recoveredSigner,
  },
  broadcast: {
    transactionHash: receipt.transactionHash,
    explorer: link("tx", receipt.transactionHash),
    blockNumber: receipt.blockNumber.toString(),
    blockExplorer: link("block", receipt.blockNumber.toString()),
    blockTimestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
    sender: transaction.from,
    to: transaction.to,
    expectedStatus: "0x1",
    actualStatus: receiptOk ? "0x1" : "0x0",
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
  },
  events,
  readBack,
  covenantState: { before: before.covenantState, after: readBack.covenantState, waiverEndsAt: readBack.waiverEndsAt },
  assertions,
  assertionError,
  policy: policyControls
    ? {
        evidence: "arc-policy-evidence.json",
        checkedAt: policyControls.generatedAt,
        controls: policyControls.controls.map(({ name, expected, actual }) => ({ name, expected, actual })),
        governance: policyControls.governance.map(({ name, refused }) => ({ name, refused })),
      }
    : null,
  disclaimer:
    "Arc Testnet only: testnet USDC, a fictional facility, no real counterparties. The two approvers signed from their persisted P-256 keys through the same QuorumAdminService the browser console uses.",
};

mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(new URL("arc-waiver-evidence.json", EVIDENCE), `${JSON.stringify(evidence, jsonSafe, 2)}\n`);
writeFileSync(new URL("arc-waiver-evidence.md", EVIDENCE), markdown());
console.log(`\n${outcome}. Evidence: packages/privy-waiver/evidence/arc-waiver-evidence.md`);
if (outcome !== "waiver created and verified") process.exit(1);

/** Privy reports times in milliseconds; tolerate seconds. */
function privyTime(value: number): string {
  return new Date(value < 1e12 ? value * 1_000 : value).toISOString();
}

function readable(eventName: string, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (eventName === "CovenantSynchronized" && (key === "previousState" || key === "newState")) {
      out[key] = enumName(COVENANT_STATES, Number(value));
    } else if (eventName === "CovenantSynchronized" && key === "reason") {
      out[key] = enumName(RESULT_REASONS, Number(value));
    } else if (["startsAt", "endsAt", "cureDeadline", "acceptedAt"].includes(key) && typeof value === "bigint" && value > 0n) {
      out[key] = `${value} (${new Date(Number(value) * 1_000).toISOString()})`;
    } else {
      out[key] = typeof value === "bigint" ? value.toString() : value;
    }
  }
  return out;
}

function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function markdown(): string {
  const yes = (value: boolean | null) => (value === null ? "not recorded" : value ? "yes" : "**NO**");
  const short = (hash: string) => `${hash.slice(0, 10)}…`;
  const cell = (value: unknown) => String(value).replace(/\|/g, "\\|");
  const args = (values: Record<string, unknown>) => Object.entries(values).map(([key, value]) => `${key} \`${cell(value)}\``).join(", ");
  const traceCell = (trace: string) => (/^0x[0-9a-f]{64}$/i.test(trace) ? `[${short(trace)}](${link("tx", trace)})` : cell(trace));
  const { coverage } = before;
  const setBy = "stateSetBy" in history ? history.stateSetBy : null;
  const credentialUpdates = "credentialUpdates" in history ? history.credentialUpdates : [];
  return [
    `# ${evidence.title}`,
    "",
    `Chain ${manifest.chainId}, explorer ${manifest.explorer}. Generated ${evidence.generatedAt}.`,
    "",
    `Outcome: **${outcome}**. ${evidence.disclaimer}`,
    "",
    `Deployed source \`${manifest.sourceCommit}\`. Facility \`${facility.id}\`, vault [${facility.vault}](${link("address", facility.vault)}). Admin [${walletAddress}](${link("address", walletAddress)}): Privy wallet \`${walletId}\`, owned by 2-of-2 key quorum \`${keyQuorumId}\`, governed by policy \`${policyId}\`.`,
    "",
    "## The seven steps",
    "",
    "| # | Step | Result | Intent | Approvals | At | Trace |",
    "|---|---|---|---|---|---|---|",
    ...steps.map((step) => `| ${step.step} | ${step.what} | ${cell(step.result)} | ${step.intentStatus ?? ""} | ${step.approvals ?? ""} | ${step.at} | ${traceCell(step.trace)} |`),
    "",
    "## Pre-validation",
    "",
    `**${evidence.preValidation.passed ? "Passed" : "Did not pass"}.** ${evidence.preValidation.statement}`,
    "",
    `At block ${beforeBlock}: covenant state **${before.covenantState}**, coverage ${coverage.coverageBps} of ${coverage.requiredCoverageBps} bps (${coverage.resultReason}; exposure ${coverage.exposureReason}; ${coverage.eligibleHedgeCount} of ${coverage.totalHedgeCount} hedges eligible), waiver active: ${before.activeWaiver}, longest waiver ${manifest.facility.policy.maxWaiverDurationSeconds} s.`,
    "",
    ...(setBy
      ? [
          `That state was set by \`${setBy.event}\` in [${setBy.transactionHash}](${setBy.explorer}), block ${setBy.blockNumber}: ${args(setBy.args)}.`,
          "",
        ]
      : []),
    ...(credentialUpdates.length > 0
      ? [
          "Credential updates to this facility since the earlier refusal:",
          "",
          "| Event | Transaction | Block | Arguments |",
          "|---|---|---|---|",
          ...credentialUpdates.map((update) => `| ${update.event} | [${short(String(update.transactionHash))}](${update.explorer}) | ${update.blockNumber} | ${args(update.args)} |`),
          "",
        ]
      : []),
    ...(earlierRefusal
      ? [
          "### It refused earlier, while the facility was compliant",
          "",
          "error" in earlierRefusal
            ? `Re-reading the chain at block ${earlierRefusal.block} failed: ${earlierRefusal.error}`
            : `${evidence.earlierRefusal?.statement}\n\nAt block ${earlierRefusal.block} (${earlierRefusal.blockTimestamp}): covenant state **${earlierRefusal.covenantState}**, coverage ${earlierRefusal.coverage.coverageBps} of ${earlierRefusal.coverage.requiredCoverageBps} bps (${earlierRefusal.coverage.resultReason}). The guard's verdict at that block:\n\n${earlierRefusal.refusals.map((refusal) => `> ${refusal}`).join("\n")}`,
          "",
        ]
      : []),
    "## What was approved",
    "",
    "| | |",
    "|---|---|",
    `| Privy intent | \`${proposed.intentId}\`, created ${evidence.proposal.createdAt} |`,
    `| Stated reason (offchain) | ${cell(statedReason)} |`,
    `| reasonCommitment | \`${expectedCommitment}\` = keccak256 of the stated reason |`,
    `| Call | \`${call.functionName}(${proposed.call.args.join(", ")})\` on the vault |`,
    `| Pinned | chain ${proposed.call.chainId}, nonce ${proposed.call.nonce}, gas limit ${proposed.call.gasLimit}, fee cap ${proposed.call.maxFeePerGasWei} wei, value 0 |`,
    "",
    `## Approvals: ${approvals.filter((approval) => approval.signedAt).length} of ${view.approvals.threshold}`,
    "",
    "Each approver signed Privy's authorization payload for this intent (its recorded request, `intent_id` and `timestamp`) with ECDSA P-256. Each signature was checked against the quorum member key before it was forwarded to `POST /v1/intents/{id}/authorize`, and is re-verified here against the intent as Privy now returns it.",
    "",
    "| Order | Approver | Public key | Signed at (Privy) | Payload SHA-256 | Signature verifies |",
    "|---|---|---|---|---|---|",
    ...approvals.map(
      (approval, index) =>
        `| ${index + 1} | ${approval.role} | \`${approval.publicKey.slice(0, 16)}…${approval.publicKey.slice(-12)}\` | ${approval.signedAt ?? "not signed"} | \`${approval.signedPayloadSha256 ? short(approval.signedPayloadSha256) : "not recorded"}\` | ${yes(approval.signatureVerifies)} |`,
    ),
    "",
    "## Signed by Privy, broadcast by us",
    "",
    `Privy executed the intent at ${evidence.privySigned.executedAt} and returned the signed transaction. It recovers to \`${recoveredSigner}\`, the admin wallet, and every field matches what the approvers were shown. Privy cannot broadcast on Arc (\`401 App is not authorized to transact on chain\`), so it was sent with viem.`,
    "",
    "| Criterion | Action | Transaction | Block | Sender | Expected | Actual | Gas used | Covenant state |",
    "|---|---|---|---|---|---|---|---|---|",
    `| R-F3-7 | createWaiver, ${proposed.call.args[0]} s | [${short(receipt.transactionHash)}](${evidence.broadcast.explorer}) | [${receipt.blockNumber}](${evidence.broadcast.blockExplorer}) | \`${transaction.from}\` | 0x1 | ${evidence.broadcast.actualStatus} | ${receipt.gasUsed} | ${before.covenantState} → ${readBack.covenantState} |`,
    "",
    `Transaction \`${receipt.transactionHash}\`, mined ${evidence.broadcast.blockTimestamp}.`,
    "",
    "Signed transaction, as Privy returned it:",
    "",
    "```",
    signedTransaction,
    "```",
    "",
    "## Events in the receipt",
    "",
    "| Contract | Event | Arguments |",
    "|---|---|---|",
    ...events.map((event) => `| ${event.contract} | ${event.event} | ${args(event.args)} |`),
    "",
    "## Read back from the chain",
    "",
    `At block ${readBack.block} (${readBack.blockTimestamp}): \`activeWaiver()\` = **${readBack.activeWaiver}**, \`covenantState()\` = **${readBack.covenantState}**, waiver ends ${readBack.waiverEndsAt}. Covenant state before: ${before.covenantState}, at block ${before.block}.`,
    "",
    "## Assertions",
    "",
    ...Object.entries(assertions).map(([name, value]) => `- ${name}: ${yes(value)}`),
    ...(assertionError ? ["", `Service assertion error: ${assertionError}`] : []),
    "",
    ...(policyControls
      ? [
          "## Policy on the admin wallet",
          "",
          `From [arc-policy-evidence.md](arc-policy-evidence.md), checked ${policyControls.generatedAt}. Privy evaluates the policy when it executes an intent, so this waiver passed it.`,
          "",
          "| Control | Expected | Actual |",
          "|---|---|---|",
          ...policyControls.controls.map((control) => `| ${control.name} | ${control.expected} | ${control.actual} |`),
          ...policyControls.governance.map((attempt) => `| ${attempt.name} | refused | ${attempt.refused ? "refused" : "**accepted**"} |`),
          "",
        ]
      : []),
  ].join("\n");
}
