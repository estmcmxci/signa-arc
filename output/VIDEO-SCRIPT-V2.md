# Signa Covenant: submission video script (draft v2)

**Structure:** landing page → app walkthrough, with the Arcscan receipts folded into the app walkthrough as the closing proof beat. No diagram scene — cut. Two windows only: the landing page / `/app` (same browser, same origin), and Arcscan.

**Bounties:** Arc — Best DeFi/Onchain Finance Application, and Privy — Best B2B Financial Product. Both must be named on screen. The Privy track requires "clearly explain how Privy enables the product" — beat 5b's narration covers that (custody without a single point of failure; a key that can only ever sign one thing; the waiver is the "approval" workflow, the 2-of-2 setup is the "key quorum" control). Not targeting Privy's separate Best Financial Flow track — that needs an actual value-moving action through a GA Privy feature, which `createWaiver` deliberately isn't.

**Runtime:** drafted at roughly 2:50–3:05 read cold, now that the diagram beat is cut. Still optimistic — it doesn't account for pauses while you actually click through the live Privy flow on camera. Time a real take before trusting this fits under 4:00. See "What still needs deciding" at the bottom for likely cuts.

**Live vs. replay, stated plainly:** Beats 1–5 are live — whatever the facility and the waiver panel actually show at recording time. Beat 6 replays three fixed historical transactions from the 2026-09-10 run. Don't blend live numbers into beat 6's narration or historical numbers into beat 5's.

---

## Beats 1–2: The problem and the pain point (landing page hero) — ~0:00–0:30

**On screen:** the live landing page (`/`), hero section. This is read close to verbatim from the page's own copy — no new text card needed.

**Say:**

> "Investors fund credit originators in dollars; those originators lend to businesses that repay in local currency. If that currency falls, the dollar value of the loan book falls with it.
> Traditionally, the originator promises to maintain FX cover as a condition of the loan. But that covenant is checked on a reporting cycle, so a hedge can lapse while new capital is still drawn."

## Beats 3–4: Introduce Signa Covenant and the remedy — ~0:30–0:50

**On screen:** stay on the landing page, hero headline and CTA in frame ("Enforce FX coverage at drawdown"). Frame the "Live on Arc Testnet" status badge at the top of the hero in the same shot — it's already there, just make sure it's in frame.

**Say:**

> "Signa Covenant is a coverage gate — for credit originators drawing on USDC facilities, and the lenders who govern them. It's a smart contract on Arc that checks authenticated FX coverage inside the same transaction as every drawdown. If cover is insufficient, capital does not move."

*(This deviates from the hero's literal copy on purpose — the page's own text never says "Arc" or "smart contract," and the video needs to establish both early, not just at the close.)*

## Beat 5: The demo, live — `/app` — ~0:45–1:50

### 5a. The coverage gate, as it stands right now

**On screen:** `/app` — facility heading and state badge, metrics row, then the Coverage Gate panel and its verdict.

**Say, filled in with today's actual numbers as an example** (read whatever the badge and verdict panel actually show on the day you record, not these exact words):

> "This is the operator desk, reading the deployed contracts live. Right now: CURE at 68.40% against a required 100. If I tried to draw right now, the contract itself would revert the transaction — reason DrawNotAllowed — and no USDC would leave the vault. That's not a warning in this interface; it's the smart contract refusing it."

If the facility happens to be COMPLIANT when you record instead, drop the revert sentence and just say the state and coverage number you see on screen.

### 5b. The lender's override, live

**On screen:** scroll to the waiver panel. Show the admin's policy text on screen ("ALLOW eth_signTransaction only when to=vault, value=0, function=createWaiver"), then the two approver key cards.

**Say:**

> "The lender can grant a bounded exception — but not alone. The facility admin is a Privy two-of-two quorum: its key can sign exactly one thing, on this vault, moving no value. For this demo, both approver keys happen to sit in this one browser — normally they'd be two different people, on two different devices."

Propose a waiver on camera — short reason, 300-second duration.

> "Let's propose a waiver, with a reason."

Approve as risk officer, then as treasury lead, back to back.

> "Now both approvals. Risk officer first — one of two, nothing executes yet. Treasury lead second — that's two of two. Now Privy actually signs the transaction, using the admin wallet's key, the one bound by that policy we just looked at, and our service sends the signed transaction to Arc."

Hold on receipt `0x1` and the checked `WaiverCreated`.

> "That's custody without a single point of failure, and a key that can never do anything else."

**Then — this is the actual payoff, don't skip it.** Scroll back up to the Coverage Gate panel and re-check the same draw amount.

> "Now let's look at the coverage gate and check whether the draw is permitted. Since the waiver's been approved by the two-of-two Privy quorum, it should be — there we go, permitted. The waiver's active, and it expires in about five minutes.
> Once it expires, the gate goes back to holding draws — unless the hedge issuer submits better cover before then, and coverage clears the threshold on its own. A waiver doesn't fix coverage; it's a separate, bounded exception. Only fresh evidence actually restores it."

*(Confirmed live on 2026-09-12: the verdict panel does flip from HELD to PERMITTED while the waiver's active. One gotcha hit during rehearsal — the vault needs enough spare liquidity above its retained reserve, or the draw stays HELD for a completely different reason ("Retained reserve," not coverage), which looks like the waiver failed when it didn't. Check "Available to draw" is comfortably above the draw amount before recording this beat. If it isn't, fund the vault first — see the CLI's `draw`/deposit notes, or ask whoever last touched the vault.)*

## Beat 6: The receipts, on Arcscan — ~1:50–2:50 (est.)

**On screen:** three historical Arcscan transaction pages from the 2026-09-10 run — the same draw call, three times.

**Say** (~480 chars, point at each receipt as you name it; pause on the two `Transfer` logs inside the permitted one when you get to that line):

> "Here are the receipts. We sent the same draw three times: permitted at full coverage, refused when the hedge dropped — DrawNotAllowed, receipt failed — and permitted again once cover was restored. These aren't UI messages, they're the contract's own recorded outcomes. Each receipt also shows two USDC transfers, one native and one ERC-20 — Arc pays gas in the same dollar it moves. Testnet USDC, a fictional facility, labelled mock data. No bank has signed anything."

## Close — ~2:50–3:05

**On screen:** end card — Signa Covenant, Arc: Best DeFi/Onchain Finance Application, Privy: Best B2B Financial Product, repo link.

**Say:**

> "A hedge can lapse between compliance checks while capital keeps moving. Signa Covenant closes that gap — it checks coverage on Arc, inside the same transaction as every drawdown, and lets the lender grant a bounded exception only through a two-key Privy quorum, never alone. Built on Arc, with USDC and Privy. Submitted to Arc, for Best DeFi and Onchain Finance Application — and to Privy, for Best B2B Financial Product."

---

## What still needs deciding

- **The real runtime.** This draft is optimistic. Do one full timed read-through, including the live Privy clicks, before assuming it fits under 4:00. Likely trims if it runs long: shorten beat 1–2's narration, or hold the waiver approvals for less time on screen (cut from "hold on receipt" to a quick zoom).
- **Beat 5a's bracketed values** depend on whatever the facility's actual state is at recording time. Check it right before rehearsing that line, don't memorize a number now.
- **Beat 5b's typed reason** will vary each take since it's a live proposal, not scripted word-for-word — keep whatever you type short, since it's referenced verbally, not read aloud on screen.
- **The architecture diagram is cut.** If you want the four-component mechanism (issuers → CredentialRegistry → CoverageEngine → CovenantVault) mentioned at all, it now has no dedicated beat — the closest fit would be a passing line inside beat 5a, since `/app`'s own panels already show the evidence and the engine's output. Not scripted here; say so only if you want it.
- **Never say:** "verified hedge", "partner", "customer", "integration" (of any bank or of Circle), "trustless", "guaranteed", or the name of any bank or broker.
- The original `output/VIDEO-SCRIPT.md` is left untouched — this is a separate draft so nothing is lost if you want to compare or revert.
