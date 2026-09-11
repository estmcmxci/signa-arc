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
| `INVALID_INPUT` | An argument, option or input file has the wrong shape. Examples: an RPC URL that is not http(s); a draw amount that is not a positive six-decimal number; a credential envelope that is malformed, or signed for another chain, registry or facility. | status, facility show, coverage show, credentials list, credentials inspect, draw simulate |
| `INVALID_MANIFEST` | The deployment manifest cannot be read, is not JSON, or fails validation. There is no fallback to another manifest. | every command that reads a manifest |
| `CHAIN_MISMATCH` | The RPC is not on Arc Testnet (5042002). | status, facility show, coverage show, credentials list, draw simulate |
| `DEPLOYMENT_MISMATCH` | The chain disagrees with the manifest. A contract has no code; a read reverts or returns nothing; or the wiring differs, as with a vault bound to another facility or an operator the facility does not name. | status, facility show, coverage show, credentials list, draw simulate |
| `RPC_UNAVAILABLE` | The RPC could not be reached, or failed. Retrying may help. | status, facility show, coverage show, credentials list, draw simulate |
| `INVALID_SIGNATURE` | A credential envelope's digest does not match its credential, or its signature does not recover to the claimed issuer. | credentials inspect |
| `SIMULATION_FAILED` | The simulated draw reverted without revert data, or with data that no known contract error decodes. Unlike a decoded refusal, which is a completed inquiry, this is a failed one. | draw simulate |

## From incur, the command framework

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | An argument or option failed its schema. `fieldErrors` names each one. |
| `COMMAND_NOT_FOUND` | No such command. |
| `UNKNOWN` | An unknown flag, or an unexpected failure. |
| `UPDATE_FAILED` | `--update` cannot run: `signa` is not published. |

## Reserved

These codes are fixed now so the set stays stable when write commands arrive. Nothing raises them yet.

| Code | Meaning |
|---|---|
| `STALE_SEQUENCE` | Reserved for P1 credential submission: the registry already holds this sequence or a later one. |
| `SIGNER_UNAVAILABLE` | Reserved for P1 operations: no signer could be opened. |
| `SIGNER_ROLE_MISMATCH` | Reserved for P1 operations: the signer is not the role the operation needs. |
| `ACTION_REFUSED` | Reserved for P1 operations: a requested send refused during preflight. Nothing was broadcast. |
| `TRANSACTION_REVERTED` | Reserved for P1 operations: the transaction was mined with receipt status 0x0. |
| `TRANSACTION_PENDING` | Reserved for P1 operations: no receipt arrived before the timeout. The hash is kept. |

## Exit codes

| Outcome | Exit code |
|---|---|
| A completed report, including an offline inspection | 0 |
| A completed simulation, whether the draw is permitted or refused | 0 |
| Any error above, including a failed simulation | 1 |

A refused draw is a valid covenant outcome: the inquiry succeeded, so the exit code is 0 and `allowed` is `false`. A transport failure, or a revert no contract error decodes, is a failed inquiry and exits 1.
