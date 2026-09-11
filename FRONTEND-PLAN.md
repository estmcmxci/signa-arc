# Signa Covenant frontend implementation plan

Status: in progress on `frontend/desk`. Checkpoint 1 (build green, fixtures isolated) accepted 2026-09-11. Checkpoint 2 (injected wallet and chain fixtures, browser tests, the zero-exposure correction) complete 2026-09-11, and **stage 1 is complete** with it. Stages 3–6 remain. Created 2026-09-11.

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

- [x] Read the complete research and expand the traceability table below to cover all actionable recommendations. — All 1,561 lines read 2026-09-11; "Research traceability" now carries every actionable §0–§7.7 recommendation with a destination, a state and a verification, plus two corrections to the research itself.
- [x] Audit existing components against those requirements; mark reuse, adaptation or replacement with file references. — "Component audit": fifteen areas with file references, four marked adapt, one marked replace (`src/main.ts`, orphaned), and the open items named.
- [x] Record behavior corrections: a signed credential is not legal proof; registry acceptance is not eligibility; stored state is not necessarily the current verdict; repayment does not automatically reduce independently asserted exposure. — "Behaviour corrections": each names where the code enforces it and the fixture or commit that proves it; three further corrections were found and fixed in checkpoint 2.
- [x] Document the component tree and screen hierarchy before changing the app entrypoint. — "Component tree and screens" records the four screens and what `src/app/Desk.tsx` actually renders, with the divergence from the contract's named tree stated rather than glossed.
- [x] Agree shared-client/manifest ownership with the CLI/docs implementer, including root configuration and lockfile edits. — `output/FRONTEND-CONTRACT.md` (ownership, the `manifest.ts` handoff, the per-branch lockfile rule) plus the note under "Ownership while CLI/docs work proceeds"; checkpoints 1 and 2 stayed inside that boundary.
- [x] Establish deterministic browser fixtures for each required state, explicitly isolated from the live product. — "Fixture matrix": every state-matrix row has a fixture and a named test; isolation is proven by the build-bundle scan, the storage assertion and the off-network guard. One gap is recorded rather than hidden (`pair-mismatch`).
- [x] Resolve dependency compatibility from current official documentation and installed APIs; record pinned versions rather than trusting the research's historical version list. — "Dependency decisions": sixteen rows of installed pins, including three divergences from the research and the wallet-kit rejection re-verified against the installed connector.

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

## Research traceability

The complete research (1,561 lines) was read on 2026-09-11. Every actionable recommendation is listed below with a destination and a verification. Background examples, competitor inventories and source lists are inputs, not requirements, and are not enumerated.

| Research | Actionable recommendation | Destination | State | Verification |
|---|---|---|---|---|
| §0.1, §6.2 | React for the dashboard; keep the landing framework-free | `src/app/**`; `index.html` + `src/landing/main.ts` | done | Both entries build and render; browser tests drive the desk |
| §0.2, §5.4, §6.4 | Simulate before every write; decode the custom error; render the verdict before signing | `src/data/client.ts` (`simulate`, `classifyError`), `src/data/transactions.ts` | done | `test/chain.test.ts` draw refusals; `e2e` held-draw test |
| §0.3, §2.1, §2.5 | Replace the DeFi visual language with a warm sand ramp and one accent | `src/design/tokens.css` | done | Checkpoint 1 browser review |
| §0.4, §4.2 | Tabular figures, one decimal discipline per column, pinned locale, U+2212 | `tokens.css` `.num`; `src/data/format.ts` | done | `money`/`percent` floor and pin `en-US`; `−` in `money` |
| §0.5, §5.1–§5.10 | A refusal is a verdict, not an error | `src/app/Desk.tsx` verdict panel; `src/data/reasons.ts` | done | Browser tests: covenant hold, authorization verdict |
| §1 | The 48-hour cut and its ordering | — | done | Checkpoints 1 and 2 |
| §2.2 | Named easings, UI under 300ms, frequency gate, never-ship list, reduced motion | `tokens.css`, `src/app/styles.css` | partly | `prefers-reduced-motion` honoured; hover motion is not yet gated behind `@media (hover: hover)` — stage 5 |
| §2.3 | Almost nothing animates; `:active scale(.97)`; hierarchy by weight and colour | `tokens.css`, `styles.css` | done | Source review |
| §2.4, §7.1 | Encode the UI rules as a skill before generating components | `.claude/skills/signa-ui/` | exists, uncommitted | Present in the worktree; `.claude/` is excluded from this branch's commits |
| §2.5 | No imported delight; not his brand yellow | — | done | No clip-path, spring or `#fad657` in the dashboard |
| §3.1, §3.4, §3.6 | Hero in credit language with zero crypto vocabulary; every crypto term spent on a consequence | `index.html` hero | done | "Make FX coverage a condition of drawdown." |
| §3.2 | Trust devices in order; say what the product is not, above the fold | `index.html`, `security/index.html` | partly | Boundary statement is above the fold; the legal-entity block waits on D-02 |
| §3.3 | The amateurism list | `index.html` | done | No stock imagery, rocket, TVL ticker or `Launch App` CTA |
| §3.5 | The nine bands | `index.html` | done | hero, problem, mechanism, enforcement, evidence, audience, trust, contact, footer |
| §4.1 | Provenance per figure; never `0` for a failed read; floor the ratio | `Desk.tsx` metrics; `format.ts` | done | `partial` fixture renders `—` and names the unavailable fields |
| §4.2 | `ch` width on the ratio; 6+6 truncation | `styles.css`; `format.ts` `short()` | open (stage 5) | No `min-width` in `ch`; `short()` is 8+6, not 6+6 |
| §4.3 | Word + shape + colour; magenta BREACH; `role="status"`; hatched surplus | `components/ui.tsx` `Badge`; `tokens.css`; `.surplus` | done | Badge glyphs; `--breach` is magenta; red is reserved for READ FAILED |
| §4.4 | Gross and counted separately, cap visible, fixed threshold marker, signed bp delta | `Desk.tsx` `CoverageBar`, metrics | done | Browser: counted and gross both shown; `delta()` in bp |
| §4.5 | Freshness from the credential's own window; demote the ratio; relative and absolute | `format.ts` `freshness`; `Desk.tsx` | done | `stale` fixture; the zero-exposure correction below |
| §4.6 | Never optimistically update risk figures; pending row only; scope the disable | `Desk.tsx`, `transactions.ts` | done | Browser: available draw stays confirmed with a pending caption |
| §4.7 | Skeleton for 1–10s; spinner only when the layout is unknown; escape hatch past 10s | — | open (stage 5) | No skeletons yet; the `slow` fixture exists to test them |
| §4.8 | Receipt field set, before → after, full hash on detail, copy live region, "reverted ≠ not executed", what happens next | `Desk.tsx` `ReceiptDetail`; `transactions.ts` `receipt` | done | Browser: declined and reverted details |
| §4.9 | Density modes, 5–7 KPIs, action-first line, colour only ever means state | `tokens.css` density vars; `Desk.tsx` | done | Density control; four metrics under a condition line |
| §5.1 | Three outcome classes; error styling only for "could not evaluate" | `data/types.ts` `Verdict.kind`; `classifyError` | done | Five-way kind; only `system` renders as an error |
| §5.2 | Statement-of-fact framing; icon matches text | `reasons.ts` | done | Copy review |
| §5.3 | `aria-disabled` with the reason adjacent, never in a tooltip | `Desk.tsx` action row | done | Browser tests click the gated control and read the notice |
| §5.4 | Always-on preflight, debounced, re-simulated before sending | `Desk.tsx` preflight query; `transactions.ts` `sendOne` | done | 250ms debounce; every step re-simulates; the verdict is held across a new block and discarded on any other change |
| §5.5 | One reason table: class, headline, explanation, remedy, actor | `data/reasons.ts` | partly | Headline, explanation, remedy and actor present; no explicit class column |
| §5.6 | The waiver as a governed, dated override | `Desk.tsx` waiver panel | done | Quorum approval and the underlying evaluation shown together |
| §5.7 | Control as actor; banned verbs; two remedies; results before action | `reasons.ts` | done | Copy review |
| §5.8 | No X, no warning triangle; red only for system failure | `ui.tsx` glyphs | done | ▣ hold, ⬡ breach, ■ error |
| §5.9 | The same motion for permit and refuse; no shake, flash or modal | `styles.css` | done | The verdict panel resolves in place |
| §5.10 | One ledger, identical treatment | `Desk.tsx` ledger | done | Held, declined, reverted and confirmed share one table |
| §6.1, §6.10 | One Vite project, two entries, no router; no keyed RPC in a `VITE_` var | `vite.config.ts`; `client.ts` | done | Build emits `/`, `/app/`, `/security/`; direct refresh tested |
| §6.3 | `arcTestnet` from viem; Multicall3; the 6-decimal ERC-20 view | `client.ts` | done | `validateDeployment` checks decimals; multicall at a pinned block |
| §6.5 | `injected()` only; no wallet kit; wagmi v3 names | `app/main.tsx` | done | Browser: connect, chain switch, account change |
| §6.6 | One multicall read set; `allowFailure`; no `watchContractEvent`; local receipt log | `client.ts`, `ledger.ts` | done | `partial` fixture degrades one field only |
| §6.7 | Tailwind 4, Base UI, Sonner, NumberFlow, plain SVG chart, no motion library | `package.json`, `ui.tsx`, `Desk.tsx` | done, one divergence | The coverage meter is a hand-rolled `role="meter"`, not Base UI's `Meter` |
| §6.8 | `bigint` end to end; format only at the render boundary | `format.ts` | done | No `Number()` on a money path |
| §6.9 | Inter Variable and Geist Mono through Fontsource | `app/main.tsx` imports | done | The build emits both families |
| §6.11 | The pinned dependency list | `apps/dashboard/package.json` | done, with corrections | "Dependency decisions" below |
| §7.2 | A filterable, exportable verdict ledger | `Desk.tsx`, `ledger.ts` | done | CSV and JSON export, bounded to 500 local rows |
| §7.3 | Multi-facility work queue | — | deferred, D-03 | Needs real discovery and a data scope |
| §7.4 | Density, keyboard, command palette | `Desk.tsx` | done | ⌘K, `d`, `s`, `j`/`k`; preferences persist |
| §7.5 | Point-of-use mock labels | `Desk.tsx` mock tags | done | Issuer and hedge rows carry their own labels |
| §7.6 | The pre-ship checklist | — | open (stages 5–6) | Numbers, state, refusal and receipt items partly verified; run item by item |
| §7.7 | Exclusion drill-down, counterfactual amount, waiver artefact | `Desk.tsx` `CredentialDetail`, `maximumDraw`, waiver panel | done | All three present; the trace is the engine's own reason, not a reconstruction |

**Corrections to the research, from the installed APIs.** §4.8 cites "44×44px per WCAG 2.5.8"; 2.5.8 (AA) is 24×24 CSS pixels and 44×44 is 2.5.5 (AAA), so the 32px copy targets meet AA. §6.11 pins React 19.3.0, which does not exist on the registry; see "Dependency decisions".

## Component audit

Against the requirements above, as of checkpoint 2.

| Area | Files | Verdict | Note |
|---|---|---|---|
| Landing page | `index.html`, `src/landing/main.ts`, `src/landing/styles.css` | reuse | All nine bands present. The entry creates no wallet or RPC client and reads only checked-in records; the contact form composes a mail draft and says so. |
| Trust boundary page | `security/index.html` | reuse | Shares the landing entry script and tokens. |
| Operator desk | `src/app/Desk.tsx` (~39 KB, one component plus six local ones) | adapt | Renders the whole desk from a single file. The contract's named tree is not yet extracted; see below. |
| Shared primitives | `src/components/ui.tsx` — `Badge`, `Help`, `Copy`, `Modal`, `Panel` | reuse | Base UI tooltip and dialog; copy feedback goes to a live region with `role="alert"` on failure. |
| Tokens | `src/design/tokens.css` | reuse | Sand ramp, status hues, density variables, focus ring, reduced motion. |
| Desk styles | `src/app/styles.css` | adapt | Open: no `ch` width on the ratio; hover motion is not gated behind `@media (hover: hover)`. |
| Browser adapter | `src/data/client.ts` | reuse | One multicall at a pinned block; `classifyError` keeps the ABI-drift alarm. |
| Transaction lifecycle | `src/data/transactions.ts` | reuse, two corrections | Declined and non-repricing replacements were misclassified; corrected in checkpoint 2. |
| Journal and recorded evidence | `src/data/ledger.ts` | reuse | Local rows bounded at 500; recorded evidence is separately labelled. |
| Formatting | `src/data/format.ts` | reuse | Open: `short()` truncates 8+6 where the research asks for 6+6. |
| Reason registry | `src/data/reasons.ts` | adapt | Carries headline, explanation, remedy and actor; the outcome class (§5.5) is still implicit in `Verdict.kind`. |
| Manifest | `src/manifest.ts` | reuse | Frontend-owned under the contract; the CLI copies its validator. |
| Fixtures | `src/test/fixtures.ts`, `chain.ts`, `wallet.ts`, `harness.ts`, `entry.ts` | reuse | Development entry only; see the fixture matrix. |
| Pre-React dashboard | `src/main.ts` (47 KB) | replace — delete | No HTML entry, import or build input references it; it is the vanilla implementation React replaced. Left in place for now: deleting another owner's file is outside this checkpoint's targeted-change rule. |
| Generated ABI subset | `src/data/abi/*.json`, `scripts/generate-abi.mjs` | reuse | `abi:check` guards drift; `test/chain.test.ts` now checks the fixture node against the same ABIs. |

## Behaviour corrections

Each correction names where the code enforces it, so a later change cannot quietly undo it.

| Correction | Enforced in | Evidence |
|---|---|---|
| A signed credential is not legal proof | `Desk.tsx` credentials caption; `security/index.html` | "A signature authenticates who asserted these fields. It does not prove a hedge legally exists." |
| Registry acceptance is not eligibility | `client.ts` reads `hedgeEligibility` per hedge; `CredentialDetail` | `revoked` and `maturity` fixtures: accepted credentials, excluded by the engine |
| Stored state is not necessarily the current verdict | `Desk.tsx` shows stored `covenantState` separately from the evaluation; every action re-simulates | `stale` and `expired-waiver` fixtures: storage reads COMPLIANT or WAIVED while a draw's own sync moves to CURE |
| Repayment does not reduce independently asserted exposure | `Desk.tsx` policy fact and confirmation copy; the chain fixture moves principal only | "Repayment reduces this principal, not the signed exposure obligation." |
| An all-zero exposure record means none was accepted, not stale evidence | `Desk.tsx` `exposure` / `noExposure` | Commit `271551a`; browser test "an all-zero exposure record reads as no exposure, in both fixtures" |
| A declined wallet request is not an unresolved send | `transactions.ts` `declined()` | Commit `0e1720a`; browser test "a declined wallet request is recorded as declined" |
| A replacement that is not a repricing did not execute the requested action | `transactions.ts` `services.wait` | Commit `0e1720a`; browser test "a replacement that is a different transaction is not reported as a completed draw" |

## Component tree and screens

What the app actually renders today. The contract's named tree is the extraction target, not a description of the present code.

```text
/                      index.html + src/landing/main.ts          no React, no wallet, no RPC client
/security/             security/index.html                       same entry script and tokens
/app/                  app/index.html → src/app/main.tsx
  WagmiProvider → QueryClientProvider → Tooltip.Provider
    Desk                                                          src/app/Desk.tsx
      topbar · truth strip · facility heading + wallet area
      attention line (Badge, agenda, refresh) · read context
      metrics ×4                                                  Metric; NumberFlow on counted coverage
      operator grid
        Coverage gate          amount field · verdict · action row · explore a smaller draw
        Frozen facility policy Fact ×8
        How cover is counted   CoverageBar · Sparkline
      notices · Independent assertions (exposure strip, hedge table)
      Governed exceptions (waiver artefact) · Decision & transaction ledger
      footer
      Modal ×4               review transaction · decision detail · assertion admissibility · command palette
      Toaster                transaction lifecycle only; never a refusal
/test-ui/              test-ui/index.html → src/test/entry.ts, then src/app/main.tsx   development only
```

The desk is one file. Splitting it into the contract's tree (FacilityHeader / ActionQueue / Metrics / CoverageDetails / ActionComposer / Credentials / Waiver / DecisionLedger) is the first item of the remaining stage-2 work; it was not done in checkpoint 2 because the brief required targeted changes to the existing structure.

## Fixture matrix

Every state-matrix row, the fixture that produces it, and the test that proves it. Snapshot fixtures answer at the snapshot boundary; chain fixtures answer at the RPC and wallet boundary, so the desk's live code path runs unchanged.

| State-matrix row | Snapshot fixture | Chain fixture | Proven by |
|---|---|---|---|
| Compliant, sufficient liquidity | `?state=compliant` | `?chain=compliant` | `test/fixtures.test.ts`; browser "the chain fixture is labelled, and the desk reads it through its live path" |
| Compliant, retained reserve prevents the draw | `?state=reserve` | `?chain=reserve` | `fixtures.test.ts` ReserveViolation; `chain.test.ts` per-state refusals |
| Below threshold / CURE | `?state=cure` | `?chain=cure` | browser "a held draw is recorded as a local simulation with no transaction" |
| BREACH / cure expiry | `?state=breach` | `?chain=breach` | `chain.test.ts` `DrawNotAllowed(3)` |
| Active / expired waiver | `?state=waived`, `?state=expired-waiver` | same | `chain.test.ts`: waived permits, a lapsed waiver falls back to CURE |
| Stale / missing / revoked / mismatched credential | `?state=stale`, `missing`, `revoked`, `maturity` | same | `chain.test.ts`; browser "an all-zero exposure record reads as no exposure" |
| RPC slow / failed / partially failed | `?state=slow`, `rpc-error`, `partial` | `?chain=slow`, `rpc-error`, `partial` | browser "failed and partial reads stay distinct from fabricated zeros" |
| Disconnected / wrong account / wrong chain | — | `&wallet=wrong-chain`, `&wallet=other-account`, panel controls | browser "a wallet on another chain, and an account that is not the operator, cannot draw" |
| Invalid / tiny / excessive / rapidly edited amount | any | any | `parseAmount` guards and the desk's input state; open: focused unit tests, stage 6 |
| Wallet rejected / submitted / pending / replaced / reverted / confirmed | — | panel: approve, decline, mine, speed up, cancel, replace, revert next | six browser tests plus `chain.test.ts` lifecycle and replacement reasons |
| Repay approval succeeds, repayment fails | — | `?chain=compliant` with the revert toggle | browser "repayment approves first, and a failed repayment leaves the approval standing" |
| Historical evidence alongside live state | recorded rows from the acceptance evidence | same | ledger source labels; browser tests select on "This browser" |
| Pair mismatch (exposure reason 4) | not modelled | not modelled | open: add a `pair-mismatch` fixture in stage 3 |

**Isolation from the live product.** The fixtures load only from the development `/test-ui/` entry, which no build input includes; `src/test/fixtures.ts` refuses any other browser context, and the harness fails closed by removing `#app`. In the test entry the fixture wallet replaces `window.ethereum`, EIP-6963 announcements are dropped, `localStorage` is routed to the tab's `sessionStorage`, and fetch and WebSocket cannot leave the page's origin except to the fixture node. Verified by `e2e/desk.build.spec.ts` (the built bundle contains no fixture string and `/test-ui/` is not served), by the storage assertion in the draw test, and by the `offNetwork` guard that fails any test whose page attempts a request off this machine.

## Dependency decisions

Versions as installed and verified, not as the research listed them.

| Dependency | Research | Installed | Decision and what was verified |
|---|---|---|---|
| `react`, `react-dom` | 19.3.0 | 19.2.8 | 19.3.0 is not published; 19.2.8 matches the docs worktree |
| `@types/react`, `@types/react-dom` | — | 19.2.8, 19.2.7 | No 19.2.8 of the DOM types exists; 19.2.7 accepts `@types/react ^19.2.0` |
| `wagmi` | 3.7.7 | 3.7.7 | `injected()` only. Verified against the installed connector: `wallet_requestPermissions` → `eth_accounts`, and `wallet_switchEthereumChain` resolving only once `chainChanged` arrives |
| `viem` | 2.56.3 | ^2.56.3 | `arcTestnet` (Multicall3 at `blockCreated: 0`), `ContractFunctionRevertedError` decoding, and `waitForTransactionReceipt`'s repriced / cancelled / replaced detection, all exercised by the fixture node |
| `@tanstack/react-query` | 5.102.8 | 5.102.8 | Poll at 4s; obsolete preflights discarded by key |
| `@base-ui/react` | 1.8.0 | 1.8.0 | Tooltip and Dialog adopted. **Divergence:** the coverage bar is a hand-rolled `role="meter"`, not Base UI's `Meter` |
| `sonner` | 2.0.8 | 2.0.8 | Single-id transaction lifecycle; a refusal never becomes a toast |
| `@number-flow/react` | 0.6.2 | 0.6.2 | Counted coverage only; respects reduced motion |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.3 | 4.3.3 | Dashboard only; the landing page is plain CSS |
| `@vitejs/plugin-react` | 6.1.1 | 5.2.0 | Installed pin kept; the whole check suite is green on it. Upgrading is a stage-6 integration decision |
| `vite` | ^7.2.2 | ^7.2.2 | Stay on 7; Rolldown is not adopted mid-build |
| `typescript` | 5.9.3 | ^5.9.3 (root) | wagmi v3's floor |
| `@playwright/test`, `@axe-core/playwright` | anticipated by §7.6 | 1.58.2, 4.11.1 | Chromium 1208 installed to match 1.58.2 |
| Wallet kits | rejected | none | RainbowKit, ConnectKit and Dynamic remain wagmi-v2 or React-18 bound |
| `declare module 'wagmi'` Register | recommended | not adopted | The desk compares `connection.chainId` with `arcTestnet.id` explicitly; adopting the augmentation is a stage-3 option |
| Chart, motion and money libraries | rejected | none | Plain SVG sparkline, CSS transitions, `bigint` arithmetic |

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

**Agreed and in force since checkpoint 1.** `output/FRONTEND-CONTRACT.md` records the settled version: the frontend owns `apps/dashboard/**` including `src/manifest.ts`, with the CLI copying its validator rather than sharing the file; each branch generates its own lockfile and the second integrator reruns installation instead of hand-merging; root integration changes stay with one owner. Checkpoints 1 and 2 were implemented inside that boundary — every commit touches `apps/dashboard/**` plus, by explicit authorization, that contract's React line. Nothing in `packages/`, the CLI, `apps/docs/`, contracts, deployments or evidence was modified.

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
| 2026-09-11 | Defect round on `frontend/desk` (`07fd96c`, `847652b`, `a2edbc7`): the preflight verdict survives a new block; the operator notice shows the recorded sentence rather than the library's message; one block-number format everywhere | Arc measured at about 2.1 blocks a second, so the block-keyed preflight re-keyed on every 4s poll. A browser test counts verdict resets and aria-disabled flips while the fixture head advances: 2 and 2 before the fix, 0 and 0 after, with a discard still required on a new amount, account and chain. Dashboard `check` green (17 unit tests); 20 browser tests (16 dev entry + 4 built preview); root `pnpm check` 64 TypeScript + 31 Solidity |
| 2026-09-11 | Checkpoint 2 on `frontend/desk` (`271551a`, `f01497a`, `0e1720a`, `f9ba995`, `09e7417`): zero-exposure correction; injected EIP-1193 wallet and in-memory Arc node fixtures behind `/test-ui/?chain=`; declined and replaced outcomes corrected; Playwright suite behind `test:browser`; the contract's React line. Stage 1 completed and ticked | Dashboard `check` green: ABI check, typecheck (now including `e2e/**`), 17 unit tests (was 6), build. Browser: 15 dev-entry tests on `127.0.0.1:5174` and 4 built-preview tests on `127.0.0.1:5175`, all passing, including axe on the landing, security, desk and both fixture entries. Root `pnpm check`: 64 TypeScript + 31 Solidity, unchanged. Built bundle scanned: no fixture string, no `test-ui` entry. Open: stage 2's component extraction, skeletons, `ch` width, hover-motion gating, a `pair-mismatch` fixture |
| 2026-09-11 | Checkpoint 1 on `frontend/desk` (`7192c5c`, `2dc8b63`, `a63e015`): fixtures module for `/test-ui/`; the 26 dashboard type errors resolved; React, React DOM and @types/react pinned to 19.2.8, @types/react-dom to 19.2.7 (no 19.2.8 release exists); lockfile regenerated | Dashboard typecheck 0 errors (was 26); dashboard `check` green: ABI check, typecheck, 6 fixture tests, build. Root `pnpm check`: 64 TypeScript + 31 Solidity tests, unchanged; dashboard builds. Production `dist/` contains no fixture code and no `test-ui` entry. Browser on `127.0.0.1:5174`: `/`, `/security/`, `/app/` (live Arc snapshot, reserve-held verdict, recorded ledger) and `/test-ui/?state=cure` (fixture label, CURE 68.40%, held verdict, no signing) render. Open: state-matrix rows that need injected EIP-1193/RPC fixtures (wallet, transaction lifecycle, repay approval); root `pnpm check` does not typecheck the dashboard's `.tsx`; dependency declarations are skipped (wagmi 3.7.7 and TanStack query-core generics disagree; optional connector peers are absent) |
