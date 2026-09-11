---
title: Quickstart
description: A five-minute, read-only walk through signa. Check the deployment, evaluate coverage, simulate a draw, and read the recorded evidence. No key, no wallet, no gas.
---

# Quickstart

Five minutes, read-only, from a checkout ([Run locally](/run-locally)). You need no private key, funded wallet or gas: nothing on this page sends a transaction.

## 1. Check the live deployment

```bash
pnpm signa status
```

`status` resolves the deployment manifest and connects to Arc Testnet. At one block, it checks that the chain is Arc Testnet, that each contract has code, that the vault is bound to the manifest's facility, and that the contracts point at each other as the manifest says.

A representative result, from `pnpm -s signa status --json`, trimmed. It was captured on 2026-09-11 at block 61622853; the block and time change on every run.

```json
{
  "schemaVersion": 1,
  "kind": "report",
  "dataMode": "live",
  "context": {
    "chainId": 5042002,
    "facilityId": "0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2",
    "vault": "0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51",
    "manifest": { "source": "bundled", "copyOf": "deployments/arc-testnet.json" },
    "rpc": { "url": "https://rpc.testnet.arc.network", "source": "manifest" },
    "block": { "number": "61622853", "hash": "0x42167b1528c72b1fa799314400da324f8959a5d53d48f9c83493263d2afe293e", "timestamp": "2026-09-11T20:46:11.000Z" }
  },
  "ready": true,
  "scope": "Connectivity and deployment wiring at one block. Not a report of coverage, covenant state or draw eligibility."
}
```

**What it establishes:** the RPC is reachable and on the right chain, and the deployment matches the manifest. **What it does not:** whether coverage is sufficient, or whether a draw would be permitted.

## 2. Evaluate the coverage

```bash
pnpm signa coverage show
```

This reads `CoverageEngine`'s own verdicts: the evaluation, and the eligibility of the exposure credential and each hedge. From the same facility on 2026-09-11, at block 61633389:

```json
{
  "evaluation": { "compliant": false, "coverageBps": 0, "requiredCoverageBps": 10000, "resultReason": "INVALID_EXPOSURE", "exposureReason": "EXPIRED" },
  "exposure": { "eligibility": "EXPIRED" },
  "hedges": [{ "eligibility": "ELIGIBLE", "adjustedNotional": { "usdc": "1.007000" } }],
  "covenant": { "storedState": "COMPLIANT", "activeWaiver": false }
}
```

**Coverage evidence expires.** Under this facility's policy a credential is valid for 24 hours, and here the exposure credential had just passed its expiry. The vault still stores COMPLIANT, because a stored state changes only when the vault syncs. No page here promises that the facility is compliant when you run this.

## 3. Simulate a draw

```bash
pnpm signa draw simulate --amount 1
```

```json
{
  "allowed": false,
  "outcome": "refused",
  "refusal": { "error": "DrawNotAllowed", "args": { "state": "CURE" } },
  "evaluation": { "compliant": false, "coverageBps": 0, "resultReason": "INVALID_EXPOSURE" }
}
```

The vault refused, and the command exited 0: a refusal is a valid answer, not a failure. [Explain a refused draw](/guides/explain-a-refused-draw) reads this output line by line.

## 4. Read the recorded evidence

```bash
pnpm signa evidence show
```

Four records bundled with the CLI, in the order they were made: the acceptance run, the coverage drop, the quorum waiver and the restoration. No RPC, and the same output every time. Every result says `dataMode: recorded` and carries each record's recorded time, source file and SHA-256. It is history, not the facility's state now.

```bash
pnpm signa evidence show acceptance
```

The acceptance run attempts the same draw three times. At 100% coverage its receipt is `0x1`. After a partially funded hedge update drops coverage to 6840 bps, the same draw's receipt is `0x0`, and the record expected `0x0`. Once coverage is restored, the draw succeeds again.

Next: [Inspect a facility](/guides/inspect-a-facility) for the full read-only walk, [For agents](/agents) for the JSON contract, and [Commands](/reference/commands) for every option.
