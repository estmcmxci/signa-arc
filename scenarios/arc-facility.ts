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
  currencyToBytes3,
  exposureCredentialTypes,
  hashExposureCredential,
  type ExposureCredential,
} from "@fx-coverage/credentials";
import {
  bookedMaturity,
  mapProviderFixture,
  MOCK_PROVIDER_DISCLAIMER,
  observeAt,
  parseSixDecimalAmount,
  signHedgeCredential,
} from "@fx-coverage/provider-adapter";
import {
  BaseError,
  ContractFunctionRevertedError,
  concat,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseEventLogs,
  toBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

// PRD §9 A-1 … A-4 against the facility deployed in deployments/arc-testnet.json.
// Every address comes from the manifest (E-SCN-2); every receipt is asserted in
// the direction its step expects, never by exit code (A-9, E-SCN-3).

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCENARIO_PATH = "scenarios/arc-facility.ts";
const EVIDENCE_DIR = process.env.ARC_EVIDENCE_DIR ?? join(REPO_ROOT, "scenarios", "output");
const KEYSTORE_DIR = process.env.ARC_KEYSTORE_DIR ?? join(homedir(), ".foundry", "keystores");
const KEYCHAIN_SERVICE = process.env.ARC_KEYCHAIN_SERVICE ?? "signa-arc-testnet-keystores";
const KEYCHAIN_ACCOUNT = process.env.ARC_KEYCHAIN_ACCOUNT ?? "signa-arc";

const DRAW = assertCanonicalScale(parseSixDecimalAmount("1.000000"), "draw amount");
const EXPOSURE_OUTSTANDING = "1.000000";
// Far above what a refused draw spends, so the refusal can never be an out-of-gas.
const REFUSAL_GAS_LIMIT = 1_000_000n;
// 0.05 USDC in Arc's 18-decimal native view: a dozen transactions at ~$0.004.
const MIN_KEEPER_GAS = 50_000_000_000_000_000n;

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

type Deployed = { address: Address; deployTx: Hex; block: number };
type Manifest = {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  sourceCommit: string;
  contracts: {
    facilityRegistry: Deployed;
    credentialRegistry: Deployed;
    coverageEngine: Deployed;
    covenantVault: Deployed;
  };
  settlementAsset: { address: Address; decimals: number; symbol: string };
  exposureDenomination: { currency: string; referenceAsset: { address: Address; symbol: string } };
  roles: { facilityAdmin: Address; operator: Address; exposureIssuer: Address; hedgeIssuer: Address };
  facility: { id: Hex; policy: { credentialMaxAgeSeconds: number } };
};
type CoverageResult = {
  compliant: boolean;
  outstandingValue: bigint;
  grossEligible: bigint;
  countedEligible: bigint;
  coverageBps: number;
  resultReason: number;
};
type Status = "0x1" | "0x0";
type Step = {
  criterion: "A-1" | "A-2" | "A-3" | "A-4";
  action: string;
  transactionHash: Hex;
  explorer: string;
  blockNumber: string;
  sender: Address;
  expectedStatus: Status;
  actualStatus: string;
  gasUsed: string;
  coverageBps: number;
  reasonCode: string;
  covenantState: string;
  events: { contract: Address; event: string; args: unknown }[];
  calldata?: Hex;
  gate?: { allowed: boolean; reason: string; pinnedBlock: string };
  vault?: { balanceBefore: string; balanceAfter: string; principalBefore: string; principalAfter: string };
  refusal?: unknown;
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

const { facilityRegistry, credentialRegistry, coverageEngine, covenantVault } = manifest.contracts;
const facilityId = manifest.facility.id;
const [registryAbi, credentialsAbi, engineAbi, vaultAbi] = await Promise.all([
  loadAbi("FacilityRegistry.sol/FacilityRegistry.json"),
  loadAbi("CredentialRegistry.sol/CredentialRegistry.json"),
  loadAbi("CoverageEngine.sol/CoverageEngine.json"),
  loadAbi("CovenantVault.sol/CovenantVault.json"),
]);
const usdcAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const eventAbi = [...vaultAbi, ...credentialsAbi, ...usdcAbi] as Abi;

// E-ID-1 … E-ID-3. Keys stay in Foundry's encrypted keystores and are decrypted
// in memory only. The operator key doubles as the keeper (E-ID-2); the two
// issuers sign offchain and hold no gas (E-DEC-3).
const password = keychainPassword();
const operator = privateKeyToAccount(await unlock("signa-arc-operator", password));
const exposureIssuer = privateKeyToAccount(await unlock("signa-arc-exposure-issuer", password));
const hedgeIssuerKey = await unlock("signa-arc-hedge-issuer", password);
const hedgeIssuer = privateKeyToAccount(hedgeIssuerKey).address;
assert(isAddressEqual(operator.address, manifest.roles.operator), "operator key is not the manifest operator");
assert(isAddressEqual(exposureIssuer.address, manifest.roles.exposureIssuer), "exposure issuer mismatch");
assert(isAddressEqual(hedgeIssuer, manifest.roles.hedgeIssuer), "hedge issuer mismatch");
assert.equal(new Set([operator.address, exposureIssuer.address, hedgeIssuer]).size, 3);
const keeper = createWalletClient({ account: operator, chain: arcTestnet, transport });

const repository = gitState();
assert(
  rehearsal || !repository.scenarioDirty,
  `commit ${SCENARIO_PATH} before a public run, so the evidence names the code that produced it`,
);

const drawCalldata = encodeFunctionData({ abi: vaultAbi, functionName: "draw", args: [DRAW] });
const evidence = {
  title: "Signa Covenant: A-1 … A-4 on Arc Testnet",
  rehearsal,
  outcome: "incomplete",
  disclaimer: DISCLAIMER,
  providerDisclaimer: MOCK_PROVIDER_DISCLAIMER,
  generatedAt: new Date().toISOString(),
  network: { chainId: arcTestnet.id, rpcUrl, explorer: manifest.explorer },
  scenario: { path: SCENARIO_PATH, commit: repository.head, dirty: repository.scenarioDirty },
  deployment: {
    sourceCommit: manifest.sourceCommit,
    facilityId,
    facilityRegistry: facilityRegistry.address,
    credentialRegistry: credentialRegistry.address,
    coverageEngine: coverageEngine.address,
    covenantVault: covenantVault.address,
    settlementAsset: manifest.settlementAsset.address,
    exposureDenomination: manifest.exposureDenomination,
  },
  identities: {
    operatorAndKeeper: operator.address,
    exposureIssuer: exposureIssuer.address,
    hedgeIssuer,
  },
  draw: { amount: DRAW.toString(), calldata: drawCalldata },
  steps: [] as Step[],
  credentials: [] as unknown[],
};

try {
  await preflight();
  const [active, refreshed, restored] = await Promise.all(
    ["active", "refreshed", "restored"].map(loadFixture),
  );

  // A-1 — the facility is funded, and both credentials are accepted from distinct issuers.
  await recordFunding();
  const start = await publicClient.getBlock();
  const maturity = bookedMaturity(active, start);
  await submitExposure(start, maturity);
  expectCoverage(await submitHedge("A-1", active, maturity), 10_000, "UNASSESSED");

  // A-2 — the draw is permitted and USDC leaves the vault.
  expectCoverage(await draw("A-2", "0x1"), 10_000, "COMPLIANT");

  // A-3 — reduced coverage, synchronised to CURE, and the identical draw refused.
  expectCoverage(await submitHedge("A-3", refreshed, maturity), 6_840, "COMPLIANT");
  expectCoverage(await transact("A-3", "syncCovenant", covenantVault.address, vaultAbi, "syncCovenant"), 6_840, "CURE");
  expectCoverage(await draw("A-3", "0x0"), 6_840, "CURE");

  // A-4 — a fresh hedge, explicit restoration, and the identical draw permitted again.
  expectCoverage(await submitHedge("A-4", restored, maturity), 10_000, "CURE");
  expectCoverage(await transact("A-4", "restoreCompliance", covenantVault.address, vaultAbi, "restoreCompliance"), 10_000, "COMPLIANT");
  expectCoverage(await draw("A-4", "0x1"), 10_000, "COMPLIANT");

  evidence.outcome = "complete";
} catch (error) {
  evidence.outcome = `failed: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
} finally {
  await writeEvidence();
}

async function preflight() {
  for (const [name, contract] of Object.entries(manifest.contracts)) {
    const code = await publicClient.getCode({ address: contract.address });
    assert(code && code !== "0x", `${name} has no code at ${contract.address}`);
  }
  assert.equal(await read(covenantVault.address, vaultAbi, "facilityId"), facilityId);
  assert.equal(await read(facilityRegistry.address, registryAbi, "isExposureIssuer", [facilityId, exposureIssuer.address]), true);
  assert.equal(await read(facilityRegistry.address, registryAbi, "isHedgeIssuer", [facilityId, hedgeIssuer]), true);

  // Sequences 1, 2 and 4 must still be unused, or every submission is stale.
  const exposure = (await read(credentialRegistry.address, credentialsAbi, "currentExposure", [facilityId])) as {
    credential: { sequence: bigint };
  };
  const tradeId = mapProviderFixture(await loadFixture("active"), facilityId).tradeIdCommitment;
  const hedge = (await read(credentialRegistry.address, credentialsAbi, "currentHedge", [facilityId, tradeId])) as {
    credential: { sequence: bigint };
  };
  assert(
    exposure.credential.sequence === 0n && hedge.credential.sequence === 0n,
    `facility already carries credentials (exposure seq ${exposure.credential.sequence}, hedge seq ${hedge.credential.sequence}); rerun against a fresh deployment`,
  );

  const policy = (await read(facilityRegistry.address, registryAbi, "getFacility", [facilityId])) as {
    reserveAmount: bigint;
  };
  const balance = await vaultBalance();
  assert(balance >= policy.reserveAmount + 2n * DRAW, `vault holds ${balance}; two draws of ${DRAW} need more`);
  const gas = await publicClient.getBalance({ address: operator.address });
  assert(gas >= MIN_KEEPER_GAS, `operator holds ${gas} native units; fund it for gas`);
}

async function recordFunding() {
  const deposits = await publicClient.getContractEvents({
    address: covenantVault.address,
    abi: vaultAbi,
    eventName: "Deposited",
    fromBlock: BigInt(covenantVault.block),
  });
  assert(deposits.length > 0, "the vault has never been funded");
  for (const deposit of deposits) {
    const { amount } = deposit.args as { amount: bigint };
    await record("A-1", `deposit ${amount} (facility funding)`, deposit.transactionHash, "0x1");
  }
}

async function submitExposure(start: { number: bigint; hash: Hex; timestamp: bigint }, maturity: bigint) {
  // E-DEC-1: the USD settlement obligation of a EUR-denominated book. The EURC
  // contract is referenced as the denominating asset only (E-EUR-1, E-EUR-2).
  const sourceRecord = {
    mock: true,
    disclaimer: DISCLAIMER,
    portfolio: "Fictional EUR-denominated loan book",
    denomination: manifest.exposureDenomination.currency,
    denominatingAsset: manifest.exposureDenomination.referenceAsset.address,
    settlementObligationUsd: EXPOSURE_OUTSTANDING,
    observedAtBlock: start.number.toString(),
    sequence: "1",
  };
  const credential: ExposureCredential = {
    facilityId,
    exposureCurrency: currencyToBytes3("EUR"),
    settlementCurrency: currencyToBytes3("USD"),
    outstandingValue: assertCanonicalScale(parseSixDecimalAmount(EXPOSURE_OUTSTANDING), "outstandingValue"),
    exposureMaturity: maturity,
    observedAt: start.timestamp,
    validUntil: start.timestamp + BigInt(manifest.facility.policy.credentialMaxAgeSeconds),
    sequence: 1n,
    sourceCommitment: keccak256(toBytes(JSON.stringify(sourceRecord))),
  };
  const signature = await exposureIssuer.signTypedData({
    domain: credentialDomain(CREDENTIAL_CHAIN_ID, credentialRegistry.address),
    types: exposureCredentialTypes,
    primaryType: "ExposureCredential",
    message: credential,
  });
  const digest = hashExposureCredential(CREDENTIAL_CHAIN_ID, credentialRegistry.address, credential);
  assert.equal(
    await read(credentialRegistry.address, credentialsAbi, "hashExposureCredential", [credential]),
    digest,
    "the registry's EIP-712 domain differs from the signing domain",
  );
  evidence.credentials.push({
    kind: "ExposureCredential",
    observedAtBlock: blockReference(start),
    sourceRecord,
    issuer: exposureIssuer.address,
    digest,
    credential,
    signature,
  });
  return transact("A-1", "submit exposure credential seq 1 (1.000000 USD)", credentialRegistry.address, credentialsAbi, "submitExposure", [credential, signature]);
}

async function submitHedge(criterion: Step["criterion"], template: unknown, maturity: bigint) {
  // E-FIX-2: observed at a block the chain has already produced, just before signing.
  const block = await publicClient.getBlock();
  const fixture = observeAt(template, block, maturity);
  const credential = mapProviderFixture(fixture, facilityId);
  const signed = await signHedgeCredential({
    credential,
    chainId: CREDENTIAL_CHAIN_ID,
    verifyingContract: credentialRegistry.address,
    privateKey: hedgeIssuerKey,
  });
  assert(isAddressEqual(signed.issuer, manifest.roles.hedgeIssuer));
  assert.equal(
    await read(credentialRegistry.address, credentialsAbi, "hashHedgeCredential", [credential]),
    signed.digest,
    "the registry's EIP-712 domain differs from the signing domain",
  );
  // E-FIX-3: the generated fixture and signed payload, saved exactly as signed.
  evidence.credentials.push({ kind: "HedgeCredential", observedAtBlock: blockReference(block), fixture, ...signed });
  const { remaining_buy_amount, buy_currency, status } = fixture.trade;
  return transact(
    criterion,
    `submit hedge seq ${credential.sequence} (${remaining_buy_amount} ${buy_currency}, ${status})`,
    credentialRegistry.address,
    credentialsAbi,
    "submitHedge",
    [credential, signed.signature],
  );
}

async function transact(
  criterion: Step["criterion"],
  action: string,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
) {
  const hash = await keeper.writeContract({ address, abi, functionName, args } as never);
  await publicClient.waitForTransactionReceipt({ hash });
  return record(criterion, action, hash, "0x1");
}

/** The identical call every time: same sender, same calldata, same amount. */
async function draw(criterion: Step["criterion"], expected: Status) {
  // Uncached: a block number from before syncCovenant would predict against COMPLIANT state.
  const predicted =
    expected === "0x0"
      ? await refusalAt(await publicClient.getBlockNumber({ cacheTime: 0 }))
      : undefined;
  const hash = await keeper.sendTransaction({
    to: covenantVault.address,
    data: drawCalldata,
    // The refusal is broadcast deliberately; estimation would stop it client-side and leave no receipt.
    ...(expected === "0x0" ? { gas: REFUSAL_GAS_LIMIT } : {}),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const transaction = await publicClient.getTransaction({ hash });
  assert.equal(transaction.input, drawCalldata, "every draw must be the identical call");

  const step = await record(criterion, `draw ${DRAW}`, hash, expected);
  const blockNumber = BigInt(step.blockNumber);
  const [balanceBefore, balanceAfter, principalBefore, principalAfter] = await Promise.all([
    vaultBalance(blockNumber - 1n),
    vaultBalance(blockNumber),
    read(covenantVault.address, vaultAbi, "principal", [], blockNumber - 1n) as Promise<bigint>,
    read(covenantVault.address, vaultAbi, "principal", [], blockNumber) as Promise<bigint>,
  ]);
  const [allowed, reason] = (await read(
    coverageEngine.address,
    engineAbi,
    "assess",
    [facilityId, DRAW],
    blockNumber - 1n,
    covenantVault.address,
  )) as [boolean, number];
  step.calldata = drawCalldata;
  step.gate = { allowed, reason: REASONS[reason] ?? String(reason), pinnedBlock: (blockNumber - 1n).toString() };
  step.vault = {
    balanceBefore: balanceBefore.toString(),
    balanceAfter: balanceAfter.toString(),
    principalBefore: principalBefore.toString(),
    principalAfter: principalAfter.toString(),
  };

  if (expected === "0x1") {
    assert.equal(allowed, true, "the gate refused a draw the vault released");
    assert.equal(balanceBefore - balanceAfter, DRAW, "the draw must move USDC out of the vault");
    assert.equal(principalAfter - principalBefore, DRAW);
    assert(step.events.some(({ event }) => event === "Drawn"), "no Drawn event");
    return step;
  }

  // A transport error, an unrelated revert or an out-of-gas is not acceptance evidence.
  assert(BigInt(step.gasUsed) < REFUSAL_GAS_LIMIT, "the refusal exhausted its gas limit");
  assert.equal(allowed, false, "the gate permitted the draw the vault refused");
  assert.equal(balanceAfter, balanceBefore, "a refused draw must not move USDC");
  assert.equal(principalAfter, principalBefore, "a refused draw must not change principal");
  // Arc's RPC does not serve debug_traceTransaction, so the revert data comes
  // from replaying the identical call against the state on either side of it.
  const replays = [await refusalAt(blockNumber - 1n), await refusalAt(blockNumber)];
  for (const refusal of [predicted, ...replays]) {
    assert.equal(refusal?.error, "DrawNotAllowed");
    assert.equal(refusal?.state, "CURE");
  }
  step.refusal = { predictedBeforeBroadcast: predicted, stateReplays: replays, gasLimit: REFUSAL_GAS_LIMIT.toString() };
  return step;
}

async function refusalAt(blockNumber: bigint) {
  try {
    await publicClient.simulateContract({
      account: operator.address,
      address: covenantVault.address,
      abi: vaultAbi,
      functionName: "draw",
      args: [DRAW],
      blockNumber,
    } as never);
  } catch (error) {
    const reverted =
      error instanceof BaseError
        ? error.walk((cause) => cause instanceof ContractFunctionRevertedError)
        : null;
    if (reverted instanceof ContractFunctionRevertedError && reverted.data && reverted.raw) {
      return {
        blockNumber: blockNumber.toString(),
        error: reverted.data.errorName,
        state: STATES[Number(reverted.data.args?.[0])] ?? String(reverted.data.args?.[0]),
        revertData: reverted.raw,
      };
    }
    throw error;
  }
  throw new Error(`draw(${DRAW}) succeeds at block ${blockNumber}; there is no refusal to evidence`);
}

async function record(criterion: Step["criterion"], action: string, hash: Hex, expected: Status) {
  const receipt = await publicClient.request({ method: "eth_getTransactionReceipt", params: [hash] });
  assert(receipt, `no receipt for ${hash}`);
  const blockNumber = BigInt(receipt.blockNumber);
  const covenant = await covenantAt(blockNumber);
  const events = parseEventLogs({ abi: eventAbi, logs: receipt.logs.map(normalizeLog) }).map((log) => ({
    contract: log.address,
    event: log.eventName,
    args: log.args,
  }));
  const step: Step = {
    criterion,
    action,
    transactionHash: hash,
    explorer: `${manifest.explorer}/tx/${hash}`,
    blockNumber: blockNumber.toString(),
    sender: receipt.from,
    expectedStatus: expected,
    actualStatus: receipt.status,
    gasUsed: BigInt(receipt.gasUsed).toString(),
    coverageBps: covenant.coverageBps,
    reasonCode: covenant.reason,
    covenantState: covenant.state,
    events,
  };
  evidence.steps.push(step);
  process.stdout.write(
    `${criterion} ${action}: ${receipt.status} (expected ${expected}), ${covenant.coverageBps} bps ${covenant.reason}, ${covenant.state}  ${step.explorer}\n`,
  );
  assert.equal(receipt.status, expected, `${criterion} ${action}: expected status ${expected}, got ${receipt.status} (${step.explorer})`);
  return step;
}

function expectCoverage(step: Step, coverageBps: number, state: (typeof STATES)[number]) {
  assert.equal(step.coverageBps, coverageBps, `${step.criterion} ${step.action}: coverage`);
  assert.equal(step.covenantState, state, `${step.criterion} ${step.action}: covenant state`);
}

async function covenantAt(blockNumber: bigint) {
  const result = (await read(coverageEngine.address, engineAbi, "evaluate", [facilityId], blockNumber)) as CoverageResult;
  const state = Number(await read(covenantVault.address, vaultAbi, "covenantState", [], blockNumber));
  return {
    coverageBps: Number(result.coverageBps),
    reason: REASONS[result.resultReason] ?? String(result.resultReason),
    state: STATES[state] ?? String(state),
  };
}

async function vaultBalance(blockNumber?: bigint): Promise<bigint> {
  return (await read(manifest.settlementAsset.address, usdcAbi, "balanceOf", [covenantVault.address], blockNumber)) as bigint;
}

async function read(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint,
  account?: Address,
): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await publicClient.readContract({ address, abi, functionName, args, blockNumber, account } as never);
    } catch (error) {
      const reverted = error instanceof BaseError && error.walk((cause) => cause instanceof ContractFunctionRevertedError);
      if (reverted || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
}

function normalizeLog(log: { address: Address; topics: Hex[]; data: Hex; blockNumber: Hex | null; transactionHash: Hex | null; logIndex: Hex | null }) {
  return {
    ...log,
    topics: log.topics as [Hex, ...Hex[]],
    blockNumber: log.blockNumber === null ? null : BigInt(log.blockNumber),
    logIndex: log.logIndex === null ? null : Number(log.logIndex),
    blockHash: null,
    transactionIndex: null,
    removed: false,
  };
}

function blockReference(block: { number: bigint; hash: Hex; timestamp: bigint }) {
  return { number: block.number.toString(), hash: block.hash, timestamp: block.timestamp.toString() };
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
    scenarioDirty: git("status", "--porcelain", "--", SCENARIO_PATH) !== "",
  };
}

async function writeEvidence() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const json = `${JSON.stringify(evidence, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`;
  await writeFile(join(EVIDENCE_DIR, "arc-facility-evidence.json"), json, "utf8");
  await writeFile(join(EVIDENCE_DIR, "arc-facility-evidence.md"), markdown(), "utf8");
  process.stdout.write(`Evidence (${evidence.outcome}): ${join(EVIDENCE_DIR, "arc-facility-evidence.json")}\n`);
}

function markdown(): string {
  const refused = evidence.steps.find((step) => step.refusal);
  const refusal = refused?.refusal as
    | { stateReplays: { blockNumber: string; revertData: Hex }[]; gasLimit: string }
    | undefined;
  return [
    `# ${evidence.title}`,
    "",
    evidence.rehearsal ? `**Rehearsal against ${rpcUrl}. Not public evidence.**` : `Chain ${arcTestnet.id}, explorer ${manifest.explorer}.`,
    "",
    `Outcome: **${evidence.outcome}**. ${DISCLAIMER} ${MOCK_PROVIDER_DISCLAIMER}`,
    "",
    `Deployed source \`${manifest.sourceCommit}\`; scenario \`${repository.head}\`${repository.scenarioDirty ? " (uncommitted changes)" : ""}. Every draw sends the identical calldata \`${drawCalldata}\` from the operator \`${operator.address}\`.`,
    "",
    "| Criterion | Action | Transaction | Expected | Actual | Coverage (bps) | Reason | Covenant state |",
    "|---|---|---|---|---|---|---|---|",
    ...evidence.steps.map(
      (step) =>
        `| ${step.criterion} | ${step.action} | [${step.transactionHash.slice(0, 10)}…](${step.explorer}) | ${step.expectedStatus} | ${step.actualStatus} | ${step.coverageBps} | ${step.reasonCode} | ${step.covenantState} |`,
    ),
    "",
    refused && refusal
      ? `The A-3 draw [${refused.transactionHash}](${refused.explorer}) failed with status ${refused.actualStatus}, using ${refused.gasUsed} of its ${refusal.gasLimit} gas limit. Replaying the identical call at blocks ${refusal.stateReplays.map((replay) => replay.blockNumber).join(" and ")} returns \`${refusal.stateReplays[0]?.revertData}\`, which decodes to \`DrawNotAllowed(CURE)\`. The gate's own verdict for that state was \`allowed = ${refused.gate?.allowed}\`, reason \`${refused.gate?.reason}\`.`
      : "No refusal was recorded.",
    "",
  ].join("\n");
}

async function loadAbi(relativePath: string): Promise<Abi> {
  const artifact = JSON.parse(await readFile(join(REPO_ROOT, "contracts", "out", relativePath), "utf8")) as {
    abi: Abi;
  };
  return artifact.abi;
}

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(join(REPO_ROOT, "packages", "provider-adapter", "fixtures", `arc-forward-${name}.json`), "utf8"),
  ) as unknown;
}
