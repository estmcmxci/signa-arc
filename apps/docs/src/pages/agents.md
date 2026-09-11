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
```

Every command and option is in [Commands](/reference/commands), and every code in [Error codes](/reference/errors).

With `--json`, stdout is exactly one JSON document. Use pnpm's `-s` flag so its own banner does not land on stdout. Every command here is read-only: none takes a key, and none sends a transaction.

## Read the result

Every result carries these fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1`. A breaking change to the result shape increments it. |
| `kind` | `report` for reads, `simulation` for `draw simulate`. |
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
| `cta` | `COMMAND_NOT_FOUND` | incur's suggested next commands, as `{ description, commands: [{ command, description }] }`. |
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
| `VALIDATION_ERROR` | An argument or option failed its schema, such as an unknown evidence record. |
| `COMMAND_NOT_FOUND` | No such command. |
| `UNKNOWN` | An unknown flag, or an unexpected failure. |

RPC URLs in messages and results are redacted, so a key in the URL is not printed.

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
