# START-HERE

Read this first. It is the only file that knows *where we are*. Everything else knows what must be true, or what the chain does.

| Document | Owns |
|---|---|
| **START-HERE.md** | Where we are. Build state, the queue, the rules. |
| `ARC-DELIVERY-PLAN.md` | How we get there. Five staged deliveries with exit conditions, and the strategy decisions behind them. |
| `EED.md` | What the pieces are, exactly. Interfaces, schemas, file ownership, handoff seams. Read before writing code another agent will call. |
| `PRD.md` | What must be true. Requirements with IDs, acceptance criteria, risks. The contract. |
| `ARC-FIELD-NOTES.md` | What Arc actually does. Verified constants, gotchas, corrections. The build brain. |
| `.claude/skills/use-arc/SKILL.md` | Circle's own guidance, vendored verbatim. |
| `ARC-ARCHITECTURE.html` | The mechanism, drawn. Satisfies the Arc diagram requirement. |
| `DESIGN-RATIONALE.md` | Why each rule exists. Read when a requirement looks arbitrary. |

---

## The objective

**Signa Covenant — capital access, backed by verified commitments.**

Signa is the company; **Covenant** is the product: an FX coverage gate that makes authenticated coverage an enforceable condition of USDC drawdowns.

A credit originator owes investors USDC while its loans repay in another currency. The loan balances live in a servicing system, the hedge lives at a bank, and the capital lives in a vault that cannot see whether that hedge is current, sufficient, or even matched to this facility. Operations reconciles on a calendar; capital moves on demand. **The covenant governs a conversation. It needs to govern the money.**

**The v0 shape:** a coverage gate (`ICoverageGate.assess`) is the product. `CovenantVault` is the reference host that proves it works — not the only possible host, and not a generic covenant engine. Do **not** build a `MockHostVault`; a mock calling a mock advances nothing.

**Immediate objective:** ETHOnline 2026, Arc track. **Submission closes 2026-09-13, 12:00 pm EDT.**

**The deliverable:** acceptance criteria A-1 → A-4 running on Arc Testnet `5042002`, reproducible with explorer links, plus a working frontend, the architecture diagram, a video naming the Arc bounty, and a public repository.

## Why Arc, in one paragraph

Arc is Circle's L1 where USDC is the native gas token. It ships StableFX — an RFQ venue with payment-versus-payment settlement — and StableFX is **spot only**: no forwards, no NDFs, no swaps. Circle built the leg that moves currency and explicitly not the leg that makes coverage a condition of capital. Arc's own published target uses include "onchain credit" and "stablecoin FX perpetuals." The gap is real on Circle's own chain, and it is the one this product fills.

---

## Build state

✅ done · 🔨 next · ⬜ not started

| Item | Req | State |
|---|---|---|
| Decimals boundary | R-F2-7 | ✅ `packages/credentials/src/decimals.ts`, 11 tests. Suite is 26 green. |
| Arc EUR/USD fixtures | S-B | ⚠️ **Two known defects.** (1) No restoration fixture: shipped `active → refreshed → cancelled` gives 10000 → 6840 → **0**, but A-4 requires restoring to COMPLIANT — 10000 → 6840 → **10000**, with cancellation as a separate extension. Needs a fourth fixture at `1.060000` with sequence 4; the original cannot be replayed because R-F1-4 requires the latest sequence. (2) Timestamps are baked to 2026-09-10/11 against a 24h `credentialMaxAge`, so they evaluate `UNASSESSED` by the September 12 target. Public runs must generate labelled mock observations relative to a recorded chain timestamp before signing. Both belong to plan stage 1. |
| viem with `arcTestnet` | — | ✅ 2.56.3. Never hand-roll the chain definition. |
| Architecture diagram | S-A | ✅ `ARC-ARCHITECTURE.html`. |
| Chain unknowns | — | ✅ E1/E2/E3/E5 answered on-chain. See `ARC-FIELD-NOTES.md` §7. |
| **`ICoverageGate`** | **R-F3-10** | ⬜ **Does not exist.** `CovenantVault.draw()` calls `CoverageEngine` directly. The seam is already there — `evaluate()` returns the verdict; `assess` adds the state check and the `reserveAmount` test `draw()` performs inline. ~2 hours. |
| **Arc EURC scenario** | **S-2, S-4** | 🔨 **Next.** Nothing exists. Must import `arcTestnet` from `viem/chains` and assert receipt status per A-9. |
| Deployment | S-1 | ⬜ Zero. `deployments/` is empty. |
| `Deploy.s.sol` | S-1 | ⬜ Still guards on Base `84532` and uses `MockUSDC`. Swap for `5042002` and `0x3600…0000`. The script *pattern* is verified working on Arc (E1) — only the targets are wrong. |
| Frontend | S-5 | ⬜ `apps/dashboard` reads a Base Sepolia manifest. **This is a qualification requirement**, not polish — a backend-only submission does not qualify for Arc. |
| Wave 1 Base removals | — | ⬜ `scenarios/base-sepolia.ts`, both `base-sepolia-preflight` files and their test, both `deployment-manifest` files and their test, `index-base-ecosystem.mjs`, and the four `package.json` scripts calling them. **Every one is already preserved in the private `signa-batches` repo** — verified by diff. Removing them drops the TS suite by 7 tests. |
| README | S-6 | ⬜ Currently a Base Sepolia deploy guide for scripts Wave 1 removes. Needs rewriting as the Arc README. |
| Repo public | S-6 | ⬜ `signa-arc` is private. `gh repo edit estmcmxci/signa-arc --visibility public`. **Hard gate — every track dies without it.** |
| Video | S-A | ⬜ Not recorded. Must name the Arc bounty and state the boundary (A-8). |
| Arc mainnet | — | ⬜ **Sept 30**, a separate deadline from submission. Decoupled, zero hackathon-window cost. |

## The queue, in order

1. **Arc EURC scenario** — it *is* the demo. Everything downstream cites it. Also replaces `coffee-facility.ts` so Wave 1 can finish.
2. **Extract `ICoverageGate`** — do it while porting, not after. The Arc diagram requirement means a monolith says "we built a vault"; a gate with a host says "we built a primitive."
3. **Deploy + manifest** — produces the four explorer links the video and README both need.
4. **Frontend on the manifest** — qualification requirement.
5. **Wave 1 removals + README rewrite** — must precede going public.
6. **Flip `signa-arc` public** — hard gate.
7. **Video** — names the bounty, states the boundary, shows the labelled mock seam.
8. **Mainnet by Sept 30** — after the deadline, worth doing.

Items 1–4 are the critical path. 5–7 are the submission gate.

**[ARC-DELIVERY-PLAN.md](./ARC-DELIVERY-PLAN.md) sequences this into five stages with exit conditions.** It is the execution document; this queue is the summary. Where they differ, the plan is more specific and wins on sequencing — but `PRD.md` still owns what must be true.

**Schedule pressure, recorded once.** The plan dates stages 1–3 across September 9–10, with Arc deployment due on the 10th. As of the 10th none of it has started, so roughly a day of slip exists before execution begins. The dates are deliberately unchanged. The squeeze lands on stages 4 and 5 — the dashboard and the submission package — and stage 4 is a qualification requirement, not polish.

---

## Standing rules

**Claims discipline.** Nothing is deployed until it is. Every sponsor is an integration target, never a partner. No bank has agreed to sign a credential. The Ebury-shaped fixture and the StableFX-shaped payload are labelled mocks in the README *and on screen*.

**Assert receipt status in the direction the step expects, never exit code.** Expected-success transactions assert `status == 0x1`. The intentional A-3 refusal asserts an explicitly *failed* receipt plus evidence of `DrawNotAllowed(CURE)` — a transport error or unrelated revert is not acceptance evidence. `cast send` exits `0` on a reverted transaction, observed in E5 with receipt `status 0x0`. PRD A-9. This is the failure that produces a green demo run containing a failed transaction.

**Canonical Arc constants** live in `ARC-FIELD-NOTES.md` §1. RPC is `https://rpc.testnet.arc.network` — **not** `arc.io`, which appears in Arc's own tutorial and is wrong. Chain `5042002`, hex `0x4CEF52`.

**One decimals convention.** Native USDC is 18 decimals and pays gas only. The ERC-20 view at `0x3600…0000` is 6 decimals and is what everything accounts in. They are one balance, two views, differing by 10¹². Everything crossing into a credential goes through `packages/credentials/src/decimals.ts`.

**Private documents stay private.** `PRODUCT-THESIS.md`, `CUTLIST.md`, `ETHONLINE-WORKSTREAMS.md`, `SPONSOR-STRATEGY-REVIEW.md` and all business material are canonical in the private `signa-batches` repo and are gitignored here. They exist as untracked local copies — readable, not committable. This repository goes public; its history was purged and must stay clean.

**Base work belongs in `signa-batches`.** Two repositories, one per chain. The Base→Arc pivot is not hidden — it is defensible, and the commit history showing it is deliberate.

**Never hand-roll the Arc chain definition.** `import { arcTestnet } from 'viem/chains'`.

## Repositories

| Repo | Visibility | Holds |
|---|---|---|
| `estmcmxci/signa-arc` | private → public at S-6 | This build. Working tree is `~/signa`. |
| `estmcmxci/signa-batches` | private | Base code, business material, the four private strategy docs. |
| `estmcmxci/signa` | private | The original, unclean history. A loose end — delete or archive. |

Backup mirror of the pre-purge history: `~/signa-backup-2026-09-09.git`.

## Settled decisions

Decided 2026-09-10. Full text and the requirements they generate are in [EED.md](./EED.md) §7.

1. **`outstandingValue` is denominated in the settlement currency (USD).** USD obligation against USD-delivering hedge notional. No implicit exchange rate anywhere in the ratio. No code change — the adapter already does this. (E-DEC-1)
2. **The demo moves real testnet EURC**, as a labelled mock conversion leg. **EURC is never the exposure, never read by the ratio, never held by the vault.** Presenting an EURC balance as the exposure would contradict the reason the product exists — if exposure were onchain, no credential would be needed. (E-DEC-2, E-EUR-1 … E-EUR-5)
3. **Issuer keys hold no gas.** They sign offchain; a keeper submits, per PRD §5. Two funded addresses suffice, since the keeper may reuse the operator key. (E-DEC-3)
