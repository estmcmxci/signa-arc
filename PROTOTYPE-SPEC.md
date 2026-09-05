# Smallest Convincing Prototype Specification

**Status:** Implementation in progress — local acceptance passed; Base Sepolia and public-evidence gates pending  
**Target network:** Base Sepolia (`84532`)  
**Target completion:** 2026-09-02  
**Product authority:** [PRODUCT-THESIS.md](./PRODUCT-THESIS.md)  
**Public-claims authority:** [CLAIMS-EVIDENCE-LEDGER.md](./CLAIMS-EVIDENCE-LEDGER.md)

## 1. Evidence objective

The prototype must prove one narrow thesis:

> Independently authenticated exposure and hedge state can be reduced to a deterministic FX coverage result that safely governs new capital actions in a Base vault.

It is not a production credit facility, an FX execution product, or a claim that offchain facts have become trustless.

## 2. Acceptance story

A fictional originator funds COP-repayable working-capital loans to Colombian coffee cooperatives or exporters using a Base Sepolia vault denominated in a clearly labeled USDC-like test token. The facility requires 80% eligible USD/COP hedge coverage.

1. An approved mock servicer signs a USD 5.0M-equivalent COP exposure credential.
2. A distinct approved mock hedge verifier signs a USD 4.5M eligible hedge credential.
3. The engine reports 90% coverage and the vault permits a new draw while retaining the configured reserve.
4. Exposure increases or a hedge expires/cancels, dropping coverage below 80%.
5. The vault immediately blocks new draws, retains the predefined reserve, and opens a cure window; it does not liquidate a borrower or buy a hedge.
6. A refreshed eligible hedge restores coverage, resolves the cure, and restores draw availability.

The UI and fixtures must label all parties and trade data as fictional or mock. No named protocol, provider, bank, exporter, or cooperative may appear as a participant.

## 3. Deliberate minimum

### Included

- One facility and one settlement asset in the public demo.
- One configured exposure currency pair: USD/COP represented as ISO-like `bytes3` codes.
- Separate exposure and hedge signing roles.
- Direct EIP-712 signed credentials submitted to Base Sepolia.
- Onchain credential lifecycle, eligibility calculation, covenant state, draw gate, reserve, cure, waiver, restoration, and repayment.
- A TypeScript adapter using an Ebury-shaped **mock fixture**.
- A small read/write dashboard and a deterministic scenario runner.

### Deferred

- Real lender, servicer, bank, broker, Ebury, or EAS integration.
- Real funds, production USDC dependency, production borrowers, or legal facility documents.
- Price discovery, a market-price oracle, mark-to-market, collateral liquidation, margining, or hedge execution.
- Multiple facilities in the UI, portfolio optimization, cross-currency netting, counterparty concentration, or configurable basis models.
- ZK proofs, encrypted commercial terms, smart-account automation, upgradeability, token issuance, fees, or production governance.
- Claims of production security, audit, legal enforceability, or regulatory approval.

EIP-712 is preferred over EAS for this slice because direct typed signatures prove the required issuer authorization, domain separation, expiry, sequencing, and revocation with fewer moving parts. EAS can be added later as a credential transport or discovery layer without changing the core policy model.

## 4. System boundary

| Component | Minimum responsibility | Explicitly does not do |
|---|---|---|
| `FacilityRegistry` | Store facility policy, roles, signer authorization, and freeze state | Underwrite, price FX, or manage borrowers |
| `CredentialRegistry` | Verify and store the latest EIP-712 exposure and hedge assertions; handle sequencing and revocation | Determine whether an issuer’s offchain assertion is legally true |
| `ExposureCredential` | Typed data describing authenticated facility exposure | Serve as a transferable token or borrower claim |
| `HedgeCredential` | Typed data describing minimum authenticated hedge state | Represent ownership of or execute a derivative |
| `CoverageEngine` | Apply eligibility, uniqueness, maturity, freshness, and haircut rules; return coverage and reason codes | Fetch prices or recommend a hedge |
| `CovenantVault` | Hold the test settlement asset; deposit, draw, retain reserve, pause, cure, waive, restore, and repay | Liquidate offchain borrowers or seize external assets |
| `ProviderAdapter` | Convert a local Ebury-shaped mock payload to the canonical hedge typed data and request a mock signature | Call or imply authorization from Ebury |
| Dashboard | Show inputs, eligible coverage, policy status, transaction history, alerts, and scenario actions | Present the mock workflow as production or commercially integrated |

`ExposureCredential` and `HedgeCredential` are EIP-712 structs handled by `CredentialRegistry`, not separate token contracts. This is the smallest implementation that preserves every required trust boundary.

## 5. Roles

| Role | Demo identity | Authority |
|---|---|---|
| Facility admin / senior lender | Dedicated test wallet | Configure then freeze the policy; authorize/revoke signers; issue a bounded waiver |
| Originator operator | Dedicated test wallet | Request permitted draws and make repayments |
| Exposure issuer | Mock servicer test key | Sign exposure credentials only |
| Hedge issuer | Mock approved-verifier test key | Sign hedge credentials only |
| Keeper | Any account / scenario runner | Submit credentials and call covenant synchronization |

The registry must reject configuration that authorizes the same address as both exposure issuer and hedge issuer for the facility.

## 6. Canonical data

All settlement-equivalent values use the settlement token’s six-decimal units. The issuer, not an onchain price oracle, asserts the settlement-equivalent value and commits to the private source record. The dashboard must display this trust assumption.

### `FacilityPolicy`

```text
facilityId                 bytes32
settlementCurrency         bytes3      // USD
exposureCurrency           bytes3      // COP in the demo
minCoverageBps             uint16      // 8000
credentialMaxAge           uint32
maturityTolerance          uint32
defaultHaircutBps          uint16
reserveAmount              uint128
curePeriod                 uint32
maxWaiverDuration          uint32
maxActiveHedges            uint8       // hard cap: 8
settlementAsset            address
admin                      address
operator                   address
frozen                     bool
```

Policy validates basis points at `<= 10_000`, nonzero signer-independent roles, nonzero freshness/cure bounds, and `maxActiveHedges <= 8`. Once funded, economic policy is immutable for this prototype. Signer revocation and bounded waiver remain available because they are safety actions. Each role-specific revocation advances an authorization epoch, so reauthorizing the same address cannot resurrect credentials accepted before revocation. A changed economic policy requires a new facility.

### `ExposureCredential`

```text
facilityId                 bytes32
exposureCurrency           bytes3
settlementCurrency         bytes3
outstandingValue           uint128     // USD-equivalent, six decimals
exposureMaturity           uint64
observedAt                 uint64
validUntil                 uint64
sequence                   uint64
sourceCommitment           bytes32
```

Only the highest accepted sequence for a facility is current. A zero exposure is invalid for draw authorization in the demo.

### `HedgeCredential`

```text
facilityId                 bytes32
tradeIdCommitment          bytes32
baseCurrency               bytes3
quoteCurrency              bytes3
remainingNotional          uint128     // USD-equivalent, six decimals
maturity                   uint64
status                     uint8       // ACTIVE, CANCELLED, SETTLED, DISPUTED
observedAt                 uint64
validUntil                 uint64
sequence                   uint64
sourceCommitment           bytes32
```

One `tradeIdCommitment` identifies one hedge across updates. A higher sequence replaces its prior state; equal or lower sequences revert. Therefore a trade can be updated to partially settled or cancelled, but never counted twice. The full provider trade ID and confirmation remain offchain.

### Signature domain

Both typed messages use:

```text
name: FXCoverageCredentials
version: 1
chainId: runtime chain ID
verifyingContract: CredentialRegistry address
```

This prevents replay across chains or registry deployments. Every accepted assertion records the recovered issuer, credential digest, block time, and lifecycle event.

## 7. Eligibility and coverage math

An exposure is usable only when:

- its issuer is currently approved for exposure;
- the facility and currency pair match;
- `observedAt <= now <= validUntil`;
- `now - observedAt <= credentialMaxAge`;
- its sequence is the latest accepted sequence; and
- it has not been revoked by its issuer or invalidated by the facility admin.

A hedge is eligible only when:

- its issuer is currently approved for hedges and is not the current exposure issuer;
- the facility and currency pair match;
- its status is `ACTIVE`;
- `observedAt <= now <= validUntil` and it meets `credentialMaxAge`;
- `maturity + maturityTolerance >= exposureMaturity`;
- its sequence is the latest for its `tradeIdCommitment`;
- the trade ID has not appeared under another current credential; and
- it has not been revoked or disputed.

For each eligible hedge:

```text
adjustedNotional = remainingNotional * (10_000 - defaultHaircutBps) / 10_000
```

Then:

```text
grossEligible       = sum(adjustedNotional for unique eligible trade IDs)
countedEligible     = min(grossEligible, outstandingValue)
coverageBps         = countedEligible * 10_000 / outstandingValue
compliant           = coverageBps >= minCoverageBps
```

Over-hedging is visible but excess coverage is not counted. Integer division rounds down. Missing or zero exposure produces `UNASSESSED`, not compliance. The engine returns reason codes for every rejected input and the top-level result so the UI can explain the decision.

## 8. Vault state machine

```text
UNASSESSED -> COMPLIANT       valid coverage meets threshold
UNASSESSED -> CURE            valid evaluation is below threshold
COMPLIANT -> CURE             coverage becomes insufficient
CURE -> BREACH                cure deadline passes without restoration
CURE/BREACH -> COMPLIANT      fresh coverage restores threshold
any non-compliant -> WAIVED   admin creates active bounded waiver
WAIVED -> prior evaluation    waiver expires or admin revokes it, then syncs
```

Rules:

- `syncCovenant()` is permissionless and emits the ratio, status, reason, inputs, and cure deadline.
- `draw()` performs a fresh evaluation in the same transaction; stale cached compliance cannot authorize capital.
- Draws are allowed only in `COMPLIANT` or during an active `WAIVED` state.
- Every draw must leave at least `reserveAmount` in the vault.
- Entering `CURE` blocks draws immediately. The cure period is time to remedy, not permission to add exposure.
- `BREACH` adds no automatic liquidation or seizure behavior.
- Only the facility admin can create a waiver; it requires a reason commitment, cannot exceed `maxWaiverDuration`, and emits start/end events.
- `repay()` remains available in every state and reduces recorded principal after successful token transfer.
- Restoration requires current credentials and a fresh onchain evaluation; time passage alone cannot restore availability.

## 9. Provider adapter

The TypeScript adapter reads a checked-in fictional fixture whose field names and status lifecycle resemble a provider trade API. It must:

1. validate the fixture with a local schema;
2. map currency codes, trade status, remaining amount, maturity, update time, and expiry to `HedgeCredential`;
3. hash the mock trade ID and full fixture separately as `tradeIdCommitment` and `sourceCommitment`;
4. sign typed data with the mock hedge-issuer test key; and
5. submit or export the signed credential for the scenario runner.

Every fixture, script output, and dashboard surface must contain: `Mock provider data — no Ebury connection or endorsement.`

Private keys must never be committed. Local deterministic Anvil keys may be used for tests; Sepolia signers come from environment variables documented in `.env.example`.

## 10. Dashboard

One responsive page is sufficient. It must show:

- a persistent “Base Sepolia / fictional facility / mock provider data” banner;
- facility pair, threshold, freshness, maturity, haircut, reserve, and cure settings;
- current exposure issuer, value, observation time, expiry, and source commitment;
- each hedge issuer, committed ID, remaining notional, status, maturity, freshness, and eligibility reason;
- gross eligible, counted eligible, coverage percentage, covenant status, cure deadline, and available draw amount;
- event history for credential updates, draws, pauses, waivers, cures, restorations, and repayments; and
- scenario controls or a linked runner for the required success/failure cases.

The page should derive displayed policy state from Base Sepolia reads and transaction receipts, not a parallel frontend-only calculation.

## 11. Required scenario and test matrix

| ID | Scenario | Expected evidence |
|---|---|---|
| T-01 | 5.0M exposure, 4.5M eligible hedge, 80% threshold | 90% coverage; status `COMPLIANT`; permitted draw succeeds |
| T-02 | Hedge credential expires | Fresh draw reverts; sync enters `CURE`; reserve remains |
| T-03 | Higher-sequence update cancels hedge | Trade contributes zero; draw reverts; cancellation event and reason visible |
| T-04 | Exposure grows until ratio is below 80% | Draw reverts immediately even though prior state was compliant |
| T-05 | Duplicate trade ID or stale sequence submitted | Submission reverts and coverage is not double-counted |
| T-06 | Credential observation exceeds freshness | Input is ineligible with stale reason; draw reverts |
| T-07 | Hedge signer is revoked | Its credentials stop qualifying; draw reverts |
| T-08 | Hedge matures too early | Input is rejected for maturity mismatch |
| T-09 | Hedge is partially settled | Higher-sequence remaining notional lowers coverage exactly once |
| T-10 | Exposure amortizes | Higher-sequence lower exposure increases computed ratio without changing hedge data |
| T-11 | Over-hedging | Gross value is shown; counted value caps at exposure and ratio caps at 100% |
| T-12 | Hedge becomes `DISPUTED` | It contributes zero and starts/continues the non-compliant path |
| T-13 | Cure succeeds before deadline | New valid hedge produces `COMPLIANT`; draw availability is restored |
| T-14 | Cure deadline passes | State becomes `BREACH`; no liquidation or reserve transfer occurs |
| T-15 | Signer outage waiver | Only admin can issue a bounded waiver; draw works only until expiry and emits reason |
| T-16 | Repayment during breach | Repayment succeeds and principal falls; no new draw becomes available without compliance |
| T-17 | Same address assigned to both issuer roles | Configuration reverts |
| T-18 | Cross-chain, cross-registry, wrong-facility, or tampered signature | Credential submission reverts |

Unit tests cover every row. One end-to-end test or scenario script must execute T-01, T-04, T-13, and T-16 as the core demo arc. Base Sepolia transaction receipts must demonstrate the same arc after deployment.

## 12. Repository structure

```text
fx-coverage-controls/
├── contracts/
│   ├── src/
│   │   ├── FacilityRegistry.sol
│   │   ├── CredentialRegistry.sol
│   │   ├── CoverageEngine.sol
│   │   ├── CovenantVault.sol
│   │   └── mocks/MockUSDC.sol
│   ├── test/
│   └── script/
├── packages/
│   ├── credentials/        # typed-data definitions and shared encoders
│   └── provider-adapter/   # schema, fictional fixtures, mapper, signer
├── apps/
│   └── dashboard/
├── deployments/
│   └── base-sepolia.json
├── scenarios/
│   └── coffee-facility.ts
├── .env.example
├── LICENSE
└── README.md
```

Use a monorepo only to share typed data and generated ABIs; do not add services that the acceptance story does not require.

## 13. Public interfaces and events

The exact ABI may evolve during implementation, but the public surface must make these actions independently inspectable:

- create and freeze facility policy;
- authorize and revoke role-specific issuers;
- submit and revoke exposure credentials;
- submit, update, and revoke hedge credentials;
- evaluate coverage with reason codes;
- deposit, draw, synchronize, repay, waive, revoke waiver, and restore; and
- query current policy, credentials, coverage result, principal, reserve, and covenant state.

Events must include facility ID and relevant credential or policy commitment. Never emit the unhashed provider trade ID or private confirmation payload.

## 14. Definition of “Prototype” for the application

Do not change the application stage from `Idea` to `Prototype` until all of the following exist:

- [x] Contracts implement the specified trust separation and vault behavior.
- [ ] All required tests pass from a clean checkout with documented commands. (`25` Solidity and `15` TypeScript tests plus the dashboard build passed from a dependency- and artifact-free snapshot of the exact current source on 2026-08-23. The gate remains open until the same workflow passes against an immutable commit in a standalone public repository.)
- [x] The core demo arc runs end to end locally with captured Anvil receipts.
- [ ] Contracts are deployed to Base Sepolia and source-verified on a public explorer.
- [ ] Deployment JSON records chain ID, addresses, deployer, transaction hashes, block numbers, source commit, and timestamp.
- [ ] Two distinct issuer addresses are visible in accepted Sepolia credentials.
- [ ] Base Sepolia receipts prove compliant draw, breach pause, cure/restoration, and repayment.
- [ ] The dashboard reads those deployments and is publicly reachable.
- [x] Mock data and non-partnership disclaimers are visible in fixtures, scenario evidence, and the dashboard build.
- [ ] The public repository contains setup, architecture, threat assumptions, demo steps, known limitations, and a passing CI run. (The source and workflow exist locally; publication remains pending.)

Only then may the application claim a working Base Sepolia reference facility. “Verified contracts” means both explorer source verification and behavior covered by the documented test suite; neither alone is sufficient.

## 15. Evidence bundle

The handoff for application production must contain:

1. public repository URL and immutable commit hash;
2. test command and captured summary;
3. Base Sepolia deployment manifest and explorer links;
4. demo URL;
5. transaction links for the core demo arc;
6. a 60–90 second deterministic walkthrough script;
7. screenshots or recording backup in case the live demo fails; and
8. ledger updates changing only the product claims actually proven by those artifacts.

## 16. Build stop conditions

Do not widen implementation scope until the acceptance story passes. Stop and revise the design if:

- independent signers cannot be enforced;
- `draw()` can use stale cached compliance;
- duplicate or updated trades can be counted more than once;
- a breach can transfer reserves or liquidate borrowers automatically;
- mock data cannot be clearly distinguished from a real provider integration; or
- the dashboard cannot trace its decision to inspectable Sepolia inputs and receipts.
