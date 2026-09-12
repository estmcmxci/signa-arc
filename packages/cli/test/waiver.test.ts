import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bundledManifest } from "@signa/client";
import type { Address, Hex } from "viem";

import { createApprover } from "../../privy-waiver/src/approvers.ts";
import { verifyAuthorizationSignature } from "../../privy-waiver/src/authorization.ts";
import type { ArcGateway, CoverageEvaluation, FacilityPolicy, VaultStatus } from "../../privy-waiver/src/arc.ts";
import { PrivyClient } from "../../privy-waiver/src/privy-client.ts";
import { QuorumAdminService } from "../../privy-waiver/src/service.ts";
import { MemoryActionStore } from "../../privy-waiver/src/store.ts";
import { approverApproval, openWaiverDesk, type WaiverDesk } from "../src/waiver.ts";
import { onlyJson, runSigna } from "./helpers.ts";

/**
 * The waiver adapter, over a faked chain. Nothing here reads a keystore, an approver key belonging
 * to whoever runs the suite, or a Privy credential: the one key these tests use is generated into
 * a temporary directory, and the Privy client is never called.
 */

const manifest = bundledManifest();
const compliant: CoverageEvaluation = {
  assessed: true,
  compliant: true,
  coverageBps: 10_000,
  requiredCoverageBps: 10_000,
  eligibleHedgeCount: 1,
  totalHedgeCount: 1,
  exposureReason: "ELIGIBLE",
  resultReason: "NONE",
};
const short: CoverageEvaluation = { ...compliant, compliant: false, coverageBps: 6_840, resultReason: "BELOW_THRESHOLD" };

function fakeArc(coverage: CoverageEvaluation, status?: Partial<VaultStatus>): ArcGateway {
  const policy = {
    facilityId: manifest.facility.id,
    admin: manifest.roles.facilityAdmin,
    operator: manifest.roles.operator,
    maxWaiverDuration: 259_200,
  } as FacilityPolicy;
  const unused = () => {
    throw new Error("the fake chain was asked for something waiver status does not read");
  };
  return {
    chainId: async () => manifest.chainId,
    simulate: unused,
    estimateGas: unused,
    feesPerGas: unused,
    pendingNonce: unused,
    sendRawTransaction: unused,
    waitForReceipt: unused,
    facilityExists: async () => true,
    getFacility: async () => policy,
    isExposureIssuer: async () => true,
    isHedgeIssuer: async () => true,
    vaultStatus: async (): Promise<VaultStatus> => ({
      facilityId: manifest.facility.id,
      covenantState: "COMPLIANT",
      activeWaiver: false,
      waiverEndsAt: 0n,
      ...status,
    }),
    evaluateCoverage: async () => coverage,
  } as ArcGateway;
}

/** A desk over the fake chain. Its Privy client is constructed but never called. */
function fakeDesk(arc: ArcGateway): WaiverDesk {
  const service = new QuorumAdminService(
    new PrivyClient({ appId: "test", appSecret: "test", apiUrl: "https://api.privy.io" }),
    arc,
    new MemoryActionStore(),
    {
      walletId: manifest.facilityAdminQuorum?.walletId ?? "test-wallet",
      walletAddress: manifest.roles.facilityAdmin,
      explorer: manifest.explorer,
      facility: {
        id: manifest.facility.id,
        vault: manifest.contracts.covenantVault.address,
        registry: manifest.contracts.facilityRegistry.address,
        coverageEngine: manifest.contracts.coverageEngine.address,
      },
    },
  );
  return { service, walletAddress: manifest.roles.facilityAdmin, walletId: "test-wallet", storePath: "/tmp/test-actions.json", approverDirectory: "/tmp/test-approvers" };
}

const withDesk = (arc: ArcGateway) => ({ dependencies: { openDesk: async () => fakeDesk(arc) } });

test("waiver status: a compliant facility is refused, and that is an answer, so it exits 0", async () => {
  const run = await runSigna(["waiver", "status", "--json"], withDesk(fakeArc(compliant)));
  assert.equal(run.exitCode, 0, run.stdout);
  const result = onlyJson(run);
  assert.equal(result.kind, "report");
  assert.equal(result.wouldAccept, false);
  assert.equal(result.refusals.length, 1);
  assert.match(result.refusals[0], /compliant/);
  assert.equal(result.coverage.coverageBps, 10_000);
  assert.equal(result.context.admin.address, manifest.roles.facilityAdmin);
  assert.match(result.scope, /not pinned to one block/);
});

test("waiver status: a facility short of coverage would accept a waiver", async () => {
  const run = await runSigna(["waiver", "status", "--json"], withDesk(fakeArc(short)));
  assert.equal(run.exitCode, 0);
  const result = onlyJson(run);
  assert.equal(result.wouldAccept, true);
  assert.deepEqual(result.refusals, []);
  assert.equal(result.coverage.compliant, false);
  assert.equal(result.maxWaiverDurationSeconds, 259_200);
});

test("waiver status: an active waiver is a refusal of its own", async () => {
  const run = await runSigna(["waiver", "status", "--json"], withDesk(fakeArc(short, { activeWaiver: true, covenantState: "WAIVED", waiverEndsAt: 4_000_000_000n })));
  assert.equal(run.exitCode, 0);
  const result = onlyJson(run);
  assert.equal(result.wouldAccept, false);
  assert.ok(result.refusals.some((refusal: string) => /waiver/i.test(refusal)), JSON.stringify(result.refusals));
});

test("waiver propose: pre-validation refuses with ACTION_REFUSED and a non-zero exit, so a script can tell it from status", async () => {
  const run = await runSigna(["waiver", "propose", "--duration", "300", "--reason", "rehearsal", "--json"], withDesk(fakeArc(compliant)));
  assert.equal(run.exitCode, 1, "would be refused exits 0 from status; was refused exits non-zero here");
  const error = onlyJson(run);
  assert.equal(error.code, "ACTION_REFUSED");
  assert.match(error.message, /would refuse it/);
});

test("waiver propose: malformed input is refused before any desk is opened", async () => {
  const noDesk = {
    dependencies: {
      openDesk: async () => {
        throw new Error("a malformed proposal must be refused before anything is opened");
      },
    },
  };
  for (const [args, pattern] of [
    [["--duration", "0", "--reason", "x"], /whole seconds above zero/],
    [["--duration", "5.5", "--reason", "x"], /whole seconds above zero/],
    [["--duration", "300", "--reason", "   "], /cannot be empty/],
  ] as const) {
    const run = await runSigna(["waiver", "propose", ...args, "--json"], noDesk);
    assert.equal(run.exitCode, 1);
    assert.equal(onlyJson(run).code, "INVALID_INPUT");
    assert.match(onlyJson(run).message, pattern);
  }
});

test("waiver approve and reject: with nothing in flight, there is nothing to act on", async () => {
  for (const command of [
    ["waiver", "approve", "--role", "risk-officer", "--json"],
    ["waiver", "reject", "--json"],
    ["waiver", "broadcast", "--json"],
  ]) {
    const run = await runSigna(command, withDesk(fakeArc(short)));
    assert.equal(run.exitCode, 1, command.join(" "));
    const error = onlyJson(run);
    assert.equal(error.code, "INVALID_INPUT");
    assert.match(error.message, /no proposal is in flight/);
  }
});

test("an approver signs the payload it was given, and a missing key is refused before anything is sent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "signa-test-approvers-"));
  assert.throws(
    () => approverApproval(directory, "risk-officer", { text: "payload", timestamp: 1 }),
    (error: unknown) => (error as { code?: string }).code === "SIGNER_UNAVAILABLE",
    "no key means no approval, and nothing reaches Privy",
  );

  // A throwaway key, generated here. No key belonging to whoever runs this is ever read.
  const key = createApprover(directory, "risk-officer");
  const payload = { text: "the exact bytes an approver signs", timestamp: 1_700_000_000_000 };
  const approval = approverApproval(directory, "risk-officer", payload);
  assert.equal(approval.encoding, "der", "Node signs DER, which is what Privy's own SDK sends");
  assert.equal(approval.timestamp, payload.timestamp, "the payload's own timestamp is echoed, not a fresh one");
  assert.equal(approval.publicKey, key.publicKey);
  assert.ok(
    verifyAuthorizationSignature(approval.publicKey, new TextEncoder().encode(payload.text), approval.signature),
    "the signature verifies against the payload it claims to cover",
  );
});

test("a waiver command that needs Privy fails on the missing credential, before any network call", async () => {
  await assert.rejects(
    () => openWaiverDesk(manifest, {}, "authorized"),
    (error: unknown) => {
      const failure = error as { code?: string; message?: string };
      return failure.code === "SIGNER_UNAVAILABLE" && /PRIVY_APP_ID/.test(failure.message ?? "");
    },
  );
});

test("waiver status needs no credential at all: read mode never constructs one", async () => {
  const desk = await openWaiverDesk(manifest, {}, "read");
  assert.equal(desk.privy, undefined, "read mode holds no Privy client");
  assert.equal(desk.walletAddress, manifest.roles.facilityAdmin, "the admin comes from the manifest");
  assert.equal(desk.walletId, manifest.facilityAdminQuorum?.walletId);
  assert.match(desk.storePath, /actions\.json$/);
  assert.ok(!desk.storePath.startsWith(process.cwd()), "proposals are recorded outside the repository");
});

test("the manifest names the quorum wallet, so no flag has to", async () => {
  const desk = await openWaiverDesk(manifest, { PRIVY_WALLET_ID: "overridden" }, "read");
  assert.equal(desk.walletId, "overridden", "an override is possible for another deployment");
  const address: Address = desk.walletAddress;
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  const hash: Hex = manifest.facility.id;
  assert.match(hash, /^0x[0-9a-f]{64}$/);
});
