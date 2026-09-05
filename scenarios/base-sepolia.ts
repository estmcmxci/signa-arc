import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  credentialDomain,
  currencyToBytes3,
  exposureCredentialTypes,
  type ExposureCredential,
  type HedgeCredential,
} from "@fx-coverage/credentials";
import {
  mapProviderFixture,
  MOCK_PROVIDER_DISCLAIMER,
  signHedgeCredential,
} from "@fx-coverage/provider-adapter";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { BaseSepoliaManifest } from "../scripts/lib/deployment-manifest.ts";

type Artifact = { abi: Abi };
type CoverageResult = {
  assessed: boolean;
  compliant: boolean;
  outstandingValue: bigint;
  grossEligible: bigint;
  countedEligible: bigint;
  coverageBps: number;
  requiredCoverageBps: number;
};
type Snapshot = {
  state: string;
  assessed: boolean;
  compliant: boolean;
  coverageBps: number;
  requiredCoverageBps: number;
  outstandingValue: string;
  grossEligible: string;
  principal: string;
  cureDeadline: string;
  vaultBalance: string;
};
type ScenarioStep = {
  action: string;
  transactionHash: Hex;
  explorerUrl: string;
  blockNumber: string;
  transactionStatus: string;
  snapshot: Snapshot;
};
type ScenarioEvidence = {
  schemaVersion: 1;
  generatedAt: string;
  disclaimer: string;
  providerDisclaimer: string;
  network: { name: "Base Sepolia"; chainId: 84532; rpcUrl: string };
  sourceCommit: string;
  facilityId: Hex;
  actors: BaseSepoliaManifest["roles"];
  contracts: Record<string, Address>;
  steps: ScenarioStep[];
  pending?: { cureDeadline: string; vaultBalanceBeforeBreach: string };
};

const CHAIN_ID = 84_532;
const UNIT = 1_000_000n;
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const MANIFEST_PATH = resolve(
  process.env.DEPLOYMENT_MANIFEST ?? "deployments/base-sepolia.json",
);
const EVIDENCE_PATH = resolve("deployments/base-sepolia-scenario.json");
const PHASE = process.env.SCENARIO_PHASE ?? "initial";
if (PHASE !== "initial" && PHASE !== "finalize") {
  throw new Error("SCENARIO_PHASE must be initial or finalize");
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as BaseSepoliaManifest;
assert.equal(manifest.chainId, CHAIN_ID, "manifest is not for Base Sepolia");
const chain = defineChain({
  id: CHAIN_ID,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Sepolia Basescan", url: "https://sepolia.basescan.org" },
  },
});
const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain, transport });
assert.equal(await publicClient.getChainId(), CHAIN_ID, "RPC is not Base Sepolia");

const admin = privateKeyToAccount(requiredPrivateKey("ADMIN_PRIVATE_KEY"));
const operator = privateKeyToAccount(requiredPrivateKey("OPERATOR_PRIVATE_KEY"));
const exposureIssuer = privateKeyToAccount(requiredPrivateKey("EXPOSURE_ISSUER_PRIVATE_KEY"));
const hedgeIssuer = privateKeyToAccount(requiredPrivateKey("HEDGE_ISSUER_PRIVATE_KEY"));
assertActor(admin.address, manifest.roles.facilityAdmin, "admin");
assertActor(operator.address, manifest.roles.originatorOperator, "operator");
assertActor(exposureIssuer.address, manifest.roles.exposureIssuer, "exposure issuer");
assertActor(hedgeIssuer.address, manifest.roles.hedgeIssuer, "hedge issuer");

const adminWallet = createWalletClient({ account: admin, chain, transport });
const operatorWallet = createWalletClient({ account: operator, chain, transport });
const facilityId = manifest.facilityId;
const token = manifest.contracts.mockSettlementAsset.address;
const credentials = manifest.contracts.credentialRegistry.address;
const engine = manifest.contracts.coverageEngine.address;
const vault = manifest.contracts.covenantVault.address;

const [tokenArtifact, credentialArtifact, engineArtifact, vaultArtifact] = await Promise.all([
  loadArtifact("MockUSDC.sol/MockUSDC.json"),
  loadArtifact("CredentialRegistry.sol/CredentialRegistry.json"),
  loadArtifact("CoverageEngine.sol/CoverageEngine.json"),
  loadArtifact("CovenantVault.sol/CovenantVault.json"),
]);

if (PHASE === "initial") await runInitialPhase();
else await runFinalPhase();

async function runInitialPhase() {
  const currentExposure = (await read(credentials, credentialArtifact.abi, "currentExposure", [
    facilityId,
  ])) as { digest: Hex };
  if (!/^0x0{64}$/i.test(currentExposure.digest)) {
    throw new Error("The deployment already has an exposure credential; refusing to replay phase one");
  }

  const now = (await publicClient.getBlock()).timestamp;
  const evidence = newEvidence();
  await submitExposure(exposureCredential(5_000_000n * UNIT, 1n, now));
  await submitHedge(await mappedFixture("mock-forward-active.json", now, 1, "4500000.000000"));

  await record(
    evidence,
    "T-01 sync 5.0M exposure against 4.5M hedge",
    await send(adminWallet, vault, vaultArtifact.abi, "syncCovenant"),
  );
  assert.equal(evidence.steps.at(-1)?.snapshot.coverageBps, 9_000);
  assert.equal(evidence.steps.at(-1)?.snapshot.state, "COMPLIANT");
  await record(
    evidence,
    "T-01 compliant draw",
    await send(operatorWallet, vault, vaultArtifact.abi, "draw", [500_000n * UNIT]),
  );

  const growthTime = (await publicClient.getBlock()).timestamp;
  await submitExposure(exposureCredential(6_000_000n * UNIT, 2n, growthTime));
  const failedDraw = await sendExpectedRevert(operatorWallet, vault, vaultArtifact.abi, "draw", [1n]);
  assert.equal(failedDraw.status, "reverted");
  await record(evidence, "T-04 fresh draw blocked after exposure growth", failedDraw);
  await record(
    evidence,
    "T-04 permissionless sync opens cure",
    await send(adminWallet, vault, vaultArtifact.abi, "syncCovenant"),
  );
  assert.equal(evidence.steps.at(-1)?.snapshot.coverageBps, 7_500);
  assert.equal(evidence.steps.at(-1)?.snapshot.state, "CURE");

  const refreshTime = (await publicClient.getBlock()).timestamp;
  await submitHedge(
    await mappedFixture("mock-forward-refreshed.json", refreshTime, 2, "5000000.000000"),
  );
  await record(
    evidence,
    "T-13 refreshed hedge restores compliance",
    await send(adminWallet, vault, vaultArtifact.abi, "restoreCompliance"),
  );
  assert.equal(evidence.steps.at(-1)?.snapshot.coverageBps, 8_333);
  await record(
    evidence,
    "T-13 draw availability restored",
    await send(operatorWallet, vault, vaultArtifact.abi, "draw", [100_000n * UNIT]),
  );

  const cancelTime = (await publicClient.getBlock()).timestamp;
  await submitHedge(
    await mappedFixture("mock-forward-cancelled.json", cancelTime, 3, "0.000000"),
  );
  await record(
    evidence,
    "T-03 cancellation opens the final cure window",
    await send(adminWallet, vault, vaultArtifact.abi, "syncCovenant"),
  );
  const finalSnapshot = evidence.steps.at(-1)!.snapshot;
  assert.equal(finalSnapshot.state, "CURE");
  evidence.pending = {
    cureDeadline: finalSnapshot.cureDeadline,
    vaultBalanceBeforeBreach: finalSnapshot.vaultBalance,
  };
  await saveEvidence(evidence);
  process.stdout.write(
    `Phase one complete. Run SCENARIO_PHASE=finalize after Unix timestamp ${finalSnapshot.cureDeadline}.\n`,
  );
}

async function runFinalPhase() {
  const evidence = JSON.parse(await readFile(EVIDENCE_PATH, "utf8")) as ScenarioEvidence;
  if (!evidence.pending) throw new Error("Evidence file has no pending cure to finalize");
  const now = (await publicClient.getBlock()).timestamp;
  const deadline = BigInt(evidence.pending.cureDeadline);
  if (now <= deadline) {
    throw new Error(`Cure is still active. Finalize after Unix timestamp ${deadline}`);
  }

  const balanceBefore = await readBigInt(token, tokenArtifact.abi, "balanceOf", [vault]);
  assert.equal(balanceBefore.toString(), evidence.pending.vaultBalanceBeforeBreach);
  await record(
    evidence,
    "T-14 cure deadline produces breach without liquidation",
    await send(adminWallet, vault, vaultArtifact.abi, "syncCovenant"),
  );
  assert.equal(evidence.steps.at(-1)?.snapshot.state, "BREACH");
  assert.equal(await readBigInt(token, tokenArtifact.abi, "balanceOf", [vault]), balanceBefore);

  await send(operatorWallet, token, tokenArtifact.abi, "approve", [vault, 100_000n * UNIT]);
  await record(
    evidence,
    "T-16 repayment succeeds during breach",
    await send(operatorWallet, vault, vaultArtifact.abi, "repay", [100_000n * UNIT]),
  );
  assert.equal(evidence.steps.at(-1)?.snapshot.principal, "500000000000");
  delete evidence.pending;
  evidence.generatedAt = new Date().toISOString();
  await saveEvidence(evidence);
  process.stdout.write("Base Sepolia scenario evidence is complete.\n");
}

async function mappedFixture(
  fixtureName: string,
  observedAt: bigint,
  sequence: number,
  amount: string,
): Promise<HedgeCredential> {
  const fixture = (await loadFixture(fixtureName)) as {
    trade: Record<string, unknown>;
  };
  fixture.trade.updated_at = iso(observedAt);
  fixture.trade.credential_valid_until = iso(observedAt + 86_400n);
  fixture.trade.maturity_date = iso(observedAt + 30n * 86_400n);
  fixture.trade.sequence = sequence;
  fixture.trade.remaining_buy_amount = amount;
  return mapProviderFixture(fixture, facilityId);
}

async function submitExposure(credential: ExposureCredential) {
  const signature = await exposureIssuer.signTypedData({
    domain: credentialDomain(CHAIN_ID, credentials),
    types: exposureCredentialTypes,
    primaryType: "ExposureCredential",
    message: credential,
  });
  return send(adminWallet, credentials, credentialArtifact.abi, "submitExposure", [
    credential,
    signature,
  ]);
}

async function submitHedge(credential: HedgeCredential) {
  const signed = await signHedgeCredential({
    credential,
    chainId: CHAIN_ID,
    verifyingContract: credentials,
    privateKey: requiredPrivateKey("HEDGE_ISSUER_PRIVATE_KEY"),
  });
  assert.equal(signed.issuer, hedgeIssuer.address);
  return send(adminWallet, credentials, credentialArtifact.abi, "submitHedge", [
    credential,
    signed.signature,
  ]);
}

function exposureCredential(amount: bigint, sequence: bigint, observedAt: bigint) {
  return {
    facilityId,
    exposureCurrency: currencyToBytes3("COP"),
    settlementCurrency: currencyToBytes3("USD"),
    outstandingValue: amount,
    exposureMaturity: observedAt + 30n * 86_400n,
    observedAt,
    validUntil: observedAt + 86_400n,
    sequence,
    sourceCommitment: keccak256(
      toBytes(
        JSON.stringify({
          mock: true,
          portfolio: "fictional Colombian coffee working capital",
          amount: amount.toString(),
          sequence: sequence.toString(),
        }),
      ),
    ),
  } satisfies ExposureCredential;
}

async function record(
  evidence: ScenarioEvidence,
  action: string,
  receipt: { transactionHash: Hex; blockNumber: bigint; status: string },
) {
  evidence.steps.push({
    action,
    transactionHash: receipt.transactionHash,
    explorerUrl: `${manifest.explorerUrl}/tx/${receipt.transactionHash}`,
    blockNumber: receipt.blockNumber.toString(),
    transactionStatus: receipt.status,
    snapshot: await snapshot(),
  });
}

async function snapshot(): Promise<Snapshot> {
  const coverage = (await read(engine, engineArtifact.abi, "evaluate", [
    facilityId,
  ])) as CoverageResult;
  const state = Number(await read(vault, vaultArtifact.abi, "covenantState"));
  return {
    state: ["UNASSESSED", "COMPLIANT", "CURE", "BREACH", "WAIVED"][state] ?? "UNKNOWN",
    assessed: coverage.assessed,
    compliant: coverage.compliant,
    coverageBps: Number(coverage.coverageBps),
    requiredCoverageBps: Number(coverage.requiredCoverageBps),
    outstandingValue: coverage.outstandingValue.toString(),
    grossEligible: coverage.grossEligible.toString(),
    principal: (await readBigInt(vault, vaultArtifact.abi, "principal")).toString(),
    cureDeadline: (await readBigInt(vault, vaultArtifact.abi, "cureDeadline")).toString(),
    vaultBalance: (await readBigInt(token, tokenArtifact.abi, "balanceOf", [vault])).toString(),
  };
}

async function send(
  wallet: typeof adminWallet,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
) {
  const hash = await wallet.writeContract({
    account: wallet.account,
    chain,
    address,
    abi,
    functionName,
    args,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${functionName} reverted`);
  return receipt;
}

async function sendExpectedRevert(
  wallet: typeof adminWallet,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const hash = await wallet.sendTransaction({
    account: wallet.account,
    chain,
    to: address,
    data,
    gas: 1_000_000n,
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

async function read(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<unknown> {
  return publicClient.readContract({ address, abi, functionName, args } as never);
}

async function readBigInt(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
) {
  const value = await read(address, abi, functionName, args);
  if (typeof value !== "bigint") throw new Error(`${functionName} did not return bigint`);
  return value;
}

function newEvidence(): ScenarioEvidence {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    disclaimer:
      "Fictional Colombian coffee facility on Base Sepolia. Mock data and test token only.",
    providerDisclaimer: MOCK_PROVIDER_DISCLAIMER,
    network: { name: "Base Sepolia", chainId: CHAIN_ID, rpcUrl: RPC_URL },
    sourceCommit: manifest.sourceCommit,
    facilityId,
    actors: manifest.roles,
    contracts: { token, credentialRegistry: credentials, coverageEngine: engine, covenantVault: vault },
    steps: [],
  };
}

async function saveEvidence(evidence: ScenarioEvidence) {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function requiredPrivateKey(name: string): Hex {
  const value = process.env[name];
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte testnet private key`);
  }
  return value as Hex;
}

function assertActor(actual: Address, expected: Address, label: string) {
  assert.equal(getAddress(actual), getAddress(expected), `${label} key does not match manifest`);
}

function iso(timestamp: bigint) {
  return new Date(Number(timestamp) * 1_000).toISOString();
}

async function loadArtifact(relativePath: string): Promise<Artifact> {
  return JSON.parse(
    await readFile(new URL(`../contracts/out/${relativePath}`, import.meta.url), "utf8"),
  ) as Artifact;
}

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(`../packages/provider-adapter/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}
