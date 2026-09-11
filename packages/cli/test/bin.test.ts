import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "./helpers.ts";

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url));

function signa(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", BIN, ...args], {
    cwd: fileURLToPath(REPO_ROOT),
    encoding: "utf8",
    env,
    timeout: 60_000,
  });
}

test("the real bin prints exactly one JSON document and exits with the command's code, resolving --manifest against INIT_CWD", () => {
  const { INIT_CWD: _ignored, ...inherited } = process.env;

  const ok = signa(["evidence", "show", "--json"], inherited);
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.dataMode, "recorded");
  assert.equal(report.records.length, 4);

  const invokedFrom = mkdtempSync(join(tmpdir(), "signa-invoked-"));
  const failed = signa(["status", "--manifest", "missing.json", "--json"], { ...inherited, INIT_CWD: invokedFrom });
  assert.equal(failed.status, 1, failed.stderr);
  const error = JSON.parse(failed.stdout);
  assert.equal(error.code, "INVALID_MANIFEST");
  assert.equal(error.message, `cannot read the manifest at ${join(invokedFrom, "missing.json")} (ENOENT)`, "resolved against INIT_CWD, not the repository root");
});
