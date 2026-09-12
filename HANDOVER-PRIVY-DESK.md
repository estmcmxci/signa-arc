# HANDOVER — Privy on the desk

**Written 2026-09-12. Submission closes 2026-09-13, 12:00 pm EDT.**

Read [NEXT-SESSION.md](./NEXT-SESSION.md) for how we got here and [START-HERE.md](./START-HERE.md) for the standing architecture. This file dispatches one round of work across the fleet. Each lane below is self-contained: an agent should be able to work from its own section plus the shared facts, without reading the others.

---

## The objective, in one sentence

**Bring propose → approve → approve → broadcast onto the operator desk at `/app/`, so that a judge watching one screen sees that the power to override the covenant takes two people.**

## Why this round exists

The covenant loop is proven and re-runnable: the same `draw(1000000)` permitted, refused, permitted. The override is proven exactly once — one recorded transaction, from a hand-run script, on a separate page served by a separate server. A judge watching the desk never sees Privy at all.

Two consequences, and the second is the one that shapes the plan:

1. **The demo is missing its second half.** Custody and multi-party approval of the admin key are the lender's side of the product, and they are invisible.
2. **The end-to-end sequence has never run as one sequence.** `privy-waiver`'s 36 tests stop at the service boundary, with Privy mocked. The dashboard's browser tests never touch the quorum. The CLI can read `activeWaiver` and print the recorded waiver, but cannot create one. `scripts/run-waiver.ts` is the only path that goes all the way to Arc, and it ran once. So A-1→A-4 and the waiver are two runs against two facility states, never one facility across one block range.

---

## Shared facts

Every lane needs these. None of them is negotiable.

### Branching

**Re-branch from `integration` (`30912aa`).** All three lane branches are stale, and the React desk exists only on `integration`. `~/signa` is on `frontend/research`; `main` is not checked out anywhere.

| Lane | Worktree | Branch to create |
|---|---|---|
| C · surface | `workspace/signa-c` | `lane/desk-privy` from `integration` |
| A · cli | `workspace/signa-a` | `lane/cli-waiver` from `integration` |
| B · evidence | `workspace/signa-b` | `lane/waiver-run` from `integration` |
| Integrator | `workspace/signa-integration` | `integration` |

No lane edits `package.json` or `pnpm-lock.yaml`. No lane edits another lane's files. The ownership table in each section is exhaustive.

### Who the parties are

From `CovenantVault.draw()`: it is `onlyOperator`, and drawn USDC transfers **to** `policy.operator`.

| Role | Who | Custody | Address |
|---|---|---|---|
| Operator | The **borrower** drawing on the facility | Foundry keystore | `0x7e09657321F1818825a9A15cedd9D95308130ED4` |
| Facility admin | The **lender's** side: risk officer + treasury lead | **Privy 2-of-2 quorum** | `0x55C4DD3770A44695735717CB7b7005AC7dE9edA1` |
| Exposure issuer | The servicer | Foundry keystore | `0x4317497399f27d52007d7f2012EAd27f148B6662` |
| Hedge issuer | Verifier of the broker's confirmations | Foundry keystore | `0xAD515A2BE433e78B6b570064797626012e272e0a` |

The desk is the **borrower's** screen; the waiver panel is the **lender's** view inside it. Label it as such. Collapsing the two into one login would undermine the claim.

Vault `0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51`, facility `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2`. Privy wallet `zc9i4be5osru1qyzfci337mi`, key quorum `pbf1jtt1knpsl30eyp0z163t`, policy `y5x9g8gglndai2hosm47zvxf`.

**Every address comes from `deployments/arc-testnet.json` (E-MAN-4).** The addresses above are for reading this document, not for pasting into code.

### The approver service

`packages/privy-waiver` already implements the whole flow. Nothing in this round reimplements it.

```bash
set -a; . ./.env; set +a
PRIVY_WALLET_ID=zc9i4be5osru1qyzfci337mi node --import tsx packages/privy-waiver/src/main.ts
# Approver console: http://127.0.0.1:8787
```

It holds the Privy app secret, binds to 127.0.0.1 and has no login: a demo server, and it says so in its own banner.

| Route | Does |
|---|---|
| `GET /api/info` | Quorum, wallet, policy, and `readiness` — whether the contract would accept a waiver now, read fresh from Arc |
| `GET /api/actions` | Every proposal this server made, with Privy's current status |
| `POST /api/waivers` | `{durationSeconds, reason}`. Pre-validates against the chain and **refuses to propose what the contract would refuse** |
| `GET /api/actions/{id}/signing-payload` | `{text, timestamp}` — the exact bytes to sign, stamped now |
| `POST /api/actions/{id}/approve` | `{publicKey, signature, encoding:"p1363", timestamp}`. Verifies under a quorum member key before it reaches Privy |
| `POST /api/actions/{id}/reject` | Rejects the intent |
| `POST /api/actions/{id}/execute` | Checks the signed transaction field by field, broadcasts to Arc, asserts receipt `0x1` and that `WaiverCreated` names this facility and the stated reason |

**Privy signs; we broadcast.** `eth_sendTransaction` on Arc returns `401 App is not authorized to transact on chain`. Privy confirmed sign-then-broadcast is the intended path. Do not try to make Privy broadcast.

### How an approver signs

1. Fetch a **fresh** payload at the moment of approval. It embeds a timestamp and Privy accepts it for 300 seconds.
2. Check the payload against the proposed call before signing — target, calldata, chain, nonce, zero value, and that `intent_id` binds it to this proposal. `ui/approver.html`'s `inspect()` is the reference implementation.
3. Sign the payload text with the approver's P-256 key: ECDSA over SHA-256.
4. Send base64 **P1363** with `encoding:"p1363"` and the payload's own timestamp. The service converts to DER and verifies before forwarding.

Approver keys live in `~/.signa-privy-waiver/approvers/` (`risk-officer.json`, `treasury-lead.json`, `quorum.json`), mode 600 in a mode 700 directory, outside every repository. **Back that directory up: those two keys are the only way the admin wallet can ever sign, and a facility's admin can never change.**

### Constraints that bound rehearsal

- **A waiver cannot be revoked.** The Privy policy denies `revokeWaiver`, and while a waiver is active `syncCovenant` and `restoreCompliance` leave the vault WAIVED. Every take burns the facility until the waiver lapses.
- **So rehearse with 300-second durations.** `maxWaiverDuration` is 259,200 s (3 days); using it would end the demo.
- **A waiver needs a facility the contract would accept one for:** not compliant, no waiver active. On a COMPLIANT facility, pre-validation refuses and nothing reaches Privy. That refusal is worth showing on camera — it is the system working.
- **Gas.** The admin wallet held 0.2879 USDC. Top up at `faucet.circle.com`, 20 USDC per address every 2 hours.

### Claims discipline

Testnet only. Fictional facility. Labelled mock issuer data. No bank has agreed to sign anything. Sponsors are integration targets, never partners. Never say "trustless", and never claim Privy is more trust-minimised than a Safe — a Safe does m-of-n better and more verifiably. The honest argument is: **m-of-n approval without putting approvers on chain, and an allow-list on what the admin key can ever sign.**

**Both approver keys sit in one browser for this demo.** Label it on screen, and say it out loud once in the video.

### Working rules

- `pnpm check` must stay green: **151 TypeScript + 31 Solidity**. The dashboard's own suite runs separately: **17 unit + 20 browser**. Report exact counts, never "green".
- Never run a docs command naming `--account` in a test: it executes what the documentation shows and would unlock a real keystore.
- Backticks in commit messages execute inside double-quoted shell strings. Use a quoted heredoc with `git commit -F`.
- Never commit `.claude/`. Check staging before every commit.
- The keystore password lives in the macOS Keychain, service `signa-arc-testnet-keystores`, account `signa-arc`. Never print it.

---

## Lane C · surface — the desk panel

**Demo-critical. This is the one that blocks the video. Ship it first.**

**Owns:** `apps/dashboard/**`. Nothing else.

### Build

Replace the "Governed exceptions" panel at `src/app/Desk.tsx:145` with the lender's view. It must show, in this order:

1. **Who the admin is.** The Privy 2-of-2 quorum wallet, linked on Arcscan, and what its key may *ever* sign: `createWaiver`, that vault, that chain, moving no value. Say that Privy denies everything else, and that the policy cannot cap the duration — the contract does.
2. **Both approver key slots**, one per role, imported into this browser's IndexedDB as non-extractable WebCrypto keys. Each card says whether the key is the quorum member the manifest names for that role. These are **not passkeys**; say so.
3. **Why a waiver**, from `readiness`: covenant state, coverage against the minimum, and either the refusals the contract would raise or a plain statement that it would accept one.
4. **Propose**: stated reason and duration. Only the reason's `keccak256` goes on chain; the text stays off it.
5. **The proposal's progress**: proposed → risk officer approved (1 of 2, nothing executes) → treasury lead approved (2 of 2, Privy signs) → broadcast → receipt `0x1` → `WaiverCreated` checked against this facility and the stated reason, linked on Arcscan.
6. **What each approver signs**, expandable: the checks and the payload itself. Never sign a payload that does not match the proposed call.

Keep the recorded waiver (`0xf6f7d9ec…`) visible as historical evidence.

The desk reaches the service through a Vite proxy so the browser stays same-origin — configure it for both `server` and `preview`. When the service is not running, the panel must say so plainly and stay accessible; it must not look broken.

### Remove

Wallet connect and the signing path go. The borrower's key is a Foundry keystore, not a browser wallet, so the button promises what the demo cannot do — and it is currently the only broken control on the page. The desk reads, simulates and explains; the only thing signed anywhere on it is a waiver, by two people.

That means the connect control, the connector picker, the connection error line, the confirmation modal, the draw/repay/sync/restore write path, and the browser tests that guarded them. Where a control disappears, adjacent text must explain where signing now happens: the operator signs from its keystore with the `signa` CLI.

The desk keeps reading the live facility with no wallet connected. It already does; do not regress it.

### Obey

`.claude/skills/signa-ui/SKILL.md` and `output/FRONTEND-CONTRACT.md`. In particular: a waiver permits an exception, it does not restore coverage; refused controls stay focusable with `aria-disabled` and adjacent text; the panel passes the axe checks in both themes; the browser imports no Node file I/O and no Privy secret.

### Exit conditions

- The full sequence runs on camera against the live service, and the desk's own chain read flips to WAIVED with the same draw then permitted.
- With the service stopped, the panel reports it and the rest of the desk is unaffected.
- `pnpm --filter @fx-coverage/dashboard check` passes; browser suite passes at its new count, reported exactly.
- No wallet connection control exists at `/app/`, and no bundled code can sign a transaction there.

---

## Lane A · cli — `signa waiver`

**Parallel with C. Independent files. Cuttable if time runs out.**

**Owns:** `packages/cli/**`, `apps/docs/**`.

### Build

Add a `waiver` command group over the existing `QuorumAdminService` — do not reimplement the flow, and do not copy `run-waiver.ts`'s evidence writing.

| Command | Does |
|---|---|
| `signa waiver status` | Would the contract accept a waiver now, and why not. This is `run-waiver.ts --check` as a first-class command |
| `signa waiver propose` | `--duration`, `--reason`. Pre-validates, then proposes. Prints the intent and what it will sign |
| `signa waiver approve` | `--role risk-officer\|treasury-lead`. Fetches a fresh payload, signs with that approver's key file, forwards |
| `signa waiver broadcast` | Verifies the signed transaction, broadcasts, decides by the receipt, asserts `WaiverCreated` |

Approver keys come from `~/.signa-privy-waiver/approvers` (`PRIVY_APPROVER_KEY_DIR` overrides). Privy credentials come from the environment, **never from a flag** — a flag lands in shell history.

### The design risk, stated

Every other write command signs with a Foundry keystore through `cast`, and `operations.ts` owns the single write path: verify role → simulate → journal → broadcast once → journal the hash before waiting → decide by the receipt. A waiver is signed by no keystore: two P-256 keys authorize a Privy intent, Privy signs, we broadcast the raw transaction. Honour the same invariants in a second shape rather than bypassing them — in particular, journal the hash before any wait, and let the receipt decide.

### Docs

The reference pages are generated from the command tree (`apps/docs/scripts/generate-reference.ts`); regenerate rather than hand-edit. `test/docs.test.ts` executes every `pnpm signa …` the docs show, except those matching its signer guard. **Extend that guard so no documented waiver command runs in a test** — one would reach for approver keys and Privy credentials on whoever's machine the suite runs on.

### Exit conditions

- `pnpm check` green at 151 TS + 31 Sol, docs build at its current page count or more.
- No test unlocks a keystore, reads an approver key, or requires `PRIVY_APP_SECRET`.
- `signa waiver status` answers correctly against the live facility in both states: compliant (refused, with the reason) and not compliant (would accept).

---

## Lane B · evidence — the one-run artifact

**Cuttable. Must not block C.**

**Owns:** `scenarios/**`, `packages/privy-waiver/evidence/**`, credential fixtures.

### Build

One run, one facility, one block range:

1. Draw — permitted.
2. Hedge update lowers cover; `syncCovenant` → CURE.
3. The same draw, byte-identical — refused, receipt `0x0`, `DrawNotAllowed(CURE)`.
4. The quorum waives: propose → 1 of 2 → 2 of 2 → broadcast → `WaiverCreated`.
5. The same draw again — permitted, under a bounded exception, with coverage still below policy.
6. The waiver lapses; the next sync returns the facility to CURE.

Write it as evidence JSON in the existing shape so the desk and the CLI display it with no changes on their side. Assert each receipt in the direction its step expects — the refusal asserts a *failed* receipt plus evidence of `DrawNotAllowed(CURE)`, never an exit code.

Use a short waiver duration so step 6 is reachable inside the run.

### Exit conditions

- The run is reproducible from a clean checkout given credentials and gas.
- Every hash resolves on `testnet.arcscan.app`, and the refusal is one of them.
- No existing evidence record is rewritten. The superseded facility `0x39cbb5ce…` and vault `0x1970feb699…` stay where they are; four tests use them as golden vectors.

---

## Integrator

Merge each lane into `integration`, run `pnpm check` on every merge, refuse work that breaks it, and push `integration:main`. **61 commits are still unpushed; `origin/main` is `808f26e` from 10 September.** ETHGlobal checks commit history, so pushing is a submission gate, not housekeeping.

Also mine: the Privy scene in `output/VIDEO-SCRIPT.md`, and folding this round into `NEXT-SESSION.md` when it lands.

---

## Order, and what gets cut

1. **C alone, first.** Nothing else matters if the desk cannot show the flow.
2. **A in parallel**, different files, no coordination needed.
3. **B last**, and only if the clock allows.

If time runs short: cut B, then A. **C is not cuttable.** Neither is pushing, nor recording the video.
