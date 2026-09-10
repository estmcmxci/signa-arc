import { mkdirSync, writeFileSync } from "node:fs";

import { getAddress, isAddressEqual, keccak256, type Address, type Hex } from "viem";

import { APPROVER_ROLES, approverKeyDirectory, readApprover, readQuorumRecord, writeQuorumRecord } from "../src/approvers.ts";
import { formatAuthorizationPayload, signAuthorizationPayload } from "../src/authorization.ts";
import { describeAdminCall, loadManifest, toPrivyTransaction, verifySignedTransaction } from "../src/arc.ts";
import { policyControls, policyProblems, waiverOnlyPolicy, walletUpdateAuthorizationInput } from "../src/policy.ts";
import { PrivyApiError, PrivyClient, loadPrivyConfig, type SignTransactionRequest } from "../src/privy-client.ts";

/**
 * REQUIRES CREDENTIALS and the quorum provision-quorum.ts verified. Nothing is broadcast.
 *
 * Restricts the facility admin wallet with a Privy policy (src/policy.ts): createWaiver on the
 * facility's vault, on Arc, and nothing else. Creates it once, owned by the key quorum, and
 * attaches it with both approvers' signatures. Every run then proves it:
 *   - transaction controls, signed by both approvers through the synchronous RPC: the allowed call
 *     is signed; another function, another contract and another chain are each denied. Every probe
 *     has nonce 1,000,000,000 and a fee cap of 1 wei, so none could ever be mined;
 *   - governance controls, each a no-op if it were wrongly accepted: one approver alone cannot
 *     change the wallet's policies, and the app secret alone cannot change the policy.
 * Writes evidence/arc-policy-evidence.{json,md}. Exits non-zero if any check fails.
 *
 *   set -a; . ./.env; set +a
 *   node --import tsx packages/privy-waiver/scripts/provision-policy.ts
 */

const EVIDENCE = new URL("../evidence/", import.meta.url);

const env = process.env;
const directory = approverKeyDirectory(env);
const approvers = APPROVER_ROLES.map(({ role }) => {
  const key = readApprover(directory, role);
  if (!key) throw new Error(`no ${role} key in ${directory}: run provision-quorum.ts first`);
  return key;
});
let record = readQuorumRecord(directory);
if (!record?.walletId || !record.walletAddress) {
  throw new Error(`no quorum recorded in ${directory}: run provision-quorum.ts first`);
}
const { walletId, keyQuorumId, walletAddress: recordedAddress } = record;

const privy = new PrivyClient(loadPrivyConfig(env));
const manifest = loadManifest();
const walletAddress = getAddress((await privy.getWallet(walletId)).address);
if (!isAddressEqual(walletAddress, recordedAddress) || !isAddressEqual(manifest.roles.facilityAdmin, walletAddress)) {
  throw new Error("the Privy wallet, the recorded quorum and the manifest's facility admin disagree; stopping");
}
const vault = manifest.contracts.covenantVault.address;
const expected = waiverOnlyPolicy(vault, manifest.chainId, keyQuorumId);
const signedBy = (keys: typeof approvers, payload: Uint8Array) =>
  keys.map((approver) => signAuthorizationPayload(approver.privateKey, payload));

let policyId = record.policyId;
if (!policyId) {
  policyId = (await privy.createPolicy(expected)).id;
  record = writeQuorumRecord(directory, { ...record, policyId });
  console.log(`created policy ${policyId}, owned by key quorum ${keyQuorumId}`);
}
const attachment = { policy_ids: [policyId] };
const attachmentPayload = formatAuthorizationPayload(
  walletUpdateAuthorizationInput(privy.walletUrl(walletId), attachment, privy.appId),
);
let wallet = await privy.getWallet(walletId);
let attachedNow = false;
if (!(wallet.policy_ids ?? []).includes(policyId)) {
  await privy.updateWallet(walletId, attachment, signedBy(approvers, attachmentPayload));
  attachedNow = true;
  console.log(`attached policy ${policyId} to wallet ${walletId}, signed by both approvers`);
  wallet = await privy.getWallet(walletId);
}
const policy = await privy.getPolicy(policyId);
const mismatches = policyProblems(policy, expected);

type Refusal = { refused: boolean; privyStatus: number | null; privyResponse: string };
async function refusal(attempt: () => Promise<unknown>): Promise<Refusal> {
  try {
    await attempt();
    return { refused: false, privyStatus: null, privyResponse: "accepted" };
  } catch (error) {
    if (!(error instanceof PrivyApiError)) throw error;
    return { refused: true, privyStatus: error.status, privyResponse: error.responseBody.slice(0, 240) };
  }
}

const [riskOfficer] = approvers;
const governance = [
  {
    name: "Change the wallet's policies with one approver's signature",
    detail: "PATCH the wallet with its current policy_ids, signed by the risk officer alone: a no-op if accepted",
    ...(await refusal(() => privy.updateWallet(walletId, attachment, signedBy(riskOfficer ? [riskOfficer] : [], attachmentPayload)))),
  },
  {
    name: "Change the policy with the app secret alone",
    detail: "PATCH the policy with its current name and no signature: a no-op if accepted",
    ...(await refusal(() => privy.updatePolicy(policyId, { name: policy.name }, []))),
  },
];

type ControlResult = {
  name: string;
  varies: string;
  call: string;
  to: Address;
  chainId: number;
  expected: "allowed" | "denied";
  checkedAt: string;
} & (
  | { actual: "allowed"; signer: Address | null; signedTransactionHash: Hex | null }
  | { actual: "denied"; privyStatus: number; privyResponse: string }
);
const controls: ControlResult[] = [];
for (const control of policyControls({
  wallet: walletAddress,
  vault,
  otherContract: manifest.contracts.facilityRegistry.address,
  chainId: manifest.chainId,
  maxWaiverDurationSeconds: manifest.facility.policy.maxWaiverDurationSeconds,
})) {
  const body: SignTransactionRequest = { method: "eth_signTransaction", params: { transaction: toPrivyTransaction(control.tx) } };
  const payload = formatAuthorizationPayload({
    version: 1,
    method: "POST",
    url: privy.walletRpcUrl(walletId),
    body,
    headers: { "privy-app-id": privy.appId },
  });
  const call = describeAdminCall(control.tx.data);
  const base = {
    name: control.name,
    varies: control.varies,
    call: `${call.functionName}(${call.args.map(String).join(", ")})`,
    to: control.tx.to,
    chainId: control.tx.chainId,
    expected: control.expect,
    checkedAt: new Date().toISOString(),
  };
  try {
    const response = (await privy.walletRpc(walletId, body, signedBy(approvers, payload))) as { data?: { signed_transaction?: string } };
    const signed = response.data?.signed_transaction;
    const signer: Address | null = signed?.startsWith("0x") ? (await verifySignedTransaction(signed as Hex, control.tx)).signer : null;
    controls.push({ ...base, actual: "allowed", signer, signedTransactionHash: signed ? keccak256(signed as Hex) : null });
  } catch (error) {
    if (!(error instanceof PrivyApiError)) throw error;
    controls.push({ ...base, actual: "denied", privyStatus: error.status, privyResponse: error.responseBody.slice(0, 240) });
  }
}

const checks = {
  walletOwnerIsTheKeyQuorum: wallet.owner_id === keyQuorumId,
  policyIsOwnedByTheKeyQuorum: policy.owner_id === keyQuorumId,
  policyIsExactlyTheExpectedOne: mismatches.length === 0,
  walletIsGovernedByThisPolicyAlone: JSON.stringify(wallet.policy_ids ?? []) === JSON.stringify([policyId]),
  everyTransactionControlAsExpected: controls.every(
    (control) =>
      control.actual === control.expected &&
      (control.actual === "denied" || ("signer" in control && control.signer !== null && isAddressEqual(control.signer, walletAddress))),
  ),
  changingThePolicyTakesBothApprovers: governance.every((attempt) => attempt.refused),
};
const verified = Object.values(checks).every(Boolean);

const link = (kind: "address" | "tx", value: string) => `${manifest.explorer}/${kind}/${value}`;
const evidence = {
  title: "Signa Covenant: the Privy policy on the facility admin wallet",
  generatedAt: new Date().toISOString(),
  outcome: verified ? "verified" : "FAILED",
  network: { chainId: manifest.chainId, explorer: manifest.explorer },
  broadcast: "none: every probe is signed at most, never sent, and unmineable",
  admin: {
    address: walletAddress,
    explorer: link("address", walletAddress),
    privyWalletId: walletId,
    keyQuorumId,
    walletPolicyIds: wallet.policy_ids ?? [],
  },
  policy: {
    id: policyId,
    name: policy.name,
    ownerId: policy.owner_id ?? null,
    attachedThisRun: attachedNow,
    rules: policy.rules.map((rule) => ({
      name: rule.name,
      method: rule.method,
      action: rule.action,
      conditions: rule.conditions.map((condition) => `${condition.field_source}.${condition.field} ${condition.operator} ${String(condition.value)}`),
    })),
    vault: { address: vault, explorer: link("address", vault) },
    doesNotCap: "duration: Privy's calldata comparator never matches integers narrower than uint64, and duration is uint32",
  },
  controls,
  governance,
  checks,
  mismatches,
};

mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(new URL("arc-policy-evidence.json", EVIDENCE), `${JSON.stringify(evidence, null, 2)}\n`);
writeFileSync(new URL("arc-policy-evidence.md", EVIDENCE), markdown());
console.log(JSON.stringify({ policyId, walletPolicyIds: wallet.policy_ids, controls, governance, checks }, null, 2));

if (!verified) {
  console.error("\nVERIFICATION FAILED. See evidence/arc-policy-evidence.md.");
  process.exit(1);
}
console.log(`\nVERIFIED. Wallet ${walletId} can sign createWaiver on ${vault} on chain ${manifest.chainId}, and nothing else.`);

function markdown(): string {
  const yes = (value: boolean) => (value ? "yes" : "**NO**");
  const answer = (control: (typeof controls)[number]) =>
    "signer" in control
      ? `signed; recovers to \`${control.signer}\``
      : `${control.privyStatus} \`${String(control.privyResponse).replace(/\|/g, "\\|")}\``;
  return [
    `# ${evidence.title}`,
    "",
    `Chain ${manifest.chainId}, explorer ${manifest.explorer}. Checked ${evidence.generatedAt} against the live Privy API. Outcome: **${evidence.outcome}**.`,
    "",
    "Nothing was broadcast. Every probe carries nonce 1,000,000,000 and a fee cap of 1 wei, so none could ever be mined.",
    "",
    "| | |",
    "|---|---|",
    `| Policy | \`${policyId}\`, "${policy.name}" |`,
    `| Owner | key quorum \`${String(policy.owner_id)}\`: changing, deleting or detaching it takes both approvers |`,
    `| Governs | Privy wallet \`${walletId}\`, the facility admin [${walletAddress}](${link("address", walletAddress)}). Its policies: \`${JSON.stringify(wallet.policy_ids ?? [])}\` |`,
    `| Allows | ${evidence.policy.rules.map((rule) => `${rule.action} \`${rule.method}\` when ${rule.conditions.map((c) => `\`${c}\``).join(", ")}`).join("; ")} |`,
    "| Denies | everything else: Privy denies whatever no rule allows |",
    `| Does not cap | ${evidence.policy.doesNotCap}. The contract enforces \`maxWaiverDuration\`, and the service refuses a longer waiver before proposing it. |`,
    "",
    "## Transaction controls",
    "",
    "Each signed by both approvers through `POST /v1/wallets/{id}/rpc`.",
    "",
    "| Control | Varies | Call | To | Chain | Expected | Actual | Privy's answer |",
    "|---|---|---|---|---|---|---|---|",
    ...controls.map(
      (control) =>
        `| ${control.name} | ${control.varies} | \`${control.call}\` | \`${control.to}\` | ${control.chainId} | ${control.expected} | ${control.actual === control.expected ? control.actual : `**${control.actual}**`} | ${answer(control)} |`,
    ),
    "",
    "## Governance controls",
    "",
    "| Attempt | How | Expected | Actual | Privy's answer |",
    "|---|---|---|---|---|",
    ...governance.map(
      (attempt) =>
        `| ${attempt.name} | ${attempt.detail} | refused | ${attempt.refused ? "refused" : "**accepted**"} | ${attempt.privyStatus ?? ""} \`${attempt.privyResponse.replace(/\|/g, "\\|")}\` |`,
    ),
    "",
    "## Checks",
    "",
    ...Object.entries(checks).map(([name, value]) => `- ${name}: ${yes(value)}`),
    "",
  ].join("\n");
}
