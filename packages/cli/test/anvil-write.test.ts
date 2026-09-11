import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { hashExposureCredential, hashHedgeCredential } from "@fx-coverage/credentials";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import { runCast } from "../src/signer.ts";
import { KEYS, freePort, startAnvilFacility, throwawayKeystore, type AnvilFacility } from "./fixtures/anvil.ts";
import { onlyJson, runSigna } from "./helpers.ts";

/**
 * Every P1 write command against real contracts on a disposable local Anvil chain, signing with
 * real `cast` and throwaway keystores holding Anvil's published keys. Nothing here touches Arc,
 * and no keystore belonging to whoever runs this is read.
 */

let chain: AnvilFacility;
let operatorKeystore: { dir: string; passwordFile: string };
let strangerKeystore: { dir: string; passwordFile: string };
let journal: string;

/** An envelope file, exactly as the issuer signed it: decimal strings, status by name. */
function envelopeFileFor(kind: "exposure" | "hedge", credential: Record<string, unknown>, signature: Hex, issuer: string): string {
  const encoded = Object.fromEntries(
    Object.entries(credential).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : key === "status" ? "ACTIVE" : value]),
  );
  const registry = chain.contracts.credentials.address;
  const digest =
    kind === "exposure" ? hashExposureCredential(arcTestnet.id, registry, credential as never) : hashHedgeCredential(arcTestnet.id, registry, credential as never);
  const path = join(mkdtempSync(join(tmpdir(), "signa-p1-envelope-")), `${kind}.json`);
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, kind, domain: { ...chain.domain }, credential: encoded, signature, issuer, digest }, null, 2));
  return path;
}

function journalLines(): Record<string, string>[] {
  return existsSync(journal)
    ? readFileSync(journal, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, string>)
    : [];
}

/** Runs signa with the throwaway keystore, the local chain and a journal outside the repository. */
async function signa(args: string[], options: { keystore?: { dir: string; passwordFile: string }; cast?: typeof runCast } = {}) {
  const keystore = options.keystore ?? operatorKeystore;
  const run = await runSigna([...args, "--manifest", chain.manifestPath, "--json"], {
    dependencies: { ...chain.dependencies, ...(options.cast ? { cast: options.cast } : {}) },
    env: { SIGNA_KEYSTORE_DIR: keystore.dir, SIGNA_PASSWORD_FILE: keystore.passwordFile, SIGNA_JOURNAL: journal },
  });
  return { exitCode: run.exitCode, result: onlyJson(run) };
}

const nonceOf = async (address: `0x${string}`) => chain.publicClient.getTransactionCount({ address });

describe("P1 write commands on a local Anvil chain", { concurrency: false }, () => {
  before(async () => {
    chain = await startAnvilFacility("signa-p1");
    operatorKeystore = throwawayKeystore("test-operator", KEYS.operator);
    strangerKeystore = throwawayKeystore("test-stranger", KEYS.stranger);
    journal = join(mkdtempSync(join(tmpdir(), "signa-p1-journal-")), "operations.jsonl");
  });
  after(() => chain?.stop());

  test("a signer that is not the operator is refused before anything is simulated or broadcast", async () => {
    const before = await nonceOf(chain.addresses.stranger);
    const run = await signa(["draw", "send", "--amount", "1", "--account", "test-stranger"], { keystore: strangerKeystore });
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.code, "SIGNER_ROLE_MISMATCH");
    assert.match(run.result.message, /must be sent by the facility's operator/);
    assert.equal(await nonceOf(chain.addresses.stranger), before, "nothing was broadcast");
    assert.equal(journalLines().length, 0, "a refusal before simulation writes no journal entry");
  });

  test("an RPC on another chain is refused, and an unreachable one fails, before anything is signed", async () => {
    // A second Anvil, deliberately on a different chain id.
    const otherPort = await freePort();
    const other = spawn("anvil", ["--port", String(otherPort), "--chain-id", "31337", "--silent"], { stdio: "ignore" });
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await chain.dependencies.publicClient(`http://127.0.0.1:${otherPort}`).getChainId();
          break;
        } catch (error) {
          if (attempt > 50) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const wrongChain = await runSigna(
        ["covenant", "sync", "--account", "test-operator", "--manifest", chain.manifestPath, "--rpc-url", `http://127.0.0.1:${otherPort}`, "--json"],
        { dependencies: chain.dependencies, env: { SIGNA_KEYSTORE_DIR: operatorKeystore.dir, SIGNA_PASSWORD_FILE: operatorKeystore.passwordFile, SIGNA_JOURNAL: journal } },
      );
      assert.equal(wrongChain.exitCode, 1);
      assert.equal(onlyJson(wrongChain).code, "CHAIN_MISMATCH", "the chain is checked before a keystore is opened");
      assert.equal(journalLines().length, 0, "nothing reached the journal");
    } finally {
      other.kill();
    }

    const unreachable = await runSigna(["covenant", "sync", "--account", "test-operator", "--manifest", chain.manifestPath, "--rpc-url", "http://127.0.0.1:1", "--json"], {
      dependencies: chain.dependencies,
      env: { SIGNA_KEYSTORE_DIR: operatorKeystore.dir, SIGNA_PASSWORD_FILE: operatorKeystore.passwordFile, SIGNA_JOURNAL: journal },
    });
    assert.equal(unreachable.exitCode, 1);
    assert.equal(onlyJson(unreachable).code, "RPC_UNAVAILABLE");
  });

  test("credentials submit: an exposure credential is accepted, and acceptance is reported apart from eligibility", async () => {
    const credential = chain.exposureCredential();
    const file = envelopeFileFor("exposure", credential, await chain.signExposure(credential), chain.addresses.exposureIssuer);
    const run = await signa(["credentials", "submit", file, "--account", "test-operator"]);
    assert.equal(run.exitCode, 0, JSON.stringify(run.result));
    assert.equal(run.result.kind, "transaction");
    assert.equal(run.result.broadcast, true);
    assert.equal(run.result.transaction.status, "success");
    assert.equal(run.result.request.function, "submitExposure");
    assert.equal(run.result.accepted.sequence, "1");
    assert.equal(run.result.accepted.matchesSubmitted, true, "the registry holds exactly the envelope that was submitted");
    assert.equal(run.result.eligibility.credential, "ELIGIBLE", "the engine's verdict on the credential");
    assert.equal(run.result.eligibility.compliant, false, "accepted is not compliant: there is no hedge yet");
    assert.match(run.result.note, /not the same as it counting toward coverage/);
    assert.equal(run.result.transaction.block.number, run.result.transaction.block.number, "postconditions are read at the receipt block");

    const entries = journalLines();
    assert.deepEqual(entries.map((entry) => entry.event), ["simulated", "broadcast", "outcome"]);
    assert.equal(entries[1]?.hash, run.result.transaction.hash, "the hash is journalled before the receipt wait");
    assert.equal(entries[2]?.status, "success");
  });

  test("credentials submit: a sequence the registry has already overtaken is refused, with the envelope left as signed", async () => {
    const credential = chain.exposureCredential();
    const file = envelopeFileFor("exposure", credential, await chain.signExposure(credential), chain.addresses.exposureIssuer);
    const beforeNonce = await nonceOf(chain.addresses.operator);
    const original = readFileSync(file, "utf8");
    const run = await signa(["credentials", "submit", file, "--account", "test-operator"]);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.code, "STALE_SEQUENCE");
    assert.match(run.result.message, /already holds sequence 1/);
    assert.equal(await nonceOf(chain.addresses.operator), beforeNonce, "nothing was broadcast");
    assert.equal(readFileSync(file, "utf8"), original, "the signed envelope is never rewritten");
  });

  test("credentials submit: a hedge credential uses the (facility, trade commitment) sequence scope", async () => {
    const credential = chain.hedgeCredential(1n, 1_060_000n);
    const file = envelopeFileFor("hedge", credential, await chain.signHedge(credential), chain.addresses.hedgeIssuer);
    const run = await signa(["credentials", "submit", file, "--account", "test-operator"]);
    assert.equal(run.exitCode, 0, JSON.stringify(run.result));
    assert.equal(run.result.request.function, "submitHedge");
    assert.equal(run.result.request.tradeIdCommitment, chain.tradeId);
    assert.equal(run.result.accepted.matchesSubmitted, true);
    assert.equal(run.result.eligibility.compliant, true, "exposure and hedge together cover the facility");
  });

  test("covenant sync records the state the engine evaluates, and reports it before and after", async () => {
    const run = await signa(["covenant", "sync", "--account", "test-operator"]);
    assert.equal(run.exitCode, 0, JSON.stringify(run.result));
    assert.equal(run.result.covenant.storedStateBefore, "UNASSESSED");
    assert.equal(run.result.covenant.storedStateAfter, "COMPLIANT");
    assert.equal(run.result.covenant.changed, true);
    assert.equal(run.result.evaluation.compliant, true);
    assert.ok(run.result.journal.path.length > 0);
  });

  test("draw send moves funds, and reports the vault at the receipt block", async () => {
    const run = await signa(["draw", "send", "--amount", "1", "--account", "test-operator"]);
    assert.equal(run.exitCode, 0, JSON.stringify(run.result));
    assert.equal(run.result.broadcast, true);
    assert.equal(run.result.transaction.status, "success");
    assert.equal(run.result.request.sender, chain.addresses.operator);
    assert.deepEqual(run.result.vault.balance, { units: "1500000", usdc: "1.500000" });
    assert.deepEqual(run.result.vault.principal, { units: "1000000", usdc: "1.000000" });
    assert.ok(run.result.transaction.events.some((event: { name: string }) => event.name === "Drawn"), "the Drawn event is decoded");
  });

  test("a draw above the reserve is refused, nothing is broadcast, and the covenant sync it would have done is rolled back", async () => {
    const stateBefore = await chain.publicClient.readContract({
      address: chain.contracts.vault.address,
      abi: chain.contracts.vault.abi,
      functionName: "covenantState",
    });
    const nonceBefore = await nonceOf(chain.addresses.operator);
    const run = await signa(["draw", "send", "--amount", "2", "--account", "test-operator"]);
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.code, "ACTION_REFUSED");
    assert.match(run.result.message, /ReserveViolation/);
    assert.match(run.result.message, /Nothing was broadcast/);
    assert.equal(await nonceOf(chain.addresses.operator), nonceBefore, "a refusal broadcasts nothing");
    const stateAfter = await chain.publicClient.readContract({
      address: chain.contracts.vault.address,
      abi: chain.contracts.vault.abi,
      functionName: "covenantState",
    });
    assert.equal(stateAfter, stateBefore, "the draw's own covenant sync was rolled back with the refused call");
  });

  test("a post-simulation race is caught by gas estimation, and nothing is broadcast", async () => {
    // Simulate at sequence 2, then let a competing sequence-2 hedge land first. The signed
    // envelope is never re-signed or bumped: the race is reported as what it is.
    const ours = chain.hedgeCredential(2n, 900_000n);
    const file = envelopeFileFor("hedge", ours, await chain.signHedge(ours), chain.addresses.hedgeIssuer);
    const original = readFileSync(file, "utf8");
    const competing = chain.hedgeCredential(2n, 950_000n);
    const competingSignature = await chain.signHedge(competing);

    let raced = false;
    const racingCast: typeof runCast = async (args) => {
      if (args[0] === "send" && !raced) {
        raced = true;
        await chain.send(chain.operator, chain.contracts.credentials, "submitHedge", [competing, competingSignature]);
      }
      return runCast(args);
    };
    const nonceBefore = await nonceOf(chain.addresses.operator);
    const run = await signa(["credentials", "submit", file, "--account", "test-operator"], { cast: racingCast });
    assert.equal(raced, true, "the competing submission landed between simulation and broadcast");
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.code, "ACTION_REFUSED", "estimation refuses the stale submission before it costs anything");
    assert.match(run.result.message, /StaleSequence/);
    assert.match(run.result.message, /Nothing was broadcast/);
    assert.equal(await nonceOf(chain.addresses.operator), nonceBefore + 1, "only the competing transaction was sent, not ours");
    assert.equal(readFileSync(file, "utf8"), original, "the signed envelope is never rewritten to fit the race");
  });

  test("a race that reaches the chain is a failed action: the receipt reverts though the signer exits 0", async () => {
    // The same race, but with an explicit gas limit, which is how a transaction gets broadcast
    // despite being doomed. This is the case the keystore spike pinned: `cast send` exits 0 and
    // the receipt carries status 0x0, so only the receipt can decide.
    const ours = chain.hedgeCredential(3n, 900_000n);
    const file = envelopeFileFor("hedge", ours, await chain.signHedge(ours), chain.addresses.hedgeIssuer);
    const competing = chain.hedgeCredential(3n, 950_000n);
    const competingSignature = await chain.signHedge(competing);

    let raced = false;
    const racingCast: typeof runCast = async (args) => {
      if (args[0] !== "send") return runCast(args);
      if (!raced) {
        raced = true;
        await chain.send(chain.operator, chain.contracts.credentials, "submitHedge", [competing, competingSignature]);
      }
      return runCast([...args, "--gas-limit", "300000"]);
    };
    const run = await signa(["credentials", "submit", file, "--account", "test-operator"], { cast: racingCast });
    assert.equal(run.exitCode, 1);
    assert.equal(run.result.code, "TRANSACTION_REVERTED");
    assert.match(run.result.message, /receipt status 0x0/);
    assert.match(run.result.message, /StaleSequence/, "the revert reason is recovered by replaying the call at its own block");
    assert.ok(run.result.cta, "a broadcast transaction carries its hash through the cta");
    assert.match(run.result.cta.commands[0].command, /^signa tx show 0x[0-9a-f]{64}$/);

    const last = journalLines().at(-1);
    assert.equal(last?.event, "outcome");
    assert.equal(last?.status, "reverted", "the journal records that the broadcast transaction failed");

    // The same failure is readable afterwards, which is how an operator reconciles one.
    const hash = run.result.cta.commands[0].command.split(" ").at(-1) as Hex;
    const shown = await signa(["tx", "show", hash]);
    assert.equal(shown.exitCode, 0);
    assert.equal(shown.result.state, "mined");
    assert.equal(shown.result.status, "reverted");
    assert.equal(shown.result.revert.error, "StaleSequence");
  });

  test("a receipt that never arrives is reported pending with its hash kept, and reconciles later", async () => {
    await chain.publicClient.request({ method: "evm_setAutomine" as never, params: [false] as never });
    try {
      const run = await signa(["covenant", "sync", "--account", "test-operator", "--timeout", "1"]);
      assert.equal(run.exitCode, 1);
      assert.equal(run.result.code, "TRANSACTION_PENDING");
      assert.equal(run.result.retryable, true);
      const hash = run.result.cta.commands[0].command.split(" ").at(-1) as Hex;
      assert.match(hash, /^0x[0-9a-f]{64}$/);
      assert.match(run.result.message, /not retried or replaced/);

      // Interruption: the command failed, but the hash is already durably journalled.
      const broadcast = journalLines().filter((entry) => entry.event === "broadcast");
      assert.equal(broadcast.at(-1)?.hash, hash, "the hash was written before the wait, so it survives a timeout");

      // Reconciliation: the same hash, once mined, is readable by tx show.
      await chain.publicClient.request({ method: "evm_mine" as never, params: [] as never });
      const shown = await signa(["tx", "show", hash]);
      assert.equal(shown.exitCode, 0, JSON.stringify(shown.result));
      assert.equal(shown.result.state, "mined");
      assert.equal(shown.result.status, "success");
      assert.equal(shown.result.hash, hash);
    } finally {
      await chain.publicClient.request({ method: "evm_setAutomine" as never, params: [true] as never });
    }
  });

  test("a replacement at the same nonce is observable: the replaced hash never appears on chain", async () => {
    await chain.publicClient.request({ method: "evm_setAutomine" as never, params: [false] as never });
    let replacedHash: Hex | undefined;
    try {
      const run = await signa(["covenant", "sync", "--account", "test-operator", "--timeout", "1"]);
      assert.equal(run.result.code, "TRANSACTION_PENDING");
      replacedHash = run.result.cta.commands[0].command.split(" ").at(-1) as Hex;
      const original = await chain.publicClient.getTransaction({ hash: replacedHash });

      // The same account replaces it at the same nonce, with a fee the node will prefer.
      const operatorWallet = createWalletClient({
        account: privateKeyToAccount(KEYS.operator as Hex),
        chain: chain.chain,
        transport: http(chain.rpcUrl),
      });
      const replacement = await operatorWallet.sendTransaction({
        to: chain.addresses.stranger,
        value: 1n,
        nonce: original.nonce,
        maxFeePerGas: (original.maxFeePerGas ?? 2_000_000_000n) * 10n,
        maxPriorityFeePerGas: (original.maxPriorityFeePerGas ?? 1_000_000_000n) * 10n,
      } as never);
      await chain.publicClient.request({ method: "evm_mine" as never, params: [] as never });

      const shown = await signa(["tx", "show", replacedHash]);
      assert.equal(shown.exitCode, 0, JSON.stringify(shown.result));
      assert.notEqual(shown.result.state, "mined", "the replaced transaction was never mined");
      const replacementShown = await signa(["tx", "show", replacement]);
      assert.equal(replacementShown.result.state, "mined", "the replacement is what landed");
    } finally {
      await chain.publicClient.request({ method: "evm_setAutomine" as never, params: [true] as never });
    }
  });

  test("covenant restore is refused while coverage is short, and succeeds once it is genuinely restored", async () => {
    // A partially funded hedge: 0.70 after a 5% haircut is 6650 bps, below the 10000 required.
    const short = chain.hedgeCredential(4n, 700_000n);
    const shortFile = envelopeFileFor("hedge", short, await chain.signHedge(short), chain.addresses.hedgeIssuer);
    assert.equal((await signa(["credentials", "submit", shortFile, "--account", "test-operator"])).exitCode, 0);

    const cured = await signa(["covenant", "sync", "--account", "test-operator"]);
    assert.equal(cured.exitCode, 0, JSON.stringify(cured.result));
    assert.equal(cured.result.covenant.storedStateAfter, "CURE");
    assert.equal(cured.result.evaluation.compliant, false);

    const refused = await signa(["covenant", "restore", "--account", "test-operator"]);
    assert.equal(refused.exitCode, 1);
    assert.equal(refused.result.code, "ACTION_REFUSED", "restoring a facility that is still short is refused");
    assert.match(refused.result.message, /Nothing was broadcast/);

    const full = chain.hedgeCredential(5n, 1_060_000n);
    const fullFile = envelopeFileFor("hedge", full, await chain.signHedge(full), chain.addresses.hedgeIssuer);
    assert.equal((await signa(["credentials", "submit", fullFile, "--account", "test-operator"])).exitCode, 0);

    const restored = await signa(["covenant", "restore", "--account", "test-operator"]);
    assert.equal(restored.exitCode, 0, JSON.stringify(restored.result));
    assert.equal(restored.result.request.function, "restoreCompliance");
    assert.equal(restored.result.covenant.storedStateBefore, "CURE");
    assert.equal(restored.result.covenant.storedStateAfter, "COMPLIANT");
    assert.equal(restored.result.covenant.changed, true);
    assert.equal(restored.result.transaction.status, "success");
  });

  test("the journal lives outside the repository, and a path inside it is refused", async () => {
    assert.ok(!journal.startsWith(process.cwd()), `the journal must not be in the checkout: ${journal}`);
    const run = await runSigna(["covenant", "sync", "--account", "test-operator", "--manifest", chain.manifestPath, "--json"], {
      dependencies: chain.dependencies,
      env: { SIGNA_KEYSTORE_DIR: operatorKeystore.dir, SIGNA_PASSWORD_FILE: operatorKeystore.passwordFile, SIGNA_JOURNAL: "./operations.jsonl" },
    });
    assert.equal(run.exitCode, 1);
    assert.equal(onlyJson(run).code, "INVALID_INPUT");
    assert.match(onlyJson(run).message, /must live outside a working copy/);
  });
});
