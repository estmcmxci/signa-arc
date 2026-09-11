---
title: Inspect a facility
description: "Work through status, facility show, coverage show and credentials list, and read what each establishes: the deployment, the state the vault stored, the engine's evaluation now, and the assertions underneath it."
---

# Inspect a facility

Four read-only commands, in the order that answers "can I trust what I am looking at?" before "what does it say?". You need a checkout ([Run locally](/run-locally)) and nothing else: no key, no funded wallet, no gas.

Each command pins every read to one block and reports that block, so a report is one consistent picture rather than a series of separate glances.

## 1. Is the deployment the one you think it is?

```bash
pnpm signa status
```

This checks that the RPC is Arc Testnet, that all four contracts have code, that the vault is bound to the manifest's facility, and that the vault, engine and registries point at each other. A mismatch stops here, with `CHAIN_MISMATCH` or `DEPLOYMENT_MISMATCH`, rather than letting a later command report confident nonsense about the wrong contracts.

## 2. What does the facility say about itself?

```bash
pnpm signa facility show
```

Representative output, captured on 2026-09-11 at block 61633389 and trimmed:

```json
{
  "policy": { "minCoverageBps": 10000, "defaultHaircutBps": 500, "reserve": { "units": "500000", "usdc": "0.500000" }, "frozen": true },
  "roles": { "operator": "0x7e09657321F1818825a9A15cedd9D95308130ED4", "hedgeIssuer": { "address": "0xAD515A2BE433e78B6b570064797626012e272e0a", "approved": true } },
  "vault": { "balance": { "usdc": "0.500000" }, "principal": { "usdc": "2.000000" }, "availableToDraw": { "usdc": "0.000000" } },
  "covenant": { "storedState": "COMPLIANT", "waiver": { "active": false } },
  "manifestDifferences": []
}
```

Three things worth reading carefully:

- **`availableToDraw` is zero** because the vault's balance equals its reserve. The reserve is not drawable.
- **`storedState` is what the vault last recorded**, not a fresh judgement. It changes only when the vault syncs.
- **`manifestDifferences` is empty**, so the chain agrees with the manifest about the policy, the settlement asset and the roles. Anything listed there is the chain's value against the manifest's.

## 3. What does the engine say now?

```bash
pnpm signa coverage show
```

From the same facility, minutes later:

```json
{
  "evaluation": { "compliant": false, "coverageBps": 0, "requiredCoverageBps": 10000, "resultReason": "INVALID_EXPOSURE", "exposureReason": "EXPIRED" },
  "exposure": { "eligibility": "EXPIRED" },
  "hedges": [{ "eligibility": "ELIGIBLE", "adjustedNotional": { "usdc": "1.007000" } }],
  "covenant": { "storedState": "COMPLIANT", "activeWaiver": false }
}
```

The vault stores COMPLIANT while the engine says the coverage is worth nothing. **That is not a contradiction, and it is the point of the product.** The exposure credential expired, so the engine no longer counts it; the vault has not synced since, so its stored state is the one it last wrote. The next sync, or a draw, will move the vault to CURE.

Every verdict here is the contract's own: `evaluate`, `exposureEligibility` and `hedgeEligibility` on `CoverageEngine`. `signa` does not recompute coverage.

## 4. What is the evidence underneath?

```bash
pnpm signa credentials list
```

```json
{
  "credentialMaxAgeSeconds": 86400,
  "exposure": { "sequence": "1", "outstandingValue": { "usdc": "1.000000" }, "ageSeconds": 88286, "validForSeconds": -1886 },
  "hedges": [{ "sequence": "6", "status": "ACTIVE", "remainingNotional": { "usdc": "1.060000" } }]
}
```

`validForSeconds` is negative: the exposure credential passed its `validUntil` about half an hour before this block, which is why the engine calls it EXPIRED. The hedge is still current.

This command reports what the registry accepted, with times and sequences. **Accepted is not the same as eligible.** The registry checks the signature, the issuer and the sequence; the engine decides what counts.

## What this does not establish

- **Whether a draw would be permitted.** Ask the vault: [Explain a refused draw](/guides/explain-a-refused-draw).
- **Anything about the past.** These are live reads. For recorded transactions, see [Recorded on Arc Testnet](/evidence).
- **That the facility will look like this later.** Coverage evidence expires, as it did here.
