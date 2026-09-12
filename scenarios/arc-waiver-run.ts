import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash, scryptSync } from "node:crypto";
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
  mapProviderFixture,
  MOCK_PROVIDER_DISCLAIMER,
  observeAt,
  parseProviderFixture,
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
  formatEther,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseEventLogs,
  parseTransaction,
  recoverTransactionAddress,
  toBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type TransactionSerializedEIP1559,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import { APPROVER_ROLES, approverKeyDirectory, readApprover, readQuorumRecord } from "../packages/privy-waiver/src/approvers.ts";
import {
  formatAuthorizationPayload,
  intentAuthorizationInput,
  normalizePublicKey,
  signAuthorizationPayload,
  verifyAuthorizationSignature,
} from "../packages/privy-waiver/src/authorization.ts";
import { createArcGateway, loadManifest as loadArcManifest, reasonCommitment } from "../packages/privy-waiver/src/arc.ts";
import { PrivyClient, keyMembers, loadPrivyConfig, signedTransactionOf } from "../packages/privy-waiver/src/privy-client.ts";
import { QuorumAdminService, type ActionView, type FacilityConfig } from "../packages/privy-waiver/src/service.ts";
import { JsonFileStore, defaultStorePath } from "../packages/privy-waiver/src/store.ts";

// One facility, one block range: the covenant permits a draw, loses cover, refuses the identical
// draw, is waived by a 2-of-2 Privy quorum, permits that same draw again while still below policy,
// and returns to CURE when the waiver lapses. A-1 … A-4 proved the covenant loop and
// run-waiver.ts proved the override; neither has ever run as one sequence, which is what a reader
// needs to see that the override is the same facility, not a second staged one.
//
// The facility is deliberately left in CURE: step six is the waiver lapsing, and a reader who
// checks the chain afterwards must not read that ending as a failed run.
//
//   node --import tsx scenarios/arc-waiver-run.ts --check
//   set -a; . ~/signa/.env; set +a
//   node --import tsx scenarios/arc-waiver-run.ts --duration=300 --reason="..." [--refresh-exposure]

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_PATH = "scenarios/arc-waiver-run.ts";
const EVIDENCE_DIR = process.env.ARC_EVIDENCE_DIR ?? join(REPO_ROOT, "scenarios", "output");
const WAIVER_EVIDENCE_DIR = process.env.ARC_WAIVER_EVIDENCE_DIR ?? join(REPO_ROOT, "packages", "privy-waiver", "evidence");
const KEYSTORE_DIR = process.env.ARC_KEYSTORE_DIR ?? join(homedir(), ".foundry", "keystores");
const KEYCHAIN_SERVICE = process.env.ARC_KEYCHAIN_SERVICE ?? "signa-arc-testnet-keystores";
const KEYCHAIN_ACCOUNT = process.env.ARC_KEYCHAIN_ACCOUNT ?? "signa-arc";
const EVIDENCE_NAME = "arc-waiver-run-evidence";

const DRAW = assertCanonicalScale(parseSixDecimalAmount("1.000000"), "draw amount");
// Far above what a refused draw spends, so the refusal can never be an out-of-gas.
const REFUSAL_GAS_LIMIT = 1_000_000n;
// 0.05 USDC in Arc's 18-decimal native view: a dozen transactions at ~$0.004.
const MIN_KEEPER_GAS = 50_000_000_000_000_000n;
const MIN_ADMIN_GAS = 10_000_000_000_000_000n;
// The waiver cannot be revoked, so the run must outlive it: short enough to lapse inside the run.
const DEFAULT_DURATION = 300;
const LAPSE_MARGIN_SECONDS = 5n;
const CREDENTIAL_MARGIN_SECONDS = 1_800n;

const DISCLAIMER =
  "Fictional EUR-denominated loan book. Mock provider and exposure data. Testnet USDC only; no real counterparties.";
const ENDING =
  "The facility is left in CURE on purpose. Step six of this run is the waiver lapsing, and a lapsed waiver returns the vault to the state it was in before the exception. Cover is still below policy because nothing in this run restored it. A reader who checks the chain after the run and finds CURE is seeing the last step succeed, not the run fail.";
const STATES = ["UNASSESSED", "COMPLIANT", "CURE", "BREACH", "WAIVED"] as const;
const REASONS = ["NONE", "MISSING_EXPOSURE", "INVALID_EXPOSURE", "BELOW_THRESHOLD", "RESERVE_VIOLATION"] as const;

const options = new Map(
  process.argv.slice(2).map((arg) => {
    const [key = "", ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")] as const;
  }),
);
const checkOnly = options.has("check");
const refreshExposure = options.has("refresh-exposure");
const durationSeconds = Number(options.get("duration") ?? DEFAULT_DURATION);
const statedReason =
  options.get("reason")?.trim() ||
  "Rehearsal: hedge replacement in progress with the broker; bounded exception while cover is restored.";
assert(Number.isInteger(durationSeconds) && durationSeconds > 0, "--duration must be whole seconds");

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
  facility: { id: Hex; policy: { credentialMaxAgeSeconds: number; maxWaiverDurationSeconds: number; reserveAmount: string } };
};
type Status = "0x1" | "0x0";
type Phase = "W-1" | "W-2" | "W-3" | "W-4" | "W-5" | "W-6" | "W-7";
type Step = {
  criterion: Phase;
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
  note?: string;
};

const manifest = JSON.parse(await readFile(join(REPO_ROOT, "deployments", "arc-testnet.json"), "utf8")) as Manifest;
assert.equal(manifest.chainId, arcTestnet.id, "E-MAN-1: the manifest must be Arc Testnet");
assert(
  durationSeconds <= manifest.facility.policy.maxWaiverDurationSeconds,
  `--duration exceeds the facility's maximum of ${manifest.facility.policy.maxWaiverDurationSeconds} s`,
);

const rpcUrl = process.env.ARC_RPC_URL ?? manifest.rpcUrl;
// Any other RPC (an Anvil fork, say) is a rehearsal and never public evidence.
const rehearsal = rpcUrl !== manifest.rpcUrl;
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain: arcTestnet, transport });
assert.equal(await publicClient.getChainId(), arcTestnet.id, `${rpcUrl} is not Arc Testnet`);

const { facilityRegistry, credentialRegistry, coverageEngine, covenantVault } = manifest.contracts;
const facilityId = manifest.facility.id;
const reserveAmount = BigInt(manifest.facility.policy.reserveAmount);
const [registryAbi, credentialsAbi, engineAbi, vaultAbi] = await Promise.all([
  loadAbi("FacilityRegistry.sol/FacilityRegistry.json"),
  loadAbi("CredentialRegistry.sol/CredentialRegistry.json"),
  loadAbi("CoverageEngine.sol/CoverageEngine.json"),
  loadAbi("CovenantVault.sol/CovenantVault.json"),
]);
const usdcAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);
const eventAbi = [...vaultAbi, ...credentialsAbi, ...usdcAbi] as Abi;

// Keys stay in Foundry's encrypted keystores and are decrypted in memory only. The operator key
// doubles as the keeper (E-ID-2); the issuers sign offchain and hold no gas (E-DEC-3).
const password = keychainPassword();
const operator = privateKeyToAccount(await unlock("signa-arc-operator", password));
const exposureIssuer = privateKeyToAccount(await unlock("signa-arc-exposure-issuer", password));
const hedgeIssuerKey = await unlock("signa-arc-hedge-issuer", password);
const hedgeIssuer = privateKeyToAccount(hedgeIssuerKey).address;
assert(isAddressEqual(operator.address, manifest.roles.operator), "operator key is not the manifest operator");
assert(isAddressEqual(exposureIssuer.address, manifest.roles.exposureIssuer), "exposure issuer mismatch");
assert(isAddressEqual(hedgeIssuer, manifest.roles.hedgeIssuer), "hedge issuer mismatch");
const keeper = createWalletClient({ account: operator, chain: arcTestnet, transport });

const repository = gitState();
const drawCalldata = encodeFunctionData({ abi: vaultAbi, functionName: "draw", args: [DRAW] });

// The quorum side, wired exactly as the approver console wires it. Nothing here reimplements it.
const approverDirectory = approverKeyDirectory(process.env);
const approvers = APPROVER_ROLES.map(({ role }) => {
  const key = readApprover(approverDirectory, role);
  assert(key, `no ${role} key in ${approverDirectory}: run provision-quorum.ts first`);
  return key;
});
const quorum = readQuorumRecord(approverDirectory);
assert(quorum?.walletId && quorum.walletAddress, `no quorum recorded in ${approverDirectory}`);
const facility: FacilityConfig = {
  id: facilityId,
  vault: covenantVault.address,
  registry: facilityRegistry.address,
  coverageEngine: coverageEngine.address,
};
const privy = credentialsPresent() ? new PrivyClient(loadPrivyConfig(process.env)) : null;
const service = privy
  ? new QuorumAdminService(privy, createArcGateway(loadArcManifest()), new JsonFileStore(defaultStorePath(process.env)), {
      walletId: quorum.walletId,
      walletAddress: quorum.walletAddress,
      explorer: manifest.explorer,
      facility,
    })
  : null;

const evidence = {
  title: "Signa Covenant: permitted, refused, waived by a 2-of-2 quorum, permitted, lapsed — one facility, one run",
  rehearsal,
  outcome: "incomplete",
  disclaimer: DISCLAIMER,
  providerDisclaimer: MOCK_PROVIDER_DISCLAIMER,
  generatedAt: new Date().toISOString(),
  network: { chainId: arcTestnet.id, rpcUrl, explorer: manifest.explorer },
  scenario: { path: SCRIPT_PATH, commit: repository.head, dirty: repository.scriptDirty },
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
    facilityAdmin: quorum.walletAddress,
  },
  draw: { amount: DRAW.toString(), calldata: drawCalldata },
  before: undefined as unknown,
  steps: [] as Step[],
  credentials: [] as unknown[],
  waiver: undefined as unknown,
  ending: {
    covenantState: "unrecorded",
    byDesign: true,
    statement: ENDING,
  },
};

const preflight = await inspect();
if (checkOnly) {
  report(preflight);
  process.exit(preflight.blockers.length === 0 ? 0 : 1);
}
assert.equal(preflight.blockers.length, 0, `not ready:\n  - ${preflight.blockers.join("\n  - ")}`);
assert(service && privy, "the quorum service is not configured");
evidence.before = preflight.chain;

try {
  // W-1 — fund the facility so a draw is possible at all, then draw, permitted.
  if (preflight.funding.deposit > 0n) {
    if (preflight.funding.allowance < preflight.funding.deposit) {
      await transact("W-1", `approve ${preflight.funding.deposit} to the vault`, manifest.settlementAsset.address, usdcAbi as Abi, "approve", [covenantVault.address, preflight.funding.deposit]);
    }
    await transact("W-1", `deposit ${preflight.funding.deposit} (facility funding)`, covenantVault.address, vaultAbi, "deposit", [preflight.funding.deposit]);
  }
  await drawStep("W-1", "0x1");

  // W-2 — the hedge is replaced with less cover, and the permissionless sync records CURE.
  await submitHedge("W-2");
  const synced = await transact("W-2", "syncCovenant", covenantVault.address, vaultAbi, "syncCovenant");
  assert.equal(synced.covenantState, "CURE", "the hedge update did not move the covenant to CURE");

  // W-3 — the identical draw, refused on chain, with the receipt to show for it.
  await drawStep("W-3", "0x0");

  // W-4 — the lender's side: two people, one override.
  const waiver = await waive();

  // W-5 — the same call again, permitted under the exception, cover still short of policy.
  await drawStep("W-5", "0x1");

  // W-6 — the exception lapses and the covenant closes over the facility again.
  await lapse(waiver.endsAt);
  const resynced = await transact("W-6", "syncCovenant (after the waiver lapsed)", covenantVault.address, vaultAbi, "syncCovenant");
  assert.equal(resynced.covenantState, "CURE", "the facility did not return to CURE when the waiver lapsed");
  assert.equal(await read(covenantVault.address, vaultAbi, "activeWaiver"), false, "a waiver is still active");

  // W-7 — housekeeping, outside the sequence: a fresh observation of the same obligation, so the
  // desk keeps a readable facility after this run. It restates nothing and moves no state.
  if (refreshExposure) await refreshExposureCredential();

  const ended = await covenantAt();
  evidence.ending = { covenantState: ended.state, byDesign: true, statement: ENDING };
  assert.equal(ended.state, "CURE", "the run must end in CURE");
  evidence.outcome = "complete";
} catch (error) {
  evidence.outcome = `failed: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
} finally {
  await writeEvidence();
}

/** Every read-only check the run depends on, plus a simulation of each call it will send. */
async function inspect() {
  const blockers: string[] = [];
  const note = (ready: boolean, message: string) => {
    if (!ready) blockers.push(message);
    return ready;
  };

  for (const [name, contract] of Object.entries(manifest.contracts)) {
    const code = await publicClient.getCode({ address: contract.address });
    note(Boolean(code && code !== "0x"), `${name} has no code at ${contract.address}`);
  }
  note(
    (await read(covenantVault.address, vaultAbi, "facilityId")) === facilityId,
    "the vault does not serve the manifest's facility",
  );
  note(rehearsal || !repository.scriptDirty, `commit ${SCRIPT_PATH} before a public run, so the evidence names the code that produced it`);

  const chain = await covenantAt();
  note(chain.state === "COMPLIANT", `the facility is ${chain.state}; this run starts from COMPLIANT so its first draw is permitted`);
  note(chain.activeWaiver === false, "a waiver is already active; it cannot be revoked, so wait for it to lapse");

  // A stale exposure would make every evaluation in the run INVALID_EXPOSURE instead of a coverage story.
  const exposure = (await read(credentialRegistry.address, credentialsAbi, "currentExposure", [facilityId])) as {
    credential: { sequence: bigint; observedAt: bigint; validUntil: bigint; outstandingValue: bigint; exposureMaturity: bigint; exposureCurrency: Hex; settlementCurrency: Hex; sourceCommitment: Hex };
  };
  const latestBlock = await publicClient.getBlock();
  const maxAge = BigInt(manifest.facility.policy.credentialMaxAgeSeconds);
  const expiresAt = min(exposure.credential.observedAt + maxAge, exposure.credential.validUntil);
  const runSeconds = BigInt(durationSeconds) + CREDENTIAL_MARGIN_SECONDS;
  note(
    await read(coverageEngine.address, engineAbi, "exposureEligibility", [facilityId]).then((reason) => reason === 0),
    "the exposure credential is not eligible; re-observe it before running",
  );
  note(
    expiresAt > latestBlock.timestamp + runSeconds,
    `the exposure expires at ${iso(expiresAt)}, inside this run plus its margin; re-observe it first`,
  );

  const tradeId = mapProviderFixture(await loadFixture("refreshed"), facilityId).tradeIdCommitment;
  const hedge = (await read(credentialRegistry.address, credentialsAbi, "currentHedge", [facilityId, tradeId])) as {
    credential: { sequence: bigint; maturity: bigint };
  };
  note(hedge.credential.sequence > 0n, "the trade has no hedge credential on this facility yet");

  const balance = await vaultBalance();
  const required = reserveAmount + 2n * DRAW;
  const deposit = balance >= required ? 0n : required - balance;
  const [operatorUsdc, allowance, keeperGas] = await Promise.all([
    read(manifest.settlementAsset.address, usdcAbi as Abi, "balanceOf", [operator.address]) as Promise<bigint>,
    read(manifest.settlementAsset.address, usdcAbi as Abi, "allowance", [operator.address, covenantVault.address]) as Promise<bigint>,
    publicClient.getBalance({ address: operator.address }),
  ]);
  note(operatorUsdc >= deposit, `the operator holds ${operatorUsdc} USDC base units; funding the two draws needs ${deposit}`);
  note(keeperGas >= MIN_KEEPER_GAS, `the operator holds ${formatEther(keeperGas)} USDC of gas; fund it`);

  const adminGas = await publicClient.getBalance({ address: quorum!.walletAddress! });
  note(adminGas >= MIN_ADMIN_GAS, `the admin wallet holds ${formatEther(adminGas)} USDC of gas; fund it at faucet.circle.com`);

  // The quorum side: keys, credentials, and — the collision that matters this round — whether
  // another proposal is already pinning the admin wallet's next nonce.
  let quorumReady = false;
  let openIntent: string | null = null;
  let readiness: unknown = null;
  if (!privy || !service) {
    blockers.push("Privy credentials are not in the environment: set -a; . ~/signa/.env; set +a");
  } else {
    const wallet = await privy.getWallet(quorum!.walletId!).catch((error: unknown) => ({ error: String(error) }));
    if ("error" in wallet) {
      blockers.push(`Privy did not return the admin wallet: ${wallet.error}`);
    } else {
      note(isAddressEqual(getAddress(wallet.address), quorum!.walletAddress!), "the Privy wallet is not the recorded quorum wallet");
      note(isAddressEqual(manifest.roles.facilityAdmin, getAddress(wallet.address)), "the manifest's facility admin is not this wallet");
      const open = (await service.list()).find(
        (action) => action.kind === "waiver.create" && !action.broadcast && ["pending", "granted", "processing", "executed"].includes(action.status),
      );
      openIntent = open?.intentId ?? null;
      note(!open, `waiver intent ${open?.intentId} is already open (${open?.status}); it pins the admin nonce, so finish or reject it first`);
      readiness = await service.waiverReadiness();
      quorumReady = true;
    }
  }

  // Each call this run will send, simulated against the state it will actually meet. The draw that
  // must be refused cannot be simulated yet: the facility is compliant until W-2 runs.
  const simulations: { call: string; ok: boolean; detail?: string }[] = [];
  for (const [call, run] of [
    ["approve", () => publicClient.simulateContract({ account: operator.address, address: manifest.settlementAsset.address, abi: usdcAbi as Abi, functionName: "approve", args: [covenantVault.address, deposit > 0n ? deposit : DRAW] } as never)],
    ["draw", () => publicClient.simulateContract({ account: operator.address, address: covenantVault.address, abi: vaultAbi, functionName: "draw", args: [DRAW] } as never)],
    ["syncCovenant", () => publicClient.simulateContract({ account: operator.address, address: covenantVault.address, abi: vaultAbi, functionName: "syncCovenant" } as never)],
  ] as const) {
    try {
      await run();
      simulations.push({ call, ok: true });
    } catch (error) {
      // The draw only simulates once the vault is funded; that is the deposit's job, not a blocker.
      const detail = error instanceof BaseError ? error.shortMessage : String(error);
      const expected = call === "draw" && deposit > 0n;
      simulations.push({ call, ok: false, detail: expected ? `${detail} (expected before the deposit)` : detail });
      if (!expected) blockers.push(`${call} does not simulate: ${detail}`);
    }
  }

  return {
    blockers,
    chain: { ...chain, block: latestBlock.number.toString(), blockTimestamp: iso(latestBlock.timestamp) },
    exposure: { sequence: exposure.credential.sequence.toString(), observedAt: iso(exposure.credential.observedAt), expiresAt: iso(expiresAt) },
    hedge: { sequence: hedge.credential.sequence.toString(), nextSequence: (hedge.credential.sequence + 1n).toString(), tradeId, maturity: hedge.credential.maturity },
    funding: { vaultBalance: balance, required, deposit, allowance, operatorUsdc },
    gas: { operator: formatEther(keeperGas), admin: formatEther(adminGas) },
    quorum: { ready: quorumReady, directory: approverDirectory, walletId: quorum!.walletId, openIntent, readiness },
    simulations,
    plan: { durationSeconds, statedReason, reasonCommitment: reasonCommitment(statedReason), refreshExposure },
  };
}

function report(result: Awaited<ReturnType<typeof inspect>>) {
  const out = process.stdout;
  out.write(`facility ${facilityId}\nvault    ${covenantVault.address}\nadmin    ${quorum!.walletAddress}\n\n`);
  out.write(`block ${result.chain.block} (${result.chain.blockTimestamp}): ${result.chain.state}, coverage ${result.chain.coverageBps} bps (${result.chain.reason}), waiver active ${result.chain.activeWaiver}\n`);
  out.write(`exposure seq ${result.exposure.sequence}, expires ${result.exposure.expiresAt}\n`);
  out.write(`hedge    seq ${result.hedge.sequence} → this run submits seq ${result.hedge.nextSequence}\n`);
  out.write(`funding  vault ${result.funding.vaultBalance}, needs ${result.funding.required}, deposit ${result.funding.deposit} (allowance ${result.funding.allowance})\n`);
  out.write(`gas      operator ${result.gas.operator} USDC, admin ${result.gas.admin} USDC\n`);
  out.write(`waiver   ${result.plan.durationSeconds} s, commitment ${result.plan.reasonCommitment}\n`);
  out.write(`quorum   ${result.quorum.ready ? "reachable" : "NOT reachable"}, open intent: ${result.quorum.openIntent ?? "none"}\n`);
  for (const simulation of result.simulations) {
    out.write(`  simulate ${simulation.call}: ${simulation.ok ? "ok" : `no — ${simulation.detail}`}\n`);
  }
  out.write(
    result.blockers.length === 0
      ? "\nREADY. Nothing above was sent to Arc.\n"
      : `\nNOT READY:\n  - ${result.blockers.join("\n  - ")}\n`,
  );
}

async function submitHedge(criterion: Phase) {
  // E-FIX-1: strictly above the sequence the registry holds. E-FIX-2: observed at a block the
  // chain has already produced. The trade keeps the maturity it was booked with.
  const sequence = BigInt(preflight.hedge.nextSequence);
  const block = await publicClient.getBlock();
  const observed = observeAt(await loadFixture("refreshed"), block, preflight.hedge.maturity);
  const fixture = parseProviderFixture({
    ...observed,
    trade: { ...observed.trade, sequence: Number(sequence), receipt_reference: `FICTIONAL-ARC-RECEIPT-${sequence.toString().padStart(3, "0")}` },
  });
  const credential = mapProviderFixture(fixture, facilityId);
  const signed = await signHedgeCredential({ credential, chainId: CREDENTIAL_CHAIN_ID, verifyingContract: credentialRegistry.address, privateKey: hedgeIssuerKey });
  assert.equal(
    await read(credentialRegistry.address, credentialsAbi, "hashHedgeCredential", [credential]),
    signed.digest,
    "the registry's EIP-712 domain differs from the signing domain",
  );
  evidence.credentials.push({ kind: "HedgeCredential", observedAtBlock: blockReference(block), fixture, ...signed });
  const { remaining_buy_amount, buy_currency, status } = fixture.trade;
  return transact(
    criterion,
    `submit hedge seq ${sequence} (${remaining_buy_amount} ${buy_currency}, ${status})`,
    credentialRegistry.address,
    credentialsAbi,
    "submitHedge",
    [credential, signed.signature],
  );
}

/** Re-observes the obligation the registry already holds: same value, same maturity, new window. */
async function refreshExposureCredential() {
  const current = (await read(credentialRegistry.address, credentialsAbi, "currentExposure", [facilityId])) as {
    credential: ExposureCredential;
  };
  const block = await publicClient.getBlock();
  const sequence = current.credential.sequence + 1n;
  const sourceRecord = {
    mock: true,
    disclaimer: DISCLAIMER,
    portfolio: "Fictional EUR-denominated loan book",
    denomination: manifest.exposureDenomination.currency,
    denominatingAsset: manifest.exposureDenomination.referenceAsset.address,
    settlementObligationUsd: (Number(current.credential.outstandingValue) / 1e6).toFixed(6),
    observedAtBlock: block.number.toString(),
    sequence: sequence.toString(),
    reObservationOf: current.credential.sequence.toString(),
  };
  const credential: ExposureCredential = {
    ...current.credential,
    observedAt: block.timestamp,
    validUntil: block.timestamp + BigInt(manifest.facility.policy.credentialMaxAgeSeconds),
    sequence,
    sourceCommitment: keccak256(toBytes(JSON.stringify(sourceRecord))),
  };
  assert(credential.exposureMaturity > credential.observedAt, "the exposure has matured; it cannot be re-observed");
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
  evidence.credentials.push({ kind: "ExposureCredential", observedAtBlock: blockReference(block), sourceRecord, issuer: exposureIssuer.address, digest, credential, signature });
  const step = await transact("W-7", `submit exposure seq ${sequence} (re-observed, outside the sequence)`, credentialRegistry.address, credentialsAbi, "submitExposure", [credential, signature]);
  step.note = "Housekeeping, not part of the six steps: the same obligation re-observed so the facility stays readable after the run. It changes no value and moves no state.";
  return step;
}

/** Propose, two approvals, Privy signs, we broadcast. The service is the console's own. */
async function waive() {
  const readiness = await service!.waiverReadiness();
  assert.equal(readiness.refusals.length, 0, `the contract would refuse a waiver now: ${readiness.refusals.join("; ")}`);
  const proposed = await service!.proposeWaiver({ durationSeconds, reason: statedReason });
  const sent = new Map<string, { signature: string; timestamp: number; payloadSha256: string }>();
  let view = proposed;
  for (const approver of approvers) {
    view = await service!.get(proposed.intentId);
    if (view.status !== "pending") break;
    const publicKey = normalizePublicKey(approver.publicKey);
    const member = view.approvals.members.find((candidate) => candidate.publicKey === publicKey);
    assert(member, `${approver.label}'s key is not a member of intent ${proposed.intentId}`);
    if (member.signedAt) continue;
    // A fresh payload per approval: Privy accepts it for 300 seconds, and it binds to this intent.
    const payload = await service!.signingPayloadFor(proposed.intentId);
    const bytes = new TextEncoder().encode(payload.text);
    const signature = signAuthorizationPayload(approver.privateKey, bytes);
    view = await service!.approve(proposed.intentId, { publicKey: approver.publicKey, signature, encoding: "der", timestamp: payload.timestamp });
    sent.set(publicKey, { signature, timestamp: payload.timestamp, payloadSha256: createHash("sha256").update(bytes).digest("hex") });
    process.stdout.write(`W-4 ${approver.label} approved: intent ${view.status}, ${view.approvals.members.filter((m) => m.signedAt).length} of ${view.approvals.threshold}\n`);
  }
  for (let attempt = 0; attempt < 30 && ["pending", "granted", "processing"].includes(view.status); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    view = await service!.get(proposed.intentId);
  }
  assert.equal(view.status, "executed", `intent ${proposed.intentId} is ${view.status}, not executed`);
  const executed = await service!.execute(proposed.intentId);
  const broadcast = executed.broadcast;
  assert(broadcast, "nothing was broadcast");

  // Re-read from Privy and from Arc, not from the service.
  const intent = await privy!.getIntent(proposed.intentId);
  const signedTransaction = signedTransactionOf(intent) as TransactionSerializedEIP1559;
  assert(signedTransaction, "the executed intent carries no signed transaction");
  const decoded = parseTransaction(signedTransaction);
  const recoveredSigner = await recoverTransactionAddress({ serializedTransaction: signedTransaction });
  const step = await record("W-4", `createWaiver(${durationSeconds} s) by the 2-of-2 quorum`, broadcast.hash, "0x1");
  const commitment = reasonCommitment(statedReason);
  const created = step.events.find((event) => event.event === "WaiverCreated")?.args as { facilityId?: Hex; reasonCommitment?: Hex; endsAt?: bigint } | undefined;
  assert(created, "the receipt carries no WaiverCreated");
  assert.equal(String(created.facilityId).toLowerCase(), facilityId.toLowerCase(), "WaiverCreated names another facility");
  assert.equal(String(created.reasonCommitment).toLowerCase(), commitment.toLowerCase(), "WaiverCreated does not commit to the stated reason");
  assert(isAddressEqual(recoveredSigner, quorum!.walletAddress!), "the signed transaction does not recover to the admin wallet");
  assert.equal(step.covenantState, "WAIVED", "the vault is not WAIVED after the waiver");

  const endsAt = (await read(covenantVault.address, vaultAbi, "waiverEndsAt")) as bigint;
  const approvals = keyMembers(intent).map((member) => {
    const approver = approvers.find((candidate) => normalizePublicKey(candidate.publicKey) === member.publicKey);
    const ours = sent.get(member.publicKey);
    return {
      role: approver?.label ?? "not one of our approvers",
      publicKey: member.publicKey,
      signedAt: member.signedAt === null ? null : new Date(member.signedAt < 1e12 ? member.signedAt * 1000 : member.signedAt).toISOString(),
      signedPayloadSha256: ours?.payloadSha256 ?? null,
      signature: ours?.signature ?? null,
      signatureVerifies: ours
        ? verifyAuthorizationSignature(member.publicKey, formatAuthorizationPayload(intentAuthorizationInput(intent, privy!.appId, ours.timestamp)), ours.signature)
        : null,
    };
  });
  evidence.waiver = {
    intentId: proposed.intentId,
    statedReason,
    reasonCommitment: commitment,
    durationSeconds,
    endsAt: iso(endsAt),
    admin: { address: quorum!.walletAddress, privyWalletId: quorum!.walletId, keyQuorumId: quorum!.keyQuorumId, threshold: view.approvals.threshold, policyId: quorum!.policyId ?? null },
    call: { to: proposed.call.to, functionName: proposed.call.functionName, args: proposed.call.args, data: proposed.call.data },
    pinned: { chainId: proposed.call.chainId, nonce: proposed.call.nonce, gasLimit: proposed.call.gasLimit, maxFeePerGasWei: proposed.call.maxFeePerGasWei },
    readiness,
    approvals,
    privySigned: { signedTransaction, recoveredSigner, decodedNonce: decoded.nonce ?? 0, decodedTo: decoded.to, decodedValue: (decoded.value ?? 0n).toString() },
    broadcast: { transactionHash: step.transactionHash, explorer: step.explorer, blockNumber: step.blockNumber, blockTimestamp: step.blockTimestamp, sender: step.sender, expectedStatus: "0x1", actualStatus: step.actualStatus, gasUsed: step.gasUsed },
    assertions: {
      bothApproversSigned: approvals.filter((approval) => approval.signedAt && approval.role !== "not one of our approvers").length === 2,
      everyRecordedSignatureVerifies: approvals.every((approval) => approval.signatureVerifies !== false),
      signedByTheAdminWallet: isAddressEqual(recoveredSigner, quorum!.walletAddress!),
      receiptStatusIs0x1: step.actualStatus === "0x1",
      waiverCreatedNamesThisFacility: true,
      waiverCreatedCommitsToTheStatedReason: true,
      covenantStateReadBackWaived: step.covenantState === "WAIVED",
    },
  };
  return { endsAt, intentId: proposed.intentId };
}

/** Waits out the exception. It cannot be revoked, so the run waits rather than hurrying it. */
async function lapse(endsAt: bigint) {
  process.stdout.write(`W-6 waiting for the waiver to lapse at ${iso(endsAt)}\n`);
  for (;;) {
    const block = await publicClient.getBlock();
    if (block.timestamp > endsAt + LAPSE_MARGIN_SECONDS) return;
    const remaining = Number(endsAt - block.timestamp);
    process.stdout.write(`    ${remaining} s remaining\n`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(remaining, 1), 15) * 1_000));
  }
}

async function transact(criterion: Phase, action: string, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
  const hash = await keeper.writeContract({ address, abi, functionName, args } as never);
  await publicClient.waitForTransactionReceipt({ hash });
  return record(criterion, action, hash, "0x1");
}

/** The identical call every time: same sender, same calldata, same amount. */
async function drawStep(criterion: Phase, expected: Status) {
  // Uncached: a block from before the sync would predict against the previous state.
  const predicted = expected === "0x0" ? await refusalAt(await publicClient.getBlockNumber({ cacheTime: 0 })) : undefined;
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
  const [allowed, reason] = (await read(coverageEngine.address, engineAbi, "assess", [facilityId, DRAW], blockNumber - 1n, covenantVault.address)) as [boolean, number];
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
    if (criterion === "W-5") {
      // The whole point of the step: permitted, and still not compliant.
      const covenant = await covenantAt(blockNumber);
      assert.equal(covenant.state, "WAIVED", "W-5 must draw under the waiver");
      assert.equal(covenant.compliant, false, "W-5 must draw while coverage is below policy");
      assert(covenant.coverageBps < covenant.requiredCoverageBps, "W-5 coverage is not below the minimum");
      step.note = `Permitted under the waiver while coverage was ${covenant.coverageBps} of ${covenant.requiredCoverageBps} bps: the exception releases the draw, it does not restore cover.`;
    }
    return step;
  }

  // A transport error, an unrelated revert or an out-of-gas is not acceptance evidence.
  assert(BigInt(step.gasUsed) < REFUSAL_GAS_LIMIT, "the refusal exhausted its gas limit");
  assert.equal(allowed, false, "the gate permitted the draw the vault refused");
  assert.equal(balanceAfter, balanceBefore, "a refused draw must not move USDC");
  assert.equal(principalAfter, principalBefore, "a refused draw must not change principal");
  // Arc's RPC does not serve debug_traceTransaction, so the revert data comes from replaying the
  // identical call against the state on either side of it.
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
    await publicClient.simulateContract({ account: operator.address, address: covenantVault.address, abi: vaultAbi, functionName: "draw", args: [DRAW], blockNumber } as never);
  } catch (error) {
    const reverted = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null;
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

async function record(criterion: Phase, action: string, hash: Hex, expected: Status) {
  const receipt = await publicClient.request({ method: "eth_getTransactionReceipt", params: [hash] });
  assert(receipt, `no receipt for ${hash}`);
  const blockNumber = BigInt(receipt.blockNumber);
  const [covenant, block] = await Promise.all([covenantAt(blockNumber), publicClient.getBlock({ blockNumber })]);
  const step: Step & { blockTimestamp: string } = {
    criterion,
    action,
    transactionHash: hash,
    explorer: `${manifest.explorer}/tx/${hash}`,
    blockNumber: blockNumber.toString(),
    blockTimestamp: iso(block.timestamp),
    sender: receipt.from,
    expectedStatus: expected,
    actualStatus: receipt.status,
    gasUsed: BigInt(receipt.gasUsed).toString(),
    coverageBps: covenant.coverageBps,
    reasonCode: covenant.reason,
    covenantState: covenant.state,
    events: parseEventLogs({ abi: eventAbi, logs: receipt.logs.map(normalizeLog) }).map((log) => ({ contract: log.address, event: log.eventName, args: log.args })),
  };
  evidence.steps.push(step);
  process.stdout.write(`${criterion} ${action}: ${receipt.status} (expected ${expected}), ${covenant.coverageBps} bps ${covenant.reason}, ${covenant.state}  ${step.explorer}\n`);
  // A-9: the receipt decides, never an exit code.
  assert.equal(receipt.status, expected, `${criterion} ${action}: expected status ${expected}, got ${receipt.status} (${step.explorer})`);
  return step;
}

async function covenantAt(blockNumber?: bigint) {
  const result = (await read(coverageEngine.address, engineAbi, "evaluate", [facilityId], blockNumber)) as {
    compliant: boolean;
    coverageBps: number;
    requiredCoverageBps: number;
    resultReason: number;
  };
  const state = Number(await read(covenantVault.address, vaultAbi, "covenantState", [], blockNumber));
  const activeWaiver = (await read(covenantVault.address, vaultAbi, "activeWaiver", [], blockNumber)) as boolean;
  return {
    readAtBlock: blockNumber?.toString() ?? "latest",
    compliant: result.compliant,
    coverageBps: Number(result.coverageBps),
    requiredCoverageBps: Number(result.requiredCoverageBps),
    reason: REASONS[result.resultReason] ?? String(result.resultReason),
    state: STATES[state] ?? String(state),
    activeWaiver,
  };
}

async function vaultBalance(blockNumber?: bigint): Promise<bigint> {
  return (await read(manifest.settlementAsset.address, usdcAbi as Abi, "balanceOf", [covenantVault.address], blockNumber)) as bigint;
}

async function read(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = [], blockNumber?: bigint, account?: Address): Promise<unknown> {
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

function credentialsPresent(): boolean {
  return Boolean(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET);
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function iso(seconds: bigint): string {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function keychainPassword(): string {
  // One password protects the role keystores. It lives in the macOS Keychain, never in a file, a
  // flag or this process's output.
  return execFileSync("security", ["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w"], { encoding: "utf8" }).replace(/\n$/, "");
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
  const derived = scryptSync(keystorePassword, Buffer.from(salt, "hex"), dklen, { N: n, r, p, maxmem: 256 * n * r * p });
  const ciphertext = Buffer.from(crypto.ciphertext, "hex");
  const mac = keccak256(concat([toHex(derived.subarray(16, 32)), toHex(ciphertext)]));
  if (mac.slice(2) !== crypto.mac.toLowerCase()) throw new Error(`${name} did not unlock with the Keychain password`);
  const decipher = createDecipheriv("aes-128-ctr", derived.subarray(0, 16), Buffer.from(crypto.cipherparams.iv, "hex"));
  return toHex(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

function gitState() {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  return { head: git("rev-parse", "HEAD"), scriptDirty: git("status", "--porcelain", "--", SCRIPT_PATH) !== "" };
}

async function writeEvidence() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await mkdir(WAIVER_EVIDENCE_DIR, { recursive: true });
  const json = (value: unknown) => `${JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`;
  await writeFile(join(EVIDENCE_DIR, `${EVIDENCE_NAME}.json`), json(evidence), "utf8");
  await writeFile(join(EVIDENCE_DIR, `${EVIDENCE_NAME}.md`), markdown(), "utf8");
  if (evidence.waiver) {
    // The waiver record on its own, in the shape the desk and the CLI already read.
    await writeFile(
      join(WAIVER_EVIDENCE_DIR, `${EVIDENCE_NAME}.json`),
      json({
        title: "Signa Covenant: the waiver inside the one-run sequence",
        generatedAt: evidence.generatedAt,
        outcome: evidence.outcome,
        network: evidence.network,
        deployment: evidence.deployment,
        sequence: `${SCRIPT_PATH} — see scenarios/output/${EVIDENCE_NAME}.json for the draws either side of it`,
        ...(evidence.waiver as Record<string, unknown>),
        disclaimer: DISCLAIMER,
      }),
      "utf8",
    );
  }
  process.stdout.write(`\nEvidence (${evidence.outcome}): ${join(EVIDENCE_DIR, `${EVIDENCE_NAME}.json`)}\n`);
  process.stdout.write(`${ENDING}\n`);
}

function markdown(): string {
  const waiver = evidence.waiver as
    | { intentId: string; statedReason: string; reasonCommitment: Hex; durationSeconds: number; endsAt: string; approvals: { role: string; signedAt: string | null }[]; broadcast: { transactionHash: Hex; explorer: string } }
    | undefined;
  const refused = evidence.steps.find((step) => step.refusal);
  const refusal = refused?.refusal as { stateReplays: { blockNumber: string; revertData: Hex }[]; gasLimit: string } | undefined;
  return [
    `# ${evidence.title}`,
    "",
    rehearsal ? `**Rehearsal against ${rpcUrl}. Not public evidence.**` : `Chain ${arcTestnet.id}, explorer ${manifest.explorer}.`,
    "",
    `Outcome: **${evidence.outcome}**. ${DISCLAIMER} ${MOCK_PROVIDER_DISCLAIMER}`,
    "",
    `> **The facility is left in CURE, and that is the last step working.** ${ENDING}`,
    "",
    `Deployed source \`${manifest.sourceCommit}\`; scenario \`${repository.head}\`${repository.scriptDirty ? " (uncommitted changes)" : ""}. Every draw sends the identical calldata \`${drawCalldata}\` from the operator \`${operator.address}\`. The waiver is sent by the 2-of-2 quorum wallet \`${quorum!.walletAddress}\`.`,
    "",
    "| Step | Action | Transaction | Expected | Actual | Coverage (bps) | Reason | Covenant state |",
    "|---|---|---|---|---|---|---|---|",
    ...evidence.steps.map(
      (step) => `| ${step.criterion} | ${step.action} | [${step.transactionHash.slice(0, 10)}…](${step.explorer}) | ${step.expectedStatus} | ${step.actualStatus} | ${step.coverageBps} | ${step.reasonCode} | ${step.covenantState} |`,
    ),
    "",
    refused && refusal
      ? `The refused draw [${refused.transactionHash}](${refused.explorer}) failed with status ${refused.actualStatus}, using ${refused.gasUsed} of its ${refusal.gasLimit} gas limit. Replaying the identical call at blocks ${refusal.stateReplays.map((replay) => replay.blockNumber).join(" and ")} returns \`${refusal.stateReplays[0]?.revertData}\`, which decodes to \`DrawNotAllowed(CURE)\`. The gate's own verdict at that block was \`allowed = ${refused.gate?.allowed}\`, reason \`${refused.gate?.reason}\`.`
      : "No refusal was recorded.",
    "",
    ...(waiver
      ? [
          "## The override took two people",
          "",
          `Privy intent \`${waiver.intentId}\`, ${waiver.durationSeconds} s, ending ${waiver.endsAt}. Stated reason: ${waiver.statedReason} — only its keccak256 \`${waiver.reasonCommitment}\` goes on chain.`,
          "",
          "| Approver | Signed at |",
          "|---|---|",
          ...waiver.approvals.map((approval) => `| ${approval.role} | ${approval.signedAt ?? "not signed"} |`),
          "",
          `Broadcast: [${waiver.broadcast.transactionHash}](${waiver.broadcast.explorer}).`,
          "",
        ]
      : []),
    `Both approver keys sat in one process for this run, which is a rehearsal convenience and not how a quorum is meant to be held.`,
    "",
  ].join("\n");
}

async function loadAbi(relativePath: string): Promise<Abi> {
  const artifact = JSON.parse(await readFile(join(REPO_ROOT, "contracts", "out", relativePath), "utf8")) as { abi: Abi };
  return artifact.abi;
}

async function loadFixture(name: string): Promise<never> {
  return JSON.parse(await readFile(join(REPO_ROOT, "packages", "provider-adapter", "fixtures", `arc-forward-${name}.json`), "utf8")) as never;
}
