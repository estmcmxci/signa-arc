---
title: Quickstart
description: A five-minute, read-only walk through signa. Check the live deployment with status, then read the recorded evidence. No key, no wallet, no gas.
---

# Quickstart

Five minutes, read-only, from a checkout ([Run locally](/run-locally)). You need no private key, funded wallet or gas: nothing on this page sends a transaction.

## 1. Check the live deployment

```bash
pnpm signa status
```

`status` resolves the deployment manifest and connects to Arc Testnet. At one block, it checks that:
- the chain is Arc Testnet;
- each contract has code;
- the vault is bound to the manifest's facility;
- the vault, coverage engine and registries point at each other as the manifest says.

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
    "block": {
      "number": "61622853",
      "hash": "0x42167b1528c72b1fa799314400da324f8959a5d53d48f9c83493263d2afe293e",
      "timestamp": "2026-09-11T20:46:11.000Z"
    }
  },
  "ready": true,
  "checks": [
    { "check": "chain", "detail": "the RPC reports chain 5042002, Arc Testnet" },
    { "check": "vault.facilityId", "detail": "the vault is bound to facility 0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2" },
    { "check": "facilityRegistry.facilityExists", "detail": "facility 0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2 exists" }
  ],
  "scope": "Connectivity and deployment wiring at one block. Not a report of coverage, covenant state or draw eligibility."
}
```

**What this establishes:** the RPC is reachable and on the right chain, and the deployment matches the manifest.

**What it does not:** whether coverage is sufficient, what state the covenant is in, or whether a draw would be permitted. Coverage evidence expires; under this facility's policy a credential is valid for 24 hours. So the facility's state changes over time, and no page here promises COMPLIANT.

When something is wrong, `status` exits 1 and prints a code. `INVALID_MANIFEST`, `CHAIN_MISMATCH`, `DEPLOYMENT_MISMATCH` and `RPC_UNAVAILABLE` are listed in [For agents](/agents).

## 2. Read the recorded evidence

```bash
pnpm signa evidence show
```

This prints four records bundled with the CLI, in the order they were made: the acceptance run, the coverage drop, the quorum waiver and the restoration. It needs no RPC and returns the same output every time. Every result says `dataMode: recorded` and carries each record's recorded time, source file and SHA-256. It is history, not the facility's state now.

## 3. Look at one record

```bash
pnpm signa evidence show acceptance
```

The acceptance run attempts the same draw three times. At 100% coverage its receipt is `0x1`. After a partially funded hedge update drops coverage to 6840 bps, the same draw's receipt is `0x0`, and the record expected `0x0`: the refusal is the covenant working. Once coverage is restored, the draw succeeds again.

```bash
pnpm signa evidence show waiver
```

The waiver record shows its two approvals, risk officer then treasury lead, and the transaction the quorum wallet sent.

Next: [For agents](/agents) covers the JSON contract, and [Recorded on Arc Testnet](/evidence) has every transaction.
