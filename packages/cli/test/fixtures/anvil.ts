import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { credentialDomain, exposureCredentialTypes, hedgeCredentialTypes } from "@fx-coverage/credentials";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import { REPO_ROOT } from "../helpers.ts";

/**
 * A real deployment on a disposable local Anvil chain, running as chain 5042002 so the CLI's own
 * chain check passes. Everything here uses Anvil's published test accounts, which exist in public
 * documentation and hold nothing. Nothing in this file touches Arc or a user's keystores.
 */

// Anvil's published test accounts: disposable, and never used anywhere but a local chain.
export const KEYS = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  operator: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  exposureIssuer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  hedgeIssuer: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  stranger: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
} as const;

export const USD = "0x555344";
export const EUR = "0x455552";

export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(new URL(`contracts/out/${name}.sol/${name}.json`, REPO_ROOT), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/**
 * A throwaway Foundry keystore in a temporary directory, holding one of Anvil's published keys.
 * `--unsafe-password` appears here, and only here: it is the one non-interactive way to *create*
 * a keystore, the password is invented for this test, and the key is public. The CLI itself never
 * uses it, and never passes a password as an argument.
 */
export function throwawayKeystore(name: string, key: string): { dir: string; passwordFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "signa-test-keystore-"));
  const passwordFile = join(dir, "password.txt");
  writeFileSync(passwordFile, "throwaway-test-password", { mode: 0o600 });
  const created = spawnSync("cast", ["wallet", "import", "--keystore-dir", dir, "--unsafe-password", "throwaway-test-password", name, "--private-key", key], {
    encoding: "utf8",
  });
  if (created.status !== 0) throw new Error(`could not create a test keystore (Foundry must be installed): ${created.stderr || created.stdout}`);
  return { dir, passwordFile };
}

export type AnvilFacility = Awaited<ReturnType<typeof startAnvilFacility>>;

export async function startAnvilFacility(label = "signa-anvil-smoke") {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const facilityId = keccak256(stringToHex(label));
  const tradeId = keccak256(stringToHex(`${label}-EUR-USD-001`));
  let anvil: ChildProcess | undefined;

  anvil = spawn("anvil", ["--port", String(port), "--chain-id", String(arcTestnet.id), "--silent"], { stdio: "ignore" });
  anvil.on("error", (error) => {
    throw new Error(`anvil could not start (Foundry must be installed): ${error.message}`);
  });
  const chain = { ...arcTestnet, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
  for (let attempt = 0; ; attempt++) {
    try {
      await publicClient.getChainId();
      break;
    } catch (error) {
      if (attempt > 50) {
        anvil.kill();
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const wallet = (key: string) => createWalletClient({ account: privateKeyToAccount(key as Hex), chain, transport: http(rpcUrl) });
  const admin = wallet(KEYS.admin);
  const operator = wallet(KEYS.operator);
  const addresses = Object.fromEntries(Object.entries(KEYS).map(([role, key]) => [role, privateKeyToAccount(key as Hex).address])) as Record<keyof typeof KEYS, Address>;

  const mined = async (hash: Hex) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`setup transaction ${hash} reverted`);
    return receipt;
  };
  const deploy = async (name: string, args: readonly unknown[] = []) => {
    const { abi, bytecode } = artifact(name);
    const receipt = await mined(await admin.deployContract({ abi, bytecode, args } as never));
    if (!receipt.contractAddress) throw new Error(`${name} did not deploy`);
    return { address: receipt.contractAddress, abi, deployTx: receipt.transactionHash, block: Number(receipt.blockNumber) };
  };
  const send = async (client: typeof admin, contract: { address: Address; abi: Abi }, functionName: string, args: readonly unknown[]) =>
    mined(await client.writeContract({ address: contract.address, abi: contract.abi, functionName, args } as never));

  const token = await deploy("MockUSDC");
  const registry = await deploy("FacilityRegistry");
  const credentials = await deploy("CredentialRegistry", [registry.address]);
  const engine = await deploy("CoverageEngine", [registry.address, credentials.address]);
  const policy = {
    facilityId,
    settlementCurrency: USD,
    exposureCurrency: EUR,
    minCoverageBps: 10_000,
    credentialMaxAge: 86_400,
    maturityTolerance: 604_800,
    defaultHaircutBps: 500,
    reserveAmount: 500_000n,
    curePeriod: 432_000,
    maxWaiverDuration: 259_200,
    maxActiveHedges: 8,
    settlementAsset: token.address,
    admin: addresses.admin,
    operator: addresses.operator,
    frozen: false,
  };
  await send(admin, registry, "createFacility", [policy]);
  await send(admin, registry, "setExposureIssuer", [facilityId, addresses.exposureIssuer, true]);
  await send(admin, registry, "setHedgeIssuer", [facilityId, addresses.hedgeIssuer, true]);
  await send(admin, registry, "freezeFacility", [facilityId]);
  const vault = await deploy("CovenantVault", [facilityId, registry.address, engine.address]);
  await send(admin, token, "mint", [addresses.admin, 2_500_000n]);
  await send(admin, token, "approve", [vault.address, 2_500_000n]);
  await send(admin, vault, "deposit", [2_500_000n]);

  const now = (await publicClient.getBlock()).timestamp;
  const maturity = now + 30n * 86_400n;
  const domain = credentialDomain(arcTestnet.id, credentials.address);

  const exposureCredential = (overrides: Partial<Record<string, unknown>> = {}) =>
    ({
      facilityId,
      exposureCurrency: EUR,
      settlementCurrency: USD,
      outstandingValue: 1_000_000n,
      exposureMaturity: maturity,
      observedAt: now,
      validUntil: now + 86_400n,
      sequence: 1n,
      sourceCommitment: keccak256(stringToHex("anvil exposure")),
      ...overrides,
    }) as Record<string, unknown>;
  const hedgeCredential = (sequence: bigint, remainingNotional: bigint, overrides: Partial<Record<string, unknown>> = {}) =>
    ({
      facilityId,
      tradeIdCommitment: tradeId,
      baseCurrency: USD,
      quoteCurrency: EUR,
      remainingNotional,
      maturity,
      status: 0,
      observedAt: now,
      validUntil: now + 86_400n,
      sequence,
      sourceCommitment: keccak256(stringToHex(`anvil hedge ${sequence}`)),
      ...overrides,
    }) as Record<string, unknown>;

  const signExposure = (credential: Record<string, unknown>, key: string = KEYS.exposureIssuer) =>
    wallet(key).signTypedData({ domain, types: exposureCredentialTypes, primaryType: "ExposureCredential", message: credential as never });
  const signHedge = (credential: Record<string, unknown>, key: string = KEYS.hedgeIssuer) =>
    wallet(key).signTypedData({ domain, types: hedgeCredentialTypes, primaryType: "HedgeCredential", message: credential as never });

  const record = (contract: { address: Address; deployTx: Hex; block: number }) => ({ address: contract.address, deployTx: contract.deployTx, block: contract.block });
  const manifestPath = join(mkdtempSync(join(tmpdir(), "signa-anvil-")), "anvil-manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      chainId: arcTestnet.id,
      rpcUrl,
      explorer: "https://testnet.arcscan.app",
      sourceCommit: "0".repeat(40),
      deployedAt: new Date(Number(now) * 1_000).toISOString(),
      contracts: { facilityRegistry: record(registry), credentialRegistry: record(credentials), coverageEngine: record(engine), covenantVault: record(vault) },
      settlementAsset: { address: token.address, decimals: 6, symbol: "mUSD" },
      roles: { facilityAdmin: addresses.admin, operator: addresses.operator, exposureIssuer: addresses.exposureIssuer, hedgeIssuer: addresses.hedgeIssuer },
      facility: {
        id: facilityId,
        policy: {
          minCoverageBps: 10_000,
          defaultHaircutBps: 500,
          credentialMaxAgeSeconds: 86_400,
          maturityToleranceSeconds: 604_800,
          reserveAmount: "500000",
          cureWindowSeconds: 432_000,
          maxWaiverDurationSeconds: 259_200,
          settlementCurrency: "USD",
          exposureCurrency: "EUR",
          maxActiveHedges: 8,
        },
      },
    }),
  );

  return {
    rpcUrl,
    port,
    chain,
    publicClient,
    wallet,
    admin,
    operator,
    addresses,
    facilityId,
    tradeId,
    domain,
    now,
    maturity,
    manifestPath,
    contracts: { token, registry, credentials, engine, vault },
    send,
    exposureCredential,
    hedgeCredential,
    signExposure,
    signHedge,
    /** Injects a real viem client, so commands read and reconcile against this chain. */
    dependencies: {
      publicClient: (url: string) => createPublicClient({ chain: { ...arcTestnet, rpcUrls: { default: { http: [url] } } }, transport: http(url, { retryCount: 0 }) }) as PublicClient,
    },
    stop() {
      anvil?.kill();
    },
  };
}
