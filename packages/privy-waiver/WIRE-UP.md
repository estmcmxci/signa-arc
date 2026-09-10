# Privy quorum waivers: wire-up

R-F3-7: *"Under Privy, creation requires m-of-n quorum."* This package builds every part of that which can be built without a Privy account. This file is the checklist for when credentials arrive.

No dependency was added. `@privy-io/node` is not used; `src/authorization.ts` reproduces its signing byte for byte (see "Verified without credentials").

## A correction to the research plan

The research's Step 1, *"transfer the CovenantVault facility-admin role to `wallet.address`"*, cannot be done on the deployed contracts:

- `FacilityRegistry` writes a facility's policy, `admin` included, exactly once, in `createFacility`. It has no admin setter.
- `CovenantVault` binds its `facilityId` immutably.

So the live facility's admin is `0x5cD42354a8adc5fD87717528662Dc0990617D428` for good, and a Privy wallet can never administer the vault lane B's acceptance run uses. `onlyAdmin` being `msg.sender`-based is true, but it does not help, because the admin cannot change.

What does work, with no contract change and no redeploy of the existing four:

- The quorum's wallet creates **its own facility** in the same `FacilityRegistry`, under the same PRD §7 policy.
- A **second `CovenantVault`** is bound to that facility.
- Every setup call (`createFacility`, both issuer approvals, `freezeFacility`) is itself a quorum-approved intent, so the policy is created under quorum as well as the waivers. `src/facility-setup.ts` reads the chain and proposes whatever step is still missing.

The cost is a second facility and vault on chain. They need a manifest entry, which is a schema addition to EED §4, and a place in the story.

## Verified without credentials

| What | How |
|---|---|
| Signed payload is byte-identical to `@privy-io/node@0.34.0` | Golden vectors in `test/authorization.test.ts`, plus a differential fuzz of 5,000 random bodies against the real SDK (run from `/tmp`, not committed) |
| Signatures are interchangeable | The SDK's signature verifies here. Ours verify under `@noble/curves`, the SDK's own library. Browser WebCrypto signatures convert to DER and verify. |
| Whole flow | `test/service.test.ts` runs propose, two browser-style approvals, Privy signing, verification and broadcast against a fake Privy (through the real HTTP client) and a fake Arc |
| Refusals | A bad signature never reaches Privy. A non-member key is refused. A signed transaction differing in any field, or signed by any other address, is not broadcast. A request Privy recorded differently is not stored. Only one proposal is in flight at a time. |
| Arc side | Calls are simulated before pinning nonce, gas and fees. Receipt status is asserted, never an exit code (A-9). |

## Results with real credentials, 2026-09-10

`scripts/smoke.ts` run against a free Developer app:

1. **Key quorum creation: passes.** A 2-of-2 quorum and a wallet it owns are created. `GET /v1/key_quorums/{id}` lists the members under `authorization_keys[].public_key` as bare base64 SPKI. Creation takes `public_keys`; there is no `public_keys` field in the response.
2. **Signing for chain 5042002: passes.** Synchronous signing with both keys returns RLP that verifies and recovers to the wallet. Arc is not a blocker.
3. **`POST /v1/intents/{id}/authorize`: fails.** Both payload variants return `400 {"error":"No valid authorization key found for signature","code":"invalid_data"}`. The same signature verifies locally under a member key the intent lists. So the key and the signing are right, and Privy verifies different bytes than `{version, method, url, body, headers}` built from `request_details`. This was not pursued further; the synchronous path is the fallback.
4. **The executed intent's `action_result.response_body`: still unobserved,** because no intent has executed.

Also found: an intent lists its members' keys in PEM (`authorization_details[].members[].public_key`), while key quorums list the same keys as bare SPKI. `keyMembers()` now normalizes both to bare SPKI. Before that, the service could not match an approver to a member.

## Steps, once credentials exist

| # | Step | Time |
|---|---|---|
| 0 | Sign up at dashboard.privy.io, create an app, copy the App ID and App secret | 15 min |
| 1 | `cp packages/privy-waiver/.env.example packages/privy-waiver/.env`, then fill in `PRIVY_APP_ID` and `PRIVY_APP_SECRET` | 2 min |
| 2 | Smoke test: `node --env-file=packages/privy-waiver/.env --import tsx packages/privy-waiver/scripts/smoke.ts`. With the credentials in the repository root's `.env`, run `set -a; . ./.env; set +a` first. Expect `[1]` and `[2]` to pass. `[3]` fails today (see Results above), so waivers need the synchronous fallback until it is resolved. | 5 min |
| 3 | Start the server with `PRIVY_WALLET_ID` empty (key-setup mode, no credentials used): `node --env-file=packages/privy-waiver/.env --import tsx packages/privy-waiver/src/main.ts`, then open http://127.0.0.1:8787. Each approver enters a name and presses **Create a key here**. Use two browser profiles for two approvers. | 5 min |
| 4 | `smoke.ts --public-keys=<first>,<second>` with the two public keys the page shows. Put the printed `PRIVY_WALLET_ID` in `.env` and restart the server. | 5 min |
| 5 | Fund the admin wallet with gas: `cast send <address> --value 1ether --account signa-arc-admin --rpc-url https://rpc.testnet.arc.network --json`. Check `status` is `0x1`. | 5 min |
| 6 | Facility setup: **Propose next facility setup step**, both approve, **Verify and broadcast to Arc**. Repeat for create, exposure issuer, hedge issuer and freeze. The fifth press prints the vault's `forge create` command. | 30 min |
| 7 | Run that command. Verify the vault on Blockscout through the v2 standard-input endpoint (the Etherscan-style `/api` throttles; see `output/arc-deploy-evidence.md`). Set `PRIVY_WAIVER_VAULT`, restart, and record the facility and vault in `deployments/arc-testnet.json`. | 30 min |
| 8 | `cast send <vault> 'syncCovenant()'` so the fresh facility, which has no credentials, reads CURE (a waiver cannot be created while COMPLIANT). Then propose the waiver in the UI, both approve, and broadcast. `WaiverCreated` is decoded and the page shows WAIVED. | 15 min |
| 9 | Optional: fund the vault and draw as the operator. `assess` returns `(true, MISSING_EXPOSURE)`, which is "permitted while non-compliant". | 15 min |

A throwaway shortcut replaces steps 3 and 4: use the smoke-test wallet as the demo admin and import `approver-a.json` and `approver-b.json` into two browsers. It is faster, but the approver keys were created on the server.

## If authorize is rejected

- The smoke test prints Privy's error for each payload variant. First check that `request_details.url` has no trailing slash and that `timestamp` is in milliseconds.
- Ask in Privy's Slack (privy.io/slack) with the intent ID and the exact canonical payload. The payload shows in the UI under "What you sign".
- Fallback that still satisfies R-F3-7: the synchronous path, which step [2] of the smoke test already proves. Both approvers' signatures go in one request's `privy-authorization-signature` header, so the 2-of-2 is still enforced in Privy's enclave. What is lost is the asynchronous human flow, because the two signatures have to be collected before the request.

## Limits to state plainly

- Approver keys are non-extractable WebCrypto keys in the browser's IndexedDB, not passkeys. Privy's passkey hook is React-only.
- The server holds the Privy app secret, binds to localhost and has no login. It is a demo server.
- One proposal at a time: each pins the admin wallet's next nonce.
- The quorum administers the second facility, not the one the acceptance run uses.
