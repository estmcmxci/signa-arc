---
title: For agents
description: How an agent should drive signa. One JSON document on stdout, schemaVersion 1, live versus recorded data, error codes and exit codes, the command manifest, and the Markdown versions of these pages.
---

# For agents

## Run it

```bash
pnpm -s signa status --json
pnpm -s signa facility show --json
pnpm -s signa coverage show --json
pnpm -s signa credentials list --json
pnpm -s signa draw simulate --amount 1 --json
pnpm -s signa evidence show --json
pnpm -s signa tx show 0x38b3fd96e8a065030cdc1e551394e8aa9784e59edd0f225544614069e099d414 --json
```

Every command and option is in [Commands](/reference/commands), and every code in [Error codes](/reference/errors).

With `--json`, stdout is exactly one JSON document. Use pnpm's `-s` flag so its own banner does not land on stdout.

Every command above only reads: none takes a key, and none can change anything. The commands that take `--account` sign and send, and are covered in [Did anything reach the chain?](#did-anything-reach-the-chain) below.

## Read the result

Every result carries these fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1`. A breaking change to the result shape increments it. |
| `kind` | `report` for reads, `simulation` for `draw simulate`, `transaction` for a command that sent one. |
| `dataMode` | `live`: read from Arc Testnet at the block in `context.block`. `recorded`: copied from a bundled historical record, with its `recordedAt` and source SHA-256. `offline`: computed from an input file alone, with no block and no live claim. |

**Never treat `recorded` data as the facility's current state.** `evidence show` describes transactions that happened when each record was made. Coverage evidence expires, so a facility that was COMPLIANT in a record may not be now.

`status` reports connectivity and deployment wiring only. It does not report coverage, covenant state, or whether a draw would be permitted.

## Branch on error codes

On failure the exit code is 1, and stdout carries one JSON object. Branch on `code`, never on the message.

| Field | Present | Meaning |
|---|---|---|
| `code` | always | One of the codes below. |
| `message` | always | Human-readable detail. It may change between releases. |
| `retryable` | Signa's own codes | `true` when the same request may succeed later, as after an RPC outage. |
| `cta` | `COMMAND_NOT_FOUND`, and any failure that left a transaction on the chain | incur's suggested next commands, as `{ description, commands: [{ command, description }] }`. For `TRANSACTION_PENDING` and `TRANSACTION_REVERTED` it carries the transaction hash, as `signa tx show <hash>`. |
| `fieldErrors` | `VALIDATION_ERROR` | incur's list of failing fields, each with `path`, `code` and `message`. |

| Code | Raised when |
|---|---|
| `INVALID_INPUT` | An option has the wrong shape, such as an RPC URL that is not http(s). |
| `INVALID_MANIFEST` | The manifest cannot be read, is not JSON, or fails validation. There is no fallback to another manifest. |
| `CHAIN_MISMATCH` | The RPC is not on Arc Testnet (5042002). |
| `DEPLOYMENT_MISMATCH` | A contract has no code, a read reverts or returns nothing, or the wiring differs from the manifest. |
| `RPC_UNAVAILABLE` | The RPC could not be reached or failed. Retrying may help. |
| `INVALID_SIGNATURE` | A credential envelope's digest does not match its credential, or its signature does not recover to the claimed issuer. |
| `SIMULATION_FAILED` | A simulated draw reverted with no data, or with data no known contract error decodes. A *decoded* refusal is not an error: it exits 0 with `allowed: false`. |
| `STALE_SEQUENCE` | The registry already holds this sequence or a later one. Nothing was broadcast, and the envelope is left exactly as signed. |
| `SIGNER_UNAVAILABLE` | No signer could be opened: no such keystore, a missing password file, a wrong password, or `cast` not on PATH. |
| `SIGNER_ROLE_MISMATCH` | The signer is not the role the operation needs, as with a draw from anyone but the operator. |
| `ACTION_REFUSED` | Refused before broadcast, by the simulation or by gas estimation. **Nothing reached the chain.** |
| `TRANSACTION_REVERTED` | Broadcast and mined with receipt status `0x0`. The hash is in `cta`. |
| `TRANSACTION_PENDING` | Broadcast, but no receipt before the timeout. Not retried and not replaced. The hash is in `cta`. |
| `VALIDATION_ERROR` | An argument or option failed its schema, such as an unknown evidence record. |
| `COMMAND_NOT_FOUND` | No such command. |
| `UNKNOWN` | An unknown flag, or an unexpected failure. |

RPC URLs in messages and results are redacted, so a key in the URL is not printed.

## Did anything reach the chain?

For a write command, branch on the code; it answers this on its own. incur fixes the error document to `code`, `message` and `retryable` plus a `cta`, so a failure that left a transaction on the chain carries its hash in `cta.commands[0].command`, as `signa tx show <hash>`. The operation journal holds the same hash as structured JSON, and it is written **before** the wait for a receipt begins.

- **Broadcast, succeeded:** exit 0, `kind: transaction`, hash in `transaction.hash`.
- **Broadcast, failed or unresolved:** `TRANSACTION_REVERTED` or `TRANSACTION_PENDING`.
- **Nothing broadcast:** every other code, including `ACTION_REFUSED`.

A pending transaction is never retried or replaced for you. Reconcile it with `signa tx show`, then decide.

## Write commands are not exposed over MCP

Every command that signs sets `mcp: false` and is marked destructive, so an MCP client is not handed a way to move funds. Read commands remain available.

## Discover the commands

```bash
pnpm -s signa --llms
pnpm -s signa --llms-full
pnpm -s signa status --schema --format json
```

`--llms` prints the command manifest as Markdown; `--llms --format json` prints it as JSON (`incur.v1`); `--schema` prints one command's options and output as JSON Schema. `--full-output` wraps a result as `{ ok, data, meta }`. Its `meta.duration` changes on every run, so compare `data` only.

`--update` is not available: `signa` is not published, and it fails with `UPDATE_FAILED`.

## Read these docs as Markdown

`/llms.txt` indexes every page, and `/llms-full.txt` contains all of them. The docs server (`pnpm docs:dev` or `pnpm docs:preview`) also serves each page as Markdown at `/<page>.md`, for example `/quickstart.md`. The static build writes those files under `/assets/md/`.
