---
title: "Submit a credential"
description: "Sign in with a named Foundry keystore and submit a signed credential envelope to the registry, then read what acceptance does and does not prove."
---

# Submit a credential

`signa credentials submit` sends a signed envelope to the credential registry. It is the first command in these docs that signs anything, so it is worth being precise about what it does: it checks the envelope offline, checks the sequence, simulates the exact call, and then broadcasts **one** transaction.

:::warning
Every example on this page was captured against a **local Anvil chain**, not Arc Testnet. The addresses, hashes and block numbers are local. Nothing in this documentation sends a transaction to Arc.
:::

## 1. A signer

Signing uses a named [Foundry](https://getfoundry.sh) keystore. Create one once, with your own key:

```bash
cast wallet import signa-operator --interactive
```

`--account signa-operator` then resolves that name. `signa` resolves the name itself, against `~/.foundry/keystores` by default or `SIGNA_KEYSTORE_DIR` if set, and hands `cast` the file.

On a terminal, `cast` prompts for the password. Unattended, point at a file instead:

```bash
pnpm signa credentials submit ./hedge.json --account signa-operator --password-file ~/.config/signa/password
```

A password is never taken as a command-line argument, where other processes could read it, and a private key is never accepted on the command line at all.

## 2. The envelope

An envelope is the credential exactly as its issuer signed it. Monetary and time fields are decimal strings, so nothing passes through a floating-point type. [Signed credential envelope](/reference/envelope) has every field.

```json
{
  "schemaVersion": 1,
  "kind": "hedge",
  "domain": { "name": "FXCoverageCredentials", "version": "1", "chainId": 5042002, "verifyingContract": "0x9fe4…a6e0" },
  "credential": { "remainingNotional": "1060000", "sequence": "1", "status": "ACTIVE", "validUntil": "1789256056" },
  "signature": "0xd2db220d…1b",
  "issuer": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "digest": "0xd95eb925…01e9"
}
```

Check it offline first, with no key and no RPC: `pnpm signa credentials inspect ./hedge.json`.

## 3. Submit it

```bash
pnpm signa credentials submit ./hedge.json --account signa-operator
```

Trimmed, from a local run:

```json
{
  "kind": "transaction",
  "account": { "name": "test-operator", "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  "request": { "function": "submitHedge", "kind": "hedge", "sequence": "1", "digest": "0xd95eb925…01e9" },
  "broadcast": true,
  "transaction": {
    "hash": "0x2b009b17…7c04",
    "status": "success",
    "block": { "number": "14" },
    "gasUsed": "314784",
    "events": [{ "name": "HedgeCredentialAccepted", "args": { "sequence": "1", "remainingNotional": "1060000" } }]
  },
  "accepted": { "sequence": "1", "digest": "0xd95eb925…01e9", "matchesSubmitted": true },
  "eligibility": { "coverageBps": 10000, "requiredCoverageBps": 10000, "compliant": true, "credential": "ELIGIBLE" }
}
```

## Accepted is not eligible

The result reports two different things, and keeping them apart is the point:

- **`accepted`** is what the registry holds, read at the receipt's own block. `matchesSubmitted` confirms the registry holds exactly the envelope that was sent, digest for digest.
- **`eligibility`** is `CoverageEngine`'s separate verdict at that same block.

A credential can be accepted and count for nothing: expired, the wrong maturity, an issuer the facility no longer approves. The registry checks the signature, the issuer and the sequence. The engine decides what counts. `signa coverage show` reports the engine's view on its own.

## A sequence the registry has overtaken

Submit the same envelope again and it is refused before anything is sent:

```json
{
  "code": "STALE_SEQUENCE",
  "message": "the registry already holds sequence 1 for this hedge trade commitment 0x06634f76…9b22, and this envelope is sequence 1. The signed envelope is left as it is; nothing was broadcast.",
  "retryable": false
}
```

Sequence scope is `(facility)` for an exposure and `(facility, trade commitment)` for a hedge, so two hedges on different trades do not compete.

**The envelope is never edited to make it fit.** A sequence is not bumped, a timestamp is not refreshed, and nothing is re-signed: that would forge a new assertion from an issuer who never made it. If the registry has moved on, the issuer signs a new credential.

The same holds when another submission wins a race between the simulation and the send. The refusal says so, and the file on disk is exactly as it was.

Next: [Send and reconcile an operation](/guides/send-and-reconcile).
