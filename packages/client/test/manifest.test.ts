import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BUNDLED_MANIFEST_COPY_OF,
  SignaError,
  bundledManifest,
  parseDeploymentManifest,
  redactRpcUrl,
} from "../src/index.ts";

const ROOT = new URL("../../../", import.meta.url);
const deployed = (): Record<string, any> => JSON.parse(readFileSync(new URL("deployments/arc-testnet.json", ROOT), "utf8"));

function refused(data: unknown, pattern: RegExp, label: string): void {
  assert.throws(
    () => parseDeploymentManifest(data),
    (error: unknown) => error instanceof SignaError && error.code === "INVALID_MANIFEST" && pattern.test(error.message),
    label,
  );
}

test("the bundled manifest is a byte-for-byte copy of deployments/arc-testnet.json, and parses", () => {
  const original = readFileSync(new URL(BUNDLED_MANIFEST_COPY_OF, ROOT));
  const copy = readFileSync(new URL("../src/deployments/arc-testnet.json", import.meta.url));
  assert.ok(copy.equals(original), "packages/client/src/deployments/arc-testnet.json drifted from deployments/arc-testnet.json");
  const manifest = bundledManifest();
  assert.equal(manifest.chainId, 5_042_002);
  assert.equal(manifest.contracts.covenantVault.address, "0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51");
  assert.equal(manifest.facility.id, "0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2");
});

test("optional sections are validated and kept, not dropped", () => {
  const manifest = parseDeploymentManifest(deployed());
  assert.equal(manifest.facilityAdminQuorum?.threshold, 2);
  assert.deepEqual(manifest.facilityAdminQuorum?.approvers.map((approver) => approver.role), ["Risk officer", "Treasury lead"]);
  assert.equal(manifest.facilityAdminQuorum?.policyId, "y5x9g8gglndai2hosm47zvxf");
  assert.equal(manifest.facility.policy.maxActiveHedges, 8);
  assert.equal(manifest.facility.policy.settlementCurrency, "USD");
  assert.equal(manifest.facility.policy.exposureCurrency, "EUR");
  assert.equal(manifest.exposureDenomination?.referenceAsset.symbol, "EURC");

  const minimal = deployed();
  delete minimal.facilityAdminQuorum;
  delete minimal.exposureDenomination;
  const parsed = parseDeploymentManifest(minimal);
  assert.equal("facilityAdminQuorum" in parsed, false);
  assert.equal("exposureDenomination" in parsed, false);
});

test("a malformed manifest is refused with INVALID_MANIFEST naming the field", () => {
  const cases: [string, (manifest: Record<string, any>) => void, RegExp][] = [
    ["another chain", (m) => (m.chainId = 84_532), /chainId must be 5042002/],
    ["chain as a string", (m) => (m.chainId = "5042002"), /chainId must be 5042002/],
    ["zero vault address", (m) => (m.contracts.covenantVault.address = "0x0000000000000000000000000000000000000000"), /contracts\.covenantVault\.address/],
    ["short role address", (m) => (m.roles.operator = "0x1234"), /roles\.operator/],
    ["facility id not bytes32", (m) => (m.facility.id = "0x899d"), /facility\.id must be a bytes32/],
    ["short source commit", (m) => (m.sourceCommit = "5fefd23"), /sourceCommit/],
    ["reserve in exponent notation", (m) => (m.facility.policy.reserveAmount = "5e5"), /reserveAmount must be a decimal string/],
    ["reserve above uint128", (m) => (m.facility.policy.reserveAmount = (2n ** 128n).toString()), /reserveAmount exceeds uint128/],
    ["18-decimal settlement", (m) => (m.settlementAsset.decimals = 18), /settlementAsset\.decimals must be 6/],
    ["bps above uint16", (m) => (m.facility.policy.minCoverageBps = 70_000), /minCoverageBps must be a whole number from 0 to 65535/],
    ["fractional seconds", (m) => (m.facility.policy.credentialMaxAgeSeconds = 1.5), /credentialMaxAgeSeconds/],
    ["duplicate contracts", (m) => (m.contracts.coverageEngine.address = m.contracts.facilityRegistry.address), /four different addresses/],
    ["websocket RPC", (m) => (m.rpcUrl = "wss://rpc.testnet.arc.network"), /rpcUrl must be an http\(s\) URL/],
    ["deployedAt not a date", (m) => (m.deployedAt = "yesterday"), /deployedAt/],
    ["malformed exposure denomination", (m) => (m.exposureDenomination.referenceAsset.address = "EURC"), /exposureDenomination is present but malformed/],
    ["quorum threshold above approvers", (m) => (m.facilityAdminQuorum.threshold = 3), /threshold must be a whole number between 1 and the number of approvers/],
    ["approver key not base64", (m) => (m.facilityAdminQuorum.approvers[0].publicKey = "not base64!"), /approvers\[0\]/],
    ["too many hedges for uint8", (m) => (m.facility.policy.maxActiveHedges = 300), /maxActiveHedges/],
    ["lowercase currency", (m) => (m.facility.policy.settlementCurrency = "usd"), /three-letter currency code/],
    ["no contracts", (m) => delete m.contracts, /contracts must be an object/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const manifest = deployed();
    mutate(manifest);
    refused(manifest, pattern, label);
  }
  refused(null, /manifest is not an object/, "null");
  refused("deployments/arc-testnet.json", /manifest is not an object/, "a path instead of a manifest");
});

test("RPC URLs are redacted: credentials, query values and key-like path segments", () => {
  assert.equal(redactRpcUrl("https://rpc.testnet.arc.network"), "https://rpc.testnet.arc.network");
  assert.equal(redactRpcUrl("https://user:pass@rpc.example/"), "https://redacted:redacted@rpc.example");
  assert.equal(
    redactRpcUrl("https://arc.example/v2/abcdefghijklmnop1234?apikey=s3cret&chain=arc"),
    "https://arc.example/v2/redacted?apikey=redacted&chain=redacted",
  );
  assert.equal(redactRpcUrl("not a url"), "<unparseable URL>");
});
