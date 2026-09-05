import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  recoverHedgeIssuer,
  hedgeStatuses,
} from "@fx-coverage/credentials";
import { privateKeyToAccount } from "viem/accounts";

import {
  mapProviderFixture,
  MOCK_PROVIDER_DISCLAIMER,
  parseProviderFixture,
  parseSixDecimalAmount,
  signHedgeCredential,
} from "../src/index.ts";

const LOCAL_TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const facilityId =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const registry = "0x0000000000000000000000000000000000001234";

const activeFixture = JSON.parse(
  await readFile(
    new URL("../fixtures/mock-forward-active.json", import.meta.url),
    "utf8",
  ),
) as unknown;

test("maps the fictional active fixture without floating-point loss", () => {
  const credential = mapProviderFixture(activeFixture, facilityId);
  assert.equal(credential.remainingNotional, 4_500_000_000_000n);
  assert.equal(credential.baseCurrency, "0x555344");
  assert.equal(credential.quoteCurrency, "0x434f50");
  assert.equal(credential.status, hedgeStatuses.ACTIVE);
  assert.equal(credential.observedAt, 1_800_000_000n);
});

test("signs an export whose issuer is recoverable from the canonical domain", async () => {
  const account = privateKeyToAccount(LOCAL_TEST_PRIVATE_KEY);
  const credential = mapProviderFixture(activeFixture, facilityId);
  const signed = await signHedgeCredential({
    credential,
    chainId: 31_337,
    verifyingContract: registry,
    privateKey: LOCAL_TEST_PRIVATE_KEY,
  });
  assert.equal(signed.disclaimer, MOCK_PROVIDER_DISCLAIMER);
  assert.equal(signed.issuer, account.address);
  assert.equal(
    await recoverHedgeIssuer(
      31_337,
      registry,
      credential,
      signed.signature,
    ),
    account.address,
  );
});

test("requires the explicit mock/non-endorsement disclaimer", () => {
  const invalid = structuredClone(activeFixture) as Record<string, unknown>;
  invalid.disclaimer = "provider data";
  assert.throws(() => parseProviderFixture(invalid));
});

test("rejects precision beyond the token's six decimals", () => {
  assert.throws(
    () => parseSixDecimalAmount("1.0000001"),
    /Invalid six-decimal/,
  );
});

test("maps cancellation to the non-active lifecycle state", async () => {
  const cancelled = JSON.parse(
    await readFile(
      new URL("../fixtures/mock-forward-cancelled.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  assert.equal(
    mapProviderFixture(cancelled, facilityId).status,
    hedgeStatuses.CANCELLED,
  );
});
