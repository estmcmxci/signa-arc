# PRD — Signa Coverage Controls, ETHOnline 2026 build

**Created:** 2026-09-07
**Window:** now → **2026-09-16** (ETHOnline submission; Arc mainnet launches the same day)
**Authority:** [PRODUCT-THESIS.md](./PRODUCT-THESIS.md) owns scope and vocabulary; [PROTOTYPE-SPEC.md](./PROTOTYPE-SPEC.md) owns the reference rules; [SPONSOR-STRATEGY-REVIEW.md](./SPONSOR-STRATEGY-REVIEW.md) owns direction; [SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md) owns the mechanism. This document turns those into requirements with IDs so the EED can point at them.
**Claims rule:** nothing here is deployed. Every sponsor named is an integration target, never a partner.

---

## 1. Problem and buyer

A credit originator owes investors USDC while its loans repay in another currency. The loan balances live in a servicing system, the hedge lives at a bank or broker, and the capital lives in a vault. Staff reconcile exposure against hedge on a calendar; capital moves on demand. The covenant governs a conversation. Nothing governs the money.

**Buyer:** a private-credit originator, pool manager, or trade-finance operator deploying USDC into non-USD working-capital facilities. Alternatively, the senior lender that mandates the control.
**Users:** the buyer's risk, operations, treasury, and facility-management teams.
**Unvalidated:** willingness to pay, pricing, and whether a lender would change a capital action in response to enforceable coverage. This build produces an artifact to test that with; it does not assume the answer.

## 2. The product

> We help credit originators funding non-USD loan portfolios with USDC make authenticated FX coverage an enforceable condition of onchain capital.

The machine in one line: **a facility owner writes a policy; two independent parties assert facts; a deterministic engine turns those facts into a verdict; a vault obeys the verdict; everything that happened is recorded.**

Four planes, four functions:

| Plane | Function |
|---|---|
| Evidence | **F1** authenticate exposure and hedge from two independent issuers |
| Decision | **F2** compute coverage deterministically against policy |
| Capital | **F3** permit, pause, reserve, cure, waive, restore |
| Record | **F4** make the policy history auditable |

## 3. Positioning

Short forms of the answers that recur. Full versions live in the private narrative doc.

- **"It's an oracle."** An oracle publishes a fact. We rule on whether that fact is admissible under this lender's policy, and we hold the money the ruling governs. A credential can be current, correctly signed, and still ineligible.
- **"Five sponsors is prize-chasing."** Layer 1 of the architecture has no sponsor names in it and predates the prize list. Each vendor implements a plane that already existed. We declined Hedera, World, 1inch, Uniswap, and Ledger because nothing in the machine needed them.
- **"What if the verifier lies?"** Then the credit agreement fails the same way today, a month later. We make it attributable, immediate, revocable, and enumerable — and with CRE, we read the broker's own system rather than a summary of it.
- **"Circle already does FX."** StableFX is spot conversion, USDC/EURC, no forwards or NDFs. Circle built the conversion leg and explicitly not the coverage leg. *Circle converts currency; nobody makes coverage a condition of capital.*

## 4. Scope

### In — must ship
- **S-1** Coverage engine, credential registry, facility registry, and covenant vault deployed to **Arc Testnet** (chain `5042002`).
- **S-2** A EURC-denominated exposure funded by a USDC facility. USDC ERC-20 `0x3600000000000000000000000000000000000000` (6 dec), EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (6 dec).
- **S-3** Two distinct issuer identities signing exposure and hedge credentials. Never one key in two roles.
- **S-4** The 90-second demo in [DEMO-WALKTHROUGH.md](./DEMO-WALKTHROUGH.md): permitted draw → refusal in `CURE` → cure → draw again.
- **S-5** Operator dashboard reading a deployment manifest: state, ratio, available line, reason codes, receipts.
- **S-6** Public repository with CI green, before submission.

### In — ship in priority order after S-1..S-6 are green
- **S-7** ENS on ENSv2 Sepolia: a named facility profile whose records resolve to the facility's contracts and policy, with verifier subnames beneath it carrying EAC attest roles, and live revocation changing a capital outcome (Workstream D). Design in `SPONSOR-STRATEGY-REVIEW.md` §D.
- **S-8** Privy organisation wallet, default-deny policy, reserve rule, quorum waiver (Workstream C).
- **S-9** CRE confidential credential via CLI simulation (Workstream B).
- **S-10** Subgraph over lifecycle events, only if Subgraph Studio indexes the chosen chain (Workstream E).

### Out — explicitly not this build
- Base deployment of any kind (separate artifact, separate repo).
- Real broker integration. The hedge source is an Ebury-shaped fixture, labelled as such on screen.
- Real StableFX calls. A recorded StableFX-shaped payload, labelled a mock.
- Onchain perp hedges (Avantis). Designed in `SYSTEM-ARCHITECTURE.md`, deferred to the Bankr buildathon.
- Vault-ledger cross-check on exposure. In `BACKLOG.md` for the EED to schedule if time allows; not a submission requirement.
- Everything in the thesis exclusions: derivative execution, custody, origination, liquidation, tokens.

## 5. Roles

| Role | Holds | May |
|---|---|---|
| Facility admin | Lender's key | Write policy, approve/revoke issuers, create/revoke waiver |
| Operator | Lender ops key | `draw`, `repay` on behalf of the facility |
| Exposure issuer | Servicer key | Sign `ExposureCredential` only |
| Hedge issuer | Verifier key | Sign `HedgeCredential` only |
| Keeper | Anyone | Submit credentials, call `syncCovenant` |
| Borrower | Counterparty | Receives USDC; has no keys in the machine |

**R-ROLE-1** Exposure issuer and hedge issuer must be distinct addresses; the registry reverts with `IssuerRoleConflict`.
**R-ROLE-2** The exposure issuer must be a party that answers to the lender, never one aligned with the borrower. Deployment requirement, not code.

## 6. Functional requirements

### F1 — Evidence
- **R-F1-1** Credentials are EIP-712 typed data bound to facility, currency pair, and chain ID `5042002`.
- **R-F1-2** `ExposureCredential` carries outstanding value, exposure maturity, `observedAt`, `validUntil`, sequence, issuer.
- **R-F1-3** `HedgeCredential` carries `tradeIdCommitment`, remaining notional, maturity, status, `observedAt`, `validUntil`, sequence, issuer.
- **R-F1-4** A credential is usable only if: issuer currently approved for that role; facility and pair match; `observedAt <= now <= validUntil`; `now - observedAt <= credentialMaxAge`; latest sequence; not revoked or disputed.
- **R-F1-5** A hedge is eligible only if additionally: status `ACTIVE`; `maturity + maturityTolerance >= exposureMaturity`; latest sequence for its `tradeIdCommitment`; that commitment appears under no other current credential.
- **R-F1-6** The three questions every credential must survive: **is it current, is it the latest, is it unique.**

### F2 — Decision
- **R-F2-1** `adjustedNotional = remainingNotional × (10000 − defaultHaircutBps) / 10000` per eligible hedge.
- **R-F2-2** `grossEligible = Σ adjustedNotional` over unique eligible trade IDs.
- **R-F2-3** `countedEligible = min(grossEligible, outstandingValue)`. Over-hedging is **visible, never counted**.
- **R-F2-4** `coverageBps = countedEligible × 10000 / outstandingValue`; `compliant = coverageBps >= minCoverageBps`. Integer division rounds down.
- **R-F2-5** Missing or zero exposure yields `UNASSESSED`, never compliance.
- **R-F2-6** Every rejected input and the top-level result return a reason code. The dashboard shows the reason, never only a colour.
- **R-F2-7** All amounts are normalised to a single decimals convention at the credential boundary. Native gas USDC (18) vs ERC-20 USDC and EURC (6) must never meet inside the ratio. **A failing test for this exists before any Arc port begins.**

### F3 — Capital
- **R-F3-1** `draw()` re-evaluates in the same transaction. No cached verdict authorises capital.
- **R-F3-2** Draws permitted only in `COMPLIANT` or under an active `WAIVED`.
- **R-F3-3** Every draw leaves at least `reserveAmount` in the vault; otherwise `ReserveViolation`.
- **R-F3-4** Entering `CURE` blocks draws immediately. A cure period is time to remedy, not permission to add exposure.
- **R-F3-5** `repay()` is available in every state.
- **R-F3-6** `BREACH` adds no liquidation, seizure, or automatic hedge purchase.
- **R-F3-7** Waivers: admin only; bounded by `maxWaiverDuration`; require `reasonCommitment`; emit start and end; expiry triggers re-evaluation, not restoration. Under Privy, creation requires m-of-n quorum.
- **R-F3-8** `syncCovenant()` is permissionless and emits ratio, status, reason, inputs, cure deadline.
- **R-F3-9** Restoration requires current credentials and a fresh onchain evaluation. Time alone restores nothing.

### F4 — Record
- **R-F4-1** Every state transition emits an event carrying the inputs that produced it.
- **R-F4-2** The record plane has no authority over capital. A wrong index can mislead a report, never release a dollar.
- **R-F4-3** If S-10 ships: a lender can answer "which draws were released while coverage was below policy?" with one query.

## 7. Policy parameters

| Parameter | Meaning | Demo value |
|---|---|---|
| currency pair | Exposure vs facility currency | EURC / USDC |
| `minCoverageBps` | Minimum coverage ratio | 10000 (100%) |
| `defaultHaircutBps` | Discount on hedge notional | 500 |
| `credentialMaxAge` | Freshness window | 24h |
| `maturityTolerance` | Hedge may mature this much before the exposure | 7d |
| `reserveAmount` | USDC that must remain in the vault | 10% of facility |
| cure window | Time to remedy before `BREACH` | 5d |
| `maxWaiverDuration` | Cap on any waiver | 3d |
| approved issuers | Per role | 1 exposure, 1 hedge (ENS-named under S-7) |

## 8. States

`UNASSESSED → COMPLIANT | CURE` · `COMPLIANT → CURE` · `CURE → BREACH` on deadline · `CURE | BREACH → COMPLIANT` on fresh coverage · any non-compliant `→ WAIVED` by admin · `WAIVED →` prior evaluation on expiry or revocation. Canonical vocabulary from `PROTOTYPE-SPEC.md` §8; no synonyms.

## 9. Acceptance criteria

The demo is the acceptance test. Each line must be reproducible on Arc Testnet with explorer links.

- **A-1** Facility created with the §7 policy; USDC deposited; both credentials accepted from distinct issuers.
- **A-2** Draw succeeds; `Drawn` emitted; USDC balance moves; ratio and reason visible on the dashboard.
- **A-3** Hedge credential refreshed with reduced notional; `syncCovenant` moves state to `CURE`; the identical draw reverts with `DrawNotAllowed(CURE)`.
- **A-4** Fresh hedge credential restores the ratio; `restoreCompliance` moves state to `COMPLIANT`; the draw succeeds.
- **A-5** A stale credential (past `credentialMaxAge`) causes `UNASSESSED`, and the draw refuses.
- **A-6** The same trade ID submitted twice is counted once.
- **A-7** Coverage of 140% is displayed as 140% and counted as 100%.
- **A-8** The boundary statement is spoken in the video and the mock seam is shown working.

## 10. Sponsor track acceptance

Qualification requirements copied from the prize pages, restated as conditions we can check.

**Arc** — working frontend and backend; architecture diagram; video and presentation naming the bounty; repo link. Meaningful use of Arc and USDC; conditional payment / treasury flow. *Push-to-mainnet track:* deploy to mainnet on the 16th only if testnet evidence is already complete.

**ENS** — built on ENSv2 Sepolia; ENSv2 central, not cosmetic; functional demo with no hard-coded values; video or live demo; open source. Our proof of "not cosmetic" is live revocation changing a capital outcome.

**Privy** — Privy integrated as a core part; at least one Privy wallet; a business use case; at least one functional B2B workflow (drawdown approval, waiver); at least one control (policy, signers, key quorum, intents); working demo and source; a clear statement of what Privy enables. *Financial-flow track:* at least one completed transfer using a GA feature.

**Chainlink CRE** — a workflow using a confidential TEE handler (`handlerInTee` / `cre.HandlerInTee`); at least one secret or private parameter processed inside the enclave; meaningfully integrated, not a placeholder; a successful **CLI simulation** or live run, with logs or video as evidence.

**The Graph** — live data from a Graph provider, no mocks; public repo; 2–4 minute video; choose one pool, Continuity or Start Fresh, never both.

## 11. Non-goals

Everything in `PRODUCT-THESIS.md` "Explicit exclusions." Plus for this window: production security, audits, legal enforceability, real funds, multiple facilities in the UI, portfolio netting, price oracles, mark-to-market, ZK.

## 12. Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| Decimals mismatch on Arc | Wrong verdict, silently — capital released that should be paused | R-F2-7: failing test first, single normalisation boundary |
| Arc EVM divergences from Osaka baseline | Contract behaviour differs from local tests | Read the divergence list before deploying; re-run the suite against Arc RPC |
| CRE confidential beta access | Live run unavailable | CLI simulation qualifies; design the confidential handler as an added path |
| Mainnet launch on deadline day | Chasing it breaks the submission | Qualify on testnet; mainnet is a final-hours bonus |
| Repo not public in time | Every track disqualified | S-6 is a must-ship gate, not a cleanup task |
| Subgraph Studio does not index Arc | S-10 impossible on Arc | Verify first; index the Sepolia leg or drop S-10 |
| Five workstreams in nine days | Nothing finishes | Priority order in §4; ENS/Privy/CRE/Graph are cut in reverse order, never Arc |

## 13. Open questions

- Does `testnet.arcscan.app` support source verification, and via which API?
- Is testnet EURC obtainable in useful quantities, or mocked?
- Which chains can CRE capability DONs write to?
- Which pool for The Graph, if it ships: Continuity (repo predates the hackathon) or Start Fresh?

---

## Next session — create the EED

This PRD is the contract. The next document is the **Engineering Execution Doc**, and the session was parked here so it can be built cold. To resume:

> **First read `DESIGN-RATIONALE.md`** — it carries the reasoning behind every rule below, distilled from the walkthrough that preceded this PRD; without it the requirements look arbitrary. Then read `PRD.md`, `SYSTEM-ARCHITECTURE.md`, `ARC-SYSTEM-DESIGN.md`, `SPONSOR-STRATEGY-REVIEW.md`, `DEMO-WALKTHROUGH.md`, and `BACKLOG.md` in `~/signa`. Then inspect `contracts/src`, `packages/credentials`, `packages/provider-adapter`, `scripts/`, and `scenarios/`. Produce `EED.md` covering: the decimals normalisation and its failing test (R-F2-7) as task one; contract changes for Arc, including the EIP-712 domain for chain `5042002`; the CREATE2 deployment plan, four-identity setup, and deployment manifest; fixture and adapter changes for a EURC exposure and a StableFX-shaped quote; dashboard wiring to the manifest; then integration points and ship/cut gates for ENS (S-7), Privy (S-8), CRE (S-9), and the subgraph (S-10). Sequence it by day from the 8th to the 16th, with a named cut decision on the 14th. Reference PRD requirement IDs throughout. Do not start building until the EED exists.

Memory pointer for the assistant: `signa-fx-coverage-project` in the memory index carries the repo map, the Arc facts, and the walkthrough insights. Pitch material, the founding narrative, and the objection playbook are in the private repo at `~/signa-batches/NARRATIVE-AND-OBJECTIONS.md` — read it for context, never copy it here.
