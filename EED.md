# EED — Engineering Requirements Document

**Signa Covenant on Arc Testnet.** Requirements the *implementation* must satisfy: interfaces, data schemas, ownership, and chain constraints. It exists so several people or agents can build at once without discovering, at integration time, that they specified the same boundary two different ways.

**Scope boundary — read before adding anything here.** [PRD.md](./PRD.md) owns what the *system* must do: coverage rules, capital controls, states, acceptance criteria, addressed as `R-*`, `S-*`, `A-*`. This document owns what the *implementation* must satisfy, addressed as `E-*`. A product requirement does not belong here, and an interface signature does not belong there. Where the two appear to conflict, `PRD.md` wins and this document is wrong.

It does **not** sequence the work. [ARC-DELIVERY-PLAN.md](./ARC-DELIVERY-PLAN.md) owns sequencing and exit conditions.

| Document | Owns | Read when |
|---|---|---|
| [START-HERE.md](./START-HERE.md) | Where we are | You just arrived |
| [ARC-DELIVERY-PLAN.md](./ARC-DELIVERY-PLAN.md) | How we get there, and by when | You need to know what to do next |
| **EED.md** | **What the implementation must satisfy** | **You are about to write code that another agent will call** |
| [PRD.md](./PRD.md) | What must be true | A requirement looks arbitrary or a rule is disputed |
| [ARC-FIELD-NOTES.md](./ARC-FIELD-NOTES.md) | What Arc actually does | You are about to assume anything about the chain |

---

## 0. Reconciliation with the PRD's original brief

`PRD.md` §"Next session" retains a brief for this document written on 2026-09-07. Most of it is superseded, and the parts that are still live have moved. Recorded here so nobody executes the stale version.

| Brief said | Status |
|---|---|
| "the decimals normalisation and its failing test (R-F2-7) as task one" | ✅ **Done.** `packages/credentials/src/decimals.ts`, 11 tests, shipped red-then-green. |
| "integration points and ship/cut gates for ENS (S-7), Privy (S-8), CRE (S-9), and the subgraph (S-10)" | ❌ **All four cut.** Arc is the sole workstream. |
| "Sequence it by day from the 8th to the 16th, with a named cut decision on the 14th" | ❌ Deadline is **September 13, 12:00 pm EDT**. The 14th is after it. Sequencing belongs to the delivery plan. |
| "Do not start building until the EED exists" | ❌ Overtaken — the decimals boundary shipped first, correctly, as the PRD's own task one. |
| Contract changes for Arc, EIP-712 domain for `5042002`, deployment plan, identities, manifest, fixtures, adapter, dashboard wiring | ✅ **Live.** Specified below. |

The brief also names `SPONSOR-STRATEGY-REVIEW.md` and `CUTLIST.md` as reading. Both are private and live in the `signa-batches` repository; neither is required to build.

---

## 1. `ICoverageGate` — the interface everything hinges on

**Requirement R-F3-10.** The delivery plan lists "specify the interface" as a task. This is that specification. Implement to it; do not re-derive it.

The gate answers exactly one question: *is this facility's FX coverage sufficient for this draw, right now.* It must not grow into a generic covenant engine — that is thesis kill condition 9.

```solidity
interface ICoverageGate {
    /// @notice Rule on whether `amount` may leave `facilityId` under current evidence.
    /// @dev MUST re-evaluate from current credential state. A cached or previously
    ///      emitted verdict never authorises capital (R-F3-1).
    /// @return allowed  true only if the facility is COMPLIANT or under an active
    ///                  bounded waiver, and the draw preserves reserveAmount.
    /// @return reason   why. Always populated, including on success (R-F2-6).
    function assess(bytes32 facilityId, uint256 amount)
        external
        view
        returns (bool allowed, CoverageEngine.ResultReason reason);
}
```

**Requirements.**

- **E-GATE-1** `assess` is `view`. The gate rules; it does not mutate. State transitions belong to the host's `syncCovenant`.
- **E-GATE-2** The verdict is derived inside the same transaction that moves funds. `CovenantVault.draw()` calls `assess` and acts on the return value; it never reads a stored flag. Satisfies R-F3-1.
- **E-GATE-3** `reason` is populated on success as well as failure. Satisfies R-F2-6.
- **E-GATE-4** The reserve test lives **in the gate**, not the host, so a second host cannot forget it. Satisfies R-F3-3.
- **E-GATE-5** The gate answers coverage sufficiency for this draw and nothing else. It must not accrete unrelated covenant logic — thesis kill condition 9.

**Extraction note.** The seam already exists: `CoverageEngine.evaluate()` returns the verdict today, and `CovenantVault.draw()` performs the state check and the `reserveAmount` test inline at `contracts/src/CovenantVault.sol:119-121`. `assess` is those three things behind one call. Roughly two hours. Do it *while* porting, not after.

- **E-GATE-6** No `MockHostVault`. A mock calling a mock does not advance v0 to v1 (`PRD.md` §11). The second host is a design-partner conversation, not a hackathon deliverable.

## 2. File ownership

So two agents do not write the same seam differently. **Owner** means: changes here go through that workstream; others read but do not edit.

| Path | Owner | Notes |
|---|---|---|
| `contracts/src/CoverageEngine.sol` | Gate | Add `assess`; do not change `evaluate`'s semantics — 25 Solidity tests depend on them |
| `contracts/src/CovenantVault.sol` | Gate | `draw()` routes through `assess`; lifecycle behaviour unchanged |
| `contracts/src/{FacilityRegistry,CredentialRegistry}.sol` | Gate | Expect no change beyond the EIP-712 domain |
| `contracts/script/Deploy.s.sol` | Deployment | Chain guard `84532` → `5042002`; `MockUSDC` → `0x3600…0000` |
| `packages/credentials/src/decimals.ts` | **Frozen** | R-F2-7. Shipped and tested. Changes require a new failing test first |
| `packages/credentials/src/index.ts` | Credentials | EIP-712 domain → chain `5042002` |
| `packages/provider-adapter/fixtures/arc-forward-*.json` | Fixtures | See §5 |
| `scenarios/arc-facility.ts` | Scenario | New file. Does not exist |
| `scenarios/coffee-facility.ts` | **Do not touch** | Base-track, leaves with Wave 1 |
| `apps/dashboard/**` | Frontend | §6 |
| `deployments/arc-testnet.json` | Deployment | Written by the deploy step, read by scenario and frontend. §4 |

## 3. Identities

**E-ID-1** Four roles, and never one key in two of them. `CredentialRegistry` reverts with `IssuerRoleConflict` (R-ROLE-1).

| Role | Signs | Sends transactions | Needs gas |
|---|---|---|---|
| Deployer / facility admin | Policy, issuer approval, waivers | Yes | **Yes** |
| Operator | — | `draw`, `repay` | **Yes** |
| Exposure issuer | `ExposureCredential` (EIP-712, offchain) | No | **No** |
| Hedge issuer | `HedgeCredential` (EIP-712, offchain) | No | **No** |
| Keeper | — | Credential submission, `syncCovenant` | **Yes** |

**E-ID-2** The keeper may reuse the operator key. The two issuers may not share an address with each other or with any transacting role.

**R-ROLE-2 is a deployment requirement, not code:** the exposure issuer must be a party that answers to the lender, never one aligned with the borrower.

**E-ID-3** Keys live in Foundry's encrypted keystore (`cast wallet import`). Never a private key in a file, a command-line flag, or an evidence log.

## 4. Deployment manifest

`deployments/arc-testnet.json`. Written once by the deploy step; read by the scenario runner, the frontend, and the README. It is the single source of truth for "what is deployed" — nothing hardcodes an address.

```jsonc
{
  "chainId": 5042002,
  "rpcUrl": "https://rpc.testnet.arc.network",
  "explorer": "https://testnet.arcscan.app",
  "sourceCommit": "<40-char git sha of the deployed source>",
  "deployedAt": "<ISO 8601>",
  "contracts": {
    "facilityRegistry":   { "address": "0x…", "deployTx": "0x…", "block": 0 },
    "credentialRegistry": { "address": "0x…", "deployTx": "0x…", "block": 0 },
    "coverageEngine":     { "address": "0x…", "deployTx": "0x…", "block": 0 },
    "covenantVault":      { "address": "0x…", "deployTx": "0x…", "block": 0 }
  },
  "settlementAsset": { "address": "0x3600000000000000000000000000000000000000", "decimals": 6, "symbol": "USDC" },
  "roles": { "facilityAdmin": "0x…", "operator": "0x…", "exposureIssuer": "0x…", "hedgeIssuer": "0x…" },
  "facility": { "id": "0x…", "policy": { "minCoverageBps": 10000, "defaultHaircutBps": 500,
                "credentialMaxAgeSeconds": 86400, "maturityToleranceSeconds": 604800,
                "reserveAmount": "…", "cureWindowSeconds": 432000, "maxWaiverDurationSeconds": 259200 } }
}
```

**E-MAN-1** `chainId` must be `5042002`. Reject anything else, as the Base manifest generator does today for `84532`.
**E-MAN-2** `sourceCommit` must be a commit that exists. The deployed source is committed before the manifest is written.
**E-MAN-3** Every `deployTx` must have a receipt with `status 0x1` before the manifest is considered valid.
**E-MAN-4** Nothing outside this file hardcodes a deployed address. Scenario, frontend and README all read it.

## 5. Fixtures

Two known defects, both stage 1, both recorded in `START-HERE.md`.

**A restoration fixture is missing.** Shipped is `active(1.060000, seq 1) → refreshed(0.720000, seq 2) → cancelled(0, seq 3)`, which gives **10000 → 6840 → 0 bps**. A-4 requires restoring to COMPLIANT: **10000 → 6840 → 10000**, with cancellation as a separate extension afterward. Add `arc-forward-restored.json` at `1.060000` with **sequence 4**. The original cannot be replayed — R-F1-4 requires the latest sequence.

| Fixture | Notional | ×0.95 | Coverage | State |
|---|---|---|---|---|
| `active` seq 1 | 1.060000 | 1.007000 | **10000 bps** | COMPLIANT |
| `refreshed` seq 2 | 0.720000 | 0.684000 | **6840 bps** | CURE |
| `restored` seq 4 | 1.060000 | 1.007000 | **10000 bps** | COMPLIANT |
| `cancelled` seq 5 | 0.000000 | 0 | **0 bps** | CURE (extension) |

Against a `1.000000` exposure with a 500 bps haircut. Counted coverage caps at the exposure, so 100.7% counts as 100% — over-hedging is visible, never counted (R-F2-3).

**Timestamps go stale.** Checked-in fixtures carry `2026-09-10/11` against a 24-hour `credentialMaxAge`, so they evaluate `UNASSESSED` on any later day. Keep them fixed for deterministic local tests. For **public runs, generate observations relative to a recorded chain timestamp before signing**, and derive `observedAt`, `validUntil` and `maturity` coherently. Save the generated fixtures, source commitments, sequences and signed payloads with the evidence; never modify a signed field afterward.

**E-FIX-1** A restoring credential carries a strictly higher sequence than the update it supersedes; the original is never replayed (R-F1-4).
**E-FIX-2** Public runs generate observations relative to a recorded chain timestamp before signing, deriving `observedAt`, `validUntil` and `maturity` coherently. Checked-in fixtures stay fixed for deterministic local tests.
**E-FIX-3** Generated fixtures, source commitments, sequences and signed payloads are saved with the evidence. A signed field is never modified afterward.
**E-FIX-4** Every amount reaching a credential passes through `packages/credentials/src/decimals.ts`. No exceptions.

## 6. Scenario and frontend contracts

**`scenarios/arc-facility.ts`** — new file, does not exist.

- **E-SCN-1** `import { arcTestnet } from 'viem/chains'`. Never hand-roll the chain definition.
- **E-SCN-2** Read every address from `deployments/arc-testnet.json`. Hardcode nothing.
- **E-SCN-3** Assert receipt status **in the direction each step expects** (A-9). Expected-success asserts `status == 0x1`. The A-3 refusal asserts an explicitly **failed** receipt plus `DrawNotAllowed(CURE)` evidence via revert data or a state-pinned simulation. A transport error or unrelated revert is not acceptance evidence.
- **E-SCN-4** Emit an evidence file recording, per step: transaction hash, expected and actual receipt status, coverage result, reason code, explorer link.

The step sequence is A-1 → A-4 exactly: permitted draw → reduced hedge and `syncCovenant` to CURE → the **identical** draw refused → fresh hedge, explicit restoration, draw succeeds. Restoration requires a fresh onchain evaluation; time alone restores nothing (R-F3-9).

**`apps/dashboard`** reads the same manifest.

- **E-UI-1** Display gross and counted coverage **separately**, so over-hedging stays visible while counted coverage is capped (A-7).
- **E-UI-2** Show reason codes, never only a colour (R-F2-6).
- **E-UI-3** Keep mock-provider and mock-payload labels visible on screen.
- **E-UI-4** Never compute a competing coverage verdict. The record plane has no authority over capital (R-F4-2).
- **E-UI-5** Stale or unavailable data is visibly identified as such, never rendered as current compliance.

## 7. Settled decisions

Decided by the founder 2026-09-10. All three are baked into signed credentials at stage 1.

**E-DEC-1 — `outstandingValue` is denominated in the settlement currency (USD).** The coverage ratio compares a USD obligation against USD-delivering eligible hedge notional. `remainingNotional` maps from `remaining_buy_amount`, the buy leg, exactly as the adapter does today. Never divide a EUR amount by a USD amount, and never introduce an implicit exchange rate anywhere in the ratio. No code change; the fixtures already satisfy this.

**E-DEC-2 — the demo moves real testnet EURC, and EURC is never presented as the exposure.**

This is a deliberate reversal of the original design position, taken so the EURC contract appears in the submission. The constraint matters more than the mechanism:

- **E-EUR-1** EURC appears as a **conversion leg** — a labelled mock EUR→USD settlement movement demonstrating the StableFX-shaped seam this product sits above. It is evidence that the conversion layer exists and is not what we built.
- **E-EUR-2** EURC balances are **never** presented, labelled, or implied to be the exposure. The exposure is a loan book in a servicing system, asserted by the exposure issuer under `ExposureCredential`. If an onchain token balance were the exposure, no credential would be needed and the product's reason for existing collapses. This is the one way to get E-DEC-2 wrong.
- **E-EUR-3** The coverage ratio never reads an EURC balance. Coverage is computed from credentials only (R-F2-1 … R-F2-4). EURC movement is illustrative and has no authority over capital, the same rule the record plane obeys (R-F4-2).
- **E-EUR-4** `CovenantVault` continues to hold and move **only** USDC. The settlement asset in the manifest stays `0x3600…0000`.
- **E-EUR-5** Every EURC movement is labelled a mock on screen and in the README, like the Ebury-shaped fixture and the StableFX-shaped payload.

**E-DEC-3 — the issuer keys hold no gas.** They sign EIP-712 offchain; a keeper submits, per PRD §5. Two funded addresses suffice in practice, since the keeper may reuse the operator key. This is also the more honest architecture: a real bank verifier would never hold gas on this chain.

> `ARC-DELIVERY-PLAN.md` line 17 predates E-DEC-2 and states the demo "does not require EURC token transfers." Superseded by this section.

## 8. Standing constraints

Repeated here because they are the ones that get forgotten under time pressure.

1. **One decimals convention.** Native USDC is 18 decimals and pays gas only. The ERC-20 view at `0x3600…0000` is 6 and is what everything accounts in. One balance, two views, 10¹² apart.
2. **Assert receipt status, in the expected direction. Never exit code.** `cast send` exits `0` on a reverted transaction.
3. **`arcTestnet` from `viem/chains`.** RPC is `rpc.testnet.arc.network`, not `arc.io`.
4. **Four identities, two of which must never share an address.**
5. **Claims discipline.** Nothing is deployed until it is. Sponsors are integration targets, never partners. No bank has agreed to sign a credential. Mocks are labelled in the README *and on screen*.
6. **The gate answers one question.** Coverage sufficiency for this draw. Nothing else.
