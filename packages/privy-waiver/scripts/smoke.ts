import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAddress, type Hex } from "viem";

import {
  formatAuthorizationPayload,
  generateAuthorizationKeyPair,
  importAuthorizationPublicKey,
  intentAuthorizationInput,
  normalizePublicKey,
  signAuthorizationPayload,
  verifyAuthorizationSignature,
  type AuthorizationKeyPair,
} from "../src/authorization.ts";
import { toPrivyTransaction, verifySignedTransaction, type PinnedTransaction } from "../src/arc.ts";
import {
  PrivyApiError,
  PrivyClient,
  keyMembers,
  loadPrivyConfig,
  signedTransactionOf,
  type RpcIntent,
  type SignTransactionRequest,
} from "../src/privy-client.ts";

/**
 * REQUIRES CREDENTIALS. In about a minute, and without touching Arc, it proves the three things
 * that need a Privy account:
 *   1. A free app can create a 2-of-2 key quorum and a wallet the quorum owns.
 *   2. Privy signs a transaction for Arc's chain ID, 5042002.
 *   3. The hand-rolled POST /v1/intents/{id}/authorize works: two approvals execute an intent.
 *
 *   set -a; . ./.env; set +a          # credentials in the repository root's .env
 *   node --import tsx packages/privy-waiver/scripts/smoke.ts
 *
 * With --public-keys=<spki>,<spki> it instead creates the demo quorum and wallet from the public
 * keys approvers created in the approver UI, and prints the PRIVY_WALLET_ID to use.
 */

const ARC_TESTNET = 5_042_002;
const client = new PrivyClient(loadPrivyConfig());
const publicKeysArgument = process.argv.find((argument) => argument.startsWith("--public-keys="));

if (publicKeysArgument) {
  await createDemoQuorum(publicKeysArgument.slice("--public-keys=".length).split(",").map((key) => key.trim()).filter(Boolean));
} else {
  await smoke();
}

async function createDemoQuorum(publicKeys: string[]): Promise<void> {
  if (publicKeys.length < 2) throw new Error("pass both approvers' public keys, comma-separated");
  publicKeys.forEach((key) => importAuthorizationPublicKey(key));
  const quorum = await client.createKeyQuorum({
    public_keys: publicKeys,
    authorization_threshold: 2,
    display_name: "Signa facility admin: waiver quorum",
  });
  const wallet = await client.createWallet({ chain_type: "ethereum", owner_id: quorum.id, display_name: "Signa facility admin" });
  console.log(`Key quorum ${quorum.id} (2 of ${publicKeys.length}) owns wallet ${wallet.id}, address ${wallet.address}.`);
  console.log("Add to packages/privy-waiver/.env, fund the address with USDC for gas, restart the server:");
  console.log(`PRIVY_WALLET_ID=${wallet.id}`);
}

async function smoke(): Promise<void> {
  // Throwaway approver keys, written outside the repository and readable only by this user.
  const keyA = generateAuthorizationKeyPair();
  const keyB = generateAuthorizationKeyPair();
  const keyDirectory = join(homedir(), ".signa-privy-waiver", `smoke-${Date.now()}`);
  mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
  for (const [name, key] of [["approver-a", keyA], ["approver-b", keyB]] as [string, AuthorizationKeyPair][]) {
    writeFileSync(join(keyDirectory, `${name}.json`), `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
  }

  console.log("[1] Create a 2-of-2 key quorum and a wallet it owns");
  const quorum = await client.createKeyQuorum({
    public_keys: [keyA.publicKey, keyB.publicKey],
    authorization_threshold: 2,
    display_name: "Signa waiver quorum (smoke test)",
  });
  const wallet = await client.createWallet({ chain_type: "ethereum", owner_id: quorum.id, display_name: "Signa smoke test" });
  const address = getAddress(wallet.address);
  console.log(`    quorum ${quorum.id} owns wallet ${wallet.id} at ${address}`);
  const listed = ((await client.getKeyQuorum(quorum.id)).authorization_keys ?? []).map((entry) =>
    normalizePublicKey(entry.public_key),
  );
  const ours = [keyA.publicKey, keyB.publicKey].map(normalizePublicKey);
  if (listed.length !== ours.length || !ours.every((key) => listed.includes(key))) {
    throw new Error(`the quorum lists ${JSON.stringify(listed)} under authorization_keys, not our two keys`);
  }
  console.log("    the quorum lists exactly our two keys under authorization_keys");

  // Nothing is broadcast: the wallet is unfunded and these transactions only prove signing.
  const transaction = (nonce: number): PinnedTransaction => ({
    chainId: ARC_TESTNET,
    from: address,
    to: address,
    data: "0x",
    nonce,
    gas: 21_000n,
    maxFeePerGas: 50_000_000_000n,
    maxPriorityFeePerGas: 0n,
  });
  const request = (tx: PinnedTransaction): SignTransactionRequest => ({
    method: "eth_signTransaction",
    params: { transaction: toPrivyTransaction(tx) },
  });

  console.log("[2] Sign an Arc transaction synchronously with both keys");
  const syncTx = transaction(0);
  const syncBody = request(syncTx);
  const syncPayload = formatAuthorizationPayload({
    version: 1,
    method: "POST",
    url: client.walletRpcUrl(wallet.id),
    body: syncBody,
    headers: { "privy-app-id": client.appId },
  });
  const syncResult = (await client.walletRpc(wallet.id, syncBody, [
    signAuthorizationPayload(keyA.privateKey, syncPayload),
    signAuthorizationPayload(keyB.privateKey, syncPayload),
  ])) as { data?: { signed_transaction?: string } };
  const syncSigned = syncResult.data?.signed_transaction;
  if (!syncSigned?.startsWith("0x")) throw new Error(`no signed transaction in ${JSON.stringify(syncResult)}`);
  await verifySignedTransaction(syncSigned as Hex, syncTx);
  console.log("    Privy signed for chain 5042002; the RLP checks out and recovers to the wallet");

  console.log("[3] Intent: propose, then authorize with key A and key B (the hand-rolled call)");
  const intentTx = transaction(1);
  let intent = await client.proposeRpcIntent(wallet.id, request(intentTx));
  console.log(`    intent ${intent.intent_id} is ${intent.status}`);

  const authorize = async (name: string, key: AuthorizationKeyPair): Promise<RpcIntent> => {
    // Sign Privy's normalized copy of the request, from GET, never the body we proposed.
    const current = await client.getIntent(intent.intent_id);
    const timestamp = Date.now();
    const payload = formatAuthorizationPayload(intentAuthorizationInput(current, client.appId, timestamp));
    const signature = signAuthorizationPayload(key.privateKey, payload);
    // Privy gives one error for every bad signature, so rule out our own before blaming the payload.
    if (!keyMembers(current).some((member) => verifyAuthorizationSignature(member.publicKey, payload, signature))) {
      throw new Error(`${name}'s signature does not verify under any member key the intent lists`);
    }
    try {
      return await client.authorizeIntent(intent.intent_id, { signature, timestamp });
    } catch (error) {
      if (error instanceof PrivyApiError) console.log(`    ${name} signed: ${new TextDecoder().decode(payload)}`);
      throw error;
    }
  };

  intent = await authorize("key A", keyA);
  console.log(`    key A accepted; intent is ${intent.status}`);
  if (intent.status !== "pending") throw new Error("one signature of two should leave the intent pending");

  intent = await authorize("key B", keyB);
  for (let attempt = 0; attempt < 30 && intent.status !== "executed" && ["pending", "granted", "processing"].includes(intent.status); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    intent = await client.getIntent(intent.intent_id);
  }
  if (intent.status === "executed" && !signedTransactionOf(intent)) intent = await client.getIntent(intent.intent_id);
  const signed = signedTransactionOf(intent);
  if (intent.status !== "executed" || !signed) {
    throw new Error(`intent ended ${intent.status}; action_result = ${JSON.stringify(intent.action_result)}`);
  }
  await verifySignedTransaction(signed, intentTx);
  console.log("    key B executed the intent; the signed transaction is the one proposed and recovers to the wallet");

  console.log("\nAll three pass.");
  console.log(`# Smoke wallet ${wallet.id} (${address}). Throwaway approver keys: ${keyDirectory}`);
}
