# CUTLIST — ETHOnline 2026, single workstream

**Created:** 2026-09-09 · **Revised:** 2026-09-09 after verifying the live prize pages
**Submission:** **2026-09-13, 12:00 pm EDT** — verified verbatim on `ethglobal.com/events/ethonline2026/info/start`. `PRD.md` §Window says 2026-09-16 and is **wrong**; correct it.
**Track:** **Classic.** Built from scratch during the hackathon window.
**Replaces:** the Engineering Execution Doc called for in `PRD.md` §"Next session". At four days an EED costs the morning the decimals test needs. The PRD's requirement IDs are already the contract; this page is only the cut.
**Authority:** `PRD.md` owns requirements. This document owns scope for the remaining window, corrects `PRD.md` §10, and overrides the build order in `ETHONLINE-WORKSTREAMS.md`.

---

## The decision

**Ship one workstream: A (Arc). Cut B, C, D, E.**

Deliverable: **acceptance criteria A-1 → A-4 running on Arc Testnet (`5042002`), reproducible with explorer links.**

Every sponsor track requires a working deployed demo. The distance to *one* qualifying submission is a deployment; the distance to *five* is four features nobody has started.

### Conflict resolved

`ETHONLINE-WORKSTREAMS.md` §6 orders the build **D → C → A → B → E**, Arc third, reasoning that ENS is lowest-risk and highest existing skill. That ordering assumed the 16th and five available workstreams. It is void. `PRD.md` §4 is correct: S-1..S-6 first, "ENS/Privy/CRE/Graph are cut in reverse order, never Arc."

---

## Verified track facts — these correct `PRD.md` §10

### Arc prize structure (verified)

| Track | Total | Without mainnet | Fit |
|---|---|---|---|
| **Best DeFi/Onchain Finance Application** | **$3,500** | **$1,000** | **Target.** Exactly what this is. |
| Best Agentic Economy w/ Circle Agent Stack | $3,500 | $1,000 | No agent in this product. |
| Best DeFi or Agentic Application (Continuity) | $3,000 | $1,000 | Not our track — we build in-window. |

Requirements, verbatim, identical across tracks:

> "Functional MVP and diagram: Projects must demonstrate a working frontend and backend plus an architecture diagram."
> "Video demonstration + presentation: succinctly outlining the project's core functions and its effective use of Circle's Developer tools/tech is required, supported by detailed documentation."
> "Link to GitHub/Replit repo"

**The frontend is a hard requirement, not a nice-to-have.** S-5 is load-bearing for qualification.

### The mainnet money is decoupled from the deadline

> "$2,500 awarded only if deployed to Arc Mainnet by **Sept 30**"

`PRD.md` §13 carries a risk row reading "Mainnet launch on deadline day → chasing it breaks the submission," and `ETHONLINE-WORKSTREAMS.md` §1 calls push-to-mainnet "aspirational for everyone in that track." Both are false. Submit testnet on the 13th; deploy mainnet any time before Sept 30. That is **$2,500 of a $3,500 track for zero hackathon-window hours.** Calendar it for the week of Sep 16 and stop treating it as a risk.

### What Circle says it rewards

From Circle's HackMoney 2026 retrospective: 97% of submissions used AI agents, 56% shipped crosschain, and the pattern Circle praised without qualification was **"practical finance workflows"** solving "mainstream business problems." One quoted builder: *"They don't care about blockchain. They just want milestone payments without lawyers."*

Signa has no agent and no crosschain leg. In a field where 97% have agents, lead with the fourth pattern and make the absence deliberate: this is a capital control for a credit facility, and the covenant is the product. A HackMoney Arc winner was **arctan(x), an institutional FX DEX** — Circle already rewards institutional FX on Arc. Adjacent, not competing: they move the currency, we decide whether capital may move at all.

---

## In scope

| ID | Requirement | Gate |
|---|---|---|
| **S-1** | Four contracts deployed to Arc Testnet `5042002` | Explorer links exist |
| **S-2** | EURC exposure funded by USDC facility | Ratio computed from real token decimals |
| **S-3** | Two distinct issuer identities | `IssuerRoleConflict` proven onchain |
| **S-4** | Demo: permitted draw → refusal in `CURE` → cure → draw | A-1 → A-4 reproducible |
| **S-5** | Frontend reading the deployment manifest | **Qualification requirement.** Reason codes on screen, never only colour |
| **S-6** | Public repo, CI green | **Hard gate — every track dies without it** |
| **S-A** | Architecture diagram + video naming the bounty | Explicit Arc requirement, easy to forget |

### One shaping decision inside S-1

Build the decision plane behind **`ICoverageGate.assess(facilityId, amount) → (verdict, reason)`** (R-F3-10) from the start, rather than wiring the vault straight into the engine and extracting later.

The Arc track requires an architecture diagram. A monolith diagram says "we built a vault." A gate with the vault as its reference host says "we built a primitive, and here is one host calling it" — what `PRD.md` §11 already claims the product is: *"v0's vault is the proof the gate works; the gate is the product."*

**Do not build a `MockHostVault`.** §11 forecloses it: a mock calling a mock does not advance v0 to v1.

---

## Cut

| ID | Workstream | Prize | Why cut now, not on the 14th |
|---|---|---|---|
| **S-7** | ENS — Best Use of ENSv2 | $4,500 | Largest single prize available, and still cut: ENSv2 Sepolia is a different chain from Arc, so "live revocation changes a capital outcome" becomes a cross-chain demo — the one thing that cannot be debugged in the final day. The track also demands a functional demo "not just hard-coded values," which presupposes a deployed facility. |
| **S-10** | The Graph — Best AI Tooling (From Scratch) | $5,000 | Eligible, and the largest prize on the board. Cut because it requires The Graph as "a load-bearing part" plus live provider data — an indexing dependency on a chain we have not confirmed Studio indexes (`PRD.md` §13). |
| **S-8** | Privy — B2B Financial Product | $2,500 | Four requirements met by one build, but zero of them without a deployment underneath. |
| **S-9** | CRE — Confidential Workflow | $2,000 | Gated on confidential-beta access held by an external human. Unschedulable. |

`PRD.md` §13 flagged "five workstreams in nine days → nothing finishes." At four days that is arithmetic, not risk.

**Note the honest tension:** ENS at $4,500 and The Graph at $5,000 are each worth more than Arc's $3,500, and far more than its $1,000 pre-mainnet portion. The cut still holds, because both resolve to or index a facility that does not exist on any chain until Arc ships. Arc is not the bigger prize; it is the precondition for the bigger prizes. If the window were seven days, this ordering would flip.

### The one re-entry point

If Arc is **fully green by end of Sep 11** — deployed, demo recorded, repo public — add exactly one workstream. Take **S-8 (Privy)** over S-7 (ENS), inverting `PRD.md` §4 priority. Privy's control surface sits at the operator key on a single chain; ENS's does not.

Anything not green by **Sep 12, 12:00** is cut without further discussion.

---

## Schedule

| When | Work | Done when |
|---|---|---|
| **Sep 9** | **Task one: failing test for R-F2-7**, then the normalisation boundary. Nothing else starts before it fails. Arc RPC reachable, EIP-712 domain bound to `5042002`, deploy script, four identities. Resolve the testnet-EURC open question. | Suite green against Arc RPC |
| **Sep 10** | Deploy. Run A-1 → A-4 onchain. Write hashes to `deployments/arc-testnet.json`. | Four explorer links |
| **Sep 11** | S-5 frontend on the manifest. **S-6 repo public, CI green.** Architecture diagram (S-A). | Bonus-track go/no-go |
| **Sep 12** | Video: names the Arc bounty, states the boundary (A-8), shows the labelled mock seam. **Code freeze 12:00.** | Submission drafted |
| **Sep 13** | Buffer. **Submit by 10:00 EDT** against a 12:00 deadline. | — |
| **by Sep 30** | **Arc Mainnet deploy — unlocks $2,500.** Not hackathon work. | Mainnet manifest published |

---

## Standing risks

- **Decimals (R-F2-7).** Native gas USDC is 18 decimals, ERC-20 USDC and EURC are 6. If these meet inside `coverageBps`, the result is a draw permitted at a displayed 100%. The worst available failure, because the product claim is that the vault knows. Failing test first.
- **Frontend is a qualification requirement**, not polish. A backend-only submission does not qualify for Arc regardless of contract quality.
- **EIP-712 domain** (R-F1-1) must bind chain `5042002` before any credential is signed, or every fixture is regenerated late.
- **Arc EVM divergences** from the Osaka baseline: read the divergence list before deploying.
- ~~EURC availability~~ — **answered.** EURC is a first-class Arc token at `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`, 6 decimals, from the Circle faucet. Not a bridged wrapper.
- **Chain facts live in [ARC-FIELD-NOTES.md](./ARC-FIELD-NOTES.md)** — verified constants, the decimals contract, deploy and Blockscout verify commands, documented gotchas, and what is still open. Circle's own guidance is vendored at `.claude/skills/use-arc/SKILL.md`. Check both before assuming anything about Arc.
- ~~Mainnet launch on deadline day~~ — retired. Sept 30 is a separate deadline.

## Claims discipline

Unchanged from `PRD.md` §Claims rule. Nothing is deployed until it is. Every sponsor is an integration target, never a partner. The Ebury-shaped fixture and the StableFX-shaped payload are labelled mocks in the README and on screen.

**Added:** the ENS asset-profile post (`ens.domains/blog/post/ens-registry-tokenized-assets`) describes issuer-controlled asset profiles, hierarchical registries, and delegated management. It does **not** describe verifier roles, attestations, or revocation. Commit `f638f42` claims we "adopt ENS Labs' asset-profile model"; the naming and delegation half of S-7 is genuinely theirs, the attest-role and revocation half is our extension. Do not present the extension as ENS Labs' model.
