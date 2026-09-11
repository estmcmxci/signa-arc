# Signa Covenant frontend implementation plan

Status: in progress on `frontend/desk`. Checkpoint 1 (build green, fixtures isolated) complete 2026-09-11; later stages await its review. Created 2026-09-11.

## Objective and sources

Implement the frontend research as a complete product workstream: an operator dashboard and a public landing page, with a shared design system, accurate financial displays, understandable covenant decisions, and a tested interaction model.

Research source: `~/signa-frontend-research.md`, dated 2026-09-10. It is working material outside the public repository; section references below refer to that file. Do not copy the full research into the public site. This plan captures requirements and implementation decisions without publishing private working material.

Read [HANDOVER.md](./HANDOVER.md), then [START-HERE.md](./START-HERE.md), then this plan. HANDOVER supersedes the stale build queue. [PRD.md](./PRD.md) and [EED.md](./EED.md) remain the authorities for economic behavior and contract interfaces. [ERD.md](./ERD.md) and [CLI-DOCS-HANDOFF.md](./output/CLI-DOCS-HANDOFF.md) govern the concurrent client, CLI and Vocs work.

The A-1 → A-4 acceptance sequence and quorum waiver are already proven. Frontend development must not re-derive or rerun that work. Preserve deployed contracts, manifests, historical evidence and signature fixtures. The user has now explicitly requested the frontend implementation previously deferred in HANDOVER.

Submission remains Sunday September 13, 2026, noon EDT. Track recording readiness separately from frontend completeness; a deadline does not silently remove requirements from this plan.

## Completion rules

- `[ ]` means unfinished; `[x]` requires an implementation artifact and verification evidence.
- Existing behavior is a reuse candidate, not automatically complete against this plan.
- Every concrete research recommendation must receive an implementation/check entry or an explicit decision with a reason. Background examples and competitor research are inputs, not feature mandates.
- Section 7's longer-term ideas remain visible in the decision register. Do not silently discard them, or claim them complete using invented data.
- Record superseded recommendations when current dependency APIs or contract semantics disagree with the research.
- Keep the tracker current after each reviewable change. Do not wait until the final visual pass to discover missing behavior.

## Baseline observed in this session

The current dashboard is a Vite/vanilla TypeScript app. `render()` replaces the root HTML; a smaller function updates the preflight panel. It already has sand-dark tokens, tabular numbers, status glyphs, focus styling, simulation before writes, a refusal explanation and historical acceptance evidence. The React conversion and public landing page are not implemented.

The user-provided screenshot shows stored COMPLIANT, counted coverage 100%, available draw $0, and a reserve refusal for the default input of 100000 USDC. This demonstrates a working read/preflight path, not a completed UI test suite. The default amount, oversized introduction, distinction between coverage and liquidity, and lack of visible amount units need attention.

Local development currently runs at `http://127.0.0.1:5173/`. A server response alone does not establish that browser reads, wallet behavior or writes work.

## Six stages

### Stage 1 — Make the research executable

Sources: research §§0–1, 2–7; especially §7.6.

- [ ] Read the complete research and expand the traceability table below to cover all actionable recommendations.
- [ ] Audit existing components against those requirements; mark reuse, adaptation or replacement with file references.
- [ ] Record behavior corrections: a signed credential is not legal proof; registry acceptance is not eligibility; stored state is not necessarily the current verdict; repayment does not automatically reduce independently asserted exposure.
- [ ] Document the component tree and screen hierarchy before changing the app entrypoint.
- [ ] Agree shared-client/manifest ownership with the CLI/docs implementer, including root configuration and lockfile edits.
- [ ] Establish deterministic browser fixtures for each required state, explicitly isolated from the live product.
- [ ] Resolve dependency compatibility from current official documentation and installed APIs; record pinned versions rather than trusting the research's historical version list.

Deliverables: this tracker with full traceability, ownership agreement, component/data contracts, fixture matrix, dependency decisions.

Exit: every core requirement has an owner, destination and verification method; product/data decisions are visible rather than implicit.

### Stage 2 — Architecture and design system

Sources: research §§2, 4.2–4.3, 6.1–6.9, 7.1.

- [ ] Implement React for the dashboard with wagmi, TanStack Query and viem, using `arcTestnet` and injected-wallet discovery.
- [ ] Establish the two-entry Vite layout: `/` for the lightweight landing page, `/app/` for the operator dashboard. Keep Vocs docs as a separate app. Update local links and recording instructions when routes change.
- [ ] Create shared sand tokens, semantic state colors, typography, spacing, radii, border/shadows, focus rings and motion constants.
- [ ] Use Inter/tabular figures for quantities; monospace for identifiers. Keep number columns consistently aligned and locale-pinned.
- [ ] Build primitives for buttons, labelled amount inputs, numeric values with provenance, status pills, panels, tables, copy controls, tooltips and accessible disclosure/detail views.
- [ ] Encode reusable Signa UI rules as the design skill proposed in research §7.1, following the installed skill-creation workflow when creating it.
- [ ] Evaluate the research's Tailwind, Base UI, Sonner and NumberFlow choices explicitly. Record compatible selections or equivalent implementations; do not silently drop their required behavior.
- [ ] Separate reads, derived presentation, preflight, wallet state and transaction state. Keep component identity stable across polling and input changes.
- [x] Isolate UI test fixtures from the shipped live route. A mocked preview must carry an unmistakable label and cannot submit a live transaction. — `apps/dashboard/src/test/fixtures.ts`, `test/fixtures.test.ts`; evidence in the work log, 2026-09-11 checkpoint 1.

Suggested structure, to finalize after the client handshake:

```text
apps/dashboard/
  index.html                 landing entry
  app/index.html             React dashboard entry
  src/design/                shared tokens and styles
  src/landing/               landing layout and assets
  src/app/                   React shell, providers, routes
  src/components/            reusable display/interaction components
  src/features/              facility, coverage, credentials, actions, ledger
  src/data/                  browser adapter and query hooks
  test/                      browser/state fixtures and focused tests
```

Exit: React renders the complete dashboard skeleton with stable focus/input state, shared tokens, accessible primitives and responsive layout; existing build behavior is preserved or deliberately migrated.

### Stage 3 — Operator workflow

Sources: research §§4–5, 6.3–6.8, 7.5 and relevant §7.7 details.

- [ ] Lead with facility identity, current condition and needed action. Move the marketing explanation to the landing page.
- [ ] Show stored covenant state, current coverage evaluation, waiver status and liquidity distinctly. A compliant facility with no drawable liquidity must read coherently.
- [ ] Show gross and counted coverage separately, with the cap and policy threshold visible. Preserve exact contract values; do not recompute a competing eligibility verdict.
- [ ] Implement a numeric formatting layer: exact six-decimal parsing, appropriate display precision, full receipt precision, floored coverage display, signed basis-point deltas, pinned locale and U+2212 negatives.
- [ ] Mark each value as confirmed, stale or unavailable, with block/as-of context where relevant. Never substitute zero for a failed read. Do not optimistically mutate risk figures on submission.
- [ ] Read coherent snapshots efficiently. Batch independent getters where appropriate; resolve dependent hedge reads explicitly. Partial read failure must identify unavailable fields without implying a complete snapshot.
- [ ] Show observation age, validity/expiry, issuer and eligibility per credential. Distinguish stale credentials from a stale RPC snapshot. Update age presentation independently of chain polling.
- [ ] Implement connection, disconnection, account/chain changes, wrong-chain handling and operator-role checks. Disconnected preview uses the manifest operator and labels that context; sending requires the actual authorized wallet.
- [ ] Implement exact, visibly labelled amount input with a suitable initial state. Remove the 100000-USDC demo default. Clear invalid-input feedback must replace a generic idle message.
- [ ] Build always-visible preflight: pending, permitted, covenant/reserve refusal, and evaluation failure. Debounce amount changes, discard obsolete responses, invalidate on account/chain/block change and verify again before sending.
- [ ] Simulate the vault call in the correct operator context; do not call the host-dependent coverage gate from an arbitrary EOA.
- [ ] Explain refusals in order: plain-language verdict, rule, observed/required values, shortfall when meaningful, evidence, applicable remedies, machine code last. Provide two remedies only when two valid remedies exist.
- [ ] Keep refused action controls discoverable with `aria-disabled` and guarded handlers. No signing request may follow a gated click.
- [ ] Implement draw, sync, restore and repay with explicit simulation → wallet request → submitted → receipt lifecycle. Repayment allowance/approval is a separate mutation with its own receipt; preserve partial completion and re-simulate afterward.
- [ ] Keep risk figures authoritative while transactions are pending. Clearly state whether displayed available funds account for local pending actions, and prevent accidental duplicate sends.
- [ ] Present pending/unknown receipt outcomes without automatic resubmission. Retain transaction identity across a refresh and provide reconciliation.
- [ ] Build one ledger for permitted, held and recorded actions. Explicitly distinguish local simulations, wallet submissions, mined transactions and bundled historical evidence. A simulated refusal has no transaction hash or explorer receipt.
- [ ] Add receipt detail: action, amount, actor, block/time, status, copyable hash, explorer link and available before/after values. Label missing or unreconstructable fields instead of inventing them.
- [ ] Show waiver as a dated artifact with underlying evaluation, expiry and quorum provenance where available. Preserve the existing Privy console's approval boundary.

Exit: all specified operator workflows work against controlled local state, with understandable refusals and no regression in amount, identity, chain, simulation or receipt handling.

### Stage 4 — Public landing page

Sources: research §§3.1–3.6, 6.1, 6.10 and 7.5.

- [ ] Build the complete page structure: navigation, mechanism-led hero, problem, four-step mechanism, enforcement properties, recorded refusal proof, intended users, trust/evidence band, contact close and footer.
- [ ] Keep headline language understandable to credit operators; tie technical claims to an actual operational consequence.
- [ ] Place the fictional/mock/testnet and legal-existence boundary visibly near the main explanation. Keep point-of-use mock labels on proof assets as well.
- [ ] Use the preserved acceptance evidence for the refusal section. Label historical captures and link their actual receipts.
- [ ] Link the dashboard, Vocs documentation, public repository, architecture and verified contracts. Configure the docs origin; do not invent a deployed domain.
- [ ] Implement the contact path after destination/collection behavior is decided. A form must not claim to submit without a working destination and clear success/error handling.
- [ ] Include only supplied/verified company and legal facts. Do not invent a legal entity, address, regulatory status, customers, testimonials or integrations to fill research examples.
- [ ] Use shared tokens and lightweight HTML/CSS. Keep the landing page independent of wallet providers and dashboard hydration.
- [ ] Set correct Signa/Arc title, description, social metadata and route links; remove obsolete Base metadata.

Exit: every section communicates a true, sourced claim; navigation and contact behavior work as described; no dead-end CTA or fabricated proof remains.

### Stage 5 — Interaction and accessibility completion

Sources: research §§2.2–2.5, 4.7–4.9, 5.8–5.10, 6.7, 7.2, 7.4–7.7.

- [ ] Implement keyboard navigation, visible focus, appropriate live announcements and touch targets throughout both surfaces.
- [ ] Keep word + shape + color status encoding. Reserve software-error styling for software failures; a covenant refusal is a normal decision.
- [ ] Implement responsive table/detail behavior and stable layout for long identifiers, large quantities and changing digit counts.
- [ ] Add copy feedback through a live region and ensure copy targets remain operable by keyboard.
- [ ] Implement loading placeholders, targeted retry and retained-data/as-of presentation without concealing stale or failed reads.
- [ ] Apply restrained hover/press/transitions with the research's timing/easing rules. Respect reduced motion; remove nonessential motion and preserve feedback. Never animate a refusal as a shake or flash.
- [ ] Implement density modes and a command palette/keyboard actions if confirmed in the decision register. Shortcuts focus/navigate or prepare an action; they must not silently send money.
- [ ] Implement credential exclusion details using authoritative reasons and the corresponding observed/policy values. Do not present a complete multi-rule trace if the contract exposes only its first exclusion reason.
- [ ] Implement the scoped ledger/export and maximum-draw exploration decided below. Distinguish estimates and simulations from a promise of later transaction success.
- [ ] Review the complete §7.6 checklist, recording implementation-specific exceptions explicitly.

Exit: the interfaces are operable without a mouse, remain legible at desktop/mobile/zoom, and have no focus loss, stale-result overwrite, misleading animation or inaccessible action state.

### Stage 6 — Validate the complete experience

Sources: research §7.6 and the contract/claims constraints in repository authorities.

- [ ] Run focused tests for money parsing/formatting, freshness, query/preflight races, wallet changes and outcome classification.
- [ ] Exercise the state matrix below with deterministic fixtures and local Anvil where real transaction behavior matters.
- [ ] Verify representative desktop, narrow/mobile, keyboard-only and reduced-motion browser sessions.
- [ ] Check landing, dashboard, docs, explorer and evidence links; test direct navigation/refresh to `/app/` in the built preview.
- [ ] Run the existing project checks plus the new frontend build/type/browser checks. Coordinate root scripts with the CLI/docs work; do not remove its checks.
- [ ] Review the actual rendered browser UI with the user, using screenshots and observed behavior rather than source-code inspection alone.
- [ ] Capture reviewed recording views and note their data context. Historical receipts remain historical; current live panels depend on current credentials and liquidity.
- [ ] Prepare hosting configuration and build-preview evidence. Confirm a concrete deployment target before external publication; do not describe local build success as a deployed site.
- [ ] Record completed requirements, unresolved decisions, test evidence, routes and known limitations in this file.

Exit: the checklist is accounted for and the built app has passed meaningful browser and transaction-state validation. Remaining product decisions are explicitly named, not disguised as completed features.

## Initial research traceability

Expand this during Stage 1; this is a topic index, not a claim that every individual recommendation is already enumerated.

| Research | Requirement area | Stage | Verification |
|---|---|---|---|
| §§0–1 | Full scope, ordering and explicit cuts/decisions | 1 | Complete requirement inventory |
| §§2.1–2.5 | Tokens, hierarchy, focus, motion and craft | 2, 5 | Component/browser review |
| §§3.1–3.6 | Landing structure, vocabulary and claim discipline | 4 | Page and source/link review |
| §§4.1–4.2 | Provenance, precision and numeric typography | 3 | Boundary tests and browser inspection |
| §§4.3–4.5 | State, gross/count cap and freshness | 3 | Controlled-state browser tests |
| §§4.6–4.9 | Pending state, loading, receipts and density | 3, 5 | Lifecycle and responsive tests |
| §§5.1–5.10 | Outcome model, preflight, remedies and unified ledger | 3, 5 | Refusal/race/receipt scenarios |
| §§6.1–6.12 | Frameworks, wallet, reads, formatting, build/deploy | 1–3, 6 | API checks, builds and local integration |
| §7.1 | Reusable design skill | 2 | Skill and component consistency |
| §7.2 | Filterable/exportable verdict ledger | 3, 5 | Source-labelled export; bounded history |
| §7.3 | Multi-facility work queue | Decision D-03 | Real discovery/data contract required |
| §7.4 | Density, keyboard and command palette | 5 / D-04 | Keyboard and preference persistence |
| §7.5 | Inline mock/provenance boundaries | 3–5 | Point-of-use labels in every relevant view |
| §7.6 | Pre-ship checklist | 5–6 | Item-by-item verification |
| §7.7 | Exclusion details, amount exploration, dated waiver | 3, 5 / D-05 | Authoritative reasons and bounded simulation |

## State matrix

| Scenario | What the UI must establish |
|---|---|
| Compliant, sufficient liquidity | Correct current metrics and permitted simulation |
| Compliant, retained reserve prevents draw | Coverage remains compliant; reserve refusal is explained separately |
| Below threshold / CURE | Coverage rule, evidence, meaningful shortfall and valid remedies |
| BREACH / cure expiry | Correct state explanation; repayment remains available according to contract rules |
| Active / expired waiver | Dated waiver and underlying evaluation; no implication of restored cover |
| Stale / missing / revoked / mismatched credential | Correct reason and evidence context; no confident stale verdict |
| RPC slow / failed / partially failed | Distinct loading/failure/unavailable states; no fabricated zeros |
| Disconnected / wrong account / wrong chain | Read-only context clear; writes guarded and explainable |
| Invalid / tiny / excessive / rapidly edited amount | Exact validation, readable units, no focus loss or stale simulation overwrite |
| Wallet rejected / submitted / pending / replaced / reverted / confirmed | Accurate outcome, hash retention and no duplicate broadcast |
| Repay approval succeeds, repayment fails | Both steps retained; retry does not imply earlier approval was rolled back |
| Historical evidence alongside live state | Source/date visibly distinct; receipt links match the preserved evidence |

## Ownership while CLI/docs work proceeds

| Area | Owner and rule |
|---|---|
| `apps/dashboard/**` | Frontend owner; includes landing and browser-only adapters |
| `packages/client/**`, CLI, generated ABI contracts | CLI/client owner; frontend consumes browser-safe exports |
| `apps/docs/**` | Docs owner; frontend supplies integration/link requirements |
| `apps/dashboard/src/manifest.ts` | Explicit handoff needed: ERD currently allows client extraction here; do not edit simultaneously |
| Root scripts, TypeScript config, lockfile, CI | One integration owner per change; coordinate before concurrent dependency installs |
| Solidity, deployment/evidence JSON, signature vectors | Preserve; not frontend work |
| Recording materials | Preserve and update routes/captures only when UI changes require it |

Prefer separate worktrees/checkouts for independent implementation when available. With a shared checkout, use file ownership and serialized integration. Do not discard another agent's changes or regenerate its lockfile blindly.

The browser must not import Node file I/O, keystore adapters, CLI entrypoints or Privy secrets. Agree the small browser-facing contract: validated manifest, ABI/type exports, facility snapshot, eligibility reasons, preflight outcome and receipt model. The frontend owns hooks, rendering and injected-wallet interaction.

If those exports are not yet ready, build the UI against a typed browser adapter and labelled test fixtures. Swap in the shared implementation later without duplicating covenant calculations or waiting idle for the CLI.

## Decision register

These decisions must be resolved explicitly. They are not permission gates for unrelated implementation.

| ID | Topic | Proposed treatment / remaining decision |
|---|---|---|
| D-01 | Theme and dependency choices | Use the existing sand-dark system as the baseline; verify exact framework versions and supported APIs. Keep alternatives recorded, not silently added. |
| D-02 | Contact, company/legal and hosting | Need the intended contact destination, any form storage/delivery provider, supplied company facts, public domain and final hosting choice. Build layout and honest static content independently; no fake form submission. |
| D-03 | Multi-facility queue | Implement action-first presentation for the real single facility now. A real multi-facility queue needs discovery/configuration and data scope. Do not fabricate extra facilities; keep full multi-facility scope unresolved until decided. |
| D-04 | Density, keyboard, ledger/export | Include density preferences, safe keyboard navigation and a filterable/exportable ledger in the frontend scope. Clearly bound ledger history to fetched events and locally recorded decisions; no claim to capture every offchain simulation ever performed. |
| D-05 | Exclusion trace and counterfactual amount | Include exclusion detail from actual engine reasons. Explore maximum draw using bounded, debounced, same-context simulations, with explicit snapshot/estimate semantics. Confirm monotonicity for the applicable path before using binary search; never infer a gate verdict solely from liquidity. |
| D-06 | Charts, NumberFlow, theme toggle and navigation transitions | Account for each research suggestion. Any chart uses real/labelled observations; no decorative invented series. Theme toggle and optional motion require an explicit include/defer decision rather than disappearing into a time-based cut. |
| D-07 | Research remedy/claim corrections | Do not say repayment reduces signed exposure. Do not imply a legal hedge or integrated forward venue. Current contract semantics and source-backed claims override illustrative research copy. |
| D-08 | Contact CTA vs demo CTA | Keep operator/demo access obvious and preserve the research's contact-oriented public positioning; decide the primary CTA with the real contact path rather than shipping dead controls. |

## Recommended execution order

The six stages describe deliverables; the practical implementation order is:

1. **Traceability + ownership + shell.** Complete Stage 1, settle shared interfaces, and establish Stage 2's providers, design tokens, components and routes.
2. **One complete operator path.** Build the facility header, metric provenance, amount input and preflight explanation together. Validate permitted, coverage refusal, reserve refusal and RPC failure. This is the first browser review, after implementation begins.
3. **Complete operator behavior.** Add credential details, wallet handling, sync/restore/repay, transaction lifecycle and unified ledger. Resolve query/race/receipt problems before animation.
4. **Build the landing page from the same tokens and evidence.** This can proceed independently once tokens and routes are stable; align Vocs links with the docs owner.
5. **Finish the full interaction scope.** Add density, keyboard, export, exclusion details, bounded amount exploration and the chosen motion features. Check §7.6 continuously.
6. **Integrate and validate.** Run the controlled state matrix, existing/new checks, browser review and built-route smoke tests; then prepare recording/deployment artifacts.

This order avoids a dashboard that is visually finished but behaviorally incomplete. It also permits useful work alongside the CLI/docs agent without two owners rewriting the same files.

## Work log

| Date | Change | Evidence / next action |
|---|---|---|
| 2026-09-11 | Six-stage plan written; partial existing implementation recorded | Next: reason through ownership, scope decisions and first implementation slice with the user |
| 2026-09-11 | Checkpoint 1 on `frontend/desk` (`7192c5c`, `2dc8b63`, `a63e015`): fixtures module for `/test-ui/`; the 26 dashboard type errors resolved; React, React DOM and @types/react pinned to 19.2.8, @types/react-dom to 19.2.7 (no 19.2.8 release exists); lockfile regenerated | Dashboard typecheck 0 errors (was 26); dashboard `check` green: ABI check, typecheck, 6 fixture tests, build. Root `pnpm check`: 64 TypeScript + 31 Solidity tests, unchanged; dashboard builds. Production `dist/` contains no fixture code and no `test-ui` entry. Browser on `127.0.0.1:5174`: `/`, `/security/`, `/app/` (live Arc snapshot, reserve-held verdict, recorded ledger) and `/test-ui/?state=cure` (fixture label, CURE 68.40%, held verdict, no signing) render. Open: state-matrix rows that need injected EIP-1193/RPC fixtures (wallet, transaction lifecycle, repay approval); root `pnpm check` does not typecheck the dashboard's `.tsx`; dependency declarations are skipped (wagmi 3.7.7 and TanStack query-core generics disagree; optional connector peers are absent) |
