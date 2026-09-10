import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  createPublicClient,
  formatEther,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  parseEventLogs,
  parseTransaction,
  recoverTransactionAddress,
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
  covenantVaultAbi,
  createArcGateway,
  describeAdminCall,
  enumName,
  loadManifest,
  reasonCommitment,
} from "../src/arc.ts";
import { PrivyClient, keyMembers, loadPrivyConfig, signedTransactionOf } from "../src/privy-client.ts";
import { QuorumAdminService, type ActionView, type FacilityConfig } from "../src/service.ts";
import { JsonFileStore, defaultStorePath } from "../src/store.ts";

/**
 * REQUIRES CREDENTIALS, the quorum and its policy provisioned, gas in the admin wallet, and a
 * facility the contract would accept a waiver for: not compliant, no waiver active.
 *
 * One waiver, end to end, through the QuorumAdminService the approver console uses:
 *   1. pre-validate against the chain, then propose createWaiver as a Privy intent;
 *   2. approve as the risk officer, then as the treasury lead, each signing a fresh payload;
 *   3. take the transaction Privy signed, check it, broadcast it to Arc, and assert the receipt is
 *      0x1 and that WaiverCreated names this facility and commits to the stated reason.
 * It then re-reads the intent from Privy and the receipt from Arc, independently of the service,
 * and writes evidence/arc-waiver-evidence.{json,md}.
 *
 *   set -a; . ./.env; set +a
 *   node --import tsx packages/privy-waiver/scripts/run-waiver.ts --check
 *   node --import tsx packages/privy-waiver/scripts/run-waiver.ts --duration=3600 --reason="..."
 *
 * --check only reads the chain and says whether the contract would accept a waiver now.
 */

const EVIDENCE = new URL("../evidence/", import.meta.url);
const OPEN = ["pending", "granted", "processing", "executed"];

const options = new Map(
  process.argv.slice(2).map((arg) => {
    const [key = "", ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")] as const;
  }),
);

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
const policyAttached = record.policyId !== undefined && (wallet.policy_ids ?? []).includes(record.policyId);
const client = createPublicClient({ chain: arcTestnet, transport: http(manifest.rpcUrl) });
const service = new QuorumAdminService(privy, createArcGateway(manifest), new JsonFileStore(defaultStorePath(env)), {
  walletId,
  walletAddress,
  explorer: manifest.explorer,
  facility,
});

const gas = await client.getBalance({ address: walletAddress });
const beforeBlock = await client.getBlockNumber();
const before = await service.waiverReadiness();
console.log(`facility ${facility.id}`);
console.log(`vault    ${facility.vault}`);
console.log(`admin    ${walletAddress} (Privy wallet ${walletId}, key quorum ${keyQuorumId})`);
console.log(`policy   ${record.policyId ?? "none"}${policyAttached ? ", attached" : ", NOT attached"}`);
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

let proposed: ActionView;
if (open) {
  proposed = open;
  console.log(`\nresuming waiver intent ${open.intentId} (${open.status})`);
} else {
  const durationSeconds = Number(options.get("duration"));
  const reason = options.get("reason")?.trim() ?? "";
  if (!reason || !Number.isInteger(durationSeconds)) throw new Error('pass --duration=<seconds> and --reason="<why>"');
  proposed = await service.proposeWaiver({ durationSeconds, reason });
  console.log(`\nproposed intent ${proposed.intentId}: ${proposed.description}`);
}

// Collects both approvals, keeping each signature so the evidence can be re-verified.
const sent = new Map<string, { signature: string; timestamp: number; payloadSha256: string }>();
let view = proposed;
for (const approver of approvers) {
  view = await service.get(proposed.intentId);
  if (view.status !== "pending") break;
  const publicKey = normalizePublicKey(approver.publicKey);
  const member = view.approvals.members.find((candidate) => candidate.publicKey === publicKey);
  if (!member) throw new Error(`${approver.label}'s key is not a member of intent ${proposed.intentId}`);
  if (member.signedAt) continue;
  const payload = await service.signingPayloadFor(proposed.intentId);
  const bytes = new TextEncoder().encode(payload.text);
  const signature = signAuthorizationPayload(approver.privateKey, bytes);
  view = await service.approve(proposed.intentId, { publicKey: approver.publicKey, signature, encoding: "der", timestamp: payload.timestamp });
  sent.set(publicKey, { signature, timestamp: payload.timestamp, payloadSha256: createHash("sha256").update(bytes).digest("hex") });
  console.log(`approved as ${approver.label} at ${new Date(payload.timestamp).toISOString()}: intent is ${view.status}`);
}
for (let attempt = 0; attempt < 30 && ["pending", "granted", "processing"].includes(view.status); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  view = await service.get(proposed.intentId);
}
if (view.status !== "executed") throw new Error(`intent ${proposed.intentId} ended ${view.status}`);

let assertionError: string | null = null;
let executed: ActionView;
try {
  executed = await service.execute(proposed.intentId);
} catch (error) {
  assertionError = error instanceof Error ? error.message : String(error);
  executed = await service.get(proposed.intentId);
}
const broadcast = executed.broadcast;
if (!broadcast) throw new Error(`nothing was broadcast: ${assertionError}`);
console.log(`broadcast ${broadcast.hash}: receipt ${broadcast.status}, block ${broadcast.blockNumber}`);

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
const after = await service.waiverReadiness();
const call = describeAdminCall(proposed.call.data);
const statedReason = proposed.reason ?? "";

const events = parseEventLogs({ abi: covenantVaultAbi, logs: receipt.logs }).map((log) => ({
  contract: isAddressEqual(log.address, facility.vault) ? "CovenantVault" : log.address,
  event: log.eventName,
  logIndex: log.logIndex,
  args: readable(log.eventName, log.args as Record<string, unknown>),
}));
const waiverEvents = events.filter((event) => event.contract === "CovenantVault" && event.event === "WaiverCreated");
const waiverArgs = waiverEvents[0]?.args ?? {};

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

const link = (kind: "address" | "tx" | "block", value: string) => `${manifest.explorer}/${kind}/${value}`;
const assertions = {
  receiptStatusIs0x1: receipt.status === "success",
  signedByTheAdminWallet: isAddressEqual(recoveredSigner, walletAddress),
  signedTransactionIsTheApprovedOne:
    decoded.chainId === proposed.call.chainId &&
    isAddressEqual(decoded.to ?? "0x0000000000000000000000000000000000000000", proposed.call.to) &&
    (decoded.data ?? "0x").toLowerCase() === proposed.call.data.toLowerCase() &&
    (decoded.nonce ?? 0) === proposed.call.nonce &&
    (decoded.value ?? 0n) === 0n,
  broadcastHashIsTheSignedTransaction: keccak256(signedTransaction) === receipt.transactionHash,
  exactlyOneWaiverCreated: waiverEvents.length === 1,
  waiverCreatedNamesThisFacility: String(waiverArgs.facilityId).toLowerCase() === facility.id.toLowerCase(),
  waiverCreatedCommitsToTheStatedReason: String(waiverArgs.reasonCommitment).toLowerCase() === reasonCommitment(statedReason).toLowerCase(),
  bothApproversSigned: approvals.filter((approval) => approval.signedAt !== null && approval.role !== "not one of our approvers").length === 2,
  everyRecordedSignatureVerifies: approvals.every((approval) => approval.signatureVerifies !== false),
  covenantIsWaivedAfter: after.covenantState === "WAIVED" && after.activeWaiver,
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
  },
  admin: {
    address: walletAddress,
    explorer: link("address", walletAddress),
    privyWalletId: walletId,
    keyQuorumId,
    threshold: view.approvals.threshold,
    policyId: record.policyId ?? null,
    policyAttached,
  },
  preValidation: {
    block: beforeBlock.toString(),
    covenantState: before.covenantState,
    coverage: before.coverage,
    activeWaiver: before.activeWaiver,
    maxWaiverDurationSeconds: before.maxWaiverDurationSeconds,
    refusals: before.refusals,
  },
  proposal: {
    intentId: proposed.intentId,
    createdAt: privyTime(intent.created_at),
    statedReason,
    reasonCommitment: reasonCommitment(statedReason),
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
    actualStatus: receipt.status === "success" ? "0x1" : "0x0",
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
  },
  events,
  covenantState: {
    before: before.covenantState,
    after: after.covenantState,
    waiverEndsAt: after.activeWaiver ? new Date(Number(after.waiverEndsAt) * 1_000).toISOString() : null,
  },
  assertions,
  assertionError,
  policy: policyControls
    ? { evidence: "arc-policy-evidence.json", checkedAt: policyControls.generatedAt, controls: policyControls.controls.map(({ name, expected, actual }) => ({ name, expected, actual })), governance: policyControls.governance.map(({ name, refused }) => ({ name, refused })) }
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
    } else if ((key === "startsAt" || key === "endsAt" || key === "cureDeadline") && typeof value === "bigint" && value > 0n) {
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
  const { coverage } = before;
  return [
    `# ${evidence.title}`,
    "",
    `Chain ${manifest.chainId}, explorer ${manifest.explorer}. Generated ${evidence.generatedAt}.`,
    "",
    `Outcome: **${outcome}**. ${evidence.disclaimer}`,
    "",
    `Deployed source \`${manifest.sourceCommit}\`. Facility \`${facility.id}\`, vault [${facility.vault}](${link("address", facility.vault)}). Admin [${walletAddress}](${link("address", walletAddress)}): Privy wallet \`${walletId}\`, owned by 2-of-2 key quorum \`${keyQuorumId}\`, governed by policy \`${evidence.admin.policyId}\`.`,
    "",
    "## What was approved, and why",
    "",
    `Before proposing, at block ${beforeBlock}, the service read the chain: covenant state **${before.covenantState}**, coverage ${coverage.coverageBps} of ${coverage.requiredCoverageBps} bps (${coverage.resultReason}; exposure ${coverage.exposureReason}; ${coverage.eligibleHedgeCount} of ${coverage.totalHedgeCount} hedges eligible), no waiver active, longest waiver ${before.maxWaiverDurationSeconds} s. The contract would accept a waiver, so it was proposed.`,
    "",
    "| | |",
    "|---|---|",
    `| Privy intent | \`${proposed.intentId}\`, created ${evidence.proposal.createdAt} |`,
    `| Stated reason (offchain) | ${cell(statedReason)} |`,
    `| reasonCommitment | \`${evidence.proposal.reasonCommitment}\` = keccak256 of the stated reason |`,
    `| Call | \`${call.functionName}(${proposed.call.args.join(", ")})\` on the vault |`,
    `| Pinned | chain ${proposed.call.chainId}, nonce ${proposed.call.nonce}, gas limit ${proposed.call.gasLimit}, fee cap ${proposed.call.maxFeePerGasWei} wei, value 0 |`,
    "",
    `## Approvals: ${approvals.filter((approval) => approval.signedAt).length} of ${view.approvals.threshold}`,
    "",
    "Each approver signed Privy's authorization payload for this intent (its recorded request, `intent_id` and `timestamp`) with ECDSA P-256, and the signature was checked before it was forwarded to `POST /v1/intents/{id}/authorize`.",
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
    `Privy executed the intent at ${evidence.privySigned.executedAt} and returned the signed transaction. It recovers to \`${recoveredSigner}\`, the admin wallet, and every field matches what the approvers were shown. Privy cannot broadcast on Arc, so it was sent with viem.`,
    "",
    "| Criterion | Action | Transaction | Block | Sender | Expected | Actual | Gas used | Covenant state |",
    "|---|---|---|---|---|---|---|---|---|",
    `| R-F3-7 | createWaiver, ${proposed.call.args[0]} s | [${short(receipt.transactionHash)}](${evidence.broadcast.explorer}) | [${receipt.blockNumber}](${evidence.broadcast.blockExplorer}) | \`${transaction.from}\` | 0x1 | ${evidence.broadcast.actualStatus} | ${receipt.gasUsed} | ${before.covenantState} → ${after.covenantState} |`,
    "",
    `Transaction \`${receipt.transactionHash}\`, mined ${evidence.broadcast.blockTimestamp}.`,
    "",
    "## Events",
    "",
    "| Contract | Event | Arguments |",
    "|---|---|---|",
    ...events.map((event) => `| ${event.contract} | ${event.event} | ${Object.entries(event.args).map(([key, value]) => `${key} \`${cell(value)}\``).join(", ")} |`),
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
