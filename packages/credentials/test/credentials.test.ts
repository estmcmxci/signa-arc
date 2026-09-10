import assert from "node:assert/strict";
import test from "node:test";

import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import {
  CREDENTIAL_CHAIN_ID,
  LOCAL_REPLAY_CHAIN_ID,
  credentialDomain,
  currencyToBytes3,
  exposureCredentialTypes,
  hashExposureCredential,
  recoverExposureIssuer,
  type ExposureCredential,
} from "../src/index.ts";

const LOCAL_TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const registry = "0x0000000000000000000000000000000000001234";

const exposure: ExposureCredential = {
  facilityId:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  exposureCurrency: currencyToBytes3("COP"),
  settlementCurrency: currencyToBytes3("USD"),
  outstandingValue: 5_000_000_000_000n,
  exposureMaturity: 1_803_000_000n,
  observedAt: 1_800_000_000n,
  validUntil: 1_800_086_400n,
  sequence: 1n,
  sourceCommitment:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
};

test("encodes only uppercase three-letter currency codes", () => {
  assert.equal(currencyToBytes3("USD"), "0x555344");
  assert.throws(() => currencyToBytes3("usd"), /Invalid ISO-like/);
  assert.throws(() => currencyToBytes3("USDC"), /Invalid ISO-like/);
});

test("signs and recovers the exposure issuer from the canonical domain", async () => {
  const account = privateKeyToAccount(LOCAL_TEST_PRIVATE_KEY);
  const signature = await account.signTypedData({
    domain: credentialDomain(CREDENTIAL_CHAIN_ID, registry),
    types: exposureCredentialTypes,
    primaryType: "ExposureCredential",
    message: exposure,
  });
  assert.equal(
    await recoverExposureIssuer(CREDENTIAL_CHAIN_ID, registry, exposure, signature),
    account.address,
  );
});

test("binds the credential domain to Arc Testnet (R-F1-1)", () => {
  assert.equal(CREDENTIAL_CHAIN_ID, 5_042_002);
  assert.equal(CREDENTIAL_CHAIN_ID, arcTestnet.id);
  assert.equal(credentialDomain(CREDENTIAL_CHAIN_ID, registry).chainId, 5_042_002);
  assert.equal(credentialDomain(LOCAL_REPLAY_CHAIN_ID, registry).chainId, 31_337);
});

test("refuses a domain for any other chain", () => {
  // Base Sepolia was the previous target; nothing here may sign for it.
  for (const chainId of [84_532, 8_453, 1, 0, -1, 5_042_002.5]) {
    assert.throws(() => credentialDomain(chainId, registry), /5042002/);
  }
  assert.throws(() => hashExposureCredential(84_532, registry, exposure), /5042002/);
});

test("changes the digest across chain and registry domains", () => {
  const arc = hashExposureCredential(CREDENTIAL_CHAIN_ID, registry, exposure);
  const local = hashExposureCredential(LOCAL_REPLAY_CHAIN_ID, registry, exposure);
  const otherRegistry = hashExposureCredential(
    CREDENTIAL_CHAIN_ID,
    "0x0000000000000000000000000000000000005678",
    exposure,
  );
  assert.notEqual(arc, local);
  assert.notEqual(arc, otherRegistry);
});
