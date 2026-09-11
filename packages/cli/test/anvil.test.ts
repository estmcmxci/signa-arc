import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { hashHedgeCredential } from "@fx-coverage/credentials";
import { arcTestnet } from "viem/chains";

import { freePort, startAnvilFacility } from "./fixtures/anvil.ts";
import { onlyJson, runSigna } from "./helpers.ts";

/**
 * A local Anvil smoke of every live read-only command against the real contracts. The chain,
 * facility and credentials come from the shared fixture, which uses Anvil's published test
 * accounts. Nothing touches Arc, and no command here signs anything.
 */

test("every live read command runs against the real contracts on a local Anvil chain", async () => {
  const chain = await startAnvilFacility();
  try {
    const exposure = chain.exposureCredential();
    await chain.send(chain.operator, chain.contracts.credentials, "submitExposure", [exposure, await chain.signExposure(exposure)]);
    const hedge = chain.hedgeCredential(1n, 1_060_000n);
    await chain.send(chain.operator, chain.contracts.credentials, "submitHedge", [hedge, await chain.signHedge(hedge)]);

    const signa = async (...args: string[]) => {
      const run = await runSigna([...args, "--manifest", chain.manifestPath, "--json"], { dependencies: chain.dependencies });
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
    const partial = chain.hedgeCredential(2n, 720_000n);
    const partialSignature = await chain.signHedge(partial);
    await chain.send(chain.operator, chain.contracts.credentials, "submitHedge", [partial, partialSignature]);
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
        domain: { ...chain.domain },
        credential: {
          ...partial,
          remainingNotional: "720000",
          maturity: String(chain.maturity),
          status: "ACTIVE",
          observedAt: String(chain.now),
          validUntil: String(chain.now + 86_400n),
          sequence: "2",
        },
        signature: partialSignature,
        issuer: chain.addresses.hedgeIssuer,
        digest: hashHedgeCredential(arcTestnet.id, chain.contracts.credentials.address, partial as never),
      }),
    );
    const inspected = await signa("credentials", "inspect", envelopePath);
    assert.equal(inspected.exitCode, 0, JSON.stringify(inspected.result));
    assert.equal(inspected.result.envelope.manifestRole, "hedgeIssuer");

    const closed = await runSigna(["draw", "simulate", "--amount", "1", "--manifest", chain.manifestPath, "--rpc-url", `http://127.0.0.1:${await freePort()}`, "--json"], {
      dependencies: chain.dependencies,
    });
    assert.equal(closed.exitCode, 1);
    assert.equal(onlyJson(closed).code, "RPC_UNAVAILABLE", "an unreachable RPC is a failed inquiry");
  } finally {
    chain.stop();
  }
});
