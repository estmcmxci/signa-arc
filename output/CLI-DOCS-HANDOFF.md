# Signa Covenant CLI + Vocs documentation: agent handoff

Received and reviewed by `cli_docs_handoff`, 2026-09-11. Requirements: [ERD.md](../ERD.md).

**Review status: ready to begin P0 when implementation is assigned.** This handoff is the completed assignment for this session; no CLI implementation, dependency installation, deployment, package publication, secret access, or chain operation was performed. Existing Arc acceptance and waiver evidence were accepted as established in HANDOVER.md.

Review clarifications are resolved in ERD: offline inspection has its own data mode without an invented block/authorization result, and zero rejection applies to draw input without rejecting valid zero hedge notionals. No material requirements defect remains for starting P0.

## Working order

Read HANDOVER.md, START-HERE.md, ERD.md, then the relevant EED.md interfaces and current source. HANDOVER supersedes the older build queue. Preserve the video work, historical evidence, superseded deployment fixtures and Privy golden vectors. The public-repository command already succeeded in this conversation; do not treat the older private status as an unfinished task.

Use incur for the command tree and Vocs for the static manual. The installed incur skill is `/Users/oakgroup/.agents/skills/incur/SKILL.md`; its examples require verification against the version actually pinned. The reference site's useful pattern is Start / Explainer / Reference / Evidence, with an executable quickstart, agent guidance, command/error/deployment reference, Markdown pages and `llms.txt`.

## Ownership and changes

These are ownership boundaries for whoever implements each slice, not requests to start parallel agents automatically. One implementation owner may handle all of them. A single integration owner coordinates shared configuration and the lockfile.

| Owner | Files | Responsibility |
|---|---|---|
| Client | `packages/client/**`, ABI generator under `scripts/` | Pure manifest schema, shipped ABI data, credential envelope parsing, reads, simulation, errors; P1 receipt handling |
| CLI | `packages/cli/**` | Exported incur command definition, separate executable entrypoint, configuration/I/O, output contract; P1 signer and operation journal |
| Docs | `apps/docs/**`, reference generator under `scripts/` | Vocs config, content, generated command/deployment/evidence pages, Markdown and agent routes |
| Integration | root package/workspace/TypeScript configuration, lockfile, CI, ERD | Dependency pins, scripts, build isolation, public artifact checks, release instructions |

Client owner may make a behavior-preserving import change in `apps/dashboard/src/manifest.ts` after extracting its pure validator. Do not move dashboard transaction/UI logic wholesale or change its fixture fallback behavior. No owner edits Solidity, the recorded scenario outputs, Privy evidence, golden fixtures or recording assets for this project.

## First independently reviewable change

Deliver a small P0 vertical slice: pure manifest parsing and bundled public manifest; `signa status` and `signa evidence show`; the incur command export and separate bin; Vocs Start/Evidence pages and scoped configuration. `status` checks configuration and live connectivity through an injected public client. `evidence show` is deterministic and requires no RPC or signer. Its data is explicitly recorded, never described as present health.

Include CLI stdout/exit tests, malformed-manifest tests, recorded-evidence provenance tests and a docs build. Show generated help and representative output from test fixtures. This establishes the package/import/output architecture before adding credential or write workflows. Pin framework versions and document the API spike below in the same change. Do not publish an installation command for a package that does not exist.

## P0: inspect and explain

1. Extract pure manifest validation from the Vite-specific loader, preserving deployed fields, including optional exposure-denomination and quorum metadata. CLI configuration has no fixture fallback. Ship generated ABIs; never import executable scenarios or require `contracts/out` at runtime.
2. Add facility, coverage and credential reads pinned to one block. Report the block hash/time, actual facility policy and role addresses, stored covenant state, current evaluation, active waiver and eligibility reasons. Read contract verdicts instead of duplicating coverage arithmetic.
3. Add vault draw simulation with operator sender context. Do not call `assess` from an arbitrary EOA: it expects its caller to be the host. A completed refusal is an exit-0 inquiry; transport failure or an unknown undecodable error is a failed inquiry. Simulation never implies a persisted state transition.
4. Add strict offline signed-envelope inspection using the existing credentials package. Decimal strings encode uint64/monetary fields; validate ABI widths, digest, recovered signer, domain and selected facility. Offline output must explicitly lack a live block/authorization claim. Preserve zero values permitted by credential semantics, including zero hedge notional; reject zero for draw amounts.
5. Complete P0 guides and generated command/error/schema references. Examples cover stale credentials, refusal and historical evidence. No private key is needed for the quickstart.

Acceptance: focused schema/command/output tests, deterministic injected-RPC tests, local Anvil simulation smoke and the existing `pnpm check`, plus docs build/link/Markdown checks. No rerun of live Arc acceptance is needed.

## P1: explicitly requested operations

Implement a narrow signer adapter only after the keystore spike settles its supported interface. Add signed-envelope submission, covenant sync/restore, draw send and transaction inspection. There is no generic arbitrary-call command and no Privy admin bypass.

Each send resolves and verifies chain/facility/signer context, simulates the actual action, sends at most one mutation and records its hash before waiting. Keep a journal outside the repository and emit machine-readable pending information on timeout. Never retry a send automatically. A failed receipt remains a failed action even when the signer subprocess exited successfully.

For credential submission, use sequence scope `(facility)` for exposure and `(facility, trade commitment)` for hedge. Preserve the original signature through race failures; do not bump timestamps or sequences. Distinguish successful registry acceptance from current coverage eligibility. Read postconditions at the receipt block and report its context.

Tests use temporary disposable Anvil accounts, never user keystores: success, refusal with no broadcast, post-simulation race/revert, stale sequence, wrong signer, wrong chain, pending timeout, interruption with retained hash, replacement when observable and receipt reconciliation. Check that refused draw synchronization is rolled back. Repayment/deposit approval orchestration and issuer signing remain later work.

## P2: distribute and host

Bundle/build internal TypeScript runtime dependencies, ABIs, manifest and explicitly selected historical evidence. Test the packed package from a temporary directory outside the checkout, with no Foundry build artifacts or workspace packages available. Verify bin/shebang/executable metadata and offline help/evidence behavior.

Finish generated references, error/output examples, agent-readable routes and deployment instructions. The site consumes allowlisted public content, never recursive repository Markdown ingestion. Prepare a workspace-aware hosting configuration using the actual Vocs build output, with no runtime secrets. A local preview and a release-ready artifact complete preparation; a public URL or npm release is a separate external action.

## API spikes to settle early

| Spike | Required result |
|---|---|
| incur parsing | Verify nested groups, common options, kebab-case flags and decimal strings without numeric coercion. Record exact pinned version and help output. |
| incur output/errors | Verify `--json`, full-envelope flag, custom error codes and exit handling in TTY and pipes; stdout is exactly one JSON document. Keep Signa's versioned data shape stable. |
| incur discovery | Verify an import-safe CLI definition, command metadata generation and `--llms` behavior. Decide how generated docs consume schemas without executing handlers or initializing RPC/signers. Do not accidentally expose HTTP/MCP write surfaces. |
| Vocs | Verify configuration schema, compatible runtime/React requirements, workspace install, build output, preview, search, Markdown and `llms.txt` behavior. If routes need generation, use a deterministic generator. |
| Foundry keystore, before P1 | Test supported named-keystore address lookup/sign/send tooling with a temporary test keystore. Verify protected password-file and TTY handling, redaction, hash capture before receipt wait, nonzero errors and clean cancellation. Never copy bespoke scenario decryption. |

The draft deliberately leaves these pinned-package implementation details to the receiving agent. If a framework cannot satisfy a required contract, update ERD with the demonstrated limitation and a bounded decision before expanding implementation.

## Release dependencies and review evidence

P0 needs dependency access and a working local toolchain, not public credentials or hosting ownership. P1 additionally needs a verified signer integration; automated tests stay local. P2 external publication needs a confirmed npm scope/name, hosting project/provider and optional domain ownership. Prepare the exact package/site preview and release commands before requesting any still-needed authorization.

Each slice reports changed behavior, focused test results, existing-check results and limitations. Keep ERD command tables synchronized with what ships. No claim of a working CLI, npm package or hosted documentation is warranted by this handoff alone.
