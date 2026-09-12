---
title: Architecture
description: "Four contracts on Arc, two issuers who do not answer to each other, and one vault that re-reads both before it moves a dollar. What happens inside a draw, why spot-only FX is not a conflict, and the decimals hazard Arc introduces."
---

# Architecture

A credit originator owes investors USDC while its loans repay in euros. The hedge protecting that gap sits at a bank. The capital sits in a vault that cannot see it.

Operations reconciles those records on a calendar. Capital leaves on demand. Anything re-evaluated on a schedule can be right on Monday and wrong on Tuesday afternoon, and the covenant that is supposed to govern the difference governs a conversation instead.

Signa Covenant puts the check inside the transaction that releases the money.

## The machine

Four contracts on Arc Testnet, chain 5042002, where USDC is the gas token. Two signers who do not answer to each other. One vault that will not move a dollar until both have been re-read.

| Part | Where | What it does |
|---|---|---|
| Exposure issuer | Offchain | The servicer. Answers to the lender, not the borrower. Signs what is owed. |
| Hedge issuer | Offchain | Verifies the broker's own confirmations. Signs what is covered. |
| Facility admin | Offchain | The lender's key. Writes policy and approves issuers, once. |
| `FacilityRegistry` | Arc | Holds the frozen policy and the role addresses. The admin is written at creation and has no setter. |
| `CredentialRegistry` | Arc | Accepts EIP-712 credentials bound to this chain and this registry, each at a strictly higher sequence than the last. |
| `CoverageEngine` | Arc | Decides what counts. Implements `ICoverageGate.assess`. |
| `CovenantVault` | Arc | The reference host. Holds the USDC and calls the gate inside `draw`. |

The two issuers are distinct approved keys. That enforces key separation, not legal independence between firms.

## What happens inside a draw

This is the whole claim, and it fits in one transaction:

1. The operator calls `draw(amount)`.
2. The vault re-reads both credentials — current, latest, and unique to this facility.
3. The engine applies the haircut and caps counted cover at the exposure.
4. It tests the resulting ratio against the policy floor, and the balance against the retained reserve.
5. Either USDC transfers and `Drawn` is emitted with its inputs, or the call reverts with `DrawNotAllowed` and a reason code.

One transaction, one block, sub-second finality. **No cached verdict authorises capital.** The operator asking for money is what triggers the re-reading, so nothing can change between the check and the release — there is no between.

That is the difference between a covenant that describes and a covenant that governs.

## Why spot-only FX is not a conflict

Arc ships StableFX: an RFQ venue with payment-versus-payment settlement, USDC and EURC today. It is **spot**. No forwards, no NDFs, no swaps.

That is not a problem for this design. It is the reason the design exists.

| Layer | What it does | On Arc today |
|---|---|---|
| Execution | Moves the currency. Converts euros to dollars at a price. | StableFX, and a bank's FX desk offchain. |
| Coverage | Decides whether the capital may move at all, given what is hedged. | Nothing. This is the gap. |

Circle built the leg that moves currency, and explicitly not the leg that makes coverage a condition of capital.

## Two decimal views of one dollar

Arc introduces a hazard worth stating plainly.

| Asset | Decimals | Role |
|---|---|---|
| Native USDC | 18 | Pays for the transaction. |
| USDC as an ERC-20, at `0x3600…0000` | 6 | The facility balance. |
| EURC, at `0x89B5…D72a` | 6 | Names the exposure's denominating currency. |

If an 18-decimal figure and a 6-decimal figure meet inside the coverage ratio, the result is not visibly broken. **It reads as 100% when the truth is a millionth of a percent** — and the vault, believing itself compliant, releases the capital.

That is precisely the failure this product exists to prevent, caused by the chain chosen to prevent it on.

The rule that makes it safe is one line: the vault touches only the ERC-20 interface. Native 18-decimal USDC pays gas and is never accounted. Everything crossing into a credential passes through a single normalisation boundary, pinned by a test written before any of it was ported.

## The policy in force

Frozen at creation. Changing any of it means a different facility.

| Parameter | Value | What it governs |
|---|---|---|
| `minCoverageBps` | 10000 | Hedged notional must fully cover the exposure. |
| `defaultHaircutBps` | 500 | A 5% discount applied to every hedge before it counts. |
| `credentialMaxAge` | 24h | Evidence older than this is not evidence. |
| `maturityTolerance` | 7d | How early a hedge may mature against the exposure. |
| `reserveAmount` | 0.5 USDC | Capital no draw may consume. |
| Cure window | 5d | Time to remedy before breach — not permission to draw. |
| `maxWaiverDuration` | 3d | A hard ceiling on any admin waiver. |

The deployed addresses are on the [Deployment](/reference/deployment) page.

## Overriding the covenant

A waiver permits a bounded exception. It does not make the underlying coverage compliant, and it cannot be created when there is nothing to waive.

The facility admin is a 2-of-2 key quorum: a risk officer and a treasury lead, neither sufficient alone. The admin address is fixed for this facility, and the contract bounds the waiver's duration independently of whoever approves it.

## What is deliberately not here

The hedge feed is a fixture shaped like a broker's API, labelled as such on screen and in the repository. The conversion payload is shaped like StableFX and is a recorded mock; the live API is permissioned to vetted institutions.

**No bank has agreed to sign a credential.** In this deployment both issuers are test keys held by the project. A signature authenticates who asserted what; it does not prove that a hedge legally exists, that its terms are enforceable, or that a counterparty will perform.

Nothing here executes a derivative, takes custody, originates a loan, liquidates a position, or issues a token.

The vault shipped here is the **reference host**, not the product. The product is the gate it calls. A second host — a pool, a tranche, a curator's vault — calling `assess` before releasing its own draw is the milestone that follows, and it needs a lender rather than more code.

The recorded runs behind all of this are on the [Evidence](/evidence) page.
