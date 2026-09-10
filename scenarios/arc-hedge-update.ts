import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createDecipheriv, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CREDENTIAL_CHAIN_ID } from "@fx-coverage/credentials";
import {
  mapProviderFixture,
  MOCK_PROVIDER_DISCLAIMER,
  observeAt,
  parseProviderFixture,
  signHedgeCredential,
} from "@fx-coverage/provider-adapter";
import {
  BaseError,
  ContractFunctionRevertedError,
  concat,
  createPublicClient,
  createWalletClient,
  http,
  isAddressEqual,
  keccak256,
  parseEventLogs,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

// One hedge update against the deployed facility, outside the A-1 … A-4 run.
// The named fixture is re-observed at a recorded chain block, sequenced one
// above the latest the registry holds for the trade, signed by the hedge
// issuer, submitted by the keeper, and followed by one vault call. Its evidence
// goes to its own file; arc-facility-evidence.json is never touched.
//
//   node --import tsx scenarios/arc-hedge-update.ts refreshed syncCovenant 6840 CURE
//   node --import tsx scenarios/arc-hedge-update.ts restored restoreCompliance 10000 COMPLIANT

const USAGE =
  "Usage: node --import tsx scenarios/arc-hedge-update.ts <fixture> <syncCovenant|restoreCompliance> <expected bps> <expected state>";
const [fixtureName, vaultCall, expectedBps, expectedState] = process.argv.slice(2);
assert(fixtureName && expectedBps && expectedState, USAGE);
assert(vaultCall === "syncCovenant" || vaultCall === "restoreCompliance", USAGE);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_PATH = "scenarios/arc-hedge-update.ts";
const EVIDENCE_DIR = process.env.ARC_EVIDENCE_DIR ?? join(REPO_ROOT, "scenarios", "output");
const KEYSTORE_DIR = process.env.ARC_KEYSTORE_DIR ?? join(homedir(), ".foundry", "keystores");
const KEYCHAIN_SERVICE = process.env.ARC_KEYCHAIN_SERVICE ?? "signa-arc-testnet-keystores";
const KEYCHAIN_ACCOUNT = process.env.ARC_KEYCHAIN_ACCOUNT ?? "signa-arc";

const STATES = ["UNASSESSED", "COMPLIANT", "CURE", "BREACH", "WAIVED"] as const;
const REASONS = [
  "NONE",
  "MISSING_EXPOSURE",
  "INVALID_EXPOSURE",
  "BELOW_THRESHOLD",
  "RESERVE_VIOLATION",
] as const;

type Manifest = {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  contracts: {
    credentialRegistry: { address: Address };
    coverageEngine: { address: Address };
    covenantVault: { address: Address };
  };
  roles: { operator: Address; hedgeIssuer: Address };
  facility: { id: Hex };
};

const manifest = JSON.parse(
  await readFile(join(REPO_ROOT, "deployments", "arc-testnet.json"), "utf8"),
) as Manifest;
assert.equal(manifest.chainId, arcTestnet.id, "E-MAN-1: the manifest must be Arc Testnet");

const rpcUrl = process.env.ARC_RPC_URL ?? manifest.rpcUrl;
// Any other RPC (an Anvil fork, say) is a rehearsal and never public evidence.
const rehearsal = rpcUrl !== manifest.rpcUrl;
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain: arcTestnet, transport });
assert.equal(await publicClient.getChainId(), arcTestnet.id, `${rpcUrl} is not Arc Testnet`);

const facilityId = manifest.facility.id;
const registry = manifest.contracts.credentialRegistry.address;
const engine = manifest.contracts.coverageEngine.address;
const vault = manifest.contracts.covenantVault.address;
const [credentialsAbi, engineAbi, vaultAbi] = await Promise.all([
  loadAbi("CredentialRegistry.sol/CredentialRegistry.json"),
  loadAbi("CoverageEngine.sol/CoverageEngine.json"),
  loadAbi("CovenantVault.sol/CovenantVault.json"),
]);

// Keys stay in Foundry's encrypted keystores and are decrypted in memory only.
// The operator key doubles as the keeper (E-ID-2); the hedge issuer only signs.
const password = keychainPassword();
const operator = privateKeyToAccount(await unlock("signa-arc-operator", password));
const hedgeIssuerKey = await unlock("signa-arc-hedge-issuer", password);
assert(isAddressEqual(operator.address, manifest.roles.operator), "operator key is not the manifest operator");
assert(
  isAddressEqual(privateKeyToAccount(hedgeIssuerKey).address, manifest.roles.hedgeIssuer),
  "hedge issuer key is not the manifest hedge issuer",
);
const keeper = createWalletClient({ account: operator, chain: arcTestnet, transport });

const repository = gitState();
assert(
  rehearsal || !repository.scriptDirty,
  `commit ${SCRIPT_PATH} before a public run, so the evidence names the code that produced it`,
);

const template = JSON.parse(
  await readFile(
    join(REPO_ROOT, "packages", "provider-adapter", "fixtures", `arc-forward-${fixtureName}.json`),
    "utf8",
  ),
) as unknown;
const tradeId = mapProviderFixture(template, facilityId).tradeIdCommitment;
const latest = (await read(registry, credentialsAbi, "currentHedge", [facilityId, tradeId])) as {
  credential: { sequence: bigint; maturity: bigint };
};
assert(latest.credential.sequence > 0n, "the trade has no hedge credential on this facility yet");
// Fail closed before spending gas: a stale exposure or a live waiver would
// leave the update unable to move the covenant.
assert.equal(await read(engine, engineAbi, "exposureEligibility", [facilityId]), 0, "the exposure credential is not eligible");
assert.equal(await read(vault, vaultAbi, "activeWaiver"), false, "a waiver is active; the vault would not transition");
const before = await covenantAt();

// E-FIX-1: strictly above the latest sequence the registry holds for this trade.
// E-FIX-2: observed at a block the chain has already produced, just before
// signing. The trade keeps the maturity it was booked with, read from its
// current credential rather than recomputed.
const sequence = latest.credential.sequence + 1n;
const block = await publicClient.getBlock();
const observed = observeAt(template, block, latest.credential.maturity);
const fixture = parseProviderFixture({
  ...observed,
  trade: {
    ...observed.trade,
    sequence: Number(sequence),
    receipt_reference: `FICTIONAL-ARC-RECEIPT-${sequence.toString().padStart(3, "0")}`,
  },
});
const credential = mapProviderFixture(fixture, facilityId);
const signed = await signHedgeCredential({
  credential,
  chainId: CREDENTIAL_CHAIN_ID,
  verifyingContract: registry,
  privateKey: hedgeIssuerKey,
});
assert.equal(
  await read(registry, credentialsAbi, "hashHedgeCredential", [credential]),
  signed.digest,
  "the registry's EIP-712 domain differs from the signing domain",
);

const evidence = {
  title: `Hedge update: ${fixtureName} at sequence ${sequence}, then ${vaultCall}`,
  rehearsal,
  outcome: "incomplete",
  providerDisclaimer: MOCK_PROVIDER_DISCLAIMER,
  generatedAt: new Date().toISOString(),
  network: { chainId: arcTestnet.id, rpcUrl, explorer: manifest.explorer },
  script: { path: SCRIPT_PATH, commit: repository.head, dirty: repository.scriptDirty },
  deployment: { facilityId, credentialRegistry: registry, coverageEngine: engine, covenantVault: vault },
  before: { hedgeSequence: latest.credential.sequence.toString(), ...before },
  expected: { coverageBps: Number(expectedBps), covenantState: expectedState },
  // E-FIX-3: the generated fixture and signed payload, saved exactly as signed.
  credential: { observedAtBlock: blockReference(block), fixture, ...signed },
  steps: [] as unknown[],
  after: undefined as unknown,
};

try {
  const { remaining_buy_amount, buy_currency, status } = fixture.trade;
  await transact(
    `submit hedge seq ${sequence} (${remaining_buy_amount} ${buy_currency}, ${status})`,
    registry,
    credentialsAbi,
    "submitHedge",
    [credential, signed.signature],
  );
  const call = await transact(vaultCall, vault, vaultAbi, vaultCall);
  const after = await covenantAt();
  evidence.after = { atCallBlock: call.covenant, atLatest: after };
  for (const reading of [call.covenant, after]) {
    assert.equal(reading.coverageBps, Number(expectedBps), "coverage read back from CoverageEngine.evaluate");
    assert.equal(reading.covenantState, expectedState, "covenant state read back from the vault");
  }
  evidence.outcome = "complete";
} catch (error) {
  evidence.outcome = `failed: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
} finally {
  await writeEvidence();
}

async function transact(
  action: string,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
) {
  const hash = await keeper.writeContract({ address, abi, functionName, args } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const raw = await publicClient.request({ method: "eth_getTransactionReceipt", params: [hash] });
  assert(raw, `no receipt for ${hash}`);
  const covenant = await covenantAt(receipt.blockNumber);
  const step = {
    action,
    transactionHash: hash,
    explorer: `${manifest.explorer}/tx/${hash}`,
    blockNumber: receipt.blockNumber.toString(),
    sender: receipt.from,
    expectedStatus: "0x1",
    actualStatus: raw.status,
    gasUsed: receipt.gasUsed.toString(),
    covenant,
    events: parseEventLogs({ abi: [...credentialsAbi, ...vaultAbi] as Abi, logs: receipt.logs }).map(
      (log) => ({ contract: log.address, event: log.eventName, args: log.args }),
    ),
  };
  evidence.steps.push(step);
  process.stdout.write(
    `${action}: ${raw.status} (expected 0x1), ${covenant.coverageBps} bps ${covenant.reasonCode}, ${covenant.covenantState}  ${step.explorer}\n`,
  );
  // A-9: the receipt decides, never an exit code.
  assert.equal(raw.status, "0x1", `${action}: expected status 0x1, got ${raw.status} (${step.explorer})`);
  return step;
}

async function covenantAt(blockNumber?: bigint) {
  const result = (await read(engine, engineAbi, "evaluate", [facilityId], blockNumber)) as {
    coverageBps: number;
    resultReason: number;
  };
  const state = Number(await read(vault, vaultAbi, "covenantState", [], blockNumber));
  const cureDeadline = (await read(vault, vaultAbi, "cureDeadline", [], blockNumber)) as bigint;
  return {
    readAtBlock: blockNumber?.toString() ?? "latest",
    coverageBps: Number(result.coverageBps),
    reasonCode: REASONS[result.resultReason] ?? String(result.resultReason),
    covenantState: STATES[state] ?? String(state),
    cureDeadline: cureDeadline.toString(),
  };
}

async function read(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint,
): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await publicClient.readContract({ address, abi, functionName, args, blockNumber } as never);
    } catch (error) {
      const reverted = error instanceof BaseError && error.walk((cause) => cause instanceof ContractFunctionRevertedError);
      if (reverted || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
}

function blockReference(recorded: { number: bigint; hash: Hex; timestamp: bigint }) {
  return { number: recorded.number.toString(), hash: recorded.hash, timestamp: recorded.timestamp.toString() };
}

function keychainPassword(): string {
  // One password protects the role keystores. It lives in the macOS Keychain,
  // never in a file, a flag or this process's output.
  return execFileSync(
    "security",
    ["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w"],
    { encoding: "utf8" },
  ).replace(/\n$/, "");
}

/** Decrypt a Foundry keystore (Web3 Secret Storage v3, scrypt) in memory. */
async function unlock(name: string, keystorePassword: string): Promise<Hex> {
  const { crypto } = JSON.parse(await readFile(join(KEYSTORE_DIR, name), "utf8")) as {
    crypto: {
      cipher: string;
      ciphertext: string;
      cipherparams: { iv: string };
      kdf: string;
      kdfparams: { dklen: number; n: number; p: number; r: number; salt: string };
      mac: string;
    };
  };
  assert.equal(crypto.kdf, "scrypt", `${name}: unsupported key derivation`);
  assert.equal(crypto.cipher, "aes-128-ctr", `${name}: unsupported cipher`);
  const { dklen, n, p, r, salt } = crypto.kdfparams;
  const derived = scryptSync(keystorePassword, Buffer.from(salt, "hex"), dklen, {
    N: n,
    r,
    p,
    maxmem: 256 * n * r * p,
  });
  const ciphertext = Buffer.from(crypto.ciphertext, "hex");
  const mac = keccak256(concat([toHex(derived.subarray(16, 32)), toHex(ciphertext)]));
  if (mac.slice(2) !== crypto.mac.toLowerCase()) {
    throw new Error(`${name} did not unlock with the Keychain password`);
  }
  const decipher = createDecipheriv("aes-128-ctr", derived.subarray(0, 16), Buffer.from(crypto.cipherparams.iv, "hex"));
  return toHex(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

function gitState() {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  return {
    head: git("rev-parse", "HEAD"),
    scriptDirty: git("status", "--porcelain", "--", SCRIPT_PATH) !== "",
  };
}

async function writeEvidence() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const path = join(EVIDENCE_DIR, `arc-hedge-update-seq-${sequence}.json`);
  const json = `${JSON.stringify(evidence, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`;
  await writeFile(path, json, "utf8");
  process.stdout.write(`Evidence (${evidence.outcome}): ${path}\n`);
}

async function loadAbi(relativePath: string): Promise<Abi> {
  const artifact = JSON.parse(
    await readFile(join(REPO_ROOT, "contracts", "out", relativePath), "utf8"),
  ) as { abi: Abi };
  return artifact.abi;
}
