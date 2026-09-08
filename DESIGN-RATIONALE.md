# Design Rationale

**Created:** 2026-09-07
**Provenance:** distilled from a structured walkthrough of the machine — five rounds of the questions a credit officer, a judge, or a sceptical engineer would ask — run before any ETHOnline code was written.
**Purpose:** the PRD says *what*; this says *why*. Read it before changing any rule in the PRD or the prototype spec. If a rule here looks arbitrary, the reasoning is below; if the reasoning is wrong, change the rule and this file together.

---

## 1. What Signa is, and is not

**Signa is the controller; issuers are the oracle layer.** Signa consumes credentials it did not produce, judges whether they are admissible, applies a lender's policy, and gates capital on the result. It never produces the facts.

**It judges before it computes.** Before any arithmetic, the engine asks: is this issuer still approved, are the two issuers different parties, is the credential inside `credentialMaxAge`, is it the latest sequence, was it revoked, does the hedge maturity reach the exposure's, has this trade ID already been counted? Only what survives is haircut and counted. A credential can be current, correctly signed, perfectly formatted, and **ineligible**. That middle step is most of the product's value and is what a lender's ops team does by hand today.

**"Isn't it just an oracle?"** An oracle publishes a fact. Signa rules on whether the fact is admissible under this lender's policy and holds the money the ruling governs. An oracle's number is fresh or stale, and that is the whole question; a hedge credential has a dozen ways to be valid and still not count.

**The engine is the heart, not the body.** `CoverageEngine` alone is arithmetic anyone could write. What is defensible is that capital cannot move unless it says so.

**It enforces policy; it does not set policy.** Signa is neutral on whether the minimum is 80% or 100%, whether the cure window is five days or thirty. It guarantees that whatever the lender wrote is what happens to the money, and that every deviation is named and timed.

## 2. Why each rule exists

### Independence — the two issuers must be different parties
Dishonest version: one party asserts €1M of exposure and €1M of hedge; coverage is 100% because one party said so twice. The ratio is a preference, not a measurement, and the party expressing the preference is usually the one that wants to keep drawing.

Honest version, which is worse because nobody lies: one organisation is one key, one system, one incentive. A bug in their reconciliation makes both numbers wrong in the same direction at the same time, and the ratio still looks perfect. Independence is not about catching liars. It means a failure has to happen twice, in two organisations, with different incentives, in the same window. Enforced in code: `IssuerRoleConflict`.

### Fail closed
Missing, stale, revoked, disputed or insufficient inputs refuse the draw. Zero exposure yields `UNASSESSED`, never compliance. "No opinion" and "covered" are different answers, and conflating them is how a system releases capital on yesterday's good news.

### Fresh at the moment of movement
Today, verification and settlement are two events with a gap between them, and the borrower wins the gap by default: the check is a person on a schedule, the draw is an API call, and when the person is late the remedy is retrospective. In the machine there is no gap — `draw()` re-evaluates and moves money **in the same transaction**. The divergence from the status quo is not speed. One system has a window; the other has none.

### The 100% cap — over-hedging is visible, never counted
A hedge protects a specific amount on a specific date. Surplus notional is attached to nothing, so it protects nothing. Concretely, with a €1M book and forwards to sell €1M at $1.10:

| EUR goes to | Loan worth | Hedge pays | Net |
|---|---|---|---|
| $1.00 | $1.00M (−$100k) | +$100k | $1.10M |
| $1.20 | $1.20M (+$100k) | −$100k | $1.10M |

Locked either way. Now with €1.4M of forwards on the same book:

| EUR goes to | Loan worth | Hedge pays | Net |
|---|---|---|---|
| $1.00 | $1.00M | +$140k | $1.14M |
| $1.20 | $1.20M | −$140k | **$1.06M — a new $40k loss** |

The surplus €400k created a way to lose money that did not exist at 100%. "140% covered" is 100% covered plus a €400k currency bet. Counting it would reward the borrower for adding risk. Two further failures if it were counted: **masking** (one facility's surplus hides another's shortfall — covenants are per-facility for this reason) and **unpaid-for headroom** (surplus becomes permission to draw more later, matched to nothing, possibly maturing before the new exposure does). Hence `countedEligible = min(grossEligible, outstandingValue)`. The engine still displays the 140%, because over-hedging is itself a risk signal.

### Hedge versus forward, and why haircuts exist
A hedge is a *job*; a forward is a *tool*. Nothing about an instrument says whether it is a hedge — only the pairing with an exposure decides. Instruments behave differently: forwards and NDFs are symmetric obligations (pay when right, cost when wrong); options are asymmetric (premium, capped downside); perpetuals are symmetric with no maturity and a funding cost. The 100%-cap loss above happens *because forwards are symmetric*; with options the surplus would only have wasted premium. That instrument-dependence is why `defaultHaircutBps` exists — it prices the difference between a forward, an out-of-the-money option, and a perp with basis drift — and why the policy names eligible instruments.

### Freshness, order, uniqueness
Three fields, three attacks. **Expiry** stops stale truth — a statement that was accurate when signed, used after the hedge lapsed. **Sequence** stops replay — resubmitting last week's better credential after a worse one arrived. **Trade ID commitment** stops double-counting — one real hedge presented twice, or against two facilities. It is a commitment rather than the ID itself, so uniqueness is enforced without publishing counterparty trade references. The three questions every credential must survive: *is it current, is it the latest, is it unique.*

### `CURE` blocks draws immediately
A new draw increases exposure, which pushes the ratio further down — curing and worsening in the same window. A cure period is time to remedy, not permission to add exposure. There are two cures: **raise the top** (buy more cover — costs premium, runs on the broker's clock) or **lower the bottom** (repay — costs liquidity, instant onchain). `repay()` is available in every state because the machine never blocks the action that fixes the problem. A third path is the most common in practice: the breach was a data problem, not a credit problem — a credential went stale — and the cure is simply a fresh one. That is why a cure window exists rather than instant default.

### The waiver
It exists because the alternative is worse. Without it, a broker's API outage or a disputed trade freezes a live facility, and the lender has lost control of its own capital to someone else's downtime. No credit officer deploys that; they would keep an override outside the system, in a phone call, which is invisible, unbounded and unlogged. Real credit agreements have waivers; this is the product acknowledging how credit works.

Every dimension is fenced: admin only; capped by `maxWaiverDuration`; requires a `reasonCommitment` that fixes the stated reason at the time; start and end both emitted; m-of-n under Privy; expiry triggers **re-evaluation, not restoration**. And the distinction that preserves the audit trail: **a waiver does not make the facility compliant. It makes it permitted while non-compliant.** Rolling waivers are therefore a visible pattern — "this facility was waived 40% of Q3" is a report a credit committee can pull.

The general principle: the machine does not eliminate human discretion. It makes discretion **explicit, bounded, attributable, and logged**.

## 3. The honest gap, and what narrows it

The machine proves **provenance, not reality**: which authorised party asserted a defined fact, when, and which deterministic rule followed. A verifier that signs a hedge which does not exist, or a servicer that understates exposure, is not caught by cryptography. Mitigations are procedural — independence, approval, revocation, and the fact that the verifier is typically a regulated counterparty with liability — the same trust structure as an auditor's signature.

Say it plainly and it reads as rigour. Hedge it and it reads as not having thought about it. The answer to *"so if my verifier lies, you release the money anyway?"* is yes, followed by: so does your credit agreement today, a month later; we make it attributable, immediate, revocable, and enumerable.

**Two things narrow the gap:**

- **CRE shortens the trust chain by one party.** A verifier reads the broker's system, forms a view, and signs; you trust the verifier. A CRE confidential workflow calls the broker's own authenticated API from inside the enclave and attests to what it returned; you trust the counterparty's books. That deletes a layer of discretion. It does not prove the broker's records are true — only the FX provider signing directly does that — but a regulated counterparty misreporting its own trade book is a categorically smaller risk than an intermediary with an opinion. This is the lead framing for the CRE workstream, not the privacy feature.
- **The vault's own ledger can cross-check exposure.** The vault knows what it disbursed and what came back — a record nobody external signs. An exposure credential arithmetically inconsistent with that history is the one place in the machine where a false assertion is *mechanically detectable* rather than merely attributable. Not built; in `BACKLOG.md` for the EED. The complementary selection rule: the exposure issuer must answer to the lender, never to the borrower.

## 4. Kill condition 3 is narrower than it reads

The thesis says: stop if *no FX provider will expose authenticated hedge state **or** authorise an independent verifier*. The "or" matters. The product needs someone who can see the trade and will sign; it does not need that someone to be the provider. And the data is usually not the provider's to withhold — credit agreements already oblige the *borrower* to deliver hedge confirmations to the lender, so the right to the information exists contractually today. The attestation can come from the facility agent, the fund administrator, an audit firm, or CRE reading a broker portal on credentials the lender already holds.

Consequence for outreach: we do not need a provider to say yes. We need one lender who already receives confirmations to let a verifier sign what they are already being sent.

An **onchain hedge** (Avantis on Base trades forex) removes the question entirely for that instrument — a reader observes chain state, no permission needed — at the cost of a maturity-less instrument that needs its own class. See `SYSTEM-ARCHITECTURE.md`, "Two flavours of hedge issuer."

## 5. Build decisions and why

- **Arc ships first and is never cut.** The capital plane is the only one whose absence kills the demo. ENS alone is a registry with nothing gated; Privy alone is a policy with no covenant; CRE alone issues a credential nothing consumes. Arc is the one that lets you say *"and the money stopped."*
- **The demo lands on the refusal.** Every DeFi demo has a successful transaction; almost none has one that is correctly refused with a reason.
- **Mock at the seam, and say so out loud.** The broker feed is the least interesting axis — anyone can integrate an API. Stub the source, make everything downstream real, state the boundary on stage, and show the seam working by swapping fixtures live. Do **not** dress the mock with generated or Monte Carlo data; elaborate fakery reads as an absence being disguised.
- **A real onchain position is a stretch goal for this window and the plan for the next one.** Deferred to the Bankr buildathon, where the instrument-class question can be answered properly.
- **Five sponsors is not prize-chasing, and the proof is a diagram.** Layer 1 of the architecture has no sponsor names and predates the prize list; each vendor implements a plane that already existed; and roughly $30K of tracks were declined because nothing in the machine needed them. Naming the declined prizes is the whole answer.

### The gate is the product; the vault is the proof
"Primitive" hides a fork. **Signa-as-vault** holds the USDC and gates itself — Signa is the facility. **Signa-as-hook** lets the lender's existing vault hold the USDC and call Signa before releasing a draw — Signa is the gate. The hook is the primitive, and it is the shape the thesis already implies: the exclusions say Signa does not replace a lender's vault, yet the prototype builds one. Resolving that: `CovenantVault` is the reference host proving the gate works; `ICoverageGate` is what ships. The cost in this window is one interface. The guardrail is that the gate answers one question only — is this facility's FX coverage sufficient for this draw — because a generic covenant engine is kill condition 9 (an undifferentiated Fence competitor). The category stays Financing until an external host actually calls the hook; a mock host calling a mock gate proves nothing.

## 6. Ideas surfaced, not yet built

| Idea | Where it lives | Status |
|---|---|---|
| Vault-ledger cross-check on the exposure credential | `BACKLOG.md` | For the EED to schedule |
| Onchain hedge instrument class (heavier haircut + margin-health) | `SYSTEM-ARCHITECTURE.md`, `BACKLOG.md` | Bankr buildathon |
| Named facility profile in ENS with verifier subnames | `SPONSOR-STRATEGY-REVIEW.md` §D, PRD S-7 | In scope for Workstream D |
| Exposure issuer must answer to the lender | `BACKLOG.md` | Deployment rule for the spec |

## 7. Where everything lives

| Need | File |
|---|---|
| The contract for this build | `PRD.md` |
| The mechanism, end to end | `SYSTEM-ARCHITECTURE.md`; viewable version at the Coverage Machine artifact linked in memory |
| Direction and sequencing | `SPONSOR-STRATEGY-REVIEW.md` |
| Verified sponsor facts | `ETHONLINE-WORKSTREAMS.md` |
| Arc bindings and addresses | `ARC-SYSTEM-DESIGN.md` |
| The demo and the boundary statement | `DEMO-WALKTHROUGH.md` |
| Operational items and design debt | `BACKLOG.md` |
| Founding narrative, objection playbook, research leads | `~/signa-batches/NARRATIVE-AND-OBJECTIONS.md` and `EXTERNAL-RESEARCH-2026-09-01.md` — private repo, never copy into this one |
