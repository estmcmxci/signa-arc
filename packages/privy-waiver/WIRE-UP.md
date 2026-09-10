# Privy quorum waivers: wire-up

R-F3-7: *"Under Privy, creation requires m-of-n quorum."* This package implements that flow. `scripts/smoke.ts` runs its Privy half end to end against the live API, and all three steps pass. This file is the checklist for putting the flow on chain.

No dependency was added. Neither `@privy-io/node` nor `@privy-io/js-sdk-core` is used; the latter pins viem 2.56.0 exactly, against our 2.56.3. `src/authorization.ts` reproduces Privy's signing byte for byte.

## A correction to the research plan

The research's Step 1, *"transfer the CovenantVault facility-admin role to `wallet.address`"*, cannot be done on the deployed contracts:

- `FacilityRegistry` writes a facility's policy, `admin` included, exactly once, in `createFacility`. It has no admin setter.
- `CovenantVault` binds its `facilityId` immutably.

So the live facility's admin is `0x5cD42354a8adc5fD87717528662Dc0990617D428` for good, and a Privy wallet can never administer the vault the acceptance run uses. `onlyAdmin` being `msg.sender`-based is true, but it does not help, because the admin cannot change.

What does work, with no contract change and no redeploy of the existing four:

- The quorum's wallet creates **its own facility** in the same `FacilityRegistry`, under the same PRD §7 policy.
- A **second `CovenantVault`** is bound to that facility.
- Every setup call (`createFacility`, both issuer approvals, `freezeFacility`) is itself a quorum-approved intent, so the policy is created under quorum as well as the waivers. `src/facility-setup.ts` reads the chain and proposes whatever step is still missing.

The cost is a second facility and vault on chain. They need a manifest entry, which is a schema addition to EED §4, and a place in the story.

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
- **The error message is not a diagnostic.** An empty or garbage signature gets the same `400 No valid authorization key found for signature` as a correct signature over the wrong bytes. That error says nothing about which part is wrong.
- **It is a real API surface, not a quirk.** `@privy-io/js-sdk-core` declares both fields on `GenerateAuthorizationSignatureInput`, with `intent_id` described as binding the signature to one intent to prevent cross-intent replay. Only the prose documentation leaves them out.

## Privy signs; we broadcast

Privy cannot broadcast on Arc: `eth_sendTransaction` for `eip155:5042002` returns `401 App is not authorized to transact on chain`. So the flow uses `eth_signTransaction` and broadcasts to Arc with viem.

That is the design rather than a workaround. We pin nonce and fees, check the signed RLP field by field against what the approvers saw, confirm the quorum wallet signed it, and assert the receipt ourselves (`src/arc.ts`).

## What a Privy policy can and cannot add

This package does not use Privy policies. The same research tested them, and the result matters if anyone proposes one:

- **Can:** restrict the admin wallet to `createWaiver`, on our vault only, on Arc only. Negative controls were denied.
- **Cannot:** cap `duration`. Privy's calldata comparator never matches integer arguments narrower than `uint64`, and `duration` is `uint32`.

The duration bound therefore stays where it already is: `maxWaiverDuration`, enforced by the contract.

## Verified without credentials

| What | How |
|---|---|
| Signed payload is byte-identical to Privy's | Golden vectors from `@privy-io/node@0.34.0`, a differential fuzz of 5,000 random bodies against that SDK (run from `/tmp`, not committed), and the exact intent payload Privy's live `/authorize` accepted |
| Signatures are interchangeable | The SDK's signature verifies here. Ours verify under `@noble/curves`, the SDK's own library. Browser WebCrypto signatures convert to DER and verify. |
| Approvals are bound | A signature for one intent or timestamp does not verify for another. An approval older than 300 s is refused before it reaches Privy. |
| Whole flow | `test/service.test.ts` runs propose, two browser-style approvals, Privy signing, verification and broadcast. It uses a fake Privy that enforces the authorize recipe and window, reached through the real HTTP client, and a fake Arc. |
| Refusals | A bad signature never reaches Privy. A non-member key is refused. A signed transaction differing in any field, or signed by any other address, is not broadcast. A request Privy recorded differently is not stored. Only one proposal is in flight at a time. |
| Arc side | Calls are simulated before pinning nonce, gas and fees. Receipt status is asserted, never an exit code (A-9). |

## Results with real credentials, 2026-09-10

`scripts/smoke.ts` run against a free Developer app. All three steps pass.

1. **Key quorum creation: passes.** A 2-of-2 quorum and a wallet it owns are created. `GET /v1/key_quorums/{id}` lists the members under `authorization_keys[].public_key` as bare base64 SPKI. Creation takes `public_keys`; there is no `public_keys` field in the response.
2. **Signing for chain 5042002: passes.** Synchronous signing with both keys returns RLP that verifies and recovers to the wallet. Arc is not a blocker.
3. **`POST /v1/intents/{id}/authorize`: passes.** Key A's approval leaves the intent pending; key B's executes it. The executed intent's `action_result.response_body.data.signed_transaction` is the transaction proposed, and it recovers to the wallet.

Also found: an intent lists its members' keys in PEM (`authorization_details[].members[].public_key`), while key quorums list the same keys as bare SPKI. `keyMembers()` normalizes both to bare SPKI.

Not yet run against the live API: the approver server and UI end to end, and the on-chain steps below. They use the same recipe as the smoke test, and `test/service.test.ts` runs them against a fake Privy that enforces it.

## Steps

Credentials live in the repository root's `.env`, which is gitignored; `packages/privy-waiver/.env.example` lists every variable. Load them with `set -a; . ./.env; set +a` before each command.

| # | Step | Time |
|---|---|---|
| 1 | Smoke test: `node --import tsx packages/privy-waiver/scripts/smoke.ts`. Expect `[1]` to `[3]` to pass. | 2 min |
| 2 | Start the server with `PRIVY_WALLET_ID` unset (key-setup mode): `node --import tsx packages/privy-waiver/src/main.ts`, then open http://127.0.0.1:8787. Each approver enters a name and presses **Create a key here**. Use two browser profiles for two approvers. | 5 min |
| 3 | `node --import tsx packages/privy-waiver/scripts/smoke.ts --public-keys=<first>,<second>` with the two public keys the page shows. Put the printed `PRIVY_WALLET_ID` in `.env` and restart the server. | 5 min |
| 4 | Fund the admin wallet with gas: `cast send <address> --value 1ether --account signa-arc-admin --rpc-url https://rpc.testnet.arc.network --json`. Check `status` is `0x1`. | 5 min |
| 5 | Facility setup: **Propose next facility setup step**, both approve, **Verify and broadcast to Arc**. Repeat for create, exposure issuer, hedge issuer and freeze. The fifth press prints the vault's `forge create` command. | 30 min |
| 6 | Run that command. Verify the vault on Blockscout through the v2 standard-input endpoint (the Etherscan-style `/api` throttles). Set `PRIVY_WAIVER_VAULT`, restart, and record the facility and vault in `deployments/arc-testnet.json`. | 30 min |
| 7 | `cast send <vault> 'syncCovenant()'` so the fresh facility, which has no credentials, reads CURE (a waiver cannot be created while COMPLIANT). Then propose the waiver in the UI, both approve, and broadcast. `WaiverCreated` is decoded and the page shows WAIVED. | 15 min |
| 8 | Optional: fund the vault and draw as the operator. `assess` returns `(true, MISSING_EXPOSURE)`, which is "permitted while non-compliant". | 15 min |

A throwaway shortcut replaces steps 2 and 3: use the smoke-test wallet as the demo admin and import `approver-a.json` and `approver-b.json` into two browsers. It is faster, but the approver keys were created on the server.

## Limits to state plainly

- Approver keys are non-extractable WebCrypto keys in the browser's IndexedDB, not passkeys.
- An approval must reach Privy within 300 s of its payload being fetched. The UI fetches the payload when the approver clicks, so this only bites if a request stalls.
- The server holds the Privy app secret, binds to localhost and has no login. It is a demo server.
- One proposal at a time: each pins the admin wallet's next nonce.
- The quorum administers the second facility, not the one the acceptance run uses.
