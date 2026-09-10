# Privy quorum waivers: wire-up

R-F3-7: *"Under Privy, creation requires m-of-n quorum."* This package implements that flow, and it is live on Arc Testnet. The facility's admin is a Privy server wallet owned by a 2-of-2 key quorum of a risk officer and a treasury lead. That quorum approved every admin call that created the facility.

No dependency was added. Neither `@privy-io/node` nor `@privy-io/js-sdk-core` is used; the latter pins viem 2.56.0 exactly, against our 2.56.3. `src/authorization.ts` reproduces Privy's signing byte for byte.

## One facility, administered by the quorum

A facility's admin is set once and can never change. `FacilityRegistry` writes the policy, `admin` included, only in `createFacility`, and `CovenantVault` binds its `facilityId` immutably.

So the facility the quorum administers is a new one, and it replaces the original in `deployments/arc-testnet.json`. The original EOA-administered facility, `0x39cbb5ce…4d1c`, and its vault are no longer part of the story. The registries and `CoverageEngine` are reused unchanged.

`createFacility` only accepts the admin itself as sender, so the quorum's own wallet sent every setup call, each approved by both approvers: `createFacility`, both issuer approvals, and `freezeFacility`. The facility's policy was created under quorum as well as its waivers.

## Provisioned on 2026-09-10

| What | Value |
|---|---|
| Key quorum | `pbf1jtt1knpsl30eyp0z163t`, 2 of 2: risk officer, treasury lead |
| Admin wallet | Privy wallet `zc9i4be5osru1qyzfci337mi`, address `0x55C4DD3770A44695735717CB7b7005AC7dE9edA1` |
| Facility | `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2`, PRD §7 policy, frozen |
| Vault | `0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51`, settlement asset USDC `0x3600…0000`. Verified on Blockscout (exact match, constructor arguments decoded); `getsourcecode` returns its source. |

Before any facility existed, `scripts/provision-quorum.ts` proved the admin from Privy's own responses. The wallet's owner is the quorum. The quorum lists exactly the two approver keys, with threshold 2 and no other members. Either key alone is refused with `401 Number of signatures … does not match the wallet's authorization threshold`. Both keys together sign a probe transaction that recovers to the wallet.

Every receipt was asserted `0x1`:

| Step | Sent by | Transaction | Block |
|---|---|---|---|
| Fund the admin wallet, 0.3 USDC | deployer | `0x8ceb0122d413e9dc913fbd02b20da8fde1088d251b5bc6a3949594468c840349` | 61455095 |
| `createFacility` (intent `fu9qyf3vjfrsc88kf2vm8x5t`) | admin wallet | `0x43ab6cbae4fd65f188bac20a182867750bd99788511e8e8d1c9da00f78ac781d` | 61455145 |
| `setExposureIssuer` (intent `a2q4gtdszegq0uapnjiv5cjg`) | admin wallet | `0xd74640459fcea75823ffb434e13e7796544505c3bdb74cd6aec72b8fe23690ee` | 61455168 |
| `setHedgeIssuer` (intent `t0rs5dij6fy2jskb0jiebrt5`) | admin wallet | `0xb71e1368579842a57e7e649a4ca65f53e8a740bbd5087bfeb6440ec41289121a` | 61455192 |
| `freezeFacility` (intent `n1i5j72kpcyamo9ruh88l6wn`) | admin wallet | `0x943b6a216b2a675c003652d8a33db4213c58b97764acff1e9b6489a3c32c0ed0` | 61455217 |
| Deploy `CovenantVault` | deployer | `0xb1b66ee3b3494ec9878c0808269dd82beef2f523e823408a358fe75d2fe6da52` | 61456107 |

### The approver keys

The keys live in `~/.signa-privy-waiver/approvers/` (`PRIVY_APPROVER_KEY_DIR` overrides it): `risk-officer.json`, `treasury-lead.json` and `quorum.json`. The directory is mode 700 and the files are mode 600. They are outside every repository, so they cannot be committed, and `src/approvers.ts` refuses to overwrite a key once written.

**Back this directory up.** These two keys are the only way the admin wallet can sign, and the facility's admin can never change. Lose them and the facility can never take another admin action.

## Running the approval demo

1. `set -a; . ./.env; set +a`, then `PRIVY_WALLET_ID=zc9i4be5osru1qyzfci337mi node --import tsx packages/privy-waiver/src/main.ts`. The server takes the vault from the manifest, because the manifest's admin is this wallet.
2. Open http://127.0.0.1:8787 in two browser profiles. In each, enter the approver's name and use **Import** with the `privateKey` from `risk-officer.json` or `treasury-lead.json`. The key becomes non-extractable in that browser.
3. A waiver can only be created while the facility is non-compliant. It has no credentials yet, so `syncCovenant()` on the vault puts it in CURE. That call is permissionless, but lane B's acceptance sequence submits credentials to this facility, so coordinate the order with them.
4. **Propose waiver**, approve as the risk officer, approve as the treasury lead, then **Verify and broadcast to Arc**. The page decodes `WaiverCreated` and shows WAIVED.

`scripts/provision-quorum.ts` can be rerun at any time; it only re-verifies. `scripts/provision-facility.ts` reports the facility complete. The new vault holds no USDC: a draw needs a deposit first.

## How `POST /v1/intents/{id}/authorize` works

A separate research effort found this and proved it against the live API on 2026-09-10. `intentAuthorizationInput` in `src/authorization.ts` implements it, and `test/authorization.test.ts` pins the exact bytes the live endpoint accepted.

The signature covers the standard Privy authorization payload over the intent's *underlying* request, plus two top-level fields the documentation never mentions:

```jsonc
{
  "version": 1,
  "method": "<request_details.method>",
  "url": "<request_details.url>",
  "body": <request_details.body>,        // Privy's normalized copy, from GET /v1/intents/{id}
  "headers": { "privy-app-id": "<app id>" },
  "intent_id": "<intent id>",            // undocumented
  "timestamp": 1789069834498             // undocumented
}
```

This is canonicalized as RFC 8785 JSON, signed with ECDSA P-256 over SHA-256, DER-encoded and base64'd. The request body is `{ "signature": "<base64>", "timestamp": <the same value> }`.

- **Both fields together.** `intent_id` and `timestamp` are required as a pair; adding either one alone is rejected exactly like a wrong signature.
- **`timestamp`** must equal the one in the request body and be within 300 s of Privy's clock. Because it is inside what the approver signs, the approver UI fetches a fresh payload at the moment of approval (`GET /api/actions/{id}/signing-payload`) rather than signing whatever the page showed earlier.
- **`body`** must be Privy's copy from `GET /v1/intents/{id}`, never the body that was proposed.
- **The error message is not a diagnostic.** An empty or garbage signature gets the same `400 No valid authorization key found for signature` as a correct signature over the wrong bytes.
- **It is a real API surface, not a quirk.** `@privy-io/js-sdk-core` declares both fields on `GenerateAuthorizationSignatureInput`, with `intent_id` described as binding the signature to one intent to prevent cross-intent replay. Only the prose documentation leaves them out.

## Privy signs; we broadcast

Privy cannot broadcast on Arc: `eth_sendTransaction` for `eip155:5042002` returns `401 App is not authorized to transact on chain`. So the flow uses `eth_signTransaction` and broadcasts to Arc with viem.

That is the design rather than a workaround. We pin nonce and fees, check the signed RLP field by field against what the approvers saw, confirm the quorum wallet signed it, and assert the receipt ourselves (`src/arc.ts`).

## What a Privy policy can and cannot add

This package does not use Privy policies. The same research tested them:

- **Can:** restrict the admin wallet to `createWaiver`, on our vault only, on Arc only. Negative controls were denied.
- **Cannot:** cap `duration`. Privy's calldata comparator never matches integer arguments narrower than `uint64`, and `duration` is `uint32`.

The duration bound therefore stays where it already is: `maxWaiverDuration`, enforced by the contract.

## Verified

| What | How |
|---|---|
| Signed payload is byte-identical to Privy's | Golden vectors from `@privy-io/node@0.34.0`, a differential fuzz of 5,000 random bodies against that SDK (run from `/tmp`, not committed), and the exact intent payload Privy's live `/authorize` accepted |
| Approvals are bound | A signature for one intent or timestamp does not verify for another. An approval older than 300 s is refused before it reaches Privy. |
| Whole flow, offline | `test/service.test.ts` runs propose, two browser-style approvals, Privy signing, verification and broadcast against a fake Privy that enforces the authorize recipe and window, and a fake Arc |
| Whole flow, live | `scripts/smoke.ts` passes all three steps against the live API. `scripts/provision-facility.ts` drove `QuorumAdminService` end to end four times, from proposal through a successful receipt on Arc. |
| Refusals | A bad signature never reaches Privy. A non-member key is refused. A signed transaction differing in any field, or signed by any other address, is not broadcast. Only one proposal is in flight at a time. |

Also found: an intent lists its members' keys in PEM, while key quorums list the same keys as bare SPKI. `keyMembers()` normalizes both to bare SPKI.

Not yet run live: the approver UI in a browser against this facility. It uses the same service and recipe, and its approval route is covered by `test/service.test.ts`.

## Limits to state plainly

- The approver keys are plaintext files readable only by their owner, not passkeys or hardware keys. That is adequate for a testnet demo, and it should be said.
- An approval must reach Privy within 300 s of its payload being fetched. The UI fetches the payload when the approver clicks, so this only bites if a request stalls.
- The server holds the Privy app secret, binds to localhost and has no login. It is a demo server.
- One proposal at a time: each pins the admin wallet's next nonce.
