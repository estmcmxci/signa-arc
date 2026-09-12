---
title: "Approve a waiver"
description: "The one override in the system takes two people. Propose it, collect both approvals, broadcast it, and read what each step does and does not change."
---

# Approve a waiver

A waiver permits a draw the covenant would otherwise refuse. It is the only place a human overrides the contract, so it takes **two approvers**, and it is the one command group that signs with no keystore at all.

The facility admin is a Privy **2-of-2 key quorum**: a risk officer and a treasury lead, neither sufficient alone. Privy signs the transaction once both have authorized it; `signa` broadcasts it. The borrower's operator key is not involved.

:::warning
**A waiver cannot be revoked.** The admin's key is not permitted to call `revokeWaiver`, and while a waiver is active the vault stays WAIVED: `covenant sync` and `covenant restore` will not move it. Rehearse with short durations — 300 seconds — never the policy maximum.
:::

## 1. Would the contract accept one?

```bash
pnpm signa waiver status
```

This needs no Privy credentials and no key: it only reads Arc. Captured on 2026-09-12 against the live facility:

```json
{
  "wouldAccept": false,
  "refusals": [
    "the facility is compliant (coverage 10000 bps, 10000 required), and createWaiver refuses a compliant facility"
  ],
  "covenant": { "storedState": "COMPLIANT", "activeWaiver": false },
  "coverage": { "compliant": true, "coverageBps": 10000, "requiredCoverageBps": 10000, "resultReason": "NONE" },
  "maxWaiverDurationSeconds": 259200
}
```

**A refusal is an answer, so this exits 0.** There is nothing to waive on a compliant facility, and the contract would revert. The evaluation is read fresh rather than taken from the vault's stored state, because `createWaiver` syncs the covenant before it checks.

## 2. Propose

```bash
pnpm signa waiver propose --duration 300 --reason "Hedge rolled early; replacement confirmed for value tomorrow"
```

The reason matters: only its `keccak256` goes on chain, but that commitment is checked against the text after broadcast, so the words are part of the record.

Proposing **pre-validates against the chain first**. If the contract would refuse, nothing reaches Privy and the command exits non-zero with `ACTION_REFUSED` — which is how a script tells *would be refused* (`waiver status`, exit 0) from *was refused* (`waiver propose`, exit 1).

Nothing is signed and nothing is on chain yet. The result is a Privy intent, with `kind: "proposal"`.

## 3. Both approvals

```bash
pnpm signa waiver approve --role risk-officer
pnpm signa waiver approve --role treasury-lead
```

Each approval fetches a **freshly stamped payload** — Privy accepts one for 300 seconds — and signs it with that role's P-256 key. The approver service verifies the signature under a quorum member's key before it forwards anything, so a key that is not in the quorum is rejected locally.

Approver keys live in `~/.signa-privy-waiver/approvers`, mode 600 in a mode 700 directory, outside every repository. `PRIVY_APPROVER_KEY_DIR` points elsewhere. **Those two keys are the only way the admin wallet can ever sign, and a facility's admin can never change**, so back that directory up.

After the first approval, `remaining` is 1 and Privy has signed nothing. After the second, Privy signs.

## 4. Broadcast

```bash
pnpm signa waiver broadcast
```

Privy cannot send transactions on Arc, so it signs and we broadcast. The command records the transaction's hash in the operation journal **before** it waits for a receipt, exactly as every other write command does, then decides by the receipt — never by the signing service's own status. It finally checks that the receipt carries one `WaiverCreated` from this vault, naming this facility and committing to the stated reason.

## Rejecting a stale proposal

```bash
pnpm signa waiver reject
```

Each proposal pins the admin wallet's **next nonce**, and only one can be in flight. A proposal that is never going to be broadcast therefore blocks every later waiver until it expires at Privy, 72 hours later. Reject it instead.

## Two surfaces, one store

Proposals are recorded in `~/.signa-privy-waiver/actions.json`, shared with the approver console. **The console reads that file once, when it starts.** So:

- a proposal made with the CLI is invisible to a console that is already running, and its `execute` will answer 404 until the console is restarted;
- a proposal made in the console is invisible to the CLI until the next CLI command runs, which is usually the next thing you do anyway.

Restart the console after proposing from the CLI, or drive the whole sequence from one surface.

## What the CLI needs

| | |
|---|---|
| `waiver status` | Nothing but an RPC. No credentials, no keys |
| Everything else | `PRIVY_APP_ID` and `PRIVY_APP_SECRET` in the environment, and the approver keys |

Credentials are read from the environment only, never from a flag: a flag lands in shell history. The wallet is the one the deployment manifest names, and the CLI checks Privy's own address for it against the manifest's facility admin before it does anything.
