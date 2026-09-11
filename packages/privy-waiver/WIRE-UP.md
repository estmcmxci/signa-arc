# Privy quorum waivers: wire-up

R-F3-7: *"Under Privy, creation requires m-of-n quorum."* This package implements that, live on Arc Testnet. The facility's admin is a Privy server wallet owned by a 2-of-2 key quorum: a risk officer and a treasury lead. The quorum created and froze the facility and has approved its first waiver on chain. A Privy policy owned by the same quorum limits the admin key to one call, `createWaiver` on the facility's vault.

No dependency was added. Neither `@privy-io/node` nor `@privy-io/js-sdk-core` is used; the latter pins viem 2.56.0 exactly, against our 2.56.3. `src/authorization.ts` reproduces Privy's signing byte for byte.

## What works now

**The waiver flow** is `QuorumAdminService` (`src/service.ts`). The approver console and `scripts/run-waiver.ts` both drive it.

1. **Propose, after pre-validation.** Before anything goes to Privy, the service reads the chain and refuses any waiver the contract would refuse. Checks:
   - the vault's `facilityId` is the manifest's facility;
   - the facility's admin is this wallet;
   - no waiver is active;
   - a fresh `CoverageEngine.evaluate` is not compliant;
   - the duration is at most `maxWaiverDuration`, read from the registry.

   This matters because Privy evaluates the wallet's policy when it executes an intent, not when it accepts one, and the contract checks a waiver only when it is mined. Without pre-validation, a doomed waiver would collect both approvals first.

   If the waiver passes, the service:
   - hashes the stated reason with `keccak256` into `reasonCommitment`; the text stays offchain;
   - encodes `createWaiver(uint32,bytes32)` and simulates it;
   - reads the nonce from Arc and pins nonce, gas and fees;
   - proposes an `eth_signTransaction` intent.
2. **Approve twice**, as risk officer and treasury lead. Each approver:
   - fetches a fresh payload built from `GET /v1/intents/{id}`;
   - signs `{version, method, url, body, headers, intent_id, timestamp}` over Privy's normalized body.

   The service verifies the signature under a quorum member key before it posts to `/authorize`.
3. **Broadcast.** The service takes `action_result.response_body.data.signed_transaction` and checks it field by field against what was approved, and that it recovers to the admin wallet. It then sends it with viem's `eth_sendRawTransaction` and asserts:
   - the receipt status is `0x1`;
   - the receipt holds exactly one `WaiverCreated` from the vault;
   - its `facilityId` is this facility;
   - its `reasonCommitment` is `keccak256` of the stated reason.

The **policy** (`src/policy.ts`, `scripts/provision-policy.ts`) lets the wallet sign `createWaiver` on the vault, on Arc, moving no value, and nothing else. It was verified live with negative controls; see [The policy](#the-policy).

The **approver console** (`ui/approver.html`, served by `src/main.ts`) shows, for use on camera:
- each approver's key;
- why a waiver is or is not possible now, read from the chain;
- the policy;
- each waiver's progress from proposal to a checked `WaiverCreated`, with the transaction linked on Arcscan.

## Live status, 2026-09-10

| What | Result |
|---|---|
| Policy | `y5x9g8gglndai2hosm47zvxf`, owned by key quorum `pbf1jtt1knpsl30eyp0z163t`, attached to the admin wallet. Every control came out as expected: [evidence/arc-policy-evidence.md](evidence/arc-policy-evidence.md). |
| Pre-validation | **Refused** at block 61465637, while the facility was COMPLIANT at 10000 of 10000 bps after lane B's A-4 `restoreCompliance`. `scripts/run-waiver.ts --check` and `POST /api/waivers` both answered `not proposed, because the contract would refuse it: the facility is compliant (coverage 10000 bps, 10000 required), and createWaiver refuses a compliant facility`, and nothing reached Privy. **Passed** at block 61473290, once lane B had put the facility in CURE at 6840 of 10000 bps: a hedge update (sequence 5, `0x0bc3d814…`) followed by `syncCovenant` (`0x9cb2636d…`, block 61472429). |
| A live waiver | **Created, 2026-09-10.** Intent `gpai6xsundibqomhtkgv8i0i`, `createWaiver(3600, 0x8b30d2e6…4adc)`:<br>- proposed at 0 of 2;<br>- the risk officer authorized at 23:19:36.418Z: 1 of 2, still pending;<br>- the treasury lead authorized at 23:19:39.484Z: 2 of 2, executed.<br>Privy signed; we broadcast [`0xf6f7d9ec…f34b`](https://testnet.arcscan.app/tx/0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b) with viem, mined in block 61473309 with receipt `0x1`. `WaiverCreated` names this facility and commits to `keccak256` of the stated reason; the waiver runs from 23:19:42Z to 2026-09-11 00:19:42 UTC. Read back at block 61473317: `activeWaiver()` true, `covenantState()` WAIVED. Every step traces to a hash or block in [evidence/arc-waiver-evidence.md](evidence/arc-waiver-evidence.md). |
| Until it ends | The vault stays WAIVED until 2026-09-11 00:19:42 UTC. While a waiver is active, `syncCovenant` and `restoreCompliance` leave the state alone, and the policy denies `revokeWaiver`. So the facility cannot return to COMPLIANT before then. Afterwards, the next sync moves it back to CURE, or to COMPLIANT if fresh credentials make it compliant. |

## One facility, administered by the quorum

A facility's admin is set once and can never change. `FacilityRegistry` writes the policy, `admin` included, only in `createFacility`, and `CovenantVault` binds its `facilityId` immutably. So the quorum administers a new facility, which replaces the original in `deployments/arc-testnet.json`. The registries and `CoverageEngine` are reused unchanged.

`createFacility` only accepts the admin itself as sender, so the quorum's own wallet sent every setup call, each approved by both approvers. The facility's policy was created under quorum, not just its waivers.

| What | Value |
|---|---|
| Key quorum | `pbf1jtt1knpsl30eyp0z163t`, 2 of 2: risk officer, treasury lead |
| Admin wallet | Privy wallet `zc9i4be5osru1qyzfci337mi`, address `0x55C4DD3770A44695735717CB7b7005AC7dE9edA1` |
| Privy policy | `y5x9g8gglndai2hosm47zvxf`: createWaiver on the vault only, owned by the quorum |
| Facility | `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2`, PRD §7 policy, frozen |
| Vault | `0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51`, settlement asset USDC `0x3600…0000`. Verified on Blockscout. |

`scripts/provision-quorum.ts` proved the admin before any facility existed, from Privy's own responses:
- the wallet's owner is the quorum;
- the quorum lists exactly the two approver keys, with threshold 2;
- either key alone is refused;
- both keys together sign a probe that recovers to the wallet.

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

The keys live in `~/.signa-privy-waiver/approvers/` (`PRIVY_APPROVER_KEY_DIR` overrides it): `risk-officer.json`, `treasury-lead.json` and `quorum.json`, which also records the policy id. The directory is mode 700 and the files are mode 600. They are outside every repository, and `src/approvers.ts` refuses to overwrite a key once written.

**Back this directory up.** These two keys are the only way the admin wallet can sign or its policy can change, and the facility's admin can never change.

## Running the console

1. From the repository root: `set -a; . ./.env; set +a`, then `PRIVY_WALLET_ID=zc9i4be5osru1qyzfci337mi node --import tsx packages/privy-waiver/src/main.ts`. Open http://127.0.0.1:8787. Every address comes from the manifest.
2. Under **Approvers in this browser**, import each approver's `privateKey` from `risk-officer.json` and `treasury-lead.json`. The field is masked. Each card confirms the key is the quorum member the manifest names for that role. The key becomes non-extractable in this browser.
3. **Why a waiver** shows the covenant state and coverage from the chain, and whether the contract would accept a waiver now. **What the admin key may sign** shows the attached policy.
4. **Propose**. Then **Approve as Risk officer** and **Approve as Treasury lead**. Then **Verify and broadcast to Arc**. The waiver's card ticks off each step. It links the transaction on Arcscan and shows `WaiverCreated`, checked against this facility and the stated reason.

For the demo, both keys sit in one browser. In use, each approver's browser would hold only their own key.

`scripts/run-waiver.ts` runs the same flow from the persisted keys and writes the evidence. `scripts/provision-policy.ts` can be rerun at any time: it only re-verifies and rewrites the policy evidence.

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

- **Both fields together.** `intent_id` and `timestamp` are required as a pair; either one alone is rejected exactly like a wrong signature.
- **`timestamp`** must equal the one in the request body and be within 300 s of Privy's clock. Because it is inside what the approver signs, the console fetches a fresh payload at the moment of approval rather than signing whatever the page showed earlier.
- **`body`** must be Privy's copy from `GET /v1/intents/{id}`, never the body that was proposed.
- **The error message is not a diagnostic.** An empty or garbage signature gets the same `400 No valid authorization key found for signature` as a correct signature over the wrong bytes.
- **It is a real API surface.** `@privy-io/js-sdk-core` declares both fields on `GenerateAuthorizationSignatureInput`, with `intent_id` there to prevent cross-intent replay.

## Privy signs; we broadcast

Privy cannot broadcast on Arc: `eth_sendTransaction` for `eip155:5042002` returns `401 App is not authorized to transact on chain`. So the flow uses `eth_signTransaction` and broadcasts to Arc with viem. That keeps nonce, fees and the final check in our hands. The final check is: the signed RLP matches what the approvers saw, the quorum wallet signed it, and the receipt and event say what was approved.

## The policy

`y5x9g8gglndai2hosm47zvxf` has one rule: ALLOW `eth_signTransaction` when `chain_id` is 5042002, `to` is the vault, `value` is `0x0` and the calldata's function is `createWaiver`. Privy denies whatever no rule allows.

The key quorum owns the policy. Creating it needed no signature. Attaching it was a `PATCH` of the wallet signed by both approvers. Changing, deleting or detaching it takes both approvers too.

Live controls, each signed by both approvers through the synchronous RPC. Every probe has nonce 1,000,000,000 and a fee cap of 1 wei, so none could ever be mined, and none was sent:

| Control | Varies | Expected | Actual |
|---|---|---|---|
| createWaiver on the vault | nothing | allowed | allowed; recovers to the admin wallet |
| revokeWaiver on the vault | another function | denied | denied: `400 policy_violation` |
| createWaiver on the FacilityRegistry | another contract | denied | denied: `400 policy_violation` |
| createWaiver on the vault, chain 1 | another chain | denied | denied: `400 policy_violation` |
| createWaiver above `maxWaiverDuration` | duration | allowed | allowed: the known gap below |
| Change the wallet's policies, one approver | governance | refused | refused: `401`, signatures do not meet the threshold |
| Change the policy, app secret alone | governance | refused | refused: `401`, missing authorization signature |

What it cannot do: **cap `duration`**. Privy's calldata comparator never matches integer arguments narrower than `uint64`, and `duration` is `uint32`, so the policy does not try. The contract enforces `maxWaiverDuration`, and the service refuses a longer waiver before proposing it.

Consequences:
- **`revokeWaiver` is denied.** Ending a waiver early would first need a policy change, which both approvers sign. Otherwise a waiver ends on its own at `endsAt`. While it is active, `syncCovenant` and `restoreCompliance` leave the vault WAIVED, so compliance cannot be restored before `endsAt` either. The console no longer offers revocation or facility setup.
- **The policy runs at execution.** A policy-violating intent is accepted at proposal and fails only after both approvals, so the service proposes nothing but `createWaiver`, and only after pre-validation.

## Claims discipline

**The alternative evaluated** was a 2-of-3 Gnosis Safe as the facility admin.

**Do not claim Privy is more trust-minimised than a Safe.** A Safe does m-of-n better and more verifiably:
- its owners and threshold are on chain for anyone to read;
- every approval is a signature the chain itself checks;
- no operator stands between the approvers and the chain.

Under Privy, the chain sees one address signing. The 2-of-2 rule is enforced inside Privy's infrastructure. We can check Privy's answers, as `provision-quorum.ts` and `provision-policy.ts` do, but not its enforcement. Whoever holds the app secret can propose, though not approve.

**The honest argument for Privy** has two parts:
- **The approvers never touch a chain.** No gas, no browser extension, no seed phrase: an approver signs a payload in a web page.
- **The same primitive restricts the admin key.** It limits which function, on which contract, the admin key may ever call: here, `createWaiver` on one vault. A Safe needs an audited Guard module to match that.

Say: "m-of-n approval without putting approvers on chain, and an allow-list on what the admin key can ever sign." Do not say "trustless", "more secure than a multisig" or "on-chain quorum".

## Verified

| What | How |
|---|---|
| Signed payload is byte-identical to Privy's | Golden vectors from `@privy-io/node@0.34.0`; a differential fuzz of 5,000 random bodies against that SDK (run from `/tmp`, not committed); and the exact intent payload Privy's live `/authorize` accepted |
| Approvals are bound | A signature for one intent or timestamp does not verify for another. An approval older than 300 s is refused before it reaches Privy. |
| Pre-validation | Offline: a compliant facility, an active waiver, another facility's vault, another admin and an over-long duration are each refused before any Privy request. Live: refused on the COMPLIANT facility at block 61465637, and passed on the CURE facility at block 61473290. |
| Broadcast assertions | Offline: a successful receipt whose `WaiverCreated` commits to another reason, names another facility, is missing, or comes from another contract fails `execute`, and the mined transaction is still recorded. Live: the first waiver's receipt passed every check. |
| The policy, live | Every control and governance attempt came out as expected: [evidence/arc-policy-evidence.md](evidence/arc-policy-evidence.md) |
| The flow, live | `QuorumAdminService` has run end to end on Arc five times, from proposal through a successful receipt: the four facility-setup calls through `scripts/provision-facility.ts`, and the first waiver through `scripts/run-waiver.ts`, whose `WaiverCreated` was checked and whose state was read back. |
| Refusals | A bad signature never reaches Privy. A non-member key is refused. A signed transaction differing in any field, or signed by any other address, is not broadcast. Only one proposal is in flight at a time. |

`test/` holds 36 tests for this package, all passing. Also found: an intent lists its members' keys in PEM, while key quorums list the same keys as bare SPKI. `keyMembers()` normalizes both to bare SPKI.

## Limits to state plainly

- **The approver keys are not passkeys.**
  - In the console they are WebCrypto P-256 keys, stored non-extractable in the browser's IndexedDB.
  - Privy has no server endpoint that accepts a WebAuthn assertion. A key-quorum member must produce a raw P-256 signature over Privy's payload, and a passkey signs only WebAuthn's authenticator data and client data.
  - For the scripts, the keys are plaintext files readable only by their owner.

  That is adequate for a testnet demo, and it should be said.
- **The console is a demo server.** It holds the Privy app secret, binds to 127.0.0.1 and has no login. The page says so in a banner.
- **Privy signs; we broadcast.** Nonce and fees are pinned at proposal, with the fee cap doubled. If a proposal waits long enough for fees to rise past that cap, or for its nonce to be used, it must be rejected and proposed again.
- **The policy cannot cap `duration`,** and it denies `revokeWaiver` (see above).
- **One proposal at a time.** Each pins the admin wallet's next nonce.
- **An approval must reach Privy within 300 s of its payload being fetched.** The console fetches the payload when the approver clicks, so this only bites if a request stalls.

## Asked of Privy — answered 2026-09-10

Drafted 2026-09-10 for privy.io/slack. Sending it is a two-minute job; the answer may simplify a mainnet deploy.

> Hi — we're building on Circle's Arc (EVM, chain `5042002`) using server wallets with a 2-of-2 key quorum.
>
> `eth_signTransaction` works on Arc. `eth_sendTransaction` returns `401 App is not authorized to transact on chain eip155:5042002` — other chains pass that gate. We sign and broadcast ourselves, which your docs suggest for a custom RPC. Is that the intended path, or can Arc be enabled per-app?
>
> Separately, a docs gap: `POST /v1/intents/{id}/authorize` requires `intent_id` and `timestamp` in the signed payload. Both appear in your `js-sdk-core` types but not the API reference.

Record the answer here when it arrives.

**Their answer:**

> The 401 error for Arc specifically suggests the chain isn't authorized for `eth_sendTransaction` at the app level. Continuing with `eth_signTransaction` + external broadcast is the correct workaround for custom RPCs — this is documented behavior. If you'd like Arc added as a supported chain for direct `eth_sendTransaction`, reach out to your account team or support@privy.io with your app ID and the Arc chain details.

So sign-then-broadcast is confirmed correct rather than a hack, and the limitation is removable by request. If a future deployment wants Privy to broadcast — Arc mainnet, for instance — email support@privy.io with the app ID and the chain details, and allow lead time.

They did not comment on the `intent_id` / `timestamp` documentation gap.
