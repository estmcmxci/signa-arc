# Sponsor Strategy Review — ETHOnline 2026

**Created:** 2026-09-05
**Scope:** ETHOnline 2026 only (Sep 4 → **Sep 16**). The Base Batches 004 submission is a separate artifact in a separate repository and is not addressed here.
**Companion:** [ETHONLINE-WORKSTREAMS.md](./ETHONLINE-WORKSTREAMS.md) holds the verified technical detail per sponsor. This file is the decision layer: what we build, why it serves the thesis, what it costs, and in what order.
**Authority:** subordinate to [PRODUCT-THESIS.md](./PRODUCT-THESIS.md). Sponsors named here are integration targets — never partners, integrations, or endorsements.

## Chain plan

**No Base deployment in this track.** ETHOnline builds target:

- **Arc Testnet** — chain ID 5042002, RPC `https://rpc.testnet.arc.io`, explorer `testnet.arcscan.app`, gas paid in USDC at **18 decimals**.
- **Ethereum Sepolia** — ENSv2 beta only, for the verifier registry.

Base remains the canonical network in `PRODUCT-THESIS.md` for the company and for the Batches artifact. It is simply not on the critical path for these two weeks.

## The two access questions, answered

Both were flagged as human-dependent. Neither is.

**Chainlink CRE Confidential Workflows — no conversation required.**
Access is a **Google Form**, not an account team, and Chainlink's own docs state: *"After submitting your request, you don't need to wait for early access. Your CRE organization can run Confidential Workflows using the local simulator."* ETHGlobal's qualification bar matches — a submission qualifies via *"a Confidential Workflow simulation using the CRE CLI **or** a live deployment on the CRE network,"* with terminal output or execution logs as evidence. So: submit the form for good order, then build and simulate immediately. **Private beta is not a blocker for this hackathon.**

Exact requirements from the track: register and use a confidential TEE handler — **`handlerInTee`** (TypeScript) or **`cre.HandlerInTee`** (Go) — process at least one real secret, confidential API response, or private parameter inside the enclave, and make it core functionality rather than a placeholder. Starter material: `github.com/smartcontractkit/cre-templates/tree/main/starter-templates/confidential-workflows`, the *Hello Confidential Workflows* and *Automated Liquidation Protection* templates, and a recorded bootcamp.

**Circle StableFX — rep-gated, and we don't need it.**
A TEST key executes against Arc testnet and a LIVE key against Arc mainnet, but both are issued by a Circle representative rather than self-serve. This does not gate the prize: StableFX is one item on Arc's optional "core products" menu, and the tracks require Arc + USDC, a functional MVP with frontend and backend, an architecture diagram, a video, and a repo link. Build the conversion leg against a **recorded StableFX-shaped payload, labelled a mock on screen and in the README** — the same discipline already applied to the Ebury-shaped hedge adapter. If a Circle mentor is reachable through the event's Mentors tab or Discord during the hackathon, ask then; it is upside, not a dependency.

## Arc goes to mainnet on Sep 16 — the ETHOnline deadline

Confirmed: **Arc public mainnet launches September 16, 2026**, the same day submissions close. Founding validators are **BlackRock, DTCC, Galaxy, Global Payments, ICE (NYSE), Mastercard, MoneyGram, SBI Group, Standard Chartered, Sumitomo, and Visa**.

Three consequences:

1. **The "Launch on Arc Testnet & Push to Mainnet" track ($3,500, top prize $2,500) stops being hypothetical.** Every other team will be writing "ready to ship"; a project that actually lands on mainnet the day it opens is a different submission.
2. **That validator list is our buyer class, stated publicly by someone else.** Custody, clearing, card networks, remittance, trade banks. The thesis has always needed a named institutional credit or trade-finance operator; this is the closest thing to an addressable room appearing on a fixed date.
3. **Timing risk is real.** Mainnet launch day is deadline day. Plan the submission to qualify entirely on testnet, and treat a mainnet deployment as a bonus recorded in the final hours — never as the thing the demo depends on.

---

## Workstream review

Scored against the four product functions: **F1** authenticate hedge + exposure · **F2** compute coverage · **F3** control capital · **F4** record history.

### D — ENS · $5,000 · F1 · **build first**

**What we build:** a verifier namespace on ENSv2 Sepolia. One subname per lender-approved verifier, each granted a narrowly scoped EAC record-write role, each with its own permissioned resolver. The demo is the full arc: approve a verifier → accept its hedge attestation → **revoke the role** → the same credential is now rejected → drawdown pauses.

**Thesis fit:** the frozen boundary says the hedge source is "a regulated FX provider or lender-approved independent verifier," and never says how approval is granted or withdrawn. This is that mechanism. Revocation is not a feature we bolted on for a prize — it is the missing half of F1.

**ENS's own framing, 2026-09-04** (x.com/ensdomains/status/2095912038514245718): *"Tokenized assets are moving beyond experiments and into real financial markets. As they spread across chains, exchanges, custodians, and lending protocols, the market needs a dependable way to identify what each token represents. ENS can provide that registry layer."* Our credentials are not tokens, but the question is the same — what does this assertion represent, and who stands behind it — and our answer is a verifier namespace where the right to attest is a revocable role. Quote it beside the track submission: they described the registry layer for financial assets; we built it for the assertions a credit facility runs on.

**Why first:** lowest execution risk on the board. The EAC role model, permissioned registry and permissioned resolver are already familiar ground. It also clears the track's hardest-sounding bar — *"functional demo, not just hard-coded values"* — automatically, because the whole point is a live registry.

**Cost:** ~1 day. **Risks:** ENSv2 contracts are documented as non-final; 15 holders per role per resource (irrelevant at facility scale); this leg lives on Sepolia, so the demo spans two chains.

### C — Privy · $5,000 · F3 · **build second**

**What we build:** an organization wallet as the facility's drawdown wallet, with a default-deny policy; a stateful cumulative-value-over-window rule implementing the available reserve; a nested 2-of-3 key quorum for waivers and cures; a webhook that holds pending intents on breach.

**Thesis fit:** the boundary names "risk, operations, treasury, and facility-management teams" as the users, and today they have no surface whatsoever. Two mechanics we would otherwise have to build ourselves come free: stateful policies *are* reserve mechanics, and TEE-enforced m-of-n *is* the waiver governance that stops a covenant waiver from being one person clicking a button.

**Why second:** the best ratio of prize to effort on the board — **both** Privy tracks fall out of one build (B2B product $2,500 + financial flow $2,500), because our drawdown is itself the financial flow.

**Cost:** ~1 day. **Risks:** a policied wallet needs an explicit rule for *every* RPC method it touches or it silently denies; anything requiring commercial onboarding may be mocked but does not count toward qualification.

### A — Arc · $10,000 · F1 + F3 · **build third, largest single opportunity**

**What we build:** the coverage engine and vault ported to Arc Testnet; a **EURC-denominated exposure funded by a USDC facility**; a StableFX-shaped quote as the conversion leg; USDC drawdowns released only while coverage holds; a mainnet deployment on Sep 16 if the window allows.

**Thesis fit:** the track asks for "conditional payments, onchain automation or multi-step settlement" and "treasury or FX features" — F3 answers the prompt without bending. More importantly, EURC replaces the *fictional* COP coffee portfolio with a genuine currency mismatch, onchain, at testnet cost. F1's exposure leg stops being narrative.

**The strategic line this workstream buys:** StableFX is **spot only — no forwards, no NDFs**. Circle built the conversion leg and explicitly not the coverage leg. That yields the sharpest sentence the product has had: *Circle converts currency; nobody makes coverage a condition of capital.* Note the discipline — this is a gap in the **stack**, not evidence of a **payer**. It belongs in the pitch, not in the claims ledger as demand.

**Cost:** ~1.5 days, most of it the port. **First task is the decimals audit** — gas USDC at 18 decimals, ERC-20 USDC at 6, EURC exposure units — written as a failing test before any porting. **Risks:** documented EVM divergences from the Osaka baseline; mainnet timing on deadline day.

### B — Chainlink CRE · $2,500 · F1 + F2 · **build fourth, highest strategic value**

**What we build:** a workflow whose confidential handler runs in a TEE — Vault DON releases the broker API credential inside the enclave, the confidential HTTP client calls the hedge API, coverage is computed against a **private threshold**, and only the verdict crosses back out as a DON-signed report consumed onchain. Demonstrated by CRE CLI simulation with logs.

**Thesis fit:** this answers the objection that currently has no answer. No originator will publish its hedge book or its covenant thresholds, and every version of this product that requires them is dead on arrival. Confidential Workflows make the credential verifiable without making it public, and DON consensus verifies the enclave attestation — so F1 stops being "our server said so." Chainlink's own example list includes *"privacy-preserving risk assessment and policy enforcement,"* which is a description of our product written by someone else.

**What it actually buys: one fewer party to trust.** This is the reframe that matters, and it should lead the submission rather than the privacy feature. Compare the two evidence models:

- *Verifier model:* a party reads the broker's system, forms a view, and signs a claim. The lender trusts that party's honesty and competence.
- *CRE model:* the workflow calls the **broker's own authenticated API from inside the enclave**, with a credential that never leaves it, and attests to what that API returned.

The second deletes a layer of discretion. The assertion stops being "a verifier says the hedge exists" and becomes "the counterparty's own system of record returned this, and a TEE attests to the fetch." It does not prove the broker's records are true — nothing short of the FX provider signing directly does that, which is the data-side evidence gate in `PRODUCT-THESIS.md`. But a regulated counterparty misreporting its own trade book is a categorically smaller risk than an intermediary with an opinion, and it is the same risk credit markets already accept from custodians and administrators.

So CRE is not "we used a sponsor's privacy feature." It is **the trust chain shortened by one party**, and it is the strongest answer available to the first question any lender asks: *what if my verifier lies?*

**Why fourth despite the value:** smallest pool ($2,000 + a $500 continuity challenge) and the newest toolchain here (WASM, Go or TS SDK, new CLI). The architecture is worth more than the prize — it is the answer we will reuse in every lender conversation whether or not it places.

**Cost:** ~1.5 days including toolchain ramp. **Risks:** verify which chains the capability DON can write to before choosing the settlement chain for this leg.

### E — The Graph · $15,000 · F4 · **only if the week allows**

**What we build:** a subgraph over the facility lifecycle — Facility, Exposure, HedgeCredential, CoverageCheck, Draw, Breach, Cure, Waiver — with the Subgraph MCP layered on so an operator can ask *"show every draw released while coverage was below policy"* in natural language.

**Thesis fit:** F4 is our weakest function. We emit events and do nothing with them, while the lender's real question is retrospective and forensic. Genuine product value, indirect prize fit.

**Why last:** the largest pool on the board and the loosest fit, and it carries hard external requirements — live data from a Graph provider (mocks and static datasets are explicitly disqualified) plus a public repo. **Unverified:** whether Subgraph Studio indexes Arc Testnet. It almost certainly does not, which would strand this workstream unless it indexes the Sepolia leg instead. Check before committing an hour to it.

---

## Sequence

| Day | Work |
|---|---|
| Sep 5 | Submit the CRE access form. Repos split. Decimals test written. |
| Sep 6–7 | **D — ENS verifier registry** on Sepolia. Revocation demo working end to end. |
| Sep 8–9 | **C — Privy control room.** Policy, reserve rule, quorum waiver, breach webhook. |
| Sep 10–12 | **A — Arc port.** EURC exposure, USDC facility, coverage-gated drawdown, dashboard. |
| Sep 13–14 | **B — CRE confidential credential.** Simulation with logs; wire the report into the vault. |
| Sep 15 | Video, architecture diagram, README, repo public. Per-track submission text. |
| Sep 16 | Arc mainnet deploy if stable. Submit before the deadline regardless. |

**The single demo that spans all five:** a lender's facility whose approved verifiers are named in ENS and revocable on the spot, whose hedge state is attested confidentially through a TEE, whose USDC drawdowns settle against a EURC exposure on Arc under a default-deny policy with quorum-approved waivers, with the entire policy history queryable as a subgraph. That is not five hackathon entries stapled together — it is the product thesis with each layer implemented by the sponsor that actually sells that layer.

**Addressable across the five: ~$37,500 in pools** (Arc $10K, Graph $15K, Privy $5K, ENS $5K, Chainlink $2.5K), realistically contested per track and per placement.

## Open items

- Repo must be **public before Sep 16** — every track requires open source, and The Graph's Continuity pool requires a repo that already existed.
- Verify Subgraph Studio network support before starting E.
- Verify CRE capability-DON write targets before fixing B's settlement chain.
- Ask a Circle mentor about a StableFX TEST key during the event; do not wait on it.
