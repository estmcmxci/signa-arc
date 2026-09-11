import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { credentialDomain, exposureCredentialTypes, hashHedgeCredential, hedgeCredentialTypes } from "@fx-coverage/credentials";
import { privateKeyToAccount } from "viem/accounts";

import { SignaError, bundledManifest, inspectEnvelope, parseEnvelope } from "../src/index.ts";

const manifest = bundledManifest();
const registry = manifest.contracts.credentialRegistry.address;
// A throwaway test key (Anvil's first account). It is no issuer the manifest names.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** The hedge credential lane B signed at sequence 6 and the registry accepted, as an envelope. */
function recordedHedgeEnvelope(): Record<string, any> {
  const record = JSON.parse(readFileSync(new URL("../../../scenarios/output/arc-hedge-update-seq-6.json", import.meta.url), "utf8"));
  const credential = record.credential.credential;
  return {
    schemaVersion: 1,
    kind: "hedge",
    domain: { name: "FXCoverageCredentials", version: "1", chainId: 5_042_002, verifyingContract: registry },
    credential: { ...credential, status: "ACTIVE" },
    signature: record.credential.signature,
    issuer: record.credential.issuer,
    digest: record.credential.digest,
  };
}

async function refused(envelope: unknown, code: string, pattern: RegExp, label: string): Promise<void> {
  await assert.rejects(
    async () => inspectEnvelope(parseEnvelope(envelope), manifest),
    (error: unknown) => error instanceof SignaError && error.code === code && pattern.test(error.message),
    label,
  );
}

test("a recorded, signed hedge envelope inspects clean: digest recomputed, signer recovered, no live claim", async () => {
  const envelope = recordedHedgeEnvelope();
  const inspection = await inspectEnvelope(parseEnvelope(envelope), manifest);
  assert.equal(inspection.kind, "hedge");
  assert.equal(inspection.digest, envelope.digest, "the registry accepted this digest at sequence 6");
  assert.equal(inspection.recoveredSigner, manifest.roles.hedgeIssuer);
  assert.equal(inspection.manifestRole, "hedgeIssuer");
  assert.deepEqual(
    [inspection.credential.baseCurrency, inspection.credential.quoteCurrency, inspection.credential.status, inspection.credential.remainingNotional, inspection.credential.sequence],
    ["USD", "EUR", "ACTIVE", "1060000", "6"],
  );
  assert.equal(inspection.credential.observedAt, "2026-09-11T00:19:52.000Z");
});

test("an envelope for another chain, registry or facility is refused as INVALID_INPUT", async () => {
  const chain = recordedHedgeEnvelope();
  chain.domain.chainId = 1;
  await refused(chain, "INVALID_INPUT", /signed for chain 1; the selected deployment is Arc Testnet \(5042002\)/, "another chain");
  const other = recordedHedgeEnvelope();
  other.domain.verifyingContract = manifest.contracts.facilityRegistry.address;
  await refused(other, "INVALID_INPUT", /signed for credential registry 0xB54f.*not the selected deployment's 0xD921/, "another registry");
  const facility = recordedHedgeEnvelope();
  facility.credential.facilityId = `0x${"11".repeat(32)}`;
  await refused(facility, "INVALID_INPUT", /is for facility 0x1111.*not the selected manifest's 0x899d/, "another facility");
});

test("a forged digest or signer is refused as INVALID_SIGNATURE", async () => {
  const digest = recordedHedgeEnvelope();
  digest.digest = `0x${"00".repeat(32)}`;
  await refused(digest, "INVALID_SIGNATURE", /claims digest 0x0000.*but its credential hashes to 0xdcc126e8/, "claimed digest");

  const altered = recordedHedgeEnvelope();
  altered.credential.remainingNotional = "2000000";
  await refused(altered, "INVALID_SIGNATURE", /claims digest/, "a changed field with the old digest");
  const reDigested = recordedHedgeEnvelope();
  reDigested.credential.remainingNotional = "2000000";
  reDigested.digest = hashHedgeCredential(5_042_002, registry, parseEnvelope(reDigested).credential as never);
  await refused(reDigested, "INVALID_SIGNATURE", /recovers to 0x.*not the claimed issuer 0xAD515A2BE433e78B6b570064797626012e272e0a/, "a changed field with a recomputed digest");

  const issuer = recordedHedgeEnvelope();
  issuer.issuer = manifest.roles.exposureIssuer;
  await refused(issuer, "INVALID_SIGNATURE", /recovers to 0xAD515A2BE433e78B6b570064797626012e272e0a, not the claimed issuer 0x4317/, "claimed issuer");
});

test("malformed fields are refused before anything is encoded", async () => {
  const cases: [string, (envelope: Record<string, any>) => void, RegExp][] = [
    ["schema version", (e) => (e.schemaVersion = 2), /schemaVersion must be 1/],
    ["kind", (e) => (e.kind = "trade"), /kind must be "exposure" or "hedge"/],
    ["unknown top-level field", (e) => (e.note = "x"), /the envelope has unknown fields: note/],
    ["missing field", (e) => delete e.credential.sequence, /credential is missing sequence/],
    ["unknown credential field", (e) => (e.credential.extra = "1"), /credential has unknown fields: extra/],
    ["domain name", (e) => (e.domain.name = "Other"), /domain.name must be FXCoverageCredentials/],
    ["short bytes32", (e) => (e.credential.tradeIdCommitment = "0x1234"), /credential.tradeIdCommitment must be exactly 32 bytes/],
    ["currency as text", (e) => (e.credential.baseCurrency = "USD"), /credential.baseCurrency must be exactly 3 bytes/],
    ["amount as a number", (e) => (e.credential.remainingNotional = 1_060_000), /credential.remainingNotional must be a decimal string/],
    ["leading zero", (e) => (e.credential.sequence = "06"), /credential.sequence must be a decimal string with no sign, exponent or leading zeros/],
    ["negative", (e) => (e.credential.sequence = "-6"), /credential.sequence must be a decimal string/],
    ["exponent", (e) => (e.credential.remainingNotional = "1e6"), /credential.remainingNotional must be a decimal string/],
    ["uint64 overflow", (e) => (e.credential.maturity = (2n ** 64n).toString()), /credential.maturity exceeds uint64/],
    ["status by number", (e) => (e.credential.status = 0), /credential.status must be one of ACTIVE, CANCELLED, SETTLED, DISPUTED/],
    ["status lowercase", (e) => (e.credential.status = "active"), /credential.status must be one of/],
    ["short signature", (e) => (e.signature = `0x${"11".repeat(64)}`), /signature must be exactly 65 bytes/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const envelope = recordedHedgeEnvelope();
    mutate(envelope);
    assert.throws(() => parseEnvelope(envelope), (error: unknown) => error instanceof SignaError && error.code === "INVALID_INPUT" && pattern.test(error.message), label);
  }
  assert.throws(() => parseEnvelope([]), /the envelope must be a JSON object/);
});

test("zero hedge notional is a valid encoding, and an exposure envelope inspects the same way", async () => {
  const signer = privateKeyToAccount(TEST_KEY);
  const domain = credentialDomain(5_042_002, registry);
  const terminal = recordedHedgeEnvelope();
  terminal.credential = { ...terminal.credential, remainingNotional: "0", status: "SETTLED", sequence: "7" };
  const hedge = parseEnvelope({ ...terminal, digest: `0x${"00".repeat(32)}` }).credential;
  terminal.signature = await signer.signTypedData({ domain, types: hedgeCredentialTypes, primaryType: "HedgeCredential", message: hedge as never });
  terminal.issuer = signer.address;
  terminal.digest = hashHedgeCredential(5_042_002, registry, hedge as never);
  const settled = await inspectEnvelope(parseEnvelope(terminal), manifest);
  assert.equal(settled.credential.remainingNotional, "0");
  assert.equal(settled.credential.status, "SETTLED");
  assert.equal(settled.manifestRole, null, "a key the manifest does not name is reported as no role, not as an error");

  const exposureCredential = {
    facilityId: manifest.facility.id,
    exposureCurrency: "0x455552",
    settlementCurrency: "0x555344",
    outstandingValue: "1000000",
    exposureMaturity: "1805147242",
    observedAt: "1789085992",
    validUntil: "1789172392",
    sequence: "2",
    sourceCommitment: `0x${"e1".repeat(32)}`,
  };
  const exposure = { schemaVersion: 1, kind: "exposure", domain: terminal.domain, credential: exposureCredential, signature: "0x", issuer: signer.address, digest: `0x${"00".repeat(32)}` };
  const parsed = parseEnvelope({ ...exposure, signature: `0x${"11".repeat(65)}` });
  exposure.signature = await signer.signTypedData({ domain, types: exposureCredentialTypes, primaryType: "ExposureCredential", message: parsed.credential as never });
  exposure.digest = (await import("@fx-coverage/credentials")).hashExposureCredential(5_042_002, registry, parsed.credential as never);
  const inspected = await inspectEnvelope(parseEnvelope(exposure), manifest);
  assert.equal(inspected.kind, "exposure");
  assert.equal(inspected.recoveredSigner, signer.address);
  assert.equal(inspected.credential.exposureCurrency, "EUR");
  assert.equal(inspected.credential.outstandingValue, "1000000");
});
