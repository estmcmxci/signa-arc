import { createPublicClient, formatEther, getAddress, http, isAddressEqual } from "viem";
import { arcTestnet } from "viem/chains";

import { APPROVER_ROLES, approverKeyDirectory, readApprover, readQuorumRecord } from "../src/approvers.ts";
import { normalizePublicKey, signAuthorizationPayload } from "../src/authorization.ts";
import { createArcGateway, loadManifest } from "../src/arc.ts";
import { quorumFacilityPlan } from "../src/facility-setup.ts";
import { PrivyClient, loadPrivyConfig } from "../src/privy-client.ts";
import { QuorumAdminService, type ActionView } from "../src/service.ts";
import { JsonFileStore, defaultStorePath } from "../src/store.ts";

/**
 * REQUIRES CREDENTIALS, the quorum provision-quorum.ts verified, and gas in its wallet.
 *
 * Creates the facility the quorum administers. FacilityRegistry only accepts createFacility from
 * the admin itself, so the quorum's wallet sends every setup call: createFacility, both issuer
 * approvals, freezeFacility. Each goes through QuorumAdminService: propose an intent, approve as
 * risk officer, approve as treasury lead, check the transaction Privy signed, broadcast it, assert
 * the receipt. Resumable: each step is read from the chain, so a rerun proposes only what is
 * missing. Once the facility is frozen it prints the vault's deploy command.
 *
 *   set -a; . ./.env; set +a
 *   node --import tsx packages/privy-waiver/scripts/provision-facility.ts
 */

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

const privy = new PrivyClient(loadPrivyConfig(env));
const wallet = await privy.getWallet(record.walletId);
if (wallet.owner_id !== record.keyQuorumId || !isAddressEqual(wallet.address, record.walletAddress)) {
  throw new Error("the Privy wallet no longer matches the recorded quorum; rerun provision-quorum.ts");
}
const walletAddress = getAddress(wallet.address);
const manifest = loadManifest();
const plan = quorumFacilityPlan(manifest, walletAddress, env.PRIVY_QUORUM_FACILITY_LABEL?.trim() || undefined);

const gas = await createPublicClient({ chain: arcTestnet, transport: http(manifest.rpcUrl) }).getBalance({ address: walletAddress });
console.log(`facility ${plan.facilityId}`);
console.log(`admin    ${walletAddress} (Privy wallet ${record.walletId}, key quorum ${record.keyQuorumId})`);
console.log(`gas      ${formatEther(gas)} USDC`);
if (gas < 10n ** 16n) throw new Error("the admin wallet needs gas: fund it with USDC first");

const service = new QuorumAdminService(
  privy,
  createArcGateway(manifest),
  new JsonFileStore(defaultStorePath(env)),
  { walletId: record.walletId, walletAddress, explorer: manifest.explorer },
  plan,
);

/** Collects both approvals, waits for Privy to sign, then verifies and broadcasts. */
async function drive(intentId: string): Promise<ActionView> {
  let view = await service.get(intentId);
  for (const approver of approvers) {
    if (view.status !== "pending") break;
    const member = view.approvals.members.find((candidate) => candidate.publicKey === normalizePublicKey(approver.publicKey));
    if (!member) throw new Error(`${approver.label}'s key is not a member of intent ${intentId}`);
    if (member.signedAt) continue;
    const payload = await service.signingPayloadFor(intentId);
    view = await service.approve(intentId, {
      publicKey: approver.publicKey,
      signature: signAuthorizationPayload(approver.privateKey, new TextEncoder().encode(payload.text)),
      encoding: "der",
      timestamp: payload.timestamp,
    });
    console.log(`    approved as ${approver.label}; intent is ${view.status}`);
  }
  for (let attempt = 0; attempt < 30 && ["pending", "granted", "processing"].includes(view.status); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    view = await service.get(intentId);
  }
  if (view.status !== "executed") throw new Error(`intent ${intentId} ended ${view.status}`);
  const done = await service.execute(intentId);
  console.log(`    broadcast ${done.broadcast?.hash}: receipt ${done.broadcast?.status}, block ${done.broadcast?.blockNumber}`);
  return done;
}

// Finish anything a previous run left open before proposing more.
for (const action of await service.list()) {
  if (!action.broadcast && ["pending", "granted", "processing", "executed"].includes(action.status)) {
    console.log(`\nresuming ${action.kind}, intent ${action.intentId}`);
    await drive(action.intentId);
  }
}
for (let step = 0; step < 6; step++) {
  const next = await service.proposeNextSetupStep();
  if ("complete" in next) {
    console.log(`\n${next.description}`);
    break;
  }
  console.log(`\n[${next.kind}] intent ${next.intentId}\n    ${next.description}`);
  await drive(next.intentId);
}
