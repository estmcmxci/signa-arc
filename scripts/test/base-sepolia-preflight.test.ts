import assert from "node:assert/strict";
import test from "node:test";

import type { Address } from "viem";

import {
  evaluateBaseSepoliaPreflight,
  type BaseSepoliaPreflightSnapshot,
} from "../lib/base-sepolia-preflight.ts";

const roles = {
  facilityAdmin: "0x1000000000000000000000000000000000000001",
  originatorOperator: "0x2000000000000000000000000000000000000002",
  exposureIssuer: "0x3000000000000000000000000000000000000003",
  hedgeIssuer: "0x4000000000000000000000000000000000000004",
} as const;

const readySnapshot: BaseSepoliaPreflightSnapshot = {
  rpcUrlValid: true,
  chainId: 84_532,
  latestBlock: 50_000_000n,
  roles,
  repositoryRoot: "/workspace/fx-coverage",
  workingDirectory: "/workspace/fx-coverage",
  repositoryCommit: "a".repeat(40),
  sourceCommit: "a".repeat(40),
  repositoryClean: true,
  deployerAliasPresent: true,
  etherscanApiKeyPresent: true,
  adminBalance: 1n,
  operatorBalance: 1n,
};

test("passes only a complete Base Sepolia deployment preflight", () => {
  const report = evaluateBaseSepoliaPreflight(readySnapshot);
  assert.equal(report.ready, true);
  assert.equal(report.checks.every((check) => check.ok), true);
});

test("reports chain, repository, key, and gas failures without exposing secrets", () => {
  const report = evaluateBaseSepoliaPreflight({
    ...readySnapshot,
    chainId: 31_337,
    latestBlock: 0n,
    repositoryRoot: "/workspace",
    repositoryClean: false,
    sourceCommit: "b".repeat(40),
    deployerAliasPresent: false,
    etherscanApiKeyPresent: false,
    adminBalance: 0n,
    operatorBalance: 0n,
  });
  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter((check) => !check.ok).map((check) => check.id),
    [
      "chain-id",
      "latest-block",
      "standalone-repository",
      "clean-repository",
      "source-commit",
      "deployer-alias",
      "verification-key",
      "admin-gas",
      "operator-gas",
    ],
  );
  assert.equal(report.checks.some((check) => check.detail.includes("secret-value")), false);
});

test("rejects any repeated demo role", () => {
  const report = evaluateBaseSepoliaPreflight({
    ...readySnapshot,
    roles: { ...roles, hedgeIssuer: roles.facilityAdmin as Address },
  });
  assert.equal(report.ready, false);
  assert.match(report.checks.find((check) => check.id === "roles")!.detail, /must be distinct/);
});
