---
title: What Covenant does
description: Signa Covenant makes authenticated FX coverage an enforceable condition of USDC drawdowns on Arc Testnet. What it is, what is deployed, and what the signa CLI does today.
---

# Signa Covenant

**Capital access, backed by verified commitments.**

A credit originator owes investors USDC while its loans repay in another currency. The loan balances live in a servicing system, the hedge lives at a bank, and the capital lives in a vault. The vault cannot see whether that hedge is current, sufficient, or even matched to this facility. Covenant makes authenticated coverage an enforceable condition of the drawdown itself.

## How it works

- **Issuers sign assertions.** An exposure credential states the loan book, and hedge credentials state the hedges against it. A credential registry accepts each one against its issuer and sequence.
- **The coverage engine computes eligible coverage** from the current, accepted assertions. This facility's policy requires 100% coverage after a 5% haircut.
- **The vault enforces it.** When coverage falls below the threshold, the facility moves to CURE and the vault refuses draws with `DrawNotAllowed`. When coverage is restored, `restoreCompliance` returns it to COMPLIANT.
- **Overriding the covenant takes two people.** A waiver can permit draws for a bounded time. The facility admin that creates one is a Privy 2-of-2 key quorum: a risk officer and a treasury lead, neither sufficient alone.

Each of these happened on chain, with receipts. See [Recorded on Arc Testnet](/evidence).

## What is real, and what is not

The deployment is on Arc Testnet, chain 5042002. The facility is fictional, the provider data is a labelled mock, and the money is testnet USDC. A signature authenticates who asserted what; it does not prove that a hedge legally exists. In this deployment both issuers are test keys held by the project: no bank or hedge provider has signed anything, and the exposure and hedge data are labelled mocks. EURC is named as the exposure's denominating asset and is never moved.

## The signa CLI today

`signa` inspects the deployment from the command line. Every command is read-only and needs no key.

| Command | What it does | Needs |
|---|---|---|
| `signa status` | Checks the deployment manifest and live connectivity: the chain, each contract's code, and the facility's wiring, all read at one block | An RPC; no key |
| `signa evidence show [record]` | Shows the recorded runs above, with every transaction linked | Nothing: no RPC, no key |

Commands that read coverage, simulate a draw or submit credentials are specified but not built yet; they will appear here when they exist. The CLI is not published: [Run locally](/run-locally) has the commands. The [Quickstart](/quickstart) takes five minutes.
