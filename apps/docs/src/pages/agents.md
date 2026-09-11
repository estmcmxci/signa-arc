---
title: For agents
description: How an agent should drive signa. One JSON document on stdout, schemaVersion 1, live versus recorded data, error codes and exit codes, the command manifest, and the Markdown versions of these pages.
---

# For agents

## Run it

```bash
pnpm -s signa status --json
pnpm -s signa evidence show --json
```

With `--json`, stdout is exactly one JSON document. Use pnpm's `-s` flag so its own banner does not land on stdout. Every command here is read-only: none takes a key, and none sends a transaction.

## Read the result

Every result carries these fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1`. A breaking change to the result shape increments it. |
| `kind` | `report` for everything in this release. |
| `dataMode` | `live`: read from Arc Testnet at the block in `context.block`. `recorded`: copied from a bundled historical record, with its `recordedAt` and source SHA-256. |

**Never treat `recorded` data as the facility's current state.** `evidence show` describes transactions that happened when each record was made. Coverage evidence expires, so a facility that was COMPLIANT in a record may not be now.

`status` reports connectivity and deployment wiring only. It does not report coverage, covenant state, or whether a draw would be permitted.

## Branch on error codes

On failure, stdout carries `{ "code": "…", "message": "…" }` and the exit code is 1. Branch on `code`, never on the message.

| Code | Raised when |
|---|---|
| `INVALID_INPUT` | An option has the wrong shape, such as an RPC URL that is not http(s). |
| `INVALID_MANIFEST` | The manifest cannot be read, is not JSON, or fails validation. There is no fallback to another manifest. |
| `CHAIN_MISMATCH` | The RPC is not on Arc Testnet (5042002). |
| `DEPLOYMENT_MISMATCH` | A contract has no code, a read reverts or returns nothing, or the wiring differs from the manifest. |
| `RPC_UNAVAILABLE` | The RPC could not be reached or failed. Retrying may help. |
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
