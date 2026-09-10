# Signa Covenant — Arc delivery plan

Created September 9, 2026. Status: planned; implementation has not started under this plan.

**Capital access, backed by verified commitments.**

Deliver Signa Covenant's authenticated FX coverage gate on Arc Testnet, with `CovenantVault` as its reference host. Demonstrate that deteriorating coverage blocks a USDC draw and fresh coverage restores access. Ship reproducible evidence, a working dashboard, the architecture diagram, a public repository, and a narrated video before **September 13, 2026, 12:00 pm EDT**. Target submission on September 12.

The selected bounty remains **Arc: Best DeFi/Onchain Finance Application**, as directed by the user. This plan preserves that selection.

## Authority and accepted decisions

[START-HERE.md](./START-HERE.md) owns build status; [PRD.md](./PRD.md) owns requirements; [ARC-FIELD-NOTES.md](./ARC-FIELD-NOTES.md) owns verified chain facts. This plan sequences delivery and records the strategy accepted by the user. Update the relevant requirement documents during implementation where these decisions resolve existing ambiguities.

- Covenant is the product; `CovenantVault` is the reference host. Expose `ICoverageGate` while porting the scenario. Preserve the narrow FX coverage scope.
- Represent the authenticated USD settlement obligation associated with the EUR portfolio in `outstandingValue`. Compare it with eligible USD-delivering hedge notional. Do not divide EUR amounts by USD amounts or introduce an implicit exchange rate.
- The vault holds and moves Arc testnet USDC. EUR is the underlying portfolio denomination. Explain that distinction consistently in credentials, documentation, and the dashboard.
- **Confirmed 2026-09-10 (E-DEC-2):** no EURC is moved. The EURC contract is *referenced* — named and linked as the exposure's denominating asset in the manifest, dashboard and README. A same-day decision to move real EURC was reversed: moving it demonstrates conversion, which Covenant does not govern, and invites the reader to mistake a token balance for the exposure. See `EED.md` §7, requirements E-EUR-1 … E-EUR-5.
- Use six-decimal settlement units and the existing credential normalization boundary. Arc's native 18-decimal USDC view is reserved for gas accounting; both interfaces represent one balance.
- Demonstrate **10,000 → 6,840 → 10,000 bps** for A-1 through A-4. Show cancellation to zero afterward as a separate extension.
- All expected-success transactions must have successful receipts. The intentional A-3 refusal must have an explicitly asserted failed receipt and evidence of the expected rejection reason. Clarify A-9 accordingly; process exit codes never establish success.
- Additional sponsor integrations stay outside the submission schedule. Mainnet remains a separate post-submission workstream.

## Delivery sequence

All dates and target times below use EDT. Each stage must meet its exit condition before dependent work is treated as complete.

| Target | Work | Exit condition |
|---|---|---|
| September 9 | Settle unit semantics; complete recovery fixtures and replay inputs | Documented units; deterministic 10000 → 6840 → 10000 → 0 results |
| September 9–10 | Port the scenario and extract the gate together | Local A-1–A-4 replay passes through the real reference host; targeted regression checks pass |
| September 10 | Arc deployment, source verification, manifest, acceptance run | Four verified application contracts and reproducible public transaction evidence |
| September 11 | Dashboard wired to the Arc manifest | Complete operator walkthrough against deployed state, with reasons and explorer links |
| September 12 | Clean reproduction, Arc README, repository publication, video | Public artifact package passes final review; submission completed that evening |
| September 13, before noon | Deadline buffer | Verify submission receipt and accessibility of every submitted link |

## Lanes and sync points

The stages below are a *time* view of the work. This is the *ownership* view. Both describe the same five stages; run them together.

**Under concurrent execution the stage dates above are sync-point dates, not per-lane dates.** A lane is not behind because it has not reached stage 4 — it is behind when it misses a sync point. Read the table below before reading your stage.

| Lane | Owns | Touches stages | Blocked by |
|---|---|---|---|
| **A — Contracts** | `CoverageEngine.sol`, `CovenantVault.sol`, the two registries, `contracts/script/Deploy.s.sol`, `deployments/arc-testnet.json` | 2, 3 | Nothing. **This is the critical path** — everything else waits on its manifest |
| **B — Evidence** | `packages/credentials/src/index.ts`, `packages/provider-adapter/fixtures/arc-forward-*.json`, `scenarios/arc-facility.ts` | 1, 3 | Needs A's addresses to *run*, not to be *written*. Write against the `EED.md` §4 manifest schema from the start |
| **C — Surface** | `apps/dashboard/**`, `README.md`, Wave 1 Base removals | 4, 5 | Needs the real manifest only for final wiring. Build against a fixture manifest until S2 |

**Sync points.**

- **S1 — the gate compiles and fixtures sign.** B can run the full scenario locally against Anvil. A continues to deployment.
- **S2 — deployed, manifest written, contracts verified.** B runs the acceptance sequence against Arc; C wires the dashboard to real state.
- **S3 — evidence captured.** C writes the README and records the video against real explorer links.

**Two ownerless things that break everyone at once.**

`package.json` and `pnpm-lock.yaml` belong to the **integrator**, not to any lane. Three agents adding scripts or dependencies is the classic conflict, and it breaks `pnpm check` for all three simultaneously.

**"Is it green" is a role.** Someone runs `pnpm check` on every merge and refuses work that breaks it. Twenty-six TypeScript tests and twenty-five Solidity tests are the only thing standing between three parallel lanes and a submission that does not build.

**Every lane brief carries `EED.md` §8 verbatim** — `arcTestnet` from `viem/chains`, assert receipt status in the direction the step expects, one decimals convention, four identities with two that never share an address, claims discipline, and the gate answering one question only. A link is weaker than the text; these are the rules an agent violates while improvising.

---

### 1. Complete scenario inputs and units

Requirements: S-2, S-B, R-F1-1 through R-F1-6, R-F2-1 through R-F2-7.

- [ ] Document settlement-unit semantics in the credential definitions and PRD. Keep underlying portfolio denomination distinct from the settlement obligation.
- [ ] Retain the existing decimal tests and route every signed amount through `packages/credentials/src/decimals.ts`.
- [ ] Add a restored hedge fixture with a strictly higher sequence than the reduced-notional update. Place cancellation after restoration with another higher sequence; do not replay the original active credential.
- [ ] Preserve the fractional example: a 1.000000 USD obligation, 1.060000 USD hedge, and 500 bps haircut produce 1.007000 adjusted cover, counted at 10000 bps. Reducing the hedge to 0.720000 produces 0.684000 adjusted cover and 6840 bps. A fresh 1.060000 hedge restores compliance.
- [ ] Keep checked-in fixtures deterministic for local tests. For public runs, generate explicitly labelled mock observations relative to a recorded chain timestamp before signing. Derive valid observation, expiry, and maturity fields coherently; the existing September 10–11 timestamps cannot support deadline-day replay.
- [ ] Save the exact generated fixtures, their source commitments, timestamps, sequences, and public signed payloads with the evidence. Do not modify signed fields afterward.

Exit: fixture tests establish the full recovery sequence, consistent units, and correct freshness behavior. The adapter remains deterministic for any given input.

### 2. Port the reference host and extract the gate

Requirements: R-F3-1 through R-F3-10, S-3, S-4.

- [ ] Specify the narrow `ICoverageGate.assess` interface, its verdict/reason response, and how it obtains authoritative facility state, requested amount, and reserve context. Keep the existing four-contract deployment shape where possible.
- [ ] Implement the interface through the existing reference host and decision logic. Preserve same-transaction synchronization and assessment before a draw transfers funds. A displayed or cached verdict cannot authorize a draw.
- [ ] Preserve `COMPLIANT`, `CURE`, `BREACH`, `UNASSESSED`, and bounded waiver behavior, including explicit restoration, reserve retention, and repayment in every state.
- [ ] Build the Arc scenario using `arcTestnet` from `viem/chains`, runtime chain checks, and EIP-712 domains bound to chain 5042002 and the deployed credential registry.
- [ ] Use distinct exposure and hedge issuer identities. Sign offchain and submit through a funded transaction sender; issuer-only identities do not need gas to sign.
- [ ] Exercise the actual `CovenantVault`; do not add a `MockHostVault`.
- [ ] Run focused checks for stale inputs, incorrect domain/replayed credentials, duplicate trade counting, insufficient coverage, reserve violations, waiver expiry, and repayment availability. Run `pnpm check` after the port is coherent.

Exit: the local runner proves permitted draw → reduced coverage → synchronized CURE → identical draw refusal → fresh hedge → explicit restoration → successful draw. The gate extraction preserves the capital controls.

### 3. Deploy and capture Arc evidence

Requirements: S-1, A-1 through A-4, A-9.

- [ ] Adapt `contracts/script/Deploy.s.sol` from chain 84532 and `MockUSDC` to chain 5042002 and USDC `0x3600000000000000000000000000000000000000`.
- [ ] Use `https://rpc.testnet.arc.network`. Reuse the keystore-based workflow established by the smoke session; keep secrets out of command arguments, repository files, and evidence logs.
- [ ] Preflight chain identity, role addresses, token decimals, and transaction-sender balances. Use fractional funding with adequate USDC left for gas.
- [ ] Preserve the PRD's facility policy, including its five-day cure window. A-4 restores with fresh evidence and does not require waiting for breach.
- [ ] Commit the deployable source as work progresses. Tie the deployment manifest to the exact source commit, chain, four application addresses, token address, roles, policy, deployment blocks, and receipt hashes.
- [ ] Verify all four application contracts on Arcscan, including constructor arguments. Existing E1–E3 smoke evidence establishes tooling viability; verify this application's deployment independently.
- [ ] Run the complete acceptance sequence. Save expected and actual receipt status for every transaction, relevant events, input sequences, coverage results, and explorer links.
- [ ] For A-3, synchronize CURE in a successful transaction first. Preserve a deliberately reverted draw transaction, verify status `0x0`, and establish `DrawNotAllowed(CURE)` through available revert data or state-pinned simulation/trace evidence. Reject transport errors and unrelated reverts as acceptance evidence.
- [ ] Verify vault balance movements and unchanged principal/vault funds on refusal. Account separately for sender gas when interpreting sender USDC balance changes.
- [ ] Provide a clear rerun procedure using a fresh facility/deployment or valid higher-sequence inputs, so a second run cannot silently reuse incompatible state.

Exit: an independent reviewer can reproduce A-1–A-4 and inspect the deployed source and transaction evidence. Every successful action asserts receipt success; the single expected refusal is identified and verified.

### 4. Deliver the dashboard

Requirements: S-5, R-F2-6, R-F4-1, R-F4-2, A-2, A-7.

- [ ] Replace Base manifest assumptions with Arc deployment configuration and wallet chain selection.
- [ ] Display facility policy, assessed coverage, covenant state, available draw, credential freshness, reason codes, and transaction links from contract outputs.
- [ ] Present gross and counted coverage separately so over-coverage remains visible while counted coverage is capped. Any presentation arithmetic must not become an independent capital verdict.
- [ ] Wire draw, synchronization, restoration, and repayment actions to the deployed reference host. Show pending, successful, and refused outcomes accurately.
- [ ] Keep mock-provider and mock-payload labels visible. Describe EUR denomination and USDC transfers accurately.
- [ ] Rehearse the complete acceptance sequence in the browser. Confirm stale or unavailable data is visibly identified and never presented as current compliance.

Exit: the operator can inspect and demonstrate the full capital-control sequence from the public dashboard. Screens show actual configured contract state and receipts.

### 5. Reproduce and package the submission

Requirements: S-6, S-A, A-5 through A-8.

- [ ] Complete the planned Base removals after Arc replacements work. Preserve Base work and private business documents in their designated private repository.
- [ ] Rewrite the README around Signa Covenant, Arc setup, exact reproduction commands, deployed addresses, evidence, the coverage-gate interface, and labelled mocks. Remove obsolete commands and deployment claims.
- [ ] Run `pnpm check` from a clean checkout and obtain green CI for the submission source. Maintain incremental implementation history and describe reused work and AI assistance accurately.
- [ ] Exercise A-5 stale refusal, A-6 duplicate counting, and A-7 gross-versus-counted coverage with recorded results. Keep public evidence separate from local-only test output.
- [ ] Update the existing architecture diagram to match the final interface and deployed contracts.
- [ ] Finish repository cleanup and make `signa-arc` public. Check repository, dashboard, manifest, explorer, and video access without a logged-in session.
- [ ] Record a 2–4 minute human-narrated video at 720p or better: brief buyer problem; architecture and labelled mock source; the approximately 90-second A-1–A-4 sequence; receipts and product boundary. Name the selected Arc bounty.
- [ ] State the boundary: signatures authenticate assertions and attribution; they do not independently establish the legal existence or enforceability of an offchain hedge. Covenant enforces the configured condition on onchain drawdowns.
- [ ] Submit on September 12 and retain the submission confirmation. Verify the final links before September 13 at noon EDT.

Exit: a reviewer can understand the product, watch it operate, inspect its evidence, and reproduce the submitted implementation from the public repository.

## Scope and recovery rules

Protect the working scenario, deployment evidence, frontend, and submission artifacts if time slips. Defer additional sponsor integrations and optional presentation features. Do not substitute mocked chain success, weaken receipt assertions, or describe smoke probes as application deployment evidence.

If credentials expire before a rehearsal or judging, generate fresh labelled mock inputs, sign with higher sequences, and record the resulting updates. Preserve historical evidence as historical; never make an expired result appear live.

Keep mainnet separate from this testnet submission. After submission, evaluate the September 30 milestone using the then-current network availability and deployment requirements. The next product milestone is one external lender host calling Covenant before a draw; validate that with a prospective design partner using the completed artifact.

## Research basis

These sources were reviewed for the accepted strategy on September 9, 2026. They support the implementation choices and delivery requirements; the selected bounty follows the user's direction.

- [Arc contract addresses and USDC interfaces](https://docs.arc.io/arc/references/contract-addresses): six-decimal USDC ERC-20 operations, shared native balance, and testnet token addresses.
- [Circle's vendored Arc guidance](./.claude/skills/use-arc/SKILL.md): canonical chain configuration, unit conventions, and keystore practices.
- [Verified Arc smoke evidence](./ARC-FIELD-NOTES.md): deployment transport, token operations, explorer verification, signing-tool limitations, and the failed-receipt/process-success mismatch.
- [Arc bounty requirements](https://ethglobal.com/events/ethonline2026/prizes/arc): meaningful Arc/USDC use, working frontend and backend, diagram, video, repository, and the separate September 30 mainnet condition.
- [ETHOnline submission details](https://ethglobal.com/events/ethonline2026/info/details): September 13 noon EDT deadline, 2–4 minute video, minimum resolution, version history, and AI attribution requirements.

This document is the sole deliverable of the current planning task. Execution begins in a subsequent task.
