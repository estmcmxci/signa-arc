import assert from "node:assert/strict";
import test from "node:test";

import { buildBaseSepoliaManifest, type DeploymentRoles } from "../lib/deployment-manifest.ts";

const roles: DeploymentRoles = {
  facilityAdmin: "0x1000000000000000000000000000000000000001",
  originatorOperator: "0x2000000000000000000000000000000000000002",
  exposureIssuer: "0x3000000000000000000000000000000000000003",
  hedgeIssuer: "0x4000000000000000000000000000000000000004",
};
const names = [
  "MockUSDC",
  "FacilityRegistry",
  "CredentialRegistry",
  "CoverageEngine",
  "CovenantVault",
] as const;
const broadcast = {
  chain: 84_532,
  transactions: names.map((contractName, index) => ({
    hash: `0x${String(index + 1).padStart(64, "0")}`,
    transactionType: "CREATE",
    contractName,
    contractAddress: `0x${String(index + 1).padStart(40, "0")}`,
    transaction: { from: roles.facilityAdmin },
  })),
  receipts: names.map((_contractName, index) => ({
    transactionHash: `0x${String(index + 1).padStart(64, "0")}`,
    blockNumber: `0x${(index + 100).toString(16)}`,
    status: "0x1",
  })),
};

test("builds a complete evidence manifest from a Base Sepolia broadcast", () => {
  const manifest = buildBaseSepoliaManifest({
    broadcast,
    roles,
    sourceCommit: "a".repeat(40),
    facilityId: `0x${"b".repeat(64)}`,
    generatedAt: "2026-08-23T00:00:00.000Z",
  });
  assert.equal(manifest.chainId, 84_532);
  assert.equal(manifest.deployer, roles.facilityAdmin);
  assert.equal(manifest.contracts.covenantVault.blockNumber, "104");
  assert.equal(manifest.sourceCommit, "a".repeat(40));
});

test("rejects incomplete broadcasts", () => {
  assert.throws(
    () =>
      buildBaseSepoliaManifest({
        broadcast: {
          ...broadcast,
          transactions: broadcast.transactions.slice(0, 4),
          receipts: broadcast.receipts.slice(0, 4),
        },
        roles,
        sourceCommit: "a".repeat(40),
        facilityId: `0x${"b".repeat(64)}`,
      }),
    /Missing CovenantVault/,
  );
});

test("rejects a shared exposure and hedge issuer", () => {
  assert.throws(
    () =>
      buildBaseSepoliaManifest({
        broadcast,
        roles: { ...roles, hedgeIssuer: roles.exposureIssuer },
        sourceCommit: "a".repeat(40),
        facilityId: `0x${"b".repeat(64)}`,
      }),
    /must be distinct/,
  );
});

test("rejects a wrong-chain broadcast", () => {
  assert.throws(
    () =>
      buildBaseSepoliaManifest({
        broadcast: { ...broadcast, chain: 31_337 },
        roles,
        sourceCommit: "a".repeat(40),
        facilityId: `0x${"b".repeat(64)}`,
      }),
    /must be 84532/,
  );
});
