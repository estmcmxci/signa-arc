---
title: "Error codes"
description: "Every code signa can print, what it means, which command raises it, and the exit codes. Consumers branch on the code, never on the message."
---

# Error codes

On failure the exit code is 1 and stdout carries one JSON object. Branch on `code`; the message may change between releases.

| Field | Present | Meaning |
|---|---|---|
| `code` | always | One of the codes below. |
| `message` | always | Human-readable detail. |
| `retryable` | Signa's own codes | `true` when the same request may succeed later, as after an RPC outage. |
| `cta` | `COMMAND_NOT_FOUND` | incur's suggested next commands. |
| `fieldErrors` | `VALIDATION_ERROR` | incur's failing fields, each with `path`, `code` and `message`. |

## Raised in this release

| Code | Meaning | Raised by |
|---|---|---|
| `INVALID_INPUT` | An argument, option or input file has the wrong shape. Examples: an RPC URL that is not http(s); a draw amount that is not a positive six-decimal number; a credential envelope that is malformed, or signed for another chain, registry or facility. | every command that takes input, including every write command |
| `INVALID_MANIFEST` | The deployment manifest cannot be read, is not JSON, or fails validation. There is no fallback to another manifest. | every command that reads a manifest |
| `CHAIN_MISMATCH` | The RPC is not on Arc Testnet (5042002). A write command checks this before it opens a keystore. | every live command |
| `DEPLOYMENT_MISMATCH` | The chain disagrees with the manifest. A contract has no code; a read reverts or returns nothing; or the wiring differs, as with a vault bound to another facility or an operator the facility does not name. | status, facility show, coverage show, credentials list, draw simulate |
| `RPC_UNAVAILABLE` | The RPC could not be reached, or failed. Retrying may help. | status, facility show, coverage show, credentials list, draw simulate |
| `INVALID_SIGNATURE` | A credential envelope's digest does not match its credential, or its signature does not recover to the claimed issuer. | credentials inspect |
| `SIMULATION_FAILED` | The simulated draw reverted without revert data, or with data that no known contract error decodes. Unlike a decoded refusal, which is a completed inquiry, this is a failed one. | draw simulate |
| `STALE_SEQUENCE` | The registry already holds this sequence or a later one, in the credential's own scope: (facility) for an exposure, (facility, trade commitment) for a hedge. Nothing was broadcast, and the signed envelope is left exactly as it is: a sequence is never bumped to make a submission fit. | credentials submit |
| `SIGNER_UNAVAILABLE` | No signer could be opened: no keystore of that name, a password file that does not exist, a wrong password, or Foundry's cast missing from PATH. Nothing was simulated or broadcast. | credentials submit, covenant sync, covenant restore, draw send |
| `SIGNER_ROLE_MISMATCH` | The signer is not the role the operation requires, as with a draw sent by anyone but the facility's operator. Refused before anything is simulated or broadcast. | draw send |
| `ACTION_REFUSED` | The action was refused before anything was broadcast, either by the preflight simulation or by the gas estimation that precedes a send. The decoded contract error is in the message. Nothing reached the chain and nothing was spent. | credentials submit, covenant sync, covenant restore, draw send |
| `TRANSACTION_REVERTED` | The transaction was broadcast and mined with receipt status 0x0. The receipt decides this, not the signing tool, which exits 0 on a transaction whose receipt reverts. The hash is in the cta and the journal. | credentials submit, covenant sync, covenant restore, draw send |
| `TRANSACTION_PENDING` | The transaction was broadcast but no receipt arrived before the timeout. It was not retried or replaced, and it may still be mined. Its hash is in the cta and the journal; reconcile it with `signa tx show`. | credentials submit, covenant sync, covenant restore, draw send |

## From incur, the command framework

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | An argument or option failed its schema. `fieldErrors` names each one. |
| `COMMAND_NOT_FOUND` | No such command. |
| `UNKNOWN` | An unknown flag, or an unexpected failure. |
| `UPDATE_FAILED` | `--update` cannot run: `signa` is not published. |

## Was anything broadcast?

For a write command this is the question that matters, and the code answers it on its own. incur fixes the error document to `code`, `message` and `retryable`, so a failure that left a transaction on the chain carries its hash in the `cta` rather than in a field of its own. The operation journal records the same hash as structured JSON.

| Outcome | Broadcast | Where the hash is |
|---|---|---|
| Exit 0, a `kind: transaction` result | Yes, and mined successfully | `transaction.hash` |
| `ACTION_REFUSED`, `SIGNER_ROLE_MISMATCH`, `STALE_SEQUENCE`, `SIGNER_UNAVAILABLE`, `SIMULATION_FAILED`, `INVALID_*`, `CHAIN_MISMATCH`, `DEPLOYMENT_MISMATCH` | No. Nothing reached the chain and nothing was spent | There is none |
| `TRANSACTION_REVERTED` | Yes, and it failed: receipt status 0x0 | `cta.commands[0]`, and the journal |
| `TRANSACTION_PENDING` | Yes, and its fate is not yet known. It was not retried or replaced | `cta.commands[0]`, and the journal |
| `RPC_UNAVAILABLE` | Unknown if it happened during the wait. Check the journal | The journal, when the send got that far |

## Exit codes

| Outcome | Exit code |
|---|---|
| A completed report, including an offline inspection | 0 |
| A completed simulation, whether the draw is permitted or refused | 0 |
| A send whose transaction mined successfully | 0 |
| Any error above, including a refused send, a reverted transaction and a receipt timeout | 1 |

A refused draw is a valid covenant outcome: the inquiry succeeded, so the exit code is 0 and `allowed` is `false`. A transport failure, or a revert no contract error decodes, is a failed inquiry and exits 1.
