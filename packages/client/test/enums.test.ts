import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COVENANT_STATES, EXPOSURE_REASONS, HEDGE_REASONS, HEDGE_STATUSES, RESULT_REASONS } from "../src/index.ts";

const source = (file: string) => readFileSync(new URL(`../../../contracts/src/${file}`, import.meta.url), "utf8");

function members(text: string, name: string): string[] {
  const match = new RegExp(`enum ${name}\\s*\\{([^}]*)\\}`).exec(text);
  assert.ok(match, `enum ${name} not found`);
  return (match[1] ?? "")
    .split(",")
    .map((member) => member.replace(/\/\/.*$/gm, "").trim())
    .filter(Boolean);
}

test("enum names are the Solidity declarations, in order", () => {
  assert.deepEqual(members(source("CovenantVault.sol"), "CovenantState"), [...COVENANT_STATES]);
  const engine = source("CoverageEngine.sol");
  assert.deepEqual(members(engine, "ExposureReason"), [...EXPOSURE_REASONS]);
  assert.deepEqual(members(engine, "HedgeReason"), [...HEDGE_REASONS]);
  assert.deepEqual(members(engine, "ResultReason"), [...RESULT_REASONS]);
  assert.deepEqual(members(source("CredentialRegistry.sol"), "HedgeStatus"), [...HEDGE_STATUSES]);
});
