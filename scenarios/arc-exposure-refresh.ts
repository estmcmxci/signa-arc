import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createDecipheriv, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCanonicalScale,
  CREDENTIAL_CHAIN_ID,
  credentialDomain,
  exposureCredentialTypes,
  hashExposureCredential,
  type ExposureCredential,
} from "@fx-coverage/credentials";
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
  toBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

// One exposure re-observation against the deployed facility, outside the
// A-1 … A-4 run. The obligation itself is never restated: outstanding value,
// currency pair and maturity are read back from the credential the registry
// already holds and carried forward unchanged. Only the observation is new —
// a fresh block timestamp, a fresh validity window, the next sequence — so a
// credential that has aged out of the freshness window becomes eligible again
// without changing what it asserts. Its evidence goes to its own file;
// arc-facility-evidence.json is never touched.
//
//   node --import tsx scenarios/arc-exposure-refresh.ts

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_PATH = "scenarios/arc-exposure-refresh.ts";
const EVIDENCE_DIR = process.env.ARC_EVIDENCE_DIR ?? join(REPO_ROOT, "scenarios", "output");
const KEYSTORE_DIR = process.env.ARC_KEYSTORE_DIR ?? join(homedir(), ".foundry", "keystores");
const KEYCHAIN_SERVICE = process.env.ARC_KEYCHAIN_SERVICE ?? "signa-arc-testnet-keystores";
const KEYCHAIN_ACCOUNT = process.env.ARC_KEYCHAIN_ACCOUNT ?? "signa-arc";

// Identical to the disclaimer the A-1 source record carries: the same fictional
// book, re-observed.
const DISCLAIMER =
  "Fictional EUR-denominated loan book. Mock provider and exposure data. Testnet USDC only; no real counterparties.";
const STATES = ["UNASSESSED", "COMPLIANT", "CURE", "BREACH", "WAIVED"] as const;
const REASONS = [
  "NONE",
  "MISSING_EXPOSURE",
  "INVALID_EXPOSURE",
  "BELOW_THRESHOLD",
  "RESERVE_VIOLATION",
] as const;
const EXPOSURE_REASONS = [
  "ELIGIBLE",
  "MISSING",
  "ZERO_VALUE",
  "ISSUER_NOT_APPROVED",
  "PAIR_MISMATCH",
  "NOT_YET_OBSERVED",
  "EXPIRED",
  "STALE",
  "REVOKED",
  "ISSUER_AUTHORIZATION_STALE",
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
  exposureDenomination: { currency: string; referenceAsset: { address: Address; symbol: string } };
  roles: { operator: Address; exposureIssuer: Address };
  facility: { id: Hex; policy: { credentialMaxAgeSeconds: number } };
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
// The operator key submits and pays the gas (E-ID-2); the exposure issuer only
// signs and holds no gas (E-DEC-3).
const password = keychainPassword();
const operator = privateKeyToAccount(await unlock("signa-arc-operator", password));
const exposureIssuer = privateKeyToAccount(await unlock("signa-arc-exposure-issuer", password));
assert(isAddressEqual(operator.address, manifest.roles.operator), "operator key is not the manifest operator");
assert(
  isAddressEqual(exposureIssuer.address, manifest.roles.exposureIssuer),
  "exposure issuer key is not the manifest exposure issuer",
);
const keeper = createWalletClient({ account: operator, chain: arcTestnet, transport });

const repository = gitState();
assert(
  rehearsal || !repository.scriptDirty,
  `commit ${SCRIPT_PATH} before a public run, so the evidence names the code that produced it`,
);

const stored = (await read(registry, credentialsAbi, "currentExposure", [facilityId])) as {
  credential: ExposureCredential;
  issuer: Address;
  digest: Hex;
};
const current = stored.credential;
assert(current.sequence > 0n, "the facility has no exposure credential to re-observe");
assert(
  isAddressEqual(stored.issuer, manifest.roles.exposureIssuer),
  "the stored credential was issued by a different exposure issuer",
);
const before = { ...(await covenantAt()), exposureEligibility: await exposureEligibility() };

// E-FIX-1: strictly above the sequence the registry holds for this facility.
// E-FIX-2: observed at a block the chain has already produced, just before
// signing. The obligation is carried forward from the stored credential —
// value, pair and maturity unchanged — so only its observation is new.
const sequence = current.sequence + 1n;
const block = await publicClient.getBlock();
const outstandingValue = assertCanonicalScale(current.outstandingValue, "outstandingValue");
const sourceRecord = {
  mock: true,
  disclaimer: DISCLAIMER,
  portfolio: "Fictional EUR-denominated loan book",
  denomination: manifest.exposureDenomination.currency,
  denominatingAsset: manifest.exposureDenomination.referenceAsset.address,
  settlementObligationUsd: sixDecimals(outstandingValue),
  observedAtBlock: block.number.toString(),
  sequence: sequence.toString(),
};
const credential: ExposureCredential = {
  facilityId,
  exposureCurrency: current.exposureCurrency,
  settlementCurrency: current.settlementCurrency,
  outstandingValue,
  exposureMaturity: current.exposureMaturity,
  observedAt: block.timestamp,
  validUntil: block.timestamp + BigInt(manifest.facility.policy.credentialMaxAgeSeconds),
  sequence,
  sourceCommitment: keccak256(toBytes(JSON.stringify(sourceRecord))),
};
assert.equal(credential.facilityId, current.facilityId, "the re-observation must name the same facility");
assert.equal(credential.outstandingValue, current.outstandingValue, "the obligation must not be restated");
assert.equal(credential.exposureMaturity, current.exposureMaturity, "the maturity must not be restated");
assert(credential.exposureMaturity > credential.observedAt, "the exposure has matured; it cannot be re-observed");

const signature = await exposureIssuer.signTypedData({
  domain: credentialDomain(CREDENTIAL_CHAIN_ID, registry),
  types: exposureCredentialTypes,
  primaryType: "ExposureCredential",
  message: credential,
});
const digest = hashExposureCredential(CREDENTIAL_CHAIN_ID, registry, credential);
assert.equal(
  await read(registry, credentialsAbi, "hashExposureCredential", [credential]),
  digest,
  "the registry's EIP-712 domain differs from the signing domain",
);

const evidence = {
  title: `Exposure re-observation at sequence ${sequence}`,
  rehearsal,
  outcome: "incomplete",
  disclaimer: DISCLAIMER,
  generatedAt: new Date().toISOString(),
  network: { chainId: arcTestnet.id, rpcUrl, explorer: manifest.explorer },
  script: { path: SCRIPT_PATH, commit: repository.head, dirty: repository.scriptDirty },
  deployment: { facilityId, credentialRegistry: registry, coverageEngine: engine, covenantVault: vault },
  before: {
    exposureSequence: current.sequence.toString(),
    exposureDigest: stored.digest,
    observedAt: current.observedAt.toString(),
    validUntil: current.validUntil.toString(),
    ...before,
  },
  // E-FIX-3: the source record and signed payload, saved exactly as signed.
  credential: {
    kind: "ExposureCredential",
    observedAtBlock: blockReference(block),
    sourceRecord,
    issuer: exposureIssuer.address,
    digest,
    credential,
    signature,
  },
  steps: [] as unknown[],
  after: undefined as unknown,
  revert: undefined as unknown,
};

try {
  await transact(
    `submit exposure seq ${sequence} (${sourceRecord.settlementObligationUsd} USD, re-observed)`,
    registry,
    credentialsAbi,
    "submitExposure",
    [credential, signature],
  );
  const eligibility = await exposureEligibility();
  const after = await covenantAt();
  evidence.after = { ...after, exposureEligibility: eligibility };
  process.stdout.write(
    `exposure eligibility: ${eligibility.reason}; coverage ${after.coverageBps} bps ${after.reasonCode}, ${after.covenantState}\n`,
  );
  assert.equal(eligibility.code, 0, `the refreshed exposure is not ELIGIBLE (${eligibility.reason})`);
  evidence.outcome = "complete";
} catch (error) {
  evidence.outcome = `failed: ${error instanceof Error ? error.message : String(error)}`;
  // A refused call is reported with its exact revert data, never retried.
  const reverted =
    error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null;
  if (reverted instanceof ContractFunctionRevertedError) {
    evidence.revert = { error: reverted.data?.errorName, args: reverted.data?.args, data: reverted.raw };
  }
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

async function exposureEligibility(blockNumber?: bigint) {
  const code = Number(await read(engine, engineAbi, "exposureEligibility", [facilityId], blockNumber));
  return { code, reason: EXPOSURE_REASONS[code] ?? String(code) };
}

async function covenantAt(blockNumber?: bigint) {
  const result = (await read(engine, engineAbi, "evaluate", [facilityId], blockNumber)) as {
    compliant: boolean;
    coverageBps: number;
    resultReason: number;
  };
  const state = Number(await read(vault, vaultAbi, "covenantState", [], blockNumber));
  const activeWaiver = (await read(vault, vaultAbi, "activeWaiver", [], blockNumber)) as boolean;
  const cureDeadline = (await read(vault, vaultAbi, "cureDeadline", [], blockNumber)) as bigint;
  return {
    readAtBlock: blockNumber?.toString() ?? "latest",
    compliant: result.compliant,
    coverageBps: Number(result.coverageBps),
    reasonCode: REASONS[result.resultReason] ?? String(result.resultReason),
    covenantState: STATES[state] ?? String(state),
    activeWaiver,
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

/** The canonical 6-decimal ERC-20 view, rendered the way the A-1 source record renders it. */
function sixDecimals(value: bigint): string {
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, "0")}`;
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
  const path = join(EVIDENCE_DIR, `arc-exposure-refresh-seq-${sequence}.json`);
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
