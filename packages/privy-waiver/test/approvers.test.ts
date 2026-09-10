import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createApprover,
  readApprover,
  readQuorumRecord,
  writeQuorumRecord,
} from "../src/approvers.ts";
import { publicKeyOf } from "../src/authorization.ts";

test("an approver key is written once, readable only by its owner, and never overwritten", () => {
  const directory = mkdtempSync(join(tmpdir(), "signa-approvers-"));
  const first = createApprover(directory, "risk-officer");
  assert.equal(first.label, "Risk officer");
  assert.equal(publicKeyOf(first.privateKey), first.publicKey);
  assert.equal(statSync(join(directory, "risk-officer.json")).mode & 0o777, 0o600);
  assert.equal(statSync(directory).mode & 0o777, 0o700);

  assert.throws(() => createApprover(directory, "risk-officer"), /EEXIST/);
  assert.deepEqual(readApprover(directory, "risk-officer"), first, "the original key survives");
  assert.equal(readApprover(directory, "treasury-lead"), undefined);
});

test("the quorum record cannot be repointed at another quorum or wallet", () => {
  const directory = mkdtempSync(join(tmpdir(), "signa-approvers-"));
  const createdAt = "2026-09-10T00:00:00.000Z";
  writeQuorumRecord(directory, { keyQuorumId: "quorum-1", createdAt });
  assert.throws(() => writeQuorumRecord(directory, { keyQuorumId: "quorum-2", createdAt }), /already records key quorum/);

  const complete = { keyQuorumId: "quorum-1", walletId: "wallet-1", walletAddress: "0x0000000000000000000000000000000000000001" as const, createdAt };
  writeQuorumRecord(directory, complete);
  assert.deepEqual(readQuorumRecord(directory), complete);
  assert.throws(() => writeQuorumRecord(directory, { ...complete, walletId: "wallet-2" }), /already records wallet/);
  assert.equal(statSync(join(directory, "quorum.json")).mode & 0o777, 0o600);
});
