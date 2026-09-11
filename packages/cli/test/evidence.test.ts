import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EVIDENCE_RECORDS, commonContext, recordBytes, waiverSteps } from "../src/evidence/index.ts";
import { REPO_ROOT, onlyJson, runSigna } from "./helpers.ts";

const original = (source: string) => readFileSync(new URL(source, REPO_ROOT));
const noClient = {
  publicClient: () => {
    throw new Error("evidence show must not create an RPC client");
  },
};

test("each bundled record is a byte-identical copy of the repository's record", () => {
  for (const entry of EVIDENCE_RECORDS) {
    assert.ok(recordBytes(entry.file).equals(original(entry.source)), `${entry.file} drifted from ${entry.source}`);
  }
});

test("evidence show summarises every record as recorded data, with provenance, and reads no chain", async () => {
  const run = await runSigna(["evidence", "show", "--json"], { dependencies: noClient });
  assert.equal(run.exitCode, 0);
  const result = onlyJson(run);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.dataMode, "recorded");
  assert.match(result.notice, /It is not the facility's current state/);
  assert.equal(result.chainId, 5_042_002);
  assert.equal(result.facilityId, "0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2");
  assert.deepEqual(result.records.map((record: { id: string }) => record.id), ["acceptance", "coverage-drop", "waiver", "restore"]);
  for (const record of result.records) {
    const entry = EVIDENCE_RECORDS.find((candidate) => candidate.id === record.id);
    assert.ok(entry);
    const bytes = original(entry.source);
    assert.equal(record.source.path, entry.source);
    assert.equal(record.source.sha256, createHash("sha256").update(bytes).digest("hex"), `${record.id} sha256 is the original file's`);
    assert.equal(record.recordedAt, JSON.parse(bytes.toString("utf8")).generatedAt, `${record.id} keeps its recorded time`);
  }
  const times = result.records.map((record: { recordedAt: string }) => Date.parse(record.recordedAt));
  assert.deepEqual(times, [...times].sort((a: number, b: number) => a - b), "records are in the order they were made");
});

test("the acceptance record shows the permitted, refused, permitted draw exactly as recorded", async () => {
  const { record } = onlyJson(await runSigna(["evidence", "show", "acceptance", "--json"], { dependencies: noClient }));
  const source = JSON.parse(original("scenarios/output/arc-facility-evidence.json").toString("utf8"));
  assert.equal(record.steps.length, source.steps.length);
  record.steps.forEach((step: Record<string, unknown>, index: number) => {
    const recorded = source.steps[index];
    assert.equal(step.transactionHash, recorded.transactionHash);
    assert.equal(step.explorer, recorded.explorer);
    assert.equal(step.expectedStatus, recorded.expectedStatus);
    assert.equal(step.actualStatus, recorded.actualStatus);
  });
  const draws = record.steps.filter((step: { action: string }) => step.action.startsWith("draw"));
  assert.deepEqual(
    draws.map((step: Record<string, unknown>) => [step.label, step.actualStatus, step.coverageBps, step.covenantState]),
    [
      ["A-2", "0x1", 10_000, "COMPLIANT"],
      ["A-3", "0x0", 6_840, "CURE"],
      ["A-4", "0x1", 10_000, "COMPLIANT"],
    ],
  );
  assert.equal(draws[1].transactionHash, "0x5cad2c042e76a9f043eeb5988a733975d9dbf05fcb74cb58b44796581a09399a");
  assert.equal(draws[1].expectedStatus, "0x0", "the refusal was the expected outcome");
});

test("the waiver record shows both quorum approvals and the broadcast, from the record", async () => {
  const { record } = onlyJson(await runSigna(["evidence", "show", "waiver", "--json"], { dependencies: noClient }));
  const source = JSON.parse(original("packages/privy-waiver/evidence/arc-waiver-evidence.json").toString("utf8"));
  assert.deepEqual(record.approvals, source.approvals.map((approval: { role: string; signedAt: string }) => ({ role: approval.role, signedAt: approval.signedAt })));
  assert.deepEqual(record.approvals.map((approval: { role: string }) => approval.role), ["Risk officer", "Treasury lead"]);
  assert.equal(record.steps.length, 7);
  assert.equal(record.steps[4].transactionHash, "0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b");
  assert.equal(record.steps[4].explorer, "https://testnet.arcscan.app/tx/0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b");
  assert.match(record.summary, /receipt 0x1 in block 61473309; covenant CURE to WAIVED/);
});

test("a waiver step carries the broadcast hash only when its trace names it; other steps carry none", () => {
  const source = JSON.parse(original("packages/privy-waiver/evidence/arc-waiver-evidence.json").toString("utf8"));
  const hash = source.broadcast.transactionHash;
  const steps = waiverSteps(source, "https://testnet.arcscan.app");
  assert.deepEqual(
    steps.map((step) => step.transactionHash ?? null),
    [null, null, null, null, hash, hash, null],
    "only the broadcast (5) and its receipt check (6) name the transaction",
  );

  const unrelated = `0x${"ab".repeat(32)}`;
  const synthetic = {
    broadcast: { transactionHash: hash },
    steps: [
      { step: 1, what: "Approved", result: "ok", at: "2026-09-10T00:00:00.000Z", trace: `signed payload ${unrelated}` },
      { step: 2, what: "Mentions it mid-sentence", result: "ok", at: "2026-09-10T00:00:01.000Z", trace: `see ${hash}` },
      { step: 3, what: "Broadcast", result: "ok", at: "2026-09-10T00:00:02.000Z", trace: hash },
    ],
  };
  assert.deepEqual(
    waiverSteps(synthetic, "https://testnet.arcscan.app").map((step) => step.transactionHash ?? null),
    [null, null, hash],
    "a hash in free text is never taken as the transaction",
  );
});

test("the summary's chain and facility label every record only because they agree; a disagreement throws", () => {
  const facility = "0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2";
  const arc = { chainId: 5_042_002, explorer: "https://testnet.arcscan.app" };
  assert.deepEqual(
    commonContext([
      { id: "acceptance", network: arc, facilityId: facility },
      { id: "waiver", network: arc, facilityId: facility.toUpperCase().replace("0X", "0x") },
    ]),
    { chainId: 5_042_002, facilityId: facility },
  );
  assert.throws(
    () => commonContext([{ id: "acceptance", network: arc, facilityId: facility }, { id: "restore", network: arc, facilityId: `0x${"11".repeat(32)}` }]),
    /disagree on chain or facility: acceptance .* vs restore \(chain 5042002, facility 0x1111/,
  );
  assert.throws(
    () => commonContext([{ id: "acceptance", network: arc, facilityId: facility }, { id: "waiver", network: { ...arc, chainId: 1 }, facilityId: facility }]),
    /disagree on chain or facility: .*waiver \(chain 1,/,
  );
});

test("the hedge updates show the state before and after, as recorded", async () => {
  const drop = onlyJson(await runSigna(["evidence", "show", "coverage-drop", "--json"], { dependencies: noClient })).record;
  assert.equal(drop.summary, "before: COMPLIANT at 10000 bps; after block 61472429: CURE at 6840 bps");
  const restore = onlyJson(await runSigna(["evidence", "show", "restore", "--json"], { dependencies: noClient })).record;
  assert.equal(restore.summary, "before: WAIVED at 6840 bps; after block 61480374: COMPLIANT at 10000 bps");
  assert.ok(restore.disclaimers.some((text: string) => /Mock provider data/.test(text)));
});

test("evidence output is deterministic and never labelled live", async () => {
  for (const args of [["evidence", "show"], ["evidence", "show", "waiver"]]) {
    const first = await runSigna([...args, "--json"], { dependencies: noClient });
    const second = await runSigna([...args, "--json"], { dependencies: noClient });
    assert.equal(first.stdout, second.stdout, args.join(" "));
    assert.doesNotMatch(first.stdout, /"dataMode": "live"/);
  }
});

test("an unknown record is refused, not guessed", async () => {
  const run = await runSigna(["evidence", "show", "latest", "--json"], { dependencies: noClient });
  assert.equal(run.exitCode, 1);
  assert.equal(onlyJson(run).code, "VALIDATION_ERROR");
});
