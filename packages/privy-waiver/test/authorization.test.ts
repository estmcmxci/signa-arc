import assert from "node:assert/strict";
import { createECDH, createHash, createPrivateKey } from "node:crypto";
import test from "node:test";

import {
  canonicalize,
  formatAuthorizationPayload,
  intentAuthorizationInput,
  normalizePublicKey,
  p1363ToDer,
  publicKeyOf,
  signAuthorizationPayload,
  verifyAuthorizationSignature,
  type AuthorizationPayloadInput,
} from "../src/authorization.ts";

// Golden vectors produced by @privy-io/node@0.34.0 (formatRequestForAuthorizationSignature and
// generateAuthorizationSignature) from the same key and request. The SDK signs deterministically
// (RFC 6979), so its signature is reproducible; ours are randomised, so ours are checked by verifying.
const SDK_PUBLIC_KEY =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEh1XlTySsCtbQ25VLtzEr1p9bWFFe93SnSa4FS18rcdWTEyIzKk0dW0xcRAupfm3vBswtYL+PAnF+h5ZXZuToxQ==";
const SDK_SIGNATURE =
  "MEUCIBTdm3iNzGWBSApGEdaNLblUOzIHjUUfSq2E6FFKpRlDAiEAkx1X114VBW13WGaM8vfWn5YJ6Zlhe9KiAqgsm+sBKmQ=";
const CREATE_WAIVER_CALLDATA =
  "0x6738bca70000000000000000000000000000000000000000000000000000000000015180a7289906731da2d914d0e1aedbabe029e40e24f2b456644c95c136a03892e2d1";
const SDK_CANONICAL =
  `{"body":{"method":"eth_signTransaction","params":{"transaction":{"chain_id":5042002,"data":"${CREATE_WAIVER_CALLDATA}","gas_limit":"0x2dc6c","max_fee_per_gas":"0x9502f9000","max_priority_fee_per_gas":"0x0","nonce":3,"to":"0x1970feb699BCd4dd268a3A8c2590929fc8fd67c2","type":2,"value":"0x0"}}},"headers":{"privy-app-id":"test-app-id"},"method":"POST","url":"https://api.privy.io/v1/wallets/test-wallet-id/rpc","version":1}`;
const SDK_EMPTY_BODY_CANONICAL =
  '{"body":"","headers":{"privy-app-id":"test-app-id"},"method":"POST","url":"https://api.privy.io/v1/intents/abc/reject","version":1}';

// Keys deliberately out of order, exactly as fed to the SDK.
const vectorInput: AuthorizationPayloadInput = {
  version: 1,
  method: "POST",
  url: "https://api.privy.io/v1/wallets/test-wallet-id/rpc",
  body: {
    params: {
      transaction: {
        value: "0x0",
        to: "0x1970feb699BCd4dd268a3A8c2590929fc8fd67c2",
        type: 2,
        chain_id: 5042002,
        nonce: 3,
        data: CREATE_WAIVER_CALLDATA,
        gas_limit: "0x2dc6c",
        max_priority_fee_per_gas: "0x0",
        max_fee_per_gas: "0x9502f9000",
      },
    },
    method: "eth_signTransaction",
  },
  headers: { "privy-app-id": "test-app-id" },
};

/** A throwaway key derived from a fixed label: test vectors only, never used anywhere. */
function vectorPrivateKey(): string {
  const scalar = createHash("sha256").update("signa-privy-waiver:test-vector:approver-a").digest();
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  const point = ecdh.getPublicKey();
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: scalar.toString("base64url"),
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
    },
    format: "jwk",
  })
    .export({ format: "der", type: "pkcs8" })
    .toString("base64");
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("the signed payload matches @privy-io/node byte for byte", () => {
  assert.equal(decode(formatAuthorizationPayload(vectorInput)), SDK_CANONICAL);
});

test("an empty body is signed as an empty string, as the SDK does", () => {
  const input: AuthorizationPayloadInput = {
    version: 1,
    method: "POST",
    url: "https://api.privy.io/v1/intents/abc/reject",
    body: {},
    headers: { "privy-app-id": "test-app-id" },
  };
  assert.equal(decode(formatAuthorizationPayload(input)), SDK_EMPTY_BODY_CANONICAL);
  assert.deepEqual(input.body, {}, "formatting must not mutate the caller's request");
});

test("an intent's recorded request becomes the payload with only the app ID header", () => {
  const input = intentAuthorizationInput(
    { method: "POST", url: vectorInput.url, body: vectorInput.body },
    "test-app-id",
  );
  assert.equal(decode(formatAuthorizationPayload(input)), SDK_CANONICAL);
  const withExpiry = intentAuthorizationInput(
    { method: "POST", url: vectorInput.url, body: vectorInput.body },
    "test-app-id",
    { "privy-request-expiry": "1789000000000" },
  );
  assert.match(
    decode(formatAuthorizationPayload(withExpiry)),
    /"headers":\{"privy-app-id":"test-app-id","privy-request-expiry":"1789000000000"\}/,
  );
});

test("the SDK's signature verifies here, and the key derivation matches the SDK's", () => {
  const key = vectorPrivateKey();
  assert.equal(publicKeyOf(key), SDK_PUBLIC_KEY);
  const payload = formatAuthorizationPayload(vectorInput);
  assert.ok(verifyAuthorizationSignature(SDK_PUBLIC_KEY, payload, SDK_SIGNATURE));
});

test("our signatures verify, with or without the wallet-auth: prefix, and bind the payload", () => {
  const key = vectorPrivateKey();
  const payload = formatAuthorizationPayload(vectorInput);
  for (const encoded of [key, `wallet-auth:${key}`]) {
    const signature = signAuthorizationPayload(encoded, payload);
    assert.ok(verifyAuthorizationSignature(SDK_PUBLIC_KEY, payload, signature));
  }
  const tampered = new TextEncoder().encode(SDK_CANONICAL.replace('"nonce":3', '"nonce":4'));
  assert.ok(!verifyAuthorizationSignature(SDK_PUBLIC_KEY, tampered, signAuthorizationPayload(key, payload)));
});

test("a browser WebCrypto signature converts to the DER Privy expects", async () => {
  const pkcs8 = Buffer.from(vectorPrivateKey(), "base64");
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const payload = formatAuthorizationPayload(vectorInput);
  // ECDSA nonces are random, so repeat to cover r and s with and without a high bit.
  for (let round = 0; round < 32; round++) {
    const p1363 = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, payload));
    const der = Buffer.from(p1363ToDer(p1363)).toString("base64");
    assert.ok(verifyAuthorizationSignature(SDK_PUBLIC_KEY, payload, der), `round ${round}`);
  }
});

test("DER integers drop leading zeros and pad a set high bit", () => {
  const p1363 = new Uint8Array(64);
  p1363[31] = 0x01;
  p1363[32] = 0x80;
  const der = Array.from(p1363ToDer(p1363));
  assert.deepEqual(der.slice(0, 7), [0x30, 0x26, 0x02, 0x01, 0x01, 0x02, 0x21]);
  assert.deepEqual(der.slice(7, 9), [0x00, 0x80]);
  assert.equal(der.length, 0x26 + 2);
  assert.throws(() => p1363ToDer(new Uint8Array(63)), /64-byte/);
});

test("canonical JSON follows RFC 8785 for keys, strings, numbers and nesting", () => {
  assert.equal(canonicalize({ b: [3, { d: 1, c: 2 }], a: "é\n\"" }), '{"a":"é\\n\\"","b":[3,{"c":2,"d":1}]}');
  assert.equal(canonicalize({ big: 1e21, float: 0.1 + 0.2, negativeZero: -0 }), '{"big":1e+21,"float":0.30000000000000004,"negativeZero":0}');
  assert.equal(canonicalize({ kept: null, skipped: undefined, list: [undefined] }), '{"kept":null,"list":[null]}');
  assert.throws(() => canonicalize({ bad: Number.NaN }), /cannot encode/);
});

test("Privy's PEM member keys and bare SPKI keys name the same key", () => {
  // Verbatim from Privy on 2026-09-10: GET /v1/key_quorums/{id} lists the key as bare SPKI under
  // authorization_keys; the intent's authorization_details lists the same key in PEM.
  const fromKeyQuorum =
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENVte1KOLmSNJ+AVTXAWofx87zJSYNe7fHY4UnDIhKf1dG7ESIB0pc/2HLV0JNxs1IWw0Z+J/IiSliK2+B3RwuQ==";
  const fromIntent =
    "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENVte1KOLmSNJ+AVTXAWofx87zJSY\nNe7fHY4UnDIhKf1dG7ESIB0pc/2HLV0JNxs1IWw0Z+J/IiSliK2+B3RwuQ==\n-----END PUBLIC KEY-----";
  assert.equal(normalizePublicKey(fromIntent), fromKeyQuorum);
  assert.equal(normalizePublicKey(fromKeyQuorum), fromKeyQuorum);

  const pem = `-----BEGIN PUBLIC KEY-----\n${(SDK_PUBLIC_KEY.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PUBLIC KEY-----`;
  assert.ok(verifyAuthorizationSignature(pem, formatAuthorizationPayload(vectorInput), SDK_SIGNATURE));
});
