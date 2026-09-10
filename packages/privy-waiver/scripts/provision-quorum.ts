import { getAddress, isAddressEqual, type Hex } from "viem";

import {
  APPROVER_ROLES,
  approverKeyDirectory,
  createApprover,
  readApprover,
  readQuorumRecord,
  writeQuorumRecord,
} from "../src/approvers.ts";
import { formatAuthorizationPayload, normalizePublicKey, signAuthorizationPayload } from "../src/authorization.ts";
import { toPrivyTransaction, verifySignedTransaction, type PinnedTransaction } from "../src/arc.ts";
import { PrivyApiError, PrivyClient, loadPrivyConfig, type SignTransactionRequest } from "../src/privy-client.ts";

/**
 * REQUIRES CREDENTIALS. Creates the facility admin once, and on every run proves it:
 *   - two approver keys, risk officer and treasury lead, persisted outside the repository;
 *   - a 2-of-2 Privy key quorum over exactly those keys;
 *   - one Privy server wallet that the quorum owns.
 * The proof comes from Privy's own answers: the wallet's owner is that quorum, the quorum lists
 * exactly our two keys, both keys together can sign for the wallet, and either key alone cannot.
 * Nothing is broadcast. Exits non-zero if any check fails: do not create a facility then.
 *
 *   set -a; . ./.env; set +a
 *   node --import tsx packages/privy-waiver/scripts/provision-quorum.ts
 */

const client = new PrivyClient(loadPrivyConfig());
const directory = approverKeyDirectory();
const approvers = APPROVER_ROLES.map(({ role }) => readApprover(directory, role) ?? createApprover(directory, role));

let record = readQuorumRecord(directory);
if (!record) {
  const quorum = await client.createKeyQuorum({
    public_keys: approvers.map((approver) => approver.publicKey),
    authorization_threshold: 2,
    // Privy caps display_name at 50 characters.
    display_name: "Signa facility admin (risk + treasury)",
  });
  record = writeQuorumRecord(directory, { keyQuorumId: quorum.id, createdAt: new Date().toISOString() });
  console.log(`created key quorum ${quorum.id}`);
}
if (!record.walletId) {
  const created = await client.createWallet({ chain_type: "ethereum", owner_id: record.keyQuorumId, display_name: "Signa facility admin" });
  record = writeQuorumRecord(directory, { ...record, walletId: created.id, walletAddress: getAddress(created.address) });
  console.log(`created wallet ${created.id}`);
}
const { walletId, walletAddress: recordedAddress } = record;
if (!walletId || !recordedAddress) throw new Error(`${directory}/quorum.json is incomplete`);

const quorum = await client.getKeyQuorum(record.keyQuorumId);
const wallet = await client.getWallet(walletId);
const address = getAddress(wallet.address);
const listed = (quorum.authorization_keys ?? []).map((entry) => normalizePublicKey(entry.public_key));
const ours = approvers.map((approver) => normalizePublicKey(approver.publicKey));
const approverFor = (key: string) => approvers[ours.indexOf(key)]?.label ?? "NOT OURS";

// Signed but never sent, and unmineable if it were: nonce 1,000,000,000 and a fee cap of 1 wei.
const probe: PinnedTransaction = {
  chainId: 5_042_002,
  from: address,
  to: address,
  data: "0x",
  nonce: 1_000_000_000,
  gas: 21_000n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 0n,
};
const body: SignTransactionRequest = { method: "eth_signTransaction", params: { transaction: toPrivyTransaction(probe) } };
const payload = formatAuthorizationPayload({
  version: 1,
  method: "POST",
  url: client.walletRpcUrl(walletId),
  body,
  headers: { "privy-app-id": client.appId },
});
const signatures = approvers.map((approver) => signAuthorizationPayload(approver.privateKey, payload));

const alone: { approver: string; refused: boolean; status?: number; error?: string }[] = [];
for (const [index, approver] of approvers.entries()) {
  try {
    await client.walletRpc(walletId, body, [signatures[index] as string]);
    alone.push({ approver: approver.label, refused: false });
  } catch (error) {
    if (!(error instanceof PrivyApiError)) throw error;
    alone.push({ approver: approver.label, refused: true, status: error.status, error: error.responseBody.slice(0, 160) });
  }
}
const both = (await client.walletRpc(walletId, body, signatures)) as { data?: { signed_transaction?: string } };
const signedProbe = both.data?.signed_transaction;
const recovered = signedProbe?.startsWith("0x") ? (await verifySignedTransaction(signedProbe as Hex, probe)).signer : undefined;

const checks = {
  thresholdIsTwo: quorum.authorization_threshold === 2,
  quorumListsExactlyOurTwoKeys: listed.length === 2 && ours.every((key) => listed.includes(key)),
  quorumHasNoOtherMembers: (quorum.user_ids ?? []).length === 0 && (quorum.key_quorum_ids ?? []).length === 0,
  walletOwnerIsTheQuorum: wallet.owner_id === record.keyQuorumId,
  walletAddressIsTheRecordedOne: isAddressEqual(address, recordedAddress),
  eitherKeyAloneIsRefused: alone.length === 2 && alone.every((attempt) => attempt.refused),
  bothKeysSignForTheWallet: recovered !== undefined && isAddressEqual(recovered, address),
};

console.log(
  JSON.stringify(
    {
      approverKeyDirectory: directory,
      keyQuorum: {
        id: quorum.id,
        threshold: quorum.authorization_threshold,
        authorizationKeys: listed.map((key) => ({ approver: approverFor(key), publicKey: key })),
      },
      wallet: { id: wallet.id, address, ownerId: wallet.owner_id ?? null },
      eitherKeyAlone: alone,
      bothKeys: { recoveredSigner: recovered ?? null },
      checks,
    },
    null,
    2,
  ),
);

if (!Object.values(checks).every(Boolean)) {
  console.error("\nVERIFICATION FAILED. Do not create a facility against this wallet.");
  process.exit(1);
}
console.log(`\nVERIFIED. Facility admin ${address} is Privy wallet ${wallet.id}, owned by 2-of-2 key quorum ${quorum.id}.`);
