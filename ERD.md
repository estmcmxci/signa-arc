# Signa Covenant CLI + documentation — Engineering Requirements Document

Status: draft for agent handoff. Date: 2026-09-11. This specifies new work; it does not claim the CLI or documentation site exists.

## 1. Outcome and authority

Give an operator or coding agent a supported `signa` command to inspect a facility, understand why a draw is permitted or refused, and perform explicitly requested operations with verifiable results. Publish task-oriented documentation built with Vocs, with the same commands, errors, and evidence available to humans and agents.

Read [HANDOVER.md](./HANDOVER.md) first, then [START-HERE.md](./START-HERE.md). HANDOVER supersedes START-HERE's stale build queue. [EED.md](./EED.md) owns existing interfaces and [PRD.md](./PRD.md) owns covenant requirements. This ERD owns the new CLI and docs surface; it cannot change economic policy or contract semantics.

The A-1 → A-4 Arc acceptance sequence and 2-of-2 quorum-approved waiver are already proven. Do not repeat them as discovery work. Preserve historical evidence and golden-vector fixtures. The user successfully ran the GitHub visibility-change command during this session; HANDOVER's private-repository status predates that action.

The submission deadline remains September 13, 2026, noon EDT. This work can proceed independently of recording. It is not a new condition for submitting the existing demonstration.

## 2. Reference and design decisions

The [ENSv2 plugin site](https://mm-ensv2.estmcmxci.co/) is the information-architecture reference: Start, Explainer, Reference, Evidence; a short executable quickstart; dedicated agent guidance; command/error/deployment references; Markdown access and `llms.txt`. Adopt that learning path. Its MetaMask plugin identity and wallet executor are not Signa requirements.

Use TypeScript and [incur](https://github.com/wevm/incur) for typed commands, structured output, and command discovery. Use [Vocs](https://github.com/wevm/vocs) for the documentation app. Vocs is the framework, not the hosting account. Proposed deployment: a separate Vercel project serving the Vocs app; final provider and custom domain can change without affecting CLI implementation. Do not invent a live URL.

Pin dependency versions during implementation and check their installed APIs. The first P0 slice settled the envelope flag: incur 0.5.1 uses `--full-output`, and rejects `--verbose` as an unknown flag. `packages/cli/SPIKES.md` records incur's pinned behaviour and the tests that hold it; `apps/docs/SPIKES.md` records Vocs 2.9.0's. Do not copy an outdated scaffold blindly.

Default binary: `signa`. Working package names: `@signa/client`, `@signa/cli`, `@signa/docs`, private workspace packages initially. Registry ownership is not established. A later npm release may use the owner's available scope without changing the binary name.

## 3. Scope and release slices

| Slice | Deliverable | Exit condition |
|---|---|---|
| P0 — inspect | Shared client, read-only CLI, draw simulation, offline credential inspection, Vocs core pages | Works locally without a private key; focused acceptance tests and existing checks pass |
| P1 — operate | Signed-credential submission, sync, restore, draw; receipts and transaction recovery | Anvil integration tests cover successful, refused, pending and interrupted operations |
| P2 — distribute | Installable package artifact, complete reference generation, deployable docs and release runbook | Packed CLI runs outside checkout; docs build and preview pass; publication details are concrete |
| Later | Issuer signing workflows, mock credential refresh, repayment/deposit allowance orchestration, Privy proposal client | Separate design for each workflow, rather than placeholder commands |

P0 is independently useful. Do not advertise P1 commands as available until implemented. Do not turn the acceptance scenario into a production command or a default quickstart.

Out of scope: contract changes or redeployment, new facilities, mainnet support, dashboard redesign, bank integrations, hosted signing services, a generic raw-transaction escape hatch, automatic waiver creation, and a new plugin distribution format. The existing localhost Privy console remains the approver UI.

## 4. Repository boundaries

```text
packages/client/       pure manifest validation, ABIs, contract reads, simulations,
                       credential envelopes, errors and receipt handling
packages/cli/          incur command tree, file/config I/O, terminal formatting,
                       signer adapter (P1), bin and build configuration
apps/docs/             Vocs pages, config, public assets, generated reference
scripts/               deterministic reference/ABI generation when needed
```

Reuse `packages/credentials` for EIP-712 types, hashing/recovery and decimals, and `packages/provider-adapter` for labelled mock mapping. There must be one definition of a credential and one canonical amount conversion. Do not duplicate coverage math in TypeScript.

`apps/dashboard/src/manifest.ts` mixes validation with Vite loading and fixture fallback. Extract pure validation into the client; retain a small browser-specific loader. Preserve existing manifest fields and explicitly validate any optional fields the client consumes. The CLI must never silently substitute the dashboard fixture.

The dashboard's reads and transaction logic are private functions in `main.ts`; they are reference behavior, not an importable SDK. Extract only the necessary shared pieces. Avoid changing the dashboard before filming unless required for a tested, behavior-preserving import change.

Do not import executable scenario modules: they have top-level side effects and signing access. `scenarios/arc-facility.ts` remains the recorded demonstration runner; `arc-hedge-update.ts` is a useful reference for sequence handling, not a generic refresh workflow.

Generate ABI artifacts from the existing Solidity build, with a deterministic drift check. Runtime CLI code must not depend on `contracts/out`, a repository-relative working directory, Vite globals, or a Solidity compiler. Ship the required ABI and default public manifest in the package artifact, labelled by source/version.

Existing internal packages export TypeScript source. P2 must bundle or build their runtime dependencies, replace workspace-only references as necessary, and test the packed artifact in a temporary external directory. Do not claim `npx` installation before release exists.

Give docs their own TypeScript configuration. The root currently includes `apps/**/*.ts`; scope it deliberately so Vocs tooling does not break the existing dashboard or weaken strictness. Integrate CLI and docs checks into CI without dropping existing checks.

## 5. Configuration and chain context

Requirements C-01 through C-06:

1. Import `arcTestnet` from `viem/chains`. Public-chain commands support Arc Testnet `5042002` only. Unit/integration tests inject local transports and fixture deployments; there is no implicit mainnet or Anvil fallback.
2. Common options: `--manifest <path>` and `--rpc-url <url>`. Resolution is explicit option → corresponding `SIGNA_MANIFEST` / `SIGNA_RPC_URL` environment variable → bundled public manifest. Report resolved manifest provenance. Redact RPC credentials and query secrets from diagnostics.
3. Verify RPC chain ID before live reads or writes. Validate manifest addresses, uint ranges, chain, six-decimal settlement convention and facility/vault relationships before sending. Missing code or an inconsistent deployment fails with a specific error, not an empty successful result.
4. Each report identifies chain ID, facility ID, manifest provenance and data mode (`live`, `recorded`, or `offline`). Live reports include vault and block number/hash/timestamp. Recorded reports preserve their original available context. Offline credential inspection includes the input/domain context and no invented block or live authorization result; vault is optional where irrelevant. Historical evidence never masquerades as current state.
5. Pin related reads and simulations to one block. Report stored covenant state separately from current evaluation and active waiver. Stored COMPLIANT can coexist with stale evidence; registry acceptance can coexist with ineligible coverage.
6. Parse token amounts from decimal strings exactly. For draw commands, `--amount 1` means one USDC, encoded as `1000000`; reject zero, negative, exponent notation, excess fractional digits and out-of-range values. Credential field validation follows the actual ABI and contract semantics: a hedge's `remainingNotional: "0"` is valid for a terminal update and must not be rejected by the draw-amount rule. JSON uses decimal strings for amounts, block numbers and other bigint values. No JavaScript floating-point money.

## 6. Command contract

These are proposed commands, not instructions runnable in today's repository. During development provide `pnpm signa ...` through a root script pointing to the workspace CLI. P2 installs `signa` as a bin.

| Command | Slice | Behavior |
|---|---|---|
| `signa status` | P0 | Resolve configuration; report deployment readiness and connectivity |
| `signa facility show` | P0 | Read frozen policy, role addresses, vault balance/principal, stored state and waiver status |
| `signa coverage show` | P0 | Read engine evaluation, gross/countable coverage and exposure/per-hedge eligibility reasons |
| `signa credentials list` | P0 | Read current exposure and active hedge assertions, sequences and freshness at the report block |
| `signa credentials inspect <file>` | P0 | Offline envelope validation, digest and recovered signer; no assertion of live authorization/eligibility |
| `signa draw simulate --amount <USDC>` | P0 | Simulate `CovenantVault.draw` as the manifest operator; show permitted/refused outcome and decoded reason |
| `signa evidence show` | P0 | Display bundled historical acceptance and waiver records with explorer links and recorded timestamp; no RPC needed |
| `signa credentials submit <file> --account <name>` | P1 | Validate a signed envelope and current sequence/issuer context, simulate then submit through the keeper signer |
| `signa covenant sync --account <name>` | P1 | Simulate/send `syncCovenant`, which may persist a transition |
| `signa covenant restore --account <name>` | P1 | Simulate/send `restoreCompliance`, then report its receipt and result |
| `signa draw send --amount <USDC> --account <name>` | P1 | Require operator identity; fresh simulation followed by one explicitly requested draw |
| `signa tx show <hash>` | P1 | Report pending, mined success or mined revert; decode available events and errors |

**Shipped in the first P0 slice (branch `cli/p0`):** `signa status` and `signa evidence show [record]`. Every other row is still proposed.

Keep command argument schemas, descriptions, examples, outputs, errors and read/write classification together. Generate reference tables from that definition; do not maintain a second handwritten flag inventory. Export the incur CLI definition without executing it on import.

### Simulation and refusal semantics

Use the actual vault call with the operator as sender for draw simulation. `CoverageEngine.assess` depends on its caller being a host; calling it from an arbitrary EOA gives the wrong context. `evaluate()` explains evidence; vault simulation answers whether this operation can execute.

A completed simulation with `allowed: false` is a successful inquiry (exit 0). A requested send refused during preflight is an unsuccessful action (nonzero exit), with `broadcast: false`. A mined revert is also unsuccessful, with actual receipt status `0x0`. Do not confuse any of these with an RPC timeout or unknown revert.

`draw` synchronizes inside its transaction. A reverted draw rolls that synchronization back. Neither a refused simulation nor an accepted credential submission proves a persisted state transition. A successful simulation does not guarantee later inclusion will succeed.

### Output and errors

`--json` must emit one valid JSON document to stdout, without progress text, banners or secrets. Human progress belongs on stderr. Use incur's output machinery and document the pinned framework's envelope mode; place `schemaVersion: 1` in Signa's stable data object so consumers do not depend on TTY-specific wrapping.

Signa result fields distinguish `kind: report | simulation | transaction`, `dataMode`, context, outcome and optional transaction details. A refused simulation carries `allowed: false`, decoded contract error/arguments, engine reason where available, and an actionable explanation; raw revert data remains available for diagnostics. Never fabricate a decoded reason.

Error codes include `INVALID_INPUT`, `INVALID_MANIFEST`, `CHAIN_MISMATCH`, `DEPLOYMENT_MISMATCH`, `RPC_UNAVAILABLE`, `INVALID_SIGNATURE`, `STALE_SEQUENCE`, `SIGNER_UNAVAILABLE`, `SIGNER_ROLE_MISMATCH`, `ACTION_REFUSED`, `TRANSACTION_REVERTED`, and `TRANSACTION_PENDING`. Pin and test actual exit semantics: exit 0 for completed reports/simulations and mined-success actions; nonzero for validation/transport/signing errors, refused actions, reverts and receipt timeouts. Consumers branch on codes, not error prose.

Pinned behaviour, incur 0.5.1:
- An error prints `{ code, message, retryable }` to stdout, which is one JSON document under `--json`, and exits 1.
- incur's own codes, `COMMAND_NOT_FOUND`, `VALIDATION_ERROR` and `UNKNOWN`, appear alongside Signa's.
- Help for a command group prints text even with `--json`. Help is not a command result.
- `--full-output` wraps data as `{ ok, data, meta }`, and `meta.duration` varies between runs, so consumers read `data`.
- `pnpm signa` prints pnpm's banner on stdout, so machine consumers run `pnpm -s signa … --json`.

## 7. Credential and signing boundaries

Use a versioned signed-envelope format containing `schemaVersion`, `kind: exposure | hedge`, EIP-712 domain, credential fields, signature, claimed issuer and digest. Monetary and uint64 fields are decimal strings; bytes fields have exact ABI widths; status is a validated enum. Recompute digest and recovered signer instead of trusting envelope metadata. Reject malformed fields before encoding.

Domain must match the selected chain and registry; facility must match the selected manifest. Exposure sequence is scoped to facility; hedge sequence to facility plus trade commitment. Concurrent submissions can invalidate an earlier sequence check: preserve the original signed bytes and surface that race. Never silently bump a signed sequence or timestamp.

Offline inspection proves formatting, domain consistency and signature recovery only. Submit checks live issuer authorization, revocation context and current sequence, then relies on contract simulation/receipt. Eligibility is separately read from CoverageEngine. A higher sequence does not by itself make an assertion fresh or sufficient.

P1 signing uses a narrow adapter with `getAddress`, `signTypedData` when needed later, and `sendTransaction`. Initial implementation should support an existing named Foundry keystore through supported tools/libraries, not copy the scenario's bespoke keystore decryption. Public read commands never initialize a signer. No raw-key command-line option; do not print keys, passwords, or signed raw transactions. Never make a user's local keystores part of tests.

TTY may prompt for keystore unlock; unattended use requires an explicitly configured protected password-file mechanism. Do not prompt forever in a pipe. Invoking a specific send command authorizes that operation; avoid a redundant confirmation for every step. Validate the sender and show its address and target before submission. One send command performs at most one chain mutation.

Privy remains the facility-admin authority. The CLI must not impersonate the immutable quorum admin or expose a generic admin-key bypass. A future waiver client may create and inspect intents through the existing service, but approval remains two separate people using the existing console. Keep the app secret and browser-held approver keys out of CLI distribution and docs bundles. Preserve WIRE-UP's actual limitations and use current repository notes for the latest Arc transport status.

## 8. Transaction outcomes and evidence

Persist a local operation record as soon as a transaction hash is returned, outside checked-in acceptance evidence. Record chain, sender, target, calldata commitment, hash, operation ID and submission time without secrets. Subsequent receipt failure or interruption must preserve the hash.

Wait for a receipt with a bounded timeout and inspect its status. Report `pending/unknown` when inclusion is unresolved; never call that a mined failure and never automatically resend. `tx show` permits reconciliation. Detect replacement/cancellation where the transport exposes it and report both hashes accurately.

Read post-operation state at the receipt block where supported, with its own explicit context if a later block must be used. Transaction success comes from status `0x1`; expected events and postconditions check that it achieved the intended action. Do not equate a transaction hash or a successful subprocess exit with success.

No general `--force` or `--expect-revert` escape hatch in operator commands. Expected failed transactions belong to the existing explicit scenario/testing workflow.

## 9. Documentation requirements

The Vocs app is a public product manual, not a dump of repository planning files. Suggested navigation:

| Group | Pages |
|---|---|
| Start | What Covenant does; install; five-minute read-only quickstart; for agents |
| Concepts | Exposure vs hedge assertions; coverage and haircut; freshness/sequence; cure/waiver/restoration; Arc's decimal views |
| Guides | Inspect a facility; explain a refused draw; submit an already signed credential; sync/restore; recover a pending transaction |
| Reference | Generated commands/options/outputs; error codes; signed-envelope schema; deployment manifest and contracts |
| Evidence | Recorded permitted/refused/permitted sequence; quorum waiver; architecture and limitations |

P0 publishes only implemented commands and corresponding pages. The quickstart requires no private key or funded wallet, shows `status`, `coverage show`, and `draw simulate`, and explains that current evidence can expire. Never promise COMPLIANT as a timeless expected output. Separately offer `evidence show` for a deterministic walkthrough of recorded outcomes.

Each guide states prerequisites, command, representative labelled output and what it does or does not establish. Show a refusal as a valid covenant outcome. All command examples must parse against the shipped command tree. Reference generation includes command mutability and stable output/error shapes; freeform guides explain workflows.

Provide search, readable mobile navigation, copyable commands, repository/edit links, accessible typography and restrained existing Signa visual styling. No invented bank logos or sponsor-partnership marks. Agent-readable content must include `/llms.txt` and Markdown versions of documentation pages; use supported Vocs behavior or deterministic generation for the pinned version, then verify the routes.

Public wording: fictional facility, labelled mock provider data, testnet USDC. A signature authenticates an assertion, not legal existence of a hedge. EURC is referenced, never moved. Do not label the forward-shaped mock as a working StableFX forward integration. Do not claim Privy is more trust-minimised than a Safe or that browser keys are passkeys. Keep the implementation/production boundary explicit.

Generate deployed-address tables from the public manifest and evidence links from their records. Copy/link only explicitly selected public sources; never recursively ingest Markdown from the repository or home directory. Business documents listed in `.gitignore` stay private. Keep historical evidence separate from current deployment/health claims. The site is static documentation and must not include a live signing UI or Privy service secrets.

## 10. Build, hosting and distribution

Expose workspace scripts for CLI development/build, focused tests, docs development/build/preview, reference generation and reference drift checks. Pin Node/pnpm consistent with the repository. Record the selected incur/Vocs versions and any necessary build isolation in the implementation handoff.

For hosting, prepare a separate project rooted at `apps/docs`, with workspace-aware install/build commands, an output path confirmed from the pinned Vocs build, no runtime secrets, preview behavior, and a custom-domain placeholder. Avoid guessing a Vocs output directory or assuming the ENSv2 site's provider. Build and preview first; only then is an actual deployment ready to review.

P2 package checks: bin has executable entrypoint; runtime assets resolve relative to the installed package; help and offline commands work outside the checkout; package contents include only built code, required public assets and metadata; no Foundry artifacts or private documents. README and docs must distinguish workspace use from published install instructions. Resolve package ownership, version, license and intended hosting/domain before public release. The current repository has no selected license; do not manufacture one.

Limitations demonstrated in the first P0 slice, each with a bounded decision:

- **incur's `--update` installs globally.** incur 0.5.1 honours `--update` even when automatic updates are disabled. It installs whichever package declares the `signa` bin, with `npm|pnpm|bun add --global`. Until P2, no package declares that bin, so `--update` fails with `UPDATE_FAILED`, and a test fails if a bin appears. P2 must configure incur's `update` with the owned package name, or a refusing installer, before adding the bin.
- **incur's MCP and skill built-ins cannot be removed.** `--mcp`, `mcp add` and `skills add` are always present. Read-only P0 commands may be exposed through them. Every P1 write command sets `mcp: false` until an MCP write policy is designed.
- **Static hosts need a Markdown rewrite.** Vocs 2.9.0 serves `/<page>.md` from its own server, and a static build writes the Markdown to `/assets/md/<page>.md`. A static host must rewrite `/<page>.md` to that path, or the site must use Vocs's server adapter. Decide with the hosting provider in P2.
- **Vocs writes build-machine paths into the output.** Vocs 2.9.0 puts absolute paths in the search index and the serialized client config, and no option controls either. The docs build rewrites them relative to the repository root, and the docs check fails if any local path remains (A-DOC-03).
- **incur's type declarations fail the lib check.** incur 0.5.1's published declarations fail TypeScript's lib check, so `skipLibCheck` is set in `packages/cli/tsconfig.json` alone.

This draft/handoff does not publish npm packages, modify DNS, deploy a site or submit transactions. Those are subsequent execution steps against a concrete reviewed build, with authorization assessed from the session at that time.

## 11. Acceptance criteria

| ID | Required proof |
|---|---|
| A-CLI-01 | Help, agent manifest, offline credential inspection and historical evidence run without RPC or keys |
| A-CLI-02 | Wrong chain, invalid manifest and missing/mismatched deployment produce precise failures; no silent fixture fallback |
| A-CLI-03 | Report reads share a block context; stale current evidence is distinguished from stored COMPLIANT and historical evidence |
| A-CLI-04 | Draw simulation covers allowed, CURE refusal, reserve refusal and unknown/transport failure using the real vault/operator context |
| A-CLI-05 | JSON parses for success/refusal/error; bigint strings and exact six-decimal conversion survive boundary cases |
| A-CLI-06 | Envelope validation rejects wrong domain/facility, forged digest/signer, malformed widths and stale sequence; accepted and eligible remain distinct |
| A-CLI-07 | P1 signer identity and simulation are checked before broadcast; a mined revert is nonzero despite a successful tool process |
| A-CLI-08 | Pending receipt and interrupted execution preserve transaction identity and reconcile without automatic resend |
| A-CLI-09 | Packed CLI works outside checkout with no `contracts/out`, Vite or TypeScript-source runtime dependency |
| A-DOC-01 | Vocs build/preview pass; local links, generated references, Markdown routes and `/llms.txt` resolve |
| A-DOC-02 | Docs examples match implemented command schemas and clearly distinguish recorded output from live state |
| A-DOC-03 | Docs/package output contains only allowlisted public material; no environment files, keys or private planning sources |
| A-REG-01 | Existing `pnpm check` passes; existing dashboard behavior, contract sources and recorded acceptance artifacts are preserved |

Use focused unit tests for schemas/output/errors and local Anvil integration tests for transaction/state behavior. Do not rerun the established live Arc acceptance sequence. Any later optional testnet smoke uses a specifically authorized operation and a new evidence file, never overwrites the historical run.

## 12. Agent handoff

Receiving agent: `cli_docs_handoff` in this session. First assignment: review this ERD for implementation readiness and write a bounded execution plan in `output/CLI-DOCS-HANDOFF.md`. This request is to draft and hand off requirements, not to silently ship the full implementation.

The plan must specify P0/P1/P2 file ownership, the first independently reviewable change, command/output contracts requiring an early spike, tests, and release dependencies. Resolve routine engineering choices directly; flag only decisions that change scope or require external ownership. Start with read-only client/CLI plus Vocs scaffolding when implementation is assigned. Report artifacts and limitations precisely; do not imply that a running site or published package exists.

Review order: HANDOVER → START-HERE → this ERD → relevant EED interfaces → current source. Source anchors: `apps/dashboard/src/manifest.ts`, `apps/dashboard/src/main.ts`, `packages/credentials/src/index.ts`, `packages/provider-adapter/src/index.ts`, `scenarios/arc-facility.ts`, `scenarios/arc-hedge-update.ts`, `contracts/src/CoverageEngine.sol`, `contracts/src/CovenantVault.sol`, and `packages/privy-waiver/WIRE-UP.md`.

For implementation use the installed incur skill and current pinned-package documentation. Keep this document updated when an implementation decision changes a command or release boundary.
