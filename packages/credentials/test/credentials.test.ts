import assert from "node:assert/strict";
import test from "node:test";

import { privateKeyToAccount } from "viem/accounts";

import {
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
    domain: credentialDomain(31_337, registry),
    types: exposureCredentialTypes,
    primaryType: "ExposureCredential",
    message: exposure,
  });
  assert.equal(
    await recoverExposureIssuer(31_337, registry, exposure, signature),
    account.address,
  );
});

test("changes the digest across chain and registry domains", () => {
  const local = hashExposureCredential(31_337, registry, exposure);
  const baseSepolia = hashExposureCredential(84_532, registry, exposure);
  const otherRegistry = hashExposureCredential(
    31_337,
    "0x0000000000000000000000000000000000005678",
    exposure,
  );
  assert.notEqual(local, baseSepolia);
  assert.notEqual(local, otherRegistry);
});
