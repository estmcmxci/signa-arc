import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  credentialDomain,
  currencyToBytes3,
  exposureCredentialTypes,
  type ExposureCredential,
} from "@fx-coverage/credentials";
import {
  mapProviderFixture,
  MOCK_PROVIDER_DISCLAIMER,
  signHedgeCredential,
} from "@fx-coverage/provider-adapter";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  padHex,
  toBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
const EXPECTED_CHAIN_ID = 31_337;
const START_TIMESTAMP = 1_800_000_000n;
const UNIT = 1_000_000n;
const FACILITY_ID = keccak256(toBytes("fictional-coffee-facility"));
const DISCLAIMER =
  "Fictional Colombian coffee facility. Mock provider data. No real funds or counterparties.";

// Anvil's first two deterministic accounts pay local gas. The issuer-only keys are also
// deterministic local test keys and never belong in a Sepolia or production environment.
const ADMIN_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OPERATOR_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const EXPOSURE_ISSUER_PRIVATE_KEY = padHex(toHex(0xe11en), { size: 32 });
const HEDGE_ISSUER_PRIVATE_KEY = padHex(toHex(0xa11cen), { size: 32 });

type Artifact = { abi: Abi; bytecode: { object: Hex } };
type CoverageResult = {
  assessed: boolean;
  compliant: boolean;
  outstandingValue: bigint;
  grossEligible: bigint;
  countedEligible: bigint;
  coverageBps: number;
  requiredCoverageBps: number;
  eligibleHedgeCount: number;
  totalHedgeCount: number;
  exposureReason: number;
  resultReason: number;
};
type EvidenceStep = {
  action: string;
  transactionHash?: Hex;
  blockNumber?: string;
  transactionStatus?: string;
  covenant?: Awaited<ReturnType<typeof covenantSnapshot>>;
};

const chain = defineChain({
  id: EXPECTED_CHAIN_ID,
  name: "Local Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain, transport });
const testClient = createTestClient({ chain, mode: "anvil", transport });

const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
const operator = privateKeyToAccount(OPERATOR_PRIVATE_KEY);
const exposureIssuer = privateKeyToAccount(EXPOSURE_ISSUER_PRIVATE_KEY);
const hedgeIssuer = privateKeyToAccount(HEDGE_ISSUER_PRIVATE_KEY);
const adminWallet = createWalletClient({ account: admin, chain, transport });
const operatorWallet = createWalletClient({ account: operator, chain, transport });

const [
  mockTokenArtifact,
  facilityRegistryArtifact,
  credentialRegistryArtifact,
  coverageEngineArtifact,
  covenantVaultArtifact,
] = await Promise.all([
  loadArtifact("MockUSDC.sol/MockUSDC.json"),
  loadArtifact("FacilityRegistry.sol/FacilityRegistry.json"),
  loadArtifact("CredentialRegistry.sol/CredentialRegistry.json"),
  loadArtifact("CoverageEngine.sol/CoverageEngine.json"),
  loadArtifact("CovenantVault.sol/CovenantVault.json"),
]);

assert.equal(await publicClient.getChainId(), EXPECTED_CHAIN_ID, "wrong local chain");
const firstBlock = await publicClient.getBlock();
assert(
  firstBlock.timestamp >= START_TIMESTAMP,
  `start Anvil with --timestamp ${START_TIMESTAMP}`,
);

const evidence: EvidenceStep[] = [];

const token = await deploy("deploy mock settlement token", mockTokenArtifact);
const facilities = await deploy("deploy facility registry", facilityRegistryArtifact);
await send(adminWallet, facilities, facilityRegistryArtifact, "createFacility", [
  {
    facilityId: FACILITY_ID,
    settlementCurrency: currencyToBytes3("USD"),
    exposureCurrency: currencyToBytes3("COP"),
    minCoverageBps: 8_000,
    credentialMaxAge: 86_400,
    maturityTolerance: 86_400,
    defaultHaircutBps: 0,
    reserveAmount: 1_000_000n * UNIT,
    curePeriod: 172_800,
    maxWaiverDuration: 43_200,
    maxActiveHedges: 8,
    settlementAsset: token,
    admin: admin.address,
    operator: operator.address,
    frozen: false,
  },
]);
await send(adminWallet, facilities, facilityRegistryArtifact, "setExposureIssuer", [
  FACILITY_ID,
  exposureIssuer.address,
  true,
]);
await send(adminWallet, facilities, facilityRegistryArtifact, "setHedgeIssuer", [
  FACILITY_ID,
  hedgeIssuer.address,
  true,
]);
await send(adminWallet, facilities, facilityRegistryArtifact, "freezeFacility", [FACILITY_ID]);

const credentials = await deploy("deploy credential registry", credentialRegistryArtifact, [
  facilities,
]);
const engine = await deploy("deploy coverage engine", coverageEngineArtifact, [
  facilities,
  credentials,
]);
const vault = await deploy("deploy covenant vault", covenantVaultArtifact, [
  FACILITY_ID,
  facilities,
  engine,
]);
await send(adminWallet, token, mockTokenArtifact, "mint", [
  admin.address,
  10_000_000n * UNIT,
]);
await send(adminWallet, token, mockTokenArtifact, "approve", [vault, 10_000_000n * UNIT]);
await send(adminWallet, vault, covenantVaultArtifact, "deposit", [10_000_000n * UNIT]);

const activeFixture = await loadFixture("mock-forward-active.json");
const activeHedge = mapProviderFixture(activeFixture, FACILITY_ID);
const initialExposure = exposureCredential({
  amount: 5_000_000n * UNIT,
  sequence: 1n,
  observedAt: START_TIMESTAMP,
});
await submitExposure(initialExposure);
await submitHedge(activeHedge);

const compliantSync = await send(
  adminWallet,
  vault,
  covenantVaultArtifact,
  "syncCovenant",
);
evidence.push({
  action: "T-01 sync 5.0M exposure against 4.5M hedge",
  ...receiptEvidence(compliantSync),
  covenant: await covenantSnapshot(),
});
assert.equal(evidence.at(-1)?.covenant?.coverageBps, 9_000);
assert.equal(evidence.at(-1)?.covenant?.state, "COMPLIANT");

const firstDraw = await send(operatorWallet, vault, covenantVaultArtifact, "draw", [
  500_000n * UNIT,
]);
evidence.push({
  action: "T-01 compliant draw",
  ...receiptEvidence(firstDraw),
  covenant: await covenantSnapshot(),
});

const growthObservedAt = (await publicClient.getBlock()).timestamp;
await submitExposure(
  exposureCredential({
    amount: 6_000_000n * UNIT,
    sequence: 2n,
    observedAt: growthObservedAt,
  }),
);
const blockedDraw = await sendExpectedRevert(
  operatorWallet,
  vault,
  covenantVaultArtifact,
  "draw",
  [1n],
);
assert.equal(blockedDraw.status, "reverted");
evidence.push({
  action: "T-04 fresh draw blocked after exposure growth",
  ...receiptEvidence(blockedDraw),
  covenant: await covenantSnapshot(),
});

const cureSync = await send(adminWallet, vault, covenantVaultArtifact, "syncCovenant");
evidence.push({
  action: "T-04 permissionless sync opens cure",
  ...receiptEvidence(cureSync),
  covenant: await covenantSnapshot(),
});
assert.equal(evidence.at(-1)?.covenant?.coverageBps, 7_500);
assert.equal(evidence.at(-1)?.covenant?.state, "CURE");

await moveToTimestamp(START_TIMESTAMP + 3_600n);
const refreshedFixture = await loadFixture("mock-forward-refreshed.json");
await submitHedge(mapProviderFixture(refreshedFixture, FACILITY_ID));
const restored = await send(
  adminWallet,
  vault,
  covenantVaultArtifact,
  "restoreCompliance",
);
evidence.push({
  action: "T-13 refreshed hedge restores compliance",
  ...receiptEvidence(restored),
  covenant: await covenantSnapshot(),
});
assert.equal(evidence.at(-1)?.covenant?.coverageBps, 8_333);
assert.equal(evidence.at(-1)?.covenant?.state, "COMPLIANT");

const secondDraw = await send(operatorWallet, vault, covenantVaultArtifact, "draw", [
  100_000n * UNIT,
]);
evidence.push({
  action: "T-13 draw availability restored",
  ...receiptEvidence(secondDraw),
  covenant: await covenantSnapshot(),
});

await moveToTimestamp(START_TIMESTAMP + 7_200n);
const cancelledFixture = await loadFixture("mock-forward-cancelled.json");
await submitHedge(mapProviderFixture(cancelledFixture, FACILITY_ID));
const cancelledSync = await send(
  adminWallet,
  vault,
  covenantVaultArtifact,
  "syncCovenant",
);
evidence.push({
  action: "T-03 cancellation returns facility to cure",
  ...receiptEvidence(cancelledSync),
  covenant: await covenantSnapshot(),
});
const vaultBalanceBeforeBreach = await readBigInt(
  token,
  mockTokenArtifact,
  "balanceOf",
  [vault],
);

const cureDeadline = await readBigInt(vault, covenantVaultArtifact, "cureDeadline");
await moveToTimestamp(cureDeadline + 1n);
const breachSync = await send(adminWallet, vault, covenantVaultArtifact, "syncCovenant");
evidence.push({
  action: "T-14 cure deadline produces breach without liquidation",
  ...receiptEvidence(breachSync),
  covenant: await covenantSnapshot(),
});
assert.equal(evidence.at(-1)?.covenant?.state, "BREACH");
assert.equal(
  await readBigInt(token, mockTokenArtifact, "balanceOf", [vault]),
  vaultBalanceBeforeBreach,
  "breach must not move the reserve or any vault funds",
);

await send(operatorWallet, token, mockTokenArtifact, "approve", [vault, 100_000n * UNIT]);
const repayment = await send(operatorWallet, vault, covenantVaultArtifact, "repay", [
  100_000n * UNIT,
]);
evidence.push({
  action: "T-16 repayment succeeds during breach",
  ...receiptEvidence(repayment),
  covenant: await covenantSnapshot(),
});
assert.equal(evidence.at(-1)?.covenant?.principal, "500000000000");

const output = {
  generatedAt: new Date().toISOString(),
  disclaimer: DISCLAIMER,
  providerDisclaimer: MOCK_PROVIDER_DISCLAIMER,
  network: { name: chain.name, chainId: EXPECTED_CHAIN_ID, rpcUrl: RPC_URL },
  actors: {
    facilityAdmin: admin.address,
    originatorOperator: operator.address,
    exposureIssuer: exposureIssuer.address,
    hedgeIssuer: hedgeIssuer.address,
  },
  facilityId: FACILITY_ID,
  contracts: { token, facilityRegistry: facilities, credentialRegistry: credentials, engine, vault },
  steps: evidence,
};

await mkdir(new URL("./output/", import.meta.url), { recursive: true });
await writeFile(
  new URL("./output/local-coffee-evidence.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

async function deploy(action: string, artifact: Artifact, args: readonly unknown[] = []) {
  const hash = await adminWallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${action} failed`);
  assert(receipt.contractAddress, `${action} did not return a contract address`);
  evidence.push({ action, ...receiptEvidence(receipt) });
  return receipt.contractAddress;
}

async function send(
  wallet: typeof adminWallet,
  address: Address,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[] = [],
) {
  const hash = await wallet.writeContract({
    account: wallet.account,
    chain,
    address,
    abi: artifact.abi,
    functionName,
    args,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${functionName} failed`);
  return receipt;
}

async function sendExpectedRevert(
  wallet: typeof adminWallet,
  address: Address,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[],
) {
  const data = encodeFunctionData({
    abi: artifact.abi,
    functionName,
    args,
  } as never);
  const hash = await wallet.sendTransaction({
    account: wallet.account,
    chain,
    to: address,
    data,
    gas: 1_000_000n,
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

async function submitExposure(credential: ExposureCredential) {
  const signature = await exposureIssuer.signTypedData({
    domain: credentialDomain(EXPECTED_CHAIN_ID, credentials),
    types: exposureCredentialTypes,
    primaryType: "ExposureCredential",
    message: credential,
  });
  return send(adminWallet, credentials, credentialRegistryArtifact, "submitExposure", [
    credential,
    signature,
  ]);
}

async function submitHedge(credential: ReturnType<typeof mapProviderFixture>) {
  const signed = await signHedgeCredential({
    credential,
    chainId: EXPECTED_CHAIN_ID,
    verifyingContract: credentials,
    privateKey: HEDGE_ISSUER_PRIVATE_KEY,
  });
  assert.equal(signed.issuer, hedgeIssuer.address);
  return send(adminWallet, credentials, credentialRegistryArtifact, "submitHedge", [
    credential,
    signed.signature,
  ]);
}

function exposureCredential(args: {
  amount: bigint;
  sequence: bigint;
  observedAt: bigint;
}): ExposureCredential {
  const privateRecord = {
    mock: true,
    facility: "fictional Colombian coffee working-capital portfolio",
    outstandingUsdEquivalent: args.amount.toString(),
    sequence: args.sequence.toString(),
  };
  return {
    facilityId: FACILITY_ID,
    exposureCurrency: currencyToBytes3("COP"),
    settlementCurrency: currencyToBytes3("USD"),
    outstandingValue: args.amount,
    exposureMaturity: args.observedAt + 30n * 86_400n,
    observedAt: args.observedAt,
    validUntil: args.observedAt + 86_400n,
    sequence: args.sequence,
    sourceCommitment: keccak256(toBytes(JSON.stringify(privateRecord))),
  };
}

async function covenantSnapshot() {
  const result = (await read(engine, coverageEngineArtifact, "evaluate", [
    FACILITY_ID,
  ])) as CoverageResult;
  const stateValue = Number(await read(vault, covenantVaultArtifact, "covenantState"));
  const states = ["UNASSESSED", "COMPLIANT", "CURE", "BREACH", "WAIVED"] as const;
  return {
    state: states[stateValue] ?? `UNKNOWN_${stateValue}`,
    assessed: result.assessed,
    compliant: result.compliant,
    outstandingValue: result.outstandingValue.toString(),
    grossEligible: result.grossEligible.toString(),
    countedEligible: result.countedEligible.toString(),
    coverageBps: Number(result.coverageBps),
    requiredCoverageBps: Number(result.requiredCoverageBps),
    principal: (await readBigInt(vault, covenantVaultArtifact, "principal")).toString(),
    cureDeadline: (await readBigInt(vault, covenantVaultArtifact, "cureDeadline")).toString(),
    vaultBalance: (
      await readBigInt(token, mockTokenArtifact, "balanceOf", [vault])
    ).toString(),
  };
}

async function read(
  address: Address,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<unknown> {
  return publicClient.readContract({
    address,
    abi: artifact.abi,
    functionName,
    args,
  } as never);
}

async function readBigInt(
  address: Address,
  artifact: Artifact,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<bigint> {
  const value = await read(address, artifact, functionName, args);
  if (typeof value !== "bigint") {
    throw new Error(`${functionName} did not return a bigint`);
  }
  return value;
}

async function moveToTimestamp(timestamp: bigint) {
  const current = (await publicClient.getBlock()).timestamp;
  if (timestamp <= current) return;
  await testClient.setNextBlockTimestamp({ timestamp });
  await testClient.mine({ blocks: 1 });
}

function receiptEvidence(receipt: {
  transactionHash: Hex;
  blockNumber: bigint;
  status: string;
}) {
  return {
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    transactionStatus: receipt.status,
  };
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
