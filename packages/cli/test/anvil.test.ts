import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { credentialDomain, exposureCredentialTypes, hashHedgeCredential, hedgeCredentialTypes } from "@fx-coverage/credentials";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import { REPO_ROOT, onlyJson, runSigna } from "./helpers.ts";

/**
 * A local Anvil smoke of every live P0 command against the real contracts. It deploys the
 * Foundry build to a disposable Anvil chain running as chain 5042002, sets up a facility with
 * Anvil's well-known test accounts, and submits credentials those accounts sign. Then it runs
 * `signa` with a manifest for that deployment. Nothing touches Arc, and no key but Anvil's
 * published test keys is used.
 */

// Anvil's published test accounts: disposable, and never used anywhere but a local chain.
const KEYS = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  operator: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  exposureIssuer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  hedgeIssuer: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;
const USD = "0x555344";
const EUR = "0x455552";
const FACILITY_ID = keccak256(stringToHex("signa-anvil-smoke"));
const TRADE_ID = keccak256(stringToHex("ANVIL-EUR-USD-001"));

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(new URL(`contracts/out/${name}.sol/${name}.json`, REPO_ROOT), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

test("every live command runs against the real contracts on a local Anvil chain", async () => {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  let anvil: ChildProcess | undefined;
  try {
    anvil = spawn("anvil", ["--port", String(port), "--chain-id", String(arcTestnet.id), "--silent"], { stdio: "ignore" });
    anvil.on("error", (error) => assert.fail(`anvil could not start (Foundry must be installed): ${error.message}`));
    const chain = { ...arcTestnet, rpcUrls: { default: { http: [rpcUrl] } } };
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    for (let attempt = 0; ; attempt++) {
      try {
        assert.equal(await publicClient.getChainId(), arcTestnet.id);
        break;
      } catch (error) {
        if (attempt > 50) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(rpcUrl) });
    const admin = wallet(KEYS.admin);
    const operator = wallet(KEYS.operator);
    const addresses = Object.fromEntries(Object.entries(KEYS).map(([role, key]) => [role, privateKeyToAccount(key).address])) as Record<keyof typeof KEYS, Address>;

    const mined = async (hash: Hex) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success", `transaction ${hash} reverted`);
      return receipt;
    };
    const deploy = async (name: string, args: readonly unknown[] = []) => {
      const { abi, bytecode } = artifact(name);
      const hash = await admin.deployContract({ abi, bytecode, args });
      const receipt = await mined(hash);
      assert.ok(receipt.contractAddress);
      return { address: receipt.contractAddress, abi, deployTx: hash, block: Number(receipt.blockNumber) };
    };
    const send = async (client: typeof admin, contract: { address: Address; abi: Abi }, functionName: string, args: readonly unknown[]) =>
      mined(await client.writeContract({ address: contract.address, abi: contract.abi, functionName, args } as never));

    const token = await deploy("MockUSDC");
    const registry = await deploy("FacilityRegistry");
    const credentials = await deploy("CredentialRegistry", [registry.address]);
    const engine = await deploy("CoverageEngine", [registry.address, credentials.address]);
    const policy = {
      facilityId: FACILITY_ID,
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
    await send(admin, registry, "setExposureIssuer", [FACILITY_ID, addresses.exposureIssuer, true]);
    await send(admin, registry, "setHedgeIssuer", [FACILITY_ID, addresses.hedgeIssuer, true]);
    await send(admin, registry, "freezeFacility", [FACILITY_ID]);
    const vault = await deploy("CovenantVault", [FACILITY_ID, registry.address, engine.address]);
    await send(admin, token, "mint", [addresses.admin, 2_500_000n]);
    await send(admin, token, "approve", [vault.address, 2_500_000n]);
    await send(admin, vault, "deposit", [2_500_000n]);

    const now = (await publicClient.getBlock()).timestamp;
    const domain = credentialDomain(arcTestnet.id, credentials.address);
    const maturity = now + 30n * 86_400n;
    const exposure = {
      facilityId: FACILITY_ID,
      exposureCurrency: EUR,
      settlementCurrency: USD,
      outstandingValue: 1_000_000n,
      exposureMaturity: maturity,
      observedAt: now,
      validUntil: now + 86_400n,
      sequence: 1n,
      sourceCommitment: keccak256(stringToHex("anvil exposure")),
    } as const;
    const hedgeAt = (sequence: bigint, remainingNotional: bigint) =>
      ({
        facilityId: FACILITY_ID,
        tradeIdCommitment: TRADE_ID,
        baseCurrency: USD,
        quoteCurrency: EUR,
        remainingNotional,
        maturity,
        status: 0,
        observedAt: now,
        validUntil: now + 86_400n,
        sequence,
        sourceCommitment: keccak256(stringToHex(`anvil hedge ${sequence}`)),
      }) as const;
    const exposureSignature = await wallet(KEYS.exposureIssuer).signTypedData({ domain, types: exposureCredentialTypes, primaryType: "ExposureCredential", message: exposure });
    await send(operator, credentials, "submitExposure", [exposure, exposureSignature]);
    const hedge = hedgeAt(1n, 1_060_000n);
    const hedgeSignature = await wallet(KEYS.hedgeIssuer).signTypedData({ domain, types: hedgeCredentialTypes, primaryType: "HedgeCredential", message: hedge });
    await send(operator, credentials, "submitHedge", [hedge, hedgeSignature]);

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
          id: FACILITY_ID,
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

    const realClient = { publicClient: (url: string) => createPublicClient({ chain: { ...arcTestnet, rpcUrls: { default: { http: [url] } } }, transport: http(url, { retryCount: 0 }) }) };
    const signa = async (...args: string[]) => {
      const run = await runSigna([...args, "--manifest", manifestPath, "--json"], { dependencies: realClient });
      return { exitCode: run.exitCode, result: onlyJson(run) };
    };

    const status = await signa("status");
    assert.equal(status.exitCode, 0, JSON.stringify(status.result));
    assert.equal(status.result.checks.length, 13);

    const facility = await signa("facility", "show");
    assert.equal(facility.exitCode, 0, JSON.stringify(facility.result));
    assert.equal(facility.result.covenant.storedState, "UNASSESSED", "the vault has never synced");
    assert.deepEqual(facility.result.vault.balance, { units: "2500000", usdc: "2.500000" });
    assert.deepEqual(facility.result.manifestDifferences, []);

    const coverage = await signa("coverage", "show");
    assert.equal(coverage.result.evaluation.compliant, true);
    assert.equal(coverage.result.evaluation.coverageBps, 10_000);
    assert.equal(coverage.result.exposure.eligibility, "ELIGIBLE");
    assert.deepEqual(coverage.result.hedges.map((entry: { eligibility: string }) => entry.eligibility), ["ELIGIBLE"]);

    const listed = await signa("credentials", "list");
    assert.equal(listed.result.exposure.sequence, "1");
    assert.equal(listed.result.hedges[0].sequence, "1");

    const permitted = await signa("draw", "simulate", "--amount", "1");
    assert.equal(permitted.exitCode, 0);
    assert.equal(permitted.result.outcome, "permitted");

    const reserve = await signa("draw", "simulate", "--amount", "2.1");
    assert.equal(reserve.exitCode, 0, "a refusal is a completed inquiry");
    assert.equal(reserve.result.refusal.error, "ReserveViolation");
    assert.deepEqual(reserve.result.refusal.args, { balance: "2.500000", requested: "2.100000", reserve: "0.500000" });

    // A partially funded hedge update: 0.72 after a 5% haircut is 6840 bps of cover.
    const partial = hedgeAt(2n, 720_000n);
    await send(operator, credentials, "submitHedge", [partial, await wallet(KEYS.hedgeIssuer).signTypedData({ domain, types: hedgeCredentialTypes, primaryType: "HedgeCredential", message: partial })]);
    const below = await signa("coverage", "show");
    assert.equal(below.result.evaluation.compliant, false);
    assert.equal(below.result.evaluation.coverageBps, 6_840);
    assert.equal(below.result.evaluation.resultReason, "BELOW_THRESHOLD");

    const cure = await signa("draw", "simulate", "--amount", "1");
    assert.equal(cure.exitCode, 0);
    assert.equal(cure.result.outcome, "refused");
    assert.equal(cure.result.refusal.error, "DrawNotAllowed");
    assert.deepEqual(cure.result.refusal.args, { state: "CURE" }, "the draw's own sync moved the facility to CURE, inside the simulation");

    const after = await signa("facility", "show");
    assert.equal(after.result.covenant.storedState, "UNASSESSED", "no simulation persisted the sync it ran");

    const envelopePath = join(mkdtempSync(join(tmpdir(), "signa-anvil-envelope-")), "hedge.json");
    writeFileSync(
      envelopePath,
      JSON.stringify({
        schemaVersion: 1,
        kind: "hedge",
        domain: { ...domain },
        credential: { ...partial, remainingNotional: "720000", maturity: String(maturity), status: "ACTIVE", observedAt: String(now), validUntil: String(now + 86_400n), sequence: "2" },
        signature: await wallet(KEYS.hedgeIssuer).signTypedData({ domain, types: hedgeCredentialTypes, primaryType: "HedgeCredential", message: partial }),
        issuer: addresses.hedgeIssuer,
        digest: hashHedgeCredential(arcTestnet.id, credentials.address, partial),
      }),
    );
    const inspected = await signa("credentials", "inspect", envelopePath);
    assert.equal(inspected.exitCode, 0, JSON.stringify(inspected.result));
    assert.equal(inspected.result.envelope.manifestRole, "hedgeIssuer");

    const closed = await runSigna(["draw", "simulate", "--amount", "1", "--manifest", manifestPath, "--rpc-url", `http://127.0.0.1:${await freePort()}`, "--json"], { dependencies: realClient });
    assert.equal(closed.exitCode, 1);
    assert.equal(onlyJson(closed).code, "RPC_UNAVAILABLE", "an unreachable RPC is a failed inquiry");
  } finally {
    anvil?.kill();
  }
});
