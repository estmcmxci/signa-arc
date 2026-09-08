# ETHOnline 2026 — Sponsor Workstreams

**Created:** 2026-09-05
**Event:** ETHOnline 2026, 2026-09-04 → 2026-09-16 (async, online)
**Purpose:** Map the five prize sponsors whose technology actually corresponds to the [product thesis](./PRODUCT-THESIS.md) onto discrete, buildable workstreams.
**Authority:** This file is subordinate to [PRODUCT-THESIS.md](./PRODUCT-THESIS.md) (scope and vocabulary) and [CLAIMS-EVIDENCE-LEDGER.md](./CLAIMS-EVIDENCE-LEDGER.md) (what may be claimed publicly). Nothing here licenses a new claim. Sponsor products named below are **integration targets, not partners, integrations, or endorsements**, and must never be described as such in an application, a demo, or a README.

The thesis being fitted, unchanged:

> We help Base credit originators funding non-USD loan portfolios with USDC make authenticated FX coverage an enforceable condition of onchain capital.

Decomposed into the four functions every workstream below attaches to:

| # | Function | Current implementation |
|---|---|---|
| F1 | **Authenticate** an external hedge state and an exposure state from two independent sources | Mock Ebury-shaped adapter, locally tested |
| F2 | **Compute** coverage deterministically against lender policy | Solidity coverage engine, 25 tests passing locally |
| F3 | **Control** capital — permit, pause, reserve, cure, waive, restore | Sepolia vault, not yet deployed |
| F4 | **Record** the policy history so a lender can audit it later | Events only; nothing indexed |

---

## 0. The fork

Two artifacts, one thesis. This is deliberate and must stay clean, because the Batches application makes truth claims about a deployment.

| | **Signa-Base** | **Signa-Online** |
|---|---|---|
| Audience | Base Batches 004 (due **2026-09-09**) | ETHOnline 2026 (due **2026-09-16**) |
| Chain | Base Sepolia, canonical | Arc Testnet (+ Ethereum Sepolia for ENSv2) |
| Claim posture | Governed by `SUBMISSION-CONTROL.md` gates | Hackathon artifact; may use mocks where disclosed |
| Shared | F1–F4 core: credential schema, coverage engine, policy vocabulary | same |

**Repo mechanics** *(historical — resolved 2026-09-05: this directory is now the standalone repo `estmcmxci/signa`, and the Batches artifact lives separately in `~/signa-batches` / `estmcmxci/signa-batches`)*. At the time of writing, the working directory was **not its own git repository** — it currently sits inside the home-directory repo, which is also why `SUBMISSION-CONTROL.md` lists "Immutable public source and CI" as `BLOCKED — REPOSITORY DECISION`. A fork therefore is not `git branch`; it is:

1. `git init` this directory as a standalone repo, with a `.gitignore` that excludes `contracts/.env`, keystores, `node_modules`, and `.DS_Store` **before** the first commit;
2. tag the commit the Batches application will cite;
3. copy to a second working tree for the hackathon build, or add the ETHOnline work as a branch that is never merged into the commit the application cites.

Order matters: the Batches artifact must not depend on anything built for ETHOnline, or the claim audit becomes unresolvable four days from now.

**Do not let the hackathon move the deployment target named in the application.** Base Sepolia remains the canonical network in `PRODUCT-THESIS.md`. Arc is a second target, not a replacement.

---

## 1. Arc (Circle) — $10,000

### What they actually offer

Verified against `docs.arc.io` and `developers.circle.com`, 2026-09-05.

- **Arc is an EVM-compatible L1** targeting the Osaka EVM baseline, with documented runtime divergences from Ethereum (`docs.arc.io/arc/references/evm-differences.md`).
- **Testnet parameters:** name `Arc Testnet`, chain ID **5042002** (`0x4CC1B2`), RPC `https://rpc.testnet.arc.io`, WSS `wss://rpc.testnet.arc.io`, explorer `https://testnet.arcscan.app`, faucet `https://faucet.circle.com`. Circle's wallet APIs refer to the chain as `ARC-TESTNET`. Mainnet is not live.
- **Gas is paid in USDC, at 18 decimals.** This is the single largest porting hazard: ERC-20 USDC is 6 decimals, and our coverage math is written against that assumption.
- **StableFX** is Circle's "institutional-grade stablecoin FX engine built on Arc": request a quote for a pair, accept it via API (offchain execution), settle through **smart-contract escrow on Arc with payment-versus-payment**. Pairs today are **USDC and EURC only**. It is **spot conversion — no forwards, no NDFs**. An API key requires a Circle representative.
- **App Kit** provides Bridge, Swap, Send, and Unified Balance flows. Other named products: Circle Wallets, Circle Contracts, CCTP, Gateway.
- **Opt-in privacy (Arc Privacy Sector)** — encrypted contract state and transaction data, function-level policies (`Open` / `Restricted` / `Locked`), trust domains via `addTrustee`, ciphertext submitted to a precompile — is documented as **roadmap, not yet available**.

### How it maps to the thesis

Stronger than it first appears, and in a direction that *supports* provider-neutrality rather than eroding it.

**StableFX is the conversion leg, not the coverage leg.** It is spot-only. It converts USDC↔EURC; it does not create, hold, or attest a hedge, and it certainly does not decide whether a lender may release capital. That is precisely the boundary `PRODUCT-THESIS.md` freezes: FX capacity exists, credit exists, and the pipeline between them is missing. Circle shipping an FX engine one layer below us is corroboration of the ecosystem thesis, and a demo that consumes a StableFX-shaped quote while enforcing coverage above it makes the boundary legible in a way prose has not.

**EURC gives us a real currency pair instead of a fiction.** Today the demonstration portfolio is a *fictional* COP-repayable coffee book (P-05 in the claims ledger). On Arc, a EURC-denominated exposure funded by a USDC facility is an actual non-USD loan book with an actual FX mismatch, onchain, at testnet cost. F1's exposure source stops being hand-waved.

**Conditional payments are the product.** The Arc DeFi track asks in its own words for "conditional payments, onchain automation or multi-step settlement" and "payment, liquidity or treasury workflows"; the Launch track asks for "stablecoin settlement or escrow logic" and "Arc-powered treasury or FX features." F3 — release USDC only while coverage holds — is a conditional payment. We do not have to bend the product to answer this prompt.

**Arc privacy being unavailable is a finding, not a gap.** A lender will not publish its hedge book or its covenant thresholds. Arc's answer to that is on the roadmap; Chainlink's ships today. That is the seam between Workstream 1 and Workstream 2, and it is worth saying out loud in the submission.

### Workstream A — "Coverage-gated settlement on Arc"

1. Port the coverage engine and vault to Arc Testnet. **First task is the decimals audit**: 18-decimal gas USDC vs 6-decimal ERC-20 USDC vs EURC exposure units. Write the failing test before the port.
2. Model a EURC-denominated working-capital exposure funded by a USDC facility. Coverage ratio = hedged EURC notional ÷ EURC exposure.
3. Consume a **StableFX-shaped quote payload** as the conversion leg. The API key is gated behind a Circle rep, so build against a recorded/mock payload and **label it a mock in the README and on screen** — the same discipline as M-05 for the Ebury-shaped adapter.
4. Wire drawdown release to the coverage verdict: permitted, paused, reserve-only, cure-open.
5. Deliverables the tracks require: working frontend **and** backend, an architecture diagram, and a video that states which bounty is being submitted.

**Blockers/risks:** decimals; unaudited EVM divergences from the Osaka baseline; no StableFX credential; mainnet does not exist, so "push to mainnet" is aspirational for everyone in that track.

---

## 2. Chainlink CRE — $2,500 ($2,000 Confidential Workflow + $500 liquidation-protection challenge)

### What they actually offer

Verified against `docs.chain.link/cre`, 2026-09-05.

- A **Workflow** is a compiled **WASM binary** deployed to a DON, built on a trigger → callback model wired by `cre.Handler()`. **Go and TypeScript SDKs**; a `cre` CLI.
- **Triggers:** cron, HTTP, EVM log.
- **Secrets** are first-class, including a 1Password integration, usable in simulation and in deployed workflows.
- **Onchain write path:** the workflow produces a **DON-signed report** (`runtime.report()` / `GenerateReport()`) delivered by capability DONs to supported chains.
- **Confidential Workflows:** register a **confidential handler** that executes inside a hardware TEE, declaring accepted TEE types/regions. A **Vault DON releases secrets into the enclave**, fetched and decrypted dynamically at the moment the code needs them. A **confidential HTTP client** makes authenticated API calls from inside the enclave. Anything needing DON consensus — such as a signed report — must **explicitly cross back out** to the regular runtime, and execution completes only after **DON consensus verifies the enclave's attestations**.
- **Status: private beta, enrollment through a Chainlink account team** (`cre account access`; `/cre/account/confidential-workflows-access`).

### How it maps to the thesis

This is the closest technical match on the entire board to the hardest unsolved problem in the product.

`PRODUCT-THESIS.md` requires a hedge credential from "a regulated FX provider or lender-approved independent verifier," and `VALIDATION-LOG.md` records the one external reading we have: *hedge-compliance oracle plus covenant controller*. The obstacle has never been the math. It is that **making a hedge verifiable normally means exposing it** — broker API credentials, position sizes, counterparty identity, and the lender's own covenant thresholds, none of which any originator will publish onchain.

Confidential Workflows dissolve that:

- the **broker API credential never leaves the enclave** — Vault DON releases it inside, dynamically;
- the **hedge position and the lender's private coverage threshold are computed inside** the TEE via the confidential HTTP client;
- **only the verdict crosses back out** — covered / breached / cure-required, plus the ratio if the lender permits it — as a DON-signed report;
- **enclave attestations are verified by DON consensus**, so the credential our vault consumes carries a provenance story stronger than "our server said so."

That is F1 and F2, executed by an independent party, with the confidentiality property the buyer actually needs. Chainlink's own example list even names "automated liquidation protection using private risk thresholds and execution strategies" — the same shape as a covenant breach, which is what the separate $500 challenge rewards.

### Workstream B — "Confidential hedge-state credential"

1. Request access early — `cre account access`. **Private beta enrollment is a hard external dependency and may not land inside the hackathon window.** Design the workflow so a non-confidential CRE workflow is the fallback and the confidential handler is an added path, exactly as the docs describe them composing.
2. Build the workflow: EVM-log or cron trigger → confidential handler → confidential HTTP call to the Ebury-shaped hedge API → coverage computation against a private threshold → cross back out → DON-signed report.
3. Consume the report onchain in the existing coverage contract as an authenticated hedge credential; this replaces the mock adapter as the F1 hedge source.
4. Demonstrate a breach: hedge falls below threshold → report flips → drawdown pauses → cure opens. That single sequence satisfies both the Confidential Workflow track and the liquidation-protection challenge.

**Blockers/risks:** private beta access; WASM/Go or TS toolchain is new to this codebase; confirm which chains the capability DON can write to (Base Sepolia vs Arc) before committing the demo's settlement chain.

---

## 3. Privy — $5,000 (B2B financial product $2,500 + financial flow $2,500)

### What they actually offer

Verified against `docs.privy.io`, 2026-09-05.

- **Policy engine.** A policy is a list of **rules per RPC method**; each rule holds conditions and an action, `ALLOW` or `DENY`. Evaluation is **default-deny**, and any `DENY` wins. Conditions specify `field_source`, `field`, `operator`, `value` — sources include `ethereum_transaction`, **`ethereum_calldata`** (function-argument-level control), typed-data domain/message, `reference`, and `system`; operators include `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`, `contains`, `starts_with`, `ends_with`.
- **Stateful policies** evaluate against historical data — "cumulative transaction values over a time window" — via the `reference` source and aggregations. **Condition sets** (`in_condition_set`) carry allowlists past the 100-value limit.
- Policies attach **per wallet**, and a wallet with a policy must have a rule for **every** RPC method it intends to use. Enforcement happens in **Privy's TEE**, tamper-proof against the caller.
- **Key quorums**: m-of-n approval over keys or users, TEE-enforced, **nestable one level deep** (an inner quorum counts as one approval toward its parent's threshold).
- **Organization wallets**, **intents** (propose → sign → lifecycle), and **webhooks** for event-driven transaction handling.

### How it maps to the thesis

Privy is the missing **operator surface** — the part of the frozen boundary that names "risk, operations, treasury, and facility-management teams" as the users, which today has no implementation at all.

- **Policy engine = the covenant, expressed where the money actually leaves.** Our contract enforces coverage onchain; Privy enforces it at the wallet, before signing, in a TEE. Calldata-level conditions can require that a drawdown call carries a valid coverage reference; amount operators encode facility limits.
- **Stateful policies = reserve mechanics.** `PRODUCT-THESIS.md` lists "retain only a predefined available reserve" as an initial capital action. Cumulative-value-over-window is exactly that control, and it is a genuinely hard thing to build ourselves.
- **Key quorum = waiver and cure governance.** A waiver is the one action in the lifecycle that must not be unilateral. 2-of-3 across risk owner, treasury, and senior lender — TEE-enforced, with nesting for a senior-lender group that must reach its own threshold first — is the institutional control the Aug 28 peer said institutions would be the credible market for.
- **Intents + webhooks = event-driven pause.** Breach detected → webhook → drawdown intent refused or held for approval.

Both Privy tracks are satisfied by one build: the B2B track wants "treasury platforms… policies, team permissions, quorum approvals, intents"; the financial-flow track wants a completed transfer or stablecoin conversion. Our drawdown *is* the flow.

### Workstream C — "Lender control room"

1. Organization wallet as the facility's drawdown wallet.
2. Author the policy: default-deny; `ALLOW` USDC transfer only when calldata carries a current coverage reference and the amount is within the available line; `DENY` beyond the reserve threshold via a stateful cumulative-window rule.
3. Key quorum for waiver/cure: 2-of-3 risk / treasury / senior lender, with one nested group.
4. Webhook on breach → hold pending intents; dashboard shows permitted / paused / reserve-only / cure-open with the approvals that produced each state.
5. Execute at least one real transfer end to end, per the qualification requirements, and open-source it.

**Blockers/risks:** every RPC method the wallet touches needs a rule or it silently denies; features requiring commercial onboarding may be mocked but **do not count toward qualification**, so check tier before designing around anything.

---

## 4. ENS — $5,000 (Best Use of ENSv2 $4,500 + $500 integration)

### What they actually offer

Verified against `docs.ens.domains/ensv2/*`, 2026-09-05. **Note:** these are the canonical ENSv2 docs now — they supersede the `pr-543.docs-bao.pages.dev` preview snapshot recorded in earlier notes.

- **Enhanced Access Control (EAC):** up to 2^256 resources (typically labelhash in registries, namehash + record type in resolvers), **64 roles per resource** (32 regular + 32 admin), **max 15 holders per role per resource**. Roles pack into a `uint256` bitmap of 4-bit nybbles, upper half admin, lower half regular. `ROOT_RESOURCE` (`0x0`) cascades contract-wide like a master key, and a permission check consults both the resource and root.
- Functions: `grantRoles(resource, roleBitmap, account)`, `revokeRoles(...)`, `grantRootRoles(...)`, `revokeRootRoles(...)`; the caller must hold the admin role for each role touched, and the non-root variants reject `ROOT_RESOURCE`. Hooks: `_getRoles`, `_onRolesGranted`, `_onRolesRevoked`, `_getSettableRoles`, `_getRevokableRoles`.
- **Permissioned Registry** (10 roles, labelhash resources, version isolation) and **Permissioned Resolver** (11 roles, 8 of them per-record, scoped to individual keys or coin types) implement EAC.
- ENSv2 beta runs on **Sepolia**. The contracts are documented as **not final and subject to change before mainnet**.
- Track requirements: built on ENSv2 Sepolia, ENSv2 central rather than cosmetic, **functional demo with no hard-coded values**, video and/or live demo, open source.

### How it maps to the thesis

The frozen boundary says the hedge source is "a regulated FX provider **or lender-approved independent verifier**." Nothing in the product currently answers *how a lender approves one, or withdraws that approval*. That is a registry problem, and ENSv2 is a registry with revocable, role-scoped, per-record permissions.

- **A verifier namespace.** Each approved hedge verifier gets a subname under a parent the facility controls. Resolution is the lookup: "who may attest hedge state for this facility?"
- **EAC roles = attestation rights, not ownership.** A verifier holds a role permitting it to write *only* its own record keys on its own name — the docs' own example is letting an account edit only certain text records. A broker cannot touch another broker's attestation, and cannot touch policy.
- **Revocation is the point.** Drop a broker, revoke the role; the credential stops resolving. Expiring and revocable subnames give the approved-counterparty list a lifecycle instead of a hardcoded address array — and "no hard-coded values" is literally the track's qualification bar.
- **Permissioned Resolver per verifier** means each verifier fully owns its data while the facility owns the namespace.
- The track's bonus — "agents as namespaces, each with their own identity and permissions" — is adjacent to work already done here on ERC-8004 binding and ENSIP-25, which is reusable judgment, not reusable claims.

This is also the workstream with the lowest execution risk on this board, because the ENSv2 registry/EAC/permissioned-resolver surface is already familiar ground.

### Workstream D — "Approved-verifier registry"

1. Deploy a subname registry for the facility's verifier namespace on ENSv2 Sepolia.
2. Issue one subname per verifier; grant a narrowly scoped record-write role via `grantRoles` with an explicit role bitmap.
3. Coverage contract resolves the verifier name → resolver → attestation record, and rejects credentials from any name without a live role.
4. Demonstrate the full arc live: approve a verifier, accept its credential, **revoke**, show the same credential now rejected and drawdown paused.
5. If the repo is public by then, the $500 integration prize applies to folding ENSv2 into the existing codebase.

**Blockers/risks:** ENSv2 contracts are explicitly non-final; the 15-holders-per-role ceiling caps verifiers per resource (fine at facility scale, worth knowing); this workstream lands on **Ethereum Sepolia**, so the demo spans two chains.

---

## 5. The Graph — $15,000 (largest pool; indirect fit)

### What they actually offer

- **Subgraphs, Substreams, Firehose, Amp**; the **Subgraph MCP** for natural-language querying across 15,000+ subgraphs; **Standardized Subgraphs** (one shared schema across every protocol of a type, e.g. Messari); Agent0/ERC-8004 subgraphs; published Subgraph and Substreams **SKILLs** repos.
- Three tracks: Composable/Standardized Products ($5,000), AI Tooling **Start Fresh** ($5,000), AI Tooling **Continuity** ($5,000 — extending an existing open-source repo).
- Hard requirements: **live data from a Graph provider** — mocked, local-only, or static datasets do not qualify — plus a public repo and a 2–4 minute demo video.

### How it maps to the thesis

F4, which is currently the weakest of the four functions. `PRODUCT-THESIS.md` states that coverage registration, allocation, renewal, breach, cure, waiver, and restoration "create a recurring onchain policy history" — an asset we emit as events and then do nothing with. A lender's real question is retrospective: *was this facility ever uncovered at the moment capital was released, and who waived it?* That is a subgraph, and the Subgraph MCP turns it into a question an operator or an agent can ask in plain language.

The catch is structural, not technical: **every Graph track requires public source and live indexed data**, which collides with the still-open repository decision. The Continuity pool is attractive precisely because our codebase predates the hackathon — but it only becomes available once the repo is public.

**Verify before committing:** that Base Sepolia (and/or Arc Testnet) is indexable in Subgraph Studio. Arc almost certainly is not, which would force this workstream onto the Base artifact.

### Workstream E — "Facility policy history"

1. Resolve the repository decision first. Without it, this workstream is closed.
2. Confirm network support in Subgraph Studio for the chosen chain.
3. Subgraph over the lifecycle events; entities: Facility, Exposure, HedgeCredential, CoverageCheck, Draw, Breach, Cure, Waiver.
4. Layer the Subgraph MCP so the dashboard answers "show every draw released while coverage was below policy" in natural language.
5. Submit to Continuity if extending the existing repo; Start Fresh otherwise. Do not submit to both pools for the same work.

---

## 6. Sequencing

Four days of overlap with the Batches deadline. The only sane order:

1. **Now → Sep 9:** Batches artifact only. Base Sepolia deploy, public source, dashboard, application. Nothing in this document may delay that.
2. **In parallel, cheap:** request **CRE Confidential Workflows access** (Workstream B) and a **StableFX key** (Workstream A). Both are external humans on someone else's clock; asking early costs nothing and asking late kills the workstream.
3. **Sep 9 → Sep 16:** fork, then build in this order — **D (ENS)** lowest risk and highest existing skill, **C (Privy)** highest ratio of prize to effort with two tracks from one build, **A (Arc)** largest pool but a real port, **B (CRE)** highest strategic value but gated on beta access, **E (Graph)** only if the repo goes public.

One coherent story spans all five: *a lender's facility, whose approved verifiers are named in ENS, whose hedge state is attested confidentially by CRE, whose drawdowns settle in USDC against a EURC exposure on Arc under a Privy policy with quorum-approved waivers, with the whole policy history queryable through a subgraph.* That is not five hackathon submissions bolted together; it is the product thesis with each layer implemented by the sponsor that actually sells that layer.

---

## 7. Verification status

| Claim | Status |
|---|---|
| Arc testnet chain ID, RPC, explorer, faucet, USDC-as-gas at 18 decimals | Verified from `docs.arc.io/arc/references/connect-to-arc.md`, 2026-09-05 |
| StableFX is spot-only, USDC/EURC, RFQ + onchain escrow, rep-gated API key | Verified from `developers.circle.com/stablefx.md`, 2026-09-05 |
| Arc opt-in privacy is roadmap, not available | Verified from `docs.arc.io/arc/concepts/opt-in-privacy.md`, 2026-09-05 |
| CRE workflow model, SDKs, triggers, DON-signed reports | Verified from `docs.chain.link/cre`, 2026-09-05 |
| Confidential Workflows: TEE handler, Vault DON secrets, attestation-verified consensus, **private beta** | Verified from `docs.chain.link/cre/concepts/confidential-workflows`, 2026-09-05 |
| Privy policy engine semantics, stateful policies, key quorum, TEE enforcement | Verified from `docs.privy.io/controls/*`, 2026-09-05 |
| ENSv2 EAC role model, function names, registry/resolver role counts, non-final contracts | Verified from `docs.ens.domains/ensv2/enhanced-access-control`, 2026-09-05 |
| Prize pools, track names, amounts, qualification requirements | Verified from the ETHOnline 2026 prizes page, 2026-09-05 |
| Base Sepolia / Arc Testnet indexable in Subgraph Studio | **NOT VERIFIED** — check before committing Workstream E |
| Which chains CRE capability DONs can write to | **NOT VERIFIED** — check before committing Workstream B's settlement chain |
| Whether hackathon participants get CRE confidential-beta access | **NOT VERIFIED** — external dependency |
