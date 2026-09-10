# Signa Covenant: a waiver approved by a 2-of-2 Privy quorum, on Arc Testnet

Chain 5042002, explorer https://testnet.arcscan.app. Generated 2026-09-10T23:19:50.466Z.

Outcome: **waiver created and verified**. Arc Testnet only: testnet USDC, a fictional facility, no real counterparties. The two approvers signed from their persisted P-256 keys through the same QuorumAdminService the browser console uses.

Deployed source `5fefd2322f148cdbd713fa9b266c74b6f044b940`. Facility `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2`, vault [0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51](https://testnet.arcscan.app/address/0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51). Admin [0x55C4DD3770A44695735717CB7b7005AC7dE9edA1](https://testnet.arcscan.app/address/0x55C4DD3770A44695735717CB7b7005AC7dE9edA1): Privy wallet `zc9i4be5osru1qyzfci337mi`, owned by 2-of-2 key quorum `pbf1jtt1knpsl30eyp0z163t`, governed by policy `y5x9g8gglndai2hosm47zvxf`.

## The seven steps

| # | Step | Result | Intent | Approvals | At | Trace |
|---|---|---|---|---|---|---|
| 1 | Pre-validation against the chain | passed: the contract would accept a waiver |  |  | 2026-09-10T23:19:34.418Z | block 61473290 |
| 2 | Intent proposed to Privy | intent gpai6xsundibqomhtkgv8i0i: createWaiver(3600, "0x8b30d2e621581e8c20089a3602b4250bb0055e33c706efeb57b0379b763d4adc") | pending | 0 of 2 | 2026-09-10T23:19:35.164Z | Privy intent gpai6xsundibqomhtkgv8i0i |
| 3 | Risk officer authorized | signature checked against the quorum member key, then accepted by POST /v1/intents/{id}/authorize | pending | 1 of 2 | 2026-09-10T23:19:36.418Z | signed payload sha256 51e86d3fc1e1eb8318fd3f6828c1b6a046f4be75c87424cc2bcf927e72920619 |
| 4 | Treasury lead authorized | signature checked against the quorum member key, then accepted by POST /v1/intents/{id}/authorize | executed | 2 of 2 | 2026-09-10T23:19:39.484Z | signed payload sha256 3b0fcf2c42e0f1c7117b51705ffd27070796d1742b7c15df997dfdf075706ca0 |
| 5 | Signed transaction broadcast to Arc with viem | eth_sendRawTransaction of action_result.response_body.data.signed_transaction; Privy cannot send on Arc |  |  | 2026-09-10T23:19:46.448Z | [0xf6f7d9ec…](https://testnet.arcscan.app/tx/0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b) |
| 6 | Receipt and WaiverCreated asserted | receipt status 0x1; exactly one WaiverCreated, naming this facility and committing to keccak256 of the stated reason |  |  | 2026-09-10T23:19:42.000Z | 0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b, block 61473309 |
| 7 | Read back from the chain | activeWaiver() = true, covenantState() = WAIVED, waiver ends 2026-09-11T00:19:42.000Z |  |  | 2026-09-10T23:19:46.000Z | block 61473317 |

## Pre-validation

**Passed.** Passed at block 61473290: the facility was CURE and not compliant (6840 of 10000 bps, BELOW_THRESHOLD), no waiver was active, the vault is this facility's and its admin is this wallet, so the contract would accept a waiver and it was proposed.

At block 61473290: covenant state **CURE**, coverage 6840 of 10000 bps (BELOW_THRESHOLD; exposure ELIGIBLE; 1 of 1 hedges eligible), waiver active: false, longest waiver 259200 s.

That state was set by `CovenantSynchronized` in [0x9cb2636d23fa7b44d5d5ac45fac37a6632563ac77645772c5c560d061109f3fb](https://testnet.arcscan.app/tx/0x9cb2636d23fa7b44d5d5ac45fac37a6632563ac77645772c5c560d061109f3fb), block 61472429: facilityId `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2`, previousState `COMPLIANT`, newState `CURE`, coverageBps `6840`, requiredCoverageBps `10000`, outstandingValue `1000000`, grossEligible `684000`, countedEligible `684000`, reason `BELOW_THRESHOLD`, cureDeadline `1789513928 (2026-09-15T23:12:08.000Z)`.

Credential updates to this facility since the earlier refusal:

| Event | Transaction | Block | Arguments |
|---|---|---|---|
| HedgeCredentialAccepted | [0x0bc3d814…](https://testnet.arcscan.app/tx/0x0bc3d814570bf18fd317c8dd4794841ba838ba988741bd9a3e21c0eb4c42b04a) | 61472419 | facilityId `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2`, tradeIdCommitment `0xea65d291768b8a3968f0b3fc5d79bdfa39d68d1f4fa11eff157b909b94dde664`, issuer `0xAD515A2BE433e78B6b570064797626012e272e0a`, digest `0x6d46e4947322d679add970120715c9189eb0704454e61e0ade9363714f0d559c`, sequence `5`, status `0`, remainingNotional `720000`, acceptedAt `1789081923 (2026-09-10T23:12:03.000Z)` |

### It refused earlier, while the facility was compliant

The same guard refused a waiver at this block, while the facility was compliant. scripts/run-waiver.ts --check and the console's POST /api/waivers (HTTP 409) both answered with the refusal below, and nothing was proposed to Privy. It is re-derived here from the chain's state at that block.

At block 61465637 (2026-09-10T22:14:12.000Z): covenant state **COMPLIANT**, coverage 10000 of 10000 bps (NONE). The guard's verdict at that block:

> the facility is compliant (coverage 10000 bps, 10000 required), and createWaiver refuses a compliant facility

## What was approved

| | |
|---|---|
| Privy intent | `gpai6xsundibqomhtkgv8i0i`, created 2026-09-10T23:19:35.164Z |
| Stated reason (offchain) | Hedge roll on ARC-EUR-USD-001: the maturing EUR/USD forward has been rolled and the replacement leg is booked, but the counterparty's trade confirmation is still pending, so only the partially funded leg counts and coverage reads 68.4% against 100% required. One-hour waiver while treasury chases the confirmation; if it is not received and evidenced before expiry the facility returns to cure. Credit ref CR-0911-07. |
| reasonCommitment | `0x8b30d2e621581e8c20089a3602b4250bb0055e33c706efeb57b0379b763d4adc` = keccak256 of the stated reason |
| Call | `createWaiver(3600, "0x8b30d2e621581e8c20089a3602b4250bb0055e33c706efeb57b0379b763d4adc")` on the vault |
| Pinned | chain 5042002, nonce 4, gas limit 207398, fee cap 50500000000 wei, value 0 |

## Approvals: 2 of 2

Each approver signed Privy's authorization payload for this intent (its recorded request, `intent_id` and `timestamp`) with ECDSA P-256. Each signature was checked against the quorum member key before it was forwarded to `POST /v1/intents/{id}/authorize`, and is re-verified here against the intent as Privy now returns it.

| Order | Approver | Public key | Signed at (Privy) | Payload SHA-256 | Signature verifies |
|---|---|---|---|---|---|
| 1 | Risk officer | `MFkwEwYHKoZIzj0C…hSOPAIy+0A==` | 2026-09-10T23:19:36.418Z | `51e86d3fc1…` | yes |
| 2 | Treasury lead | `MFkwEwYHKoZIzj0C…ODQtoZqPvA==` | 2026-09-10T23:19:39.484Z | `3b0fcf2c42…` | yes |

## Signed by Privy, broadcast by us

Privy executed the intent at 2026-09-10T23:19:40.977Z and returned the signed transaction. It recovers to `0x55C4DD3770A44695735717CB7b7005AC7dE9edA1`, the admin wallet, and every field matches what the approvers were shown. Privy cannot broadcast on Arc (`401 App is not authorized to transact on chain`), so it was sent with viem.

| Criterion | Action | Transaction | Block | Sender | Expected | Actual | Gas used | Covenant state |
|---|---|---|---|---|---|---|---|---|
| R-F3-7 | createWaiver, 3600 s | [0xf6f7d9ec…](https://testnet.arcscan.app/tx/0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b) | [61473309](https://testnet.arcscan.app/block/61473309) | `0x55c4dd3770a44695735717cb7b7005ac7de9eda1` | 0x1 | 0x1 | 170313 | CURE → WAIVED |

Transaction `0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b`, mined 2026-09-10T23:19:42.000Z.

Signed transaction, as Privy returned it:

```
0x02f8b4834cef5204844a817c80850bc208d90083032a2694a68fb25ba98d522ce8326471a6b6bf3732e3bf5180b8446738bca70000000000000000000000000000000000000000000000000000000000000e108b30d2e621581e8c20089a3602b4250bb0055e33c706efeb57b0379b763d4adcc080a0922b2217c70e771204f869ec7d40b788cfed4ba8a0a1a098fad3cf2015bac870a058eaf671c35c96c3e58e77910ecd817973305968a4a23b445cb472083eb15796
```

## Events in the receipt

| Contract | Event | Arguments |
|---|---|---|
| CovenantVault | CovenantSynchronized | facilityId `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2`, previousState `CURE`, newState `CURE`, coverageBps `6840`, requiredCoverageBps `10000`, outstandingValue `1000000`, grossEligible `684000`, countedEligible `684000`, reason `BELOW_THRESHOLD`, cureDeadline `1789513928 (2026-09-15T23:12:08.000Z)` |
| CovenantVault | WaiverCreated | facilityId `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2`, reasonCommitment `0x8b30d2e621581e8c20089a3602b4250bb0055e33c706efeb57b0379b763d4adc`, startsAt `1789082382 (2026-09-10T23:19:42.000Z)`, endsAt `1789085982 (2026-09-11T00:19:42.000Z)` |

## Read back from the chain

At block 61473317 (2026-09-10T23:19:46.000Z): `activeWaiver()` = **true**, `covenantState()` = **WAIVED**, waiver ends 2026-09-11T00:19:42.000Z. Covenant state before: CURE, at block 61473290.

## Assertions

- preValidationPassed: yes
- bothApproversSigned: yes
- everyRecordedSignatureVerifies: yes
- signedByTheAdminWallet: yes
- signedTransactionIsTheApprovedOne: yes
- broadcastHashIsTheSignedTransaction: yes
- receiptStatusIs0x1: yes
- exactlyOneWaiverCreated: yes
- waiverCreatedNamesThisFacility: yes
- waiverCreatedCommitsToTheStatedReason: yes
- activeWaiverReadBackTrue: yes
- covenantStateReadBackWaived: yes
- serviceAssertionsPassed: yes

## Policy on the admin wallet

From [arc-policy-evidence.md](arc-policy-evidence.md), checked 2026-09-10T22:13:56.817Z. Privy evaluates the policy when it executes an intent, so this waiver passed it.

| Control | Expected | Actual |
|---|---|---|
| createWaiver on the facility vault | allowed | allowed |
| revokeWaiver on the facility vault | denied | denied |
| createWaiver on the FacilityRegistry | denied | denied |
| createWaiver on the vault, chain 1 | denied | denied |
| createWaiver above maxWaiverDuration | allowed | allowed |
| Change the wallet's policies with one approver's signature | refused | refused |
| Change the policy with the app secret alone | refused | refused |
