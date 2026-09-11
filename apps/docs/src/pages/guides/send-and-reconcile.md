---
title: "Send and reconcile an operation"
description: "Send a draw, read a refusal that broadcast nothing, and reconcile a transaction whose receipt never arrived, using the operation journal and signa tx show."
---

# Send and reconcile an operation

Every command that signs follows the same path, and it is worth knowing it before sending anything:

1. Verify the chain, the facility and the signer's role.
2. Simulate the exact call, as that signer, at one block.
3. Record the intent, broadcast **once**, and record the hash **before** waiting.
4. Decide by the receipt.

:::warning
Every example here was captured against a **local Anvil chain**, not Arc Testnet.
:::

## A draw that succeeds

```bash
pnpm signa draw send --amount 1 --account signa-operator
```

```json
{
  "request": { "function": "draw", "amount": { "usdc": "1.000000" }, "sender": "0x70997970…79C8" },
  "broadcast": true,
  "transaction": {
    "hash": "0xdb7177d4…a87d",
    "status": "success",
    "block": { "number": "16" },
    "gasUsed": "231776",
    "events": [{ "name": "CovenantSynchronized", "args": { "previousState": "1", "newState": "1", "coverageBps": "10000" } }]
  },
  "vault": { "balance": { "usdc": "1.500000" }, "principal": { "usdc": "1.000000" }, "availableToDraw": { "usdc": "1.000000" } },
  "covenant": { "storedState": "COMPLIANT", "activeWaiver": false }
}
```

The vault figures are read at the receipt's own block, not at the block the command started from, so they describe the facility *after* the draw. The `CovenantSynchronized` event is the vault syncing the covenant as part of the draw.

Only the facility's operator can draw. Any other signer is refused before anything is simulated, with `SIGNER_ROLE_MISMATCH`.

## A draw that is refused

```json
{
  "code": "ACTION_REFUSED",
  "message": "draw was refused: ReserveViolation, because it would leave the vault below its reserve. Balance 1.500000, requested 2.000000, reserve 0.500000 USDC. Nothing was broadcast.",
  "retryable": false
}
```

**`ACTION_REFUSED` means nothing reached the chain.** No transaction, no gas, no nonce consumed. The covenant sync the draw would have performed is discarded with the refused call, so the vault's stored state is untouched.

There are two places a send can be refused: our own simulation, and the gas estimation `cast` performs before broadcasting. The second one matters, because it catches a facility that changed after the simulation. Both exit nonzero and broadcast nothing. [Error codes](/reference/errors) has a table of exactly which outcomes broadcast and which do not.

## The operation journal

Every send writes to an append-only journal, as JSON lines. It lives **outside** the repository — `$XDG_STATE_HOME/signa/operations.jsonl` by default, or `SIGNA_JOURNAL` — because it names real accounts and real transactions, and a working copy is the wrong place for that. A path inside a checkout is refused outright.

```json
{"at":"2026-09-11T23:34:25.679Z","command":"draw send","function":"draw","event":"simulated","status":"permitted"}
{"at":"2026-09-11T23:34:25.711Z","command":"draw send","function":"draw","event":"broadcast","hash":"0xdb7177d4…a87d"}
{"at":"2026-09-11T23:34:25.712Z","command":"draw send","function":"draw","event":"outcome","hash":"0xdb7177d4…a87d","status":"success"}
```

The `broadcast` line is written **before** the wait for a receipt begins. If the wait times out, the terminal is closed, or the machine dies, the hash is already on disk.

## When no receipt arrives

A send waits up to `--timeout` seconds, 120 by default. If nothing arrives:

```json
{
  "code": "TRANSACTION_PENDING",
  "message": "syncCovenant was broadcast as 0xd4a5e4e7…c86b but no receipt arrived within 1s. It was not retried or replaced, and it may still be mined. Reconcile it with `signa tx show 0xd4a5e4e7…c86b`.",
  "retryable": true,
  "cta": { "commands": [{ "command": "signa tx show 0xd4a5e4e7…c86b" }] }
}
```

**The transaction is not retried, and not replaced.** It may still be mined. Sending again would risk doing the same thing twice, and that is always your explicit decision, never one made for you.

## Reconcile it

```bash
pnpm signa tx show 0xd4a5e4e7…c86b
```

```json
{
  "hash": "0x5e466010…4a01",
  "state": "mined",
  "status": "success",
  "transaction": { "block": { "number": "17" }, "gasUsed": "231776", "events": [] },
  "revert": null
}
```

`tx show` reports one of three states: `pending`, `mined`, or `unknown` to this node. A mined transaction that reverted carries its decoded reason, recovered by replaying the call at its own block:

```json
{ "state": "mined", "status": "reverted", "revert": { "error": "StaleSequence", "explanation": "the contract refused with StaleSequence" } }
```

## A receipt decides, not the signing tool

`cast send` exits 0 for a transaction whose receipt says `status 0x0`. A transaction that was broadcast and reverted is a **failed action**: `signa` reports `TRANSACTION_REVERTED` and exits nonzero, and the journal records it as reverted. Nothing in Signa treats a signing tool's exit code as the answer.

Next: [Inspect a facility](/guides/inspect-a-facility) for the read-only view, or [Commands](/reference/commands) for every option.
