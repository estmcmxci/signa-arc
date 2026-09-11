---
title: Recorded on Arc Testnet
description: The recorded draw that was permitted, refused and permitted again, the coverage drop, the 2-of-2 quorum waiver and the restoration, each with its transactions. Historical records, not current state.
---

# Recorded on Arc Testnet

:::warning
Recorded evidence: what these Arc Testnet transactions did when each record was made. It is not the facility's current state; `signa status` checks the live deployment.
:::

Four records, in the order they were made, from one fictional facility on Arc Testnet (chain 5042002) with labelled mock provider data and testnet USDC. A signature authenticates who asserted what. It does not prove that a hedge legally exists.

`pnpm signa evidence show` prints the same records, and `pnpm -s signa evidence show <record> --json` prints one of them as JSON.

| Record | Recorded | Outcome | Transactions |
|---|---|---|---|
| `acceptance` | 2026-09-10T21:47:22.156Z | complete | 10 |
| `coverage-drop` | 2026-09-10T23:12:02.566Z | complete | 2 |
| `waiver` | 2026-09-10T23:19:50.466Z | waiver created and verified | 1 |
| `restore` | 2026-09-11T00:19:53.382Z | complete | 2 |

## Signa Covenant: A-1 … A-4 on Arc Testnet

The A-1 to A-4 acceptance run: the same draw attempted three times while the coverage evidence underneath it changed.

- **Record:** `acceptance`, recorded 2026-09-10T21:47:22.156Z, outcome complete
- **Source:** `scenarios/output/arc-facility-evidence.json`, SHA-256 `ab2888170ecc024ecbe211d8c9a514d34db7dd783632894273118230a9b8c133`
- **Summary:** A-2 draw 1000000: receipt 0x1 (expected 0x1) at 10000 bps, COMPLIANT; A-3 draw 1000000: receipt 0x0 (expected 0x0) at 6840 bps, CURE; A-4 draw 1000000: receipt 0x1 (expected 0x1) at 10000 bps, COMPLIANT

| Step | Action | Transaction | Block | Expected | Actual | Coverage (bps) | Covenant state |
|---|---|---|---|---|---|---|---|
| A-1 | deposit 2500000 (facility funding) | [0x0ce7305b…](https://testnet.arcscan.app/tx/0x0ce7305bd96565c50e9d5ba1605ea23714fdb7960cbc303f12da349a974f4625) | 61462379 | 0x1 | 0x1 | 0 | UNASSESSED |
| A-1 | submit exposure credential seq 1 (1.000000 USD) | [0x7cdfc40d…](https://testnet.arcscan.app/tx/0x7cdfc40d07c9269766de7d794b8d4c45d2a28654982f75b9ef4cf7e8c1f1e463) | 61462497 | 0x1 | 0x1 | 0 | UNASSESSED |
| A-1 | submit hedge seq 1 (1.060000 USD, booked) | [0x74624886…](https://testnet.arcscan.app/tx/0x74624886be53a97ffb19975c75df721b109c99559e5083a9e3f236af515a827e) | 61462507 | 0x1 | 0x1 | 10000 | UNASSESSED |
| A-2 | draw 1000000 | [0x89b939cd…](https://testnet.arcscan.app/tx/0x89b939cd1315a295ab1d0b44b4b8a1d33abe7bd0ffc502af864a415c1f715ef6) | 61462517 | 0x1 | 0x1 | 10000 | COMPLIANT |
| A-3 | submit hedge seq 2 (0.720000 USD, partially_funded) | [0x33570a7d…](https://testnet.arcscan.app/tx/0x33570a7d13bd1301cc31a379db4319596de7066c51f49a600371286b6c8ab504) | 61462527 | 0x1 | 0x1 | 6840 | COMPLIANT |
| A-3 | syncCovenant | [0x5e2fc3ec…](https://testnet.arcscan.app/tx/0x5e2fc3ec45af81901d941a6d62413f045698a43efadb7ac942e5ec56646bdb16) | 61462536 | 0x1 | 0x1 | 6840 | CURE |
| A-3 | draw 1000000 | [0x5cad2c04…](https://testnet.arcscan.app/tx/0x5cad2c042e76a9f043eeb5988a733975d9dbf05fcb74cb58b44796581a09399a) | 61462544 | 0x0 | 0x0 | 6840 | CURE |
| A-4 | submit hedge seq 4 (1.060000 USD, booked) | [0x4d986e6d…](https://testnet.arcscan.app/tx/0x4d986e6de66d4bbabb9ab5afbf91ac1470d4de49b9680f82e09c561eed40ab3c) | 61462555 | 0x1 | 0x1 | 10000 | CURE |
| A-4 | restoreCompliance | [0xd4d2578b…](https://testnet.arcscan.app/tx/0xd4d2578bd944cd207d441c4a70e86d594eae89aa5cfb894119ca53a03896b26c) | 61462564 | 0x1 | 0x1 | 10000 | COMPLIANT |
| A-4 | draw 1000000 | [0x1ef19c5a…](https://testnet.arcscan.app/tx/0x1ef19c5a24e0fdd63ecdc0e6eee3d251041a03ddd4d4082753377ef382fb516a) | 61462573 | 0x1 | 0x1 | 10000 | COMPLIANT |

> Fictional EUR-denominated loan book. Mock provider and exposure data. Testnet USDC only; no real counterparties.
> Mock provider data — no Ebury connection or endorsement.

## Hedge update: refreshed at sequence 5, then syncCovenant

A hedge update at sequence 5 followed by syncCovenant, which moved the facility out of compliance before the waiver.

- **Record:** `coverage-drop`, recorded 2026-09-10T23:12:02.566Z, outcome complete
- **Source:** `scenarios/output/arc-hedge-update-seq-5.json`, SHA-256 `e7bd53fd63004c9c560f8108aa352fdaff227ca0477a003c03ef6aead544e916`
- **Summary:** before: COMPLIANT at 10000 bps; after block 61472429: CURE at 6840 bps

| Step | Action | Transaction | Block | Expected | Actual | Coverage (bps) | Covenant state |
|---|---|---|---|---|---|---|---|
| 1 | submit hedge seq 5 (0.720000 USD, partially_funded) | [0x0bc3d814…](https://testnet.arcscan.app/tx/0x0bc3d814570bf18fd317c8dd4794841ba838ba988741bd9a3e21c0eb4c42b04a) | 61472419 | 0x1 | 0x1 | 6840 | COMPLIANT |
| 2 | syncCovenant | [0x9cb2636d…](https://testnet.arcscan.app/tx/0x9cb2636d23fa7b44d5d5ac45fac37a6632563ac77645772c5c560d061109f3fb) | 61472429 | 0x1 | 0x1 | 6840 | CURE |

> Mock provider data — no Ebury connection or endorsement.

## Signa Covenant: a waiver approved by a 2-of-2 Privy quorum, on Arc Testnet

A waiver approved by the facility admin's 2-of-2 Privy key quorum, signed by Privy and broadcast to Arc separately.

- **Record:** `waiver`, recorded 2026-09-10T23:19:50.466Z, outcome waiver created and verified
- **Source:** `packages/privy-waiver/evidence/arc-waiver-evidence.json`, SHA-256 `5a4812cd33ca6fb3e14aff702525254814a835a60688f7444fe8764641c9b651`
- **Summary:** createWaiver 0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b: receipt 0x1 in block 61473309; covenant CURE to WAIVED until 2026-09-11T00:19:42.000Z

| Approver | Signed at |
|---|---|
| Risk officer | 2026-09-10T23:19:36.418Z |
| Treasury lead | 2026-09-10T23:19:39.484Z |

| Step | What happened | Result | At | Transaction |
|---|---|---|---|---|
| 1 | Pre-validation against the chain | passed: the contract would accept a waiver | 2026-09-10T23:19:34.418Z |  |
| 2 | Intent proposed to Privy | intent gpai6xsundibqomhtkgv8i0i: createWaiver(3600, "0x8b30d2e621581e8c20089a3602b4250bb0055e33c706efeb57b0379b763d4adc") | 2026-09-10T23:19:35.164Z |  |
| 3 | Risk officer authorized | signature checked against the quorum member key, then accepted by POST /v1/intents/{id}/authorize | 2026-09-10T23:19:36.418Z |  |
| 4 | Treasury lead authorized | signature checked against the quorum member key, then accepted by POST /v1/intents/{id}/authorize | 2026-09-10T23:19:39.484Z |  |
| 5 | Signed transaction broadcast to Arc with viem | eth_sendRawTransaction of action_result.response_body.data.signed_transaction; Privy cannot send on Arc | 2026-09-10T23:19:46.448Z | [0xf6f7d9ec…](https://testnet.arcscan.app/tx/0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b) |
| 6 | Receipt and WaiverCreated asserted | receipt status 0x1; exactly one WaiverCreated, naming this facility and committing to keccak256 of the stated reason | 2026-09-10T23:19:42.000Z | [0xf6f7d9ec…](https://testnet.arcscan.app/tx/0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b) |
| 7 | Read back from the chain | activeWaiver() = true, covenantState() = WAIVED, waiver ends 2026-09-11T00:19:42.000Z | 2026-09-10T23:19:46.000Z |  |

> Arc Testnet only: testnet USDC, a fictional facility, no real counterparties. The two approvers signed from their persisted P-256 keys through the same QuorumAdminService the browser console uses.

## Hedge update: restored at sequence 6, then restoreCompliance

A hedge update at sequence 6 followed by restoreCompliance, after the waiver had ended.

- **Record:** `restore`, recorded 2026-09-11T00:19:53.382Z, outcome complete
- **Source:** `scenarios/output/arc-hedge-update-seq-6.json`, SHA-256 `22c4ad027dc8c0ce2e564a4820e07d57806ff13a2551fcdf24140a52d20e2465`
- **Summary:** before: WAIVED at 6840 bps; after block 61480374: COMPLIANT at 10000 bps

| Step | Action | Transaction | Block | Expected | Actual | Coverage (bps) | Covenant state |
|---|---|---|---|---|---|---|---|
| 1 | submit hedge seq 6 (1.060000 USD, booked) | [0xbbfe4e28…](https://testnet.arcscan.app/tx/0xbbfe4e281fd3f793be009a7f997f9433c72a167036b5d5591b883467fed893f7) | 61480364 | 0x1 | 0x1 | 10000 | WAIVED |
| 2 | restoreCompliance | [0xf1720f81…](https://testnet.arcscan.app/tx/0xf1720f8193efc0744c922f186d5bc23e482a01872abbeb253120784b05662876) | 61480374 | 0x1 | 0x1 | 10000 | COMPLIANT |

> Mock provider data — no Ebury connection or endorsement.

---

This page is generated from the records bundled with the CLI (`pnpm generate:docs`). Each record's SHA-256 is that of the file in the repository.
