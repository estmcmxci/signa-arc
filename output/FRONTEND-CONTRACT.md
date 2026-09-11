# Frontend ownership and interface contract

2026-09-11. Branch `frontend/research`; based on `5ed7f9a`. No push or merge authorized.

The CLI/docs owner works in `cli/p0` in a separate worktree. User confirmed that dashboard `manifest.ts` belongs to frontend; CLI copies its validator. React, React DOM and @types/react match the docs worktree's **19.2.8**; @types/react-dom is **19.2.7**, since no 19.2.8 was released. Each branch generates its own pnpm lockfile; the second integrator reruns installation, never hand-merges it.

Lead owns dashboard React code, browser adapter, design tokens, app entry, Vite/package/test config, generated frontend ABI subset, and integration. Landing subagent owns only `apps/dashboard/index.html`, `apps/dashboard/src/landing/**`, `apps/dashboard/security/index.html`, and its landing-specific assets. It may report review findings for dashboard files, not edit them without a handoff. Neither edits CLI/docs or contracts/evidence. Root integration changes remain with the lead.

Routes: `/` public landing; `/app/` operator desk; `/security/` honest trust/boundary page. Docs link uses configurable public `VITE_DOCS_URL`, falling back to the existing public repository README until the Vocs site has a real URL. Contact is `mailto:m@oakgroup.co`; optional qualifying form composes an email locally and clearly says it opens the user's mail app, not that it submits to a server. One real facility only, per user.

Design tokens: `apps/dashboard/src/design/tokens.css`, sand-dark default with explicit light theme; semantic colors only inside data regions. Inter Variable for quantities/prose; Geist Mono Variable for identifiers. Landing uses plain CSS and no React provider. Agent can import the token CSS but must not redefine it. UI copy changes use the copy-doctor skill.

React tree: Providers → Desk → FacilityHeader / ActionQueue / Metrics / CoverageDetails / ActionComposer / Credentials / Waiver / DecisionLedger. Base UI dialog/tooltip provide focus management, Sonner only tracks submitted transaction lifecycle; local refusals stay inline and in the ledger. Density and theme preferences persist locally. Command palette navigates/focuses, never broadcasts.

Browser adapter returns a `Snapshot` with block number/hash/time, per-field read availability, policy, exposure, current engine result, stored state, reserve/liquidity, principal, waiver and per-hedge eligibility. Reads at one pinned block; no TypeScript eligibility engine. Preflight returns a discriminated permitted/refused/input/authorization/system outcome with amount, sender and block context. Transaction requests re-simulate at send time and inspect receipts; pending/replaced/reverted outcomes remain distinct.

Query keys include manifest identity, chain, account, amount and snapshot block. Poll chain data at 4 seconds; age ticker is separate. Abort/ignore obsolete preflights; no stale permit can authorize a new amount/account/chain. Post-submit balances stay confirmed with a pending-operation caption. Persist transaction hashes before waiting; receipt recovery is read-only.

Test fixtures are available only through a dedicated dev/test entry and are visibly labelled. They cannot create a production wallet client or send a live transaction. Browser tests also inject EIP-1193 and RPC responses to exercise live-path behavior. Anvil integration uses only disposable keys and local deployments.

Explicit research corrections: repayment changes principal/token balance, not the signed exposure denominator; frozen policy is not editable as a remedy; sync does not renew credentials; only currently available reasons may be shown as a trace; historical/local ledgers cannot claim completeness; simulation-only records have no receipt/hash; do not fabricate confirmation timing, legal status or contact delivery.
