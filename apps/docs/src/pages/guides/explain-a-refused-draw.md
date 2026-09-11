---
title: Explain a refused draw
description: "Simulate a draw against the real vault, read the decoded refusal, and tell the two refusals apart: the covenant state and the vault's reserve. A refusal is a valid outcome and exits 0."
---

# Explain a refused draw

A refused draw is the covenant working. This guide simulates one, reads the decoded reason, and separates a refusal from a failure.

You need a checkout ([Run locally](/run-locally)). Nothing here sends a transaction or needs a key.

## Ask the vault, not the engine

```bash
pnpm signa draw simulate --amount 1
```

`--amount 1` means one USDC, encoded as 1000000 units. The simulation calls `CovenantVault.draw` with `eth_call`, at one block, sent from the facility's operator, because the vault is the only thing that can answer the question. `CoverageEngine.assess` asks its caller whether a waiver is active, so calling it from any other account gives the wrong context.

Representative output, captured on 2026-09-11 at block 61633389 and trimmed:

```json
{
  "kind": "simulation",
  "request": { "function": "draw", "amount": { "units": "1000000", "usdc": "1.000000" }, "sender": "0x7e09657321F1818825a9A15cedd9D95308130ED4" },
  "allowed": false,
  "outcome": "refused",
  "refusal": {
    "error": "DrawNotAllowed",
    "args": { "state": "CURE" },
    "explanation": "The vault refused the draw: after its own covenant sync the facility is CURE, and a draw needs compliant coverage or an active waiver. Current evaluation at this block: 0 of 10000 bps, not compliant (INVALID_EXPOSURE)."
  },
  "evaluation": { "compliant": false, "coverageBps": 0, "resultReason": "INVALID_EXPOSURE", "activeWaiver": false }
}
```

## How to read it

- **`DrawNotAllowed` carries the state after the draw's own sync.** `draw` synchronises the covenant before it asks whether it may proceed. The vault's stored state was COMPLIANT, on evidence that had expired; inside the simulation the sync moved it to CURE, and the draw was refused.
- **The evaluation says why.** Here the exposure credential expired, so coverage counts zero against the 10000 bps required. [Inspect a facility](/guides/inspect-a-facility) walks through the same evidence.
- **Nothing changed.** The simulation is an `eth_call`: the sync it performed was discarded with the rest of the call. Running `facility show` afterwards still reports the stored state as it was.

## The other refusal: the reserve

A facility can be perfectly compliant and still refuse a draw, because the vault must keep its reserve. From a local Anvil run of the same commands:

```json
{
  "allowed": false,
  "outcome": "refused",
  "refusal": {
    "error": "ReserveViolation",
    "args": { "balance": "2.500000", "requested": "2.100000", "reserve": "0.500000" },
    "explanation": "The vault refused the draw: it would leave the vault below its reserve. Balance 2.500000, requested 2.100000, reserve 0.500000 USDC."
  }
}
```

`facility show` reports `availableToDraw`, which is the balance less the reserve. A request above it is refused this way, whatever the coverage says.

## Refusal is not failure

| Outcome | `allowed` | Exit code |
|---|---|---|
| The draw would execute | `true` | 0 |
| The vault refused, with a decoded reason | `false` | 0 |
| The simulation reverted with no reason anything can decode (`SIMULATION_FAILED`) | — | 1 |
| The RPC could not be reached (`RPC_UNAVAILABLE`) | — | 1 |

A completed inquiry exits 0 even when the answer is no. Only a failed inquiry exits non-zero, so a script can tell "the covenant said no" from "I could not ask".

## What a permitted simulation does not promise

It does not promise that a later draw succeeds. Coverage evidence expires, and someone else may draw first. It is an answer about one block, not a reservation.

A recorded refusal is on the [Evidence](/evidence) page: at A-3 the same draw that succeeded at 100% coverage was refused on chain at 68.4%, with receipt `0x0` and `DrawNotAllowed(CURE)`.
