# Signa Covenant

**Capital access, backed by verified commitments.**

Signa is the company. Covenant is the product: an FX coverage gate that makes authenticated coverage an enforceable condition of USDC drawdowns. Verified coverage determines whether a vault can release funds; when coverage changes, access follows the facility's policy.

`CovenantVault` is the reference host that proves the gate works, through `ICoverageGate.assess`. The product is intended to support other host vaults, assets, and issuers; external host integrations are not yet implemented. The name reflects the financial commitments that govern capital access.

**Current state: deployed to Arc Testnet `5042002` and exercised end to end.** Acceptance criteria A-1 through A-4 in [PRD.md](./PRD.md) have run against the live facility below, with explorer-linked receipts for every step, including the one that is supposed to fail.

**Provider data:** mock only — no Ebury connection, integration, or endorsement. StableFX-shaped hedge payloads are equally fictional; no venue is integrated.

This repository demonstrates one narrow claim: independently authenticated exposure and hedge assertions can produce a deterministic FX coverage result that safely governs new capital actions in an EVM vault, on Arc, in USDC.

The product is an **FX coverage-control layer for onchain credit**. It does not recommend, arrange, execute, custody, or represent ownership of an FX derivative. An authorized signature proves who asserted defined fields; it does not independently prove the legal existence or enforceability of an offchain hedge.

The frozen product boundary is in `PRODUCT-THESIS.md` (private), the implementation authority is [PROTOTYPE-SPEC.md](./PROTOTYPE-SPEC.md) and [EED.md](./EED.md), and public claim constraints are in `CLAIMS-EVIDENCE-LEDGER.md` (private).

## What currently works

- Frozen USD/EUR facility policy with independently authorized exposure and hedge issuers.
- Direct EIP-712 credentials with runtime chain and registry domain separation, bound to Arc `5042002`.
- Latest-sequence replacement, credential and issuer revocation, revocation epochs that prevent stale credential resurrection after reauthorization, and an eight-active-hedge cap.
- Freshness, currency, status, maturity, uniqueness, and haircut eligibility rules.
- Eligible coverage aggregation with excess cover capped at authenticated exposure — gross stays visible, only counted governs a draw.
- `ICoverageGate.assess`: the reserve test and the compliance test live in the gate, not the host, and re-evaluate from current credential state inside the same transaction as the draw. A cached or previously emitted verdict never authorises capital.
- Reserve retention, cure, breach, bounded waiver, restoration, and repayment states.
- Strict TypeScript mapping of checked-in fictional provider fixtures, generated relative to a recorded chain timestamp for public runs.
- A deployed, deterministic Arc scenario proving the full recovery sequence — permitted draw, reduced coverage, refused identical draw, fresh hedge, explicit restoration, permitted draw again — with an explorer-linked receipt at every step.
- An operator dashboard that reads the deployment manifest, simulates every write before sending it, and never recomputes a competing coverage verdict in the browser.

## Architecture

```text
Mock exposure issuer ── ExposureCredential ─┐
                                            ├─ CredentialRegistry
Mock hedge issuer ───── HedgeCredential ────┘          │
                                                       ▼
FacilityRegistry ── frozen policy ──────────── CoverageEngine ── ICoverageGate.assess
                                                                          │
                                                                          ▼
                                                                   CovenantVault
                                                        draw / reserve / cure / repay
```

- [`FacilityRegistry`](./contracts/src/FacilityRegistry.sol) stores economic policy and role-specific issuer authorization.
- [`CredentialRegistry`](./contracts/src/CredentialRegistry.sol) verifies and records the current EIP-712 assertions.
- [`CoverageEngine`](./contracts/src/CoverageEngine.sol) implements [`ICoverageGate`](./contracts/src/ICoverageGate.sol) and returns eligibility reasons and coverage without fetching prices.
- [`CovenantVault`](./contracts/src/CovenantVault.sol) holds the settlement asset and gates capital actions through the gate's verdict.
- [`MockUSDC`](./contracts/src/mocks/MockUSDC.sol) is an unrestricted-mint, six-decimal test token, used only for local Foundry tests — never on Arc, where the vault holds the real USDC ERC-20 view.
- [`credentials`](./packages/credentials/src/index.ts) is the canonical TypeScript typed-data definition, bound to Arc's EIP-712 domain.
- [`provider-adapter`](./packages/provider-adapter/src/index.ts) maps strictly validated fictional fixtures.
- [`arc-facility.ts`](./scenarios/arc-facility.ts) runs A-1 … A-4 against the deployed Arc facility and writes the evidence below.
- [`dashboard`](./apps/dashboard/src/main.ts) reads `deployments/arc-testnet.json`, simulates every write, and renders the gate's own verdict.

## Prerequisites

- Foundry with `forge`, `cast`, and `anvil`
- Node.js 24+
- pnpm 10+

Install JavaScript dependencies and run every current check:

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` builds the Solidity artifacts, typechecks all TypeScript, runs 170 TypeScript tests across typed data, the decimals boundary, the provider adapter, the Arc fixtures, the CLI, and the Privy waiver quorum service, runs 31 Solidity tests, builds the dashboard, and builds 16 documentation pages. `contracts/out/` is gitignored, so a fresh checkout fails a bare `tsc` until `forge build` has run — use `pnpm check`, not `pnpm typecheck` alone.

The tested toolchain is Node.js `24.1.0`, pnpm `10.17.1`, Foundry `1.5.0`, and Solidity `0.8.30`. The lockfile and Solidity configuration pin dependency resolution, compiler version, and the `prague` EVM target. The first build may fetch the pinned Solidity compiler if it is absent from Foundry's cache; contract tests then run offline. [GitHub Actions](./.github/workflows/check.yml) runs this same sequence on every push.

Direct contract commands:

```bash
forge build
forge test --offline
forge build contracts/src --offline --sizes
```

## Arc Testnet deployment

Arc is Circle's EVM-compatible L1 where **USDC is the native gas token**. Canonical constants live in [ARC-FIELD-NOTES.md](./ARC-FIELD-NOTES.md) §1 and are not repeated elsewhere.

| | |
|---|---|
| Chain ID | `5042002` (hex `0x4CEF52`) |
| RPC | `https://rpc.testnet.arc.network` — **not** `arc.io`, which appears in Arc's own tutorial and is wrong |
| Explorer | [`https://testnet.arcscan.app`](https://testnet.arcscan.app) (Blockscout) |
| USDC ERC-20 (settlement asset) | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000), 6 decimals |
| EURC (exposure's denominating asset, **referenced, never moved** — see below) | [`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`](https://testnet.arcscan.app/address/0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a), 6 decimals |
| Faucet | `https://faucet.circle.com` — 20 USDC per address every 2 hours |

`viem` ships Arc natively. Import `arcTestnet` from `viem/chains`; never hand-roll the chain definition.

**Deployed contracts** ([`deployments/arc-testnet.json`](./deployments/arc-testnet.json), the single source of truth — nothing else hardcodes an address):

| Contract | Address | Deploy transaction |
|---|---|---|
| `FacilityRegistry` | [`0xB54fe913C4a7dE73Bc285338dCbb384AEec5e448`](https://testnet.arcscan.app/address/0xB54fe913C4a7dE73Bc285338dCbb384AEec5e448) | [`0x6616528d…`](https://testnet.arcscan.app/tx/0x6616528d287af73044bf69fe22126cce92df818b9ac01fe4f0ec01851cc51b62) |
| `CredentialRegistry` | [`0xD921734C9314442a74Cd3FEBAB8028b2Bb9A7624`](https://testnet.arcscan.app/address/0xD921734C9314442a74Cd3FEBAB8028b2Bb9A7624) | [`0x065e74b6…`](https://testnet.arcscan.app/tx/0x065e74b65246258c403f97d5e36ae61b03f5748a39fec49b5fda2cb96149a5e0) |
| `CoverageEngine` | [`0x3341B76fEFF4CE691781fEAa4C76EA95479b9b6b`](https://testnet.arcscan.app/address/0x3341B76fEFF4CE691781fEAa4C76EA95479b9b6b) | [`0x47ff2820…`](https://testnet.arcscan.app/tx/0x47ff28200b800f3576a8bac4acf5c35b8ee2febe11d6d188caa8a3e8a4e85606) |
| `CovenantVault` | [`0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51`](https://testnet.arcscan.app/address/0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51) | [`0xb1b66ee3…`](https://testnet.arcscan.app/tx/0xb1b66ee3b3494ec9878c0808269dd82beef2f523e823408a358fe75d2fe6da52) |

Deployed from source commit `7d66394654fa2147da495027af6d64cac38d2cf8`. Facility policy: minimum coverage 100.00%, default haircut 5.00%, 24-hour credential freshness, 7-day maturity tolerance, 5-day cure window, 3-day maximum waiver.

**The facility admin is a Privy 2-of-2 key quorum** at [`0x55C4DD3770A44695735717CB7b7005AC7dE9edA1`](https://testnet.arcscan.app/address/0x55C4DD3770A44695735717CB7b7005AC7dE9edA1) — two named approvers, neither sufficient alone. `FacilityRegistry` writes `admin` once and has no setter, so that is permanent. Creating a waiver — the one action that overrides the covenant — therefore requires both. See `packages/privy-waiver/`.

### Privy: the lender's override, not a single key

The facility admin above is a **Privy-owned server wallet**, governed by a 2-of-2 key quorum: a risk officer and a treasury lead, each holding a non-extractable P-256 key in their own browser. Privy's own calldata policy restricts that wallet to one action, ever — `createWaiver` on this vault, on this chain, moving no value. Every other call, including `revokeWaiver`, is denied by Privy before it ever reaches a signature; the contract's own `maxWaiverDuration` bounds the exception, since a calldata policy cannot compare a `uint32`.

`packages/privy-waiver` runs the approver console (`node --import tsx packages/privy-waiver/src/main.ts`): it pre-validates a proposed waiver against the live chain — refusing what the contract would refuse — collects both P-256 signatures over a fresh, timestamped payload, forwards them to Privy for the actual signature, then broadcasts and verifies the receipt and the `WaiverCreated` event. The operator desk's waiver panel at `/app/` is the same flow, live: propose → risk officer approves (1 of 2, nothing executes) → treasury lead approves (2 of 2) → Privy signs → broadcast → checked receipt. The `signa waiver status | propose | approve | broadcast` CLI commands expose the identical service.

**What Privy enables here:** custody of the one key that can override the covenant, without that key ever sitting in one person's hands, and without a general-purpose signer that could be tricked into approving anything else.

### EURC is referenced, never moved

The loan book this facility covers is EUR-denominated; EURC above is linked as that exposure's denominating asset and appears in the manifest, this README, and on the dashboard. **No EURC is transferred, held, or approved anywhere in this demo.** Moving it would demonstrate conversion — a layer Covenant does not govern — and would invite the reader to mistake a token balance for the exposure, which is the one thing that would unwind the product's reason for existing. The exposure is a loan book in a servicing system, asserted by the exposure issuer under a signed `ExposureCredential`; coverage is computed from credentials only, never from an EURC balance. `CovenantVault` holds and moves **only** USDC.

### One balance, two decimal views

Arc's native USDC carries **18 decimals** and pays gas. The ERC-20 interface at `0x3600…0000` carries **6** and is what every balance, transfer and credential accounts in. They are the same balance seen twice, differing by 10¹².

Mixing them inside the coverage ratio produces a result wrong by a factor of a trillion, with no revert — the vault would report compliance and release capital. This is a filed, open, undocumented hazard against Arc itself ([`circlefin/arc-node#91`](https://github.com/circlefin/arc-node/issues/91)), not a hypothetical. Every amount crossing into a credential goes through `packages/credentials/src/decimals.ts` (requirement R-F2-7).

### Reproduce the acceptance evidence

Four identities, never one key in two roles — the registry reverts with `IssuerRoleConflict` if the exposure and hedge issuers share an address. The deployer, facility admin, and operator hold gas; the exposure and hedge issuers sign EIP-712 offchain and a keeper (which may reuse the operator key) submits, so they hold none.

```bash
cast wallet import <name> --interactive   # encrypted Foundry keystore, never a raw key
```

Never pass a private key as a command-line flag. Circle's own guidance is explicit that `--private-key` is acceptable only for local testing.

With the four roles' keys imported under the names recorded in `deployments/arc-testnet.json`, run the scenario against the live facility:

```bash
node --import tsx scenarios/arc-facility.ts
```

It reads every address from the manifest (E-SCN-2, nothing hardcoded), asserts each receipt's status in the direction that step expects rather than trusting exit code (A-9 — `cast send` exits `0` on a reverted transaction), and writes [`scenarios/output/arc-facility-evidence.json`](./scenarios/output/arc-facility-evidence.json) and the human-readable [`.md`](./scenarios/output/arc-facility-evidence.md) alongside it.

### The acceptance evidence

The full run below is deployed and reproducible; every transaction hash is a live Arc Testnet link. Every draw sends the identical calldata `0x3b304147…0f4240` (`draw(1_000_000)`) from operator `0x7e09657321F1818825a9A15cedd9D95308130ED4`.

| Criterion | Action | Expected | Actual | Coverage | Covenant state |
|---|---|---|---|---|---|
| A-1 | deposit 5,000,000, then submit exposure (1.000000 USD) and hedge seq 1 (1.060000 USD) | `0x1` | `0x1` | 100.00% | UNASSESSED |
| A-2 | draw 1,000,000 — **permitted** | `0x1` | `0x1` | 100.00% | COMPLIANT |
| A-3 | hedge reduced to seq 2 (0.720000 USD) → `syncCovenant` records CURE, then the **identical draw is refused** | `0x1` | `0x0` | 68.40% | CURE |
| A-4 | fresh hedge seq 4 (1.060000 USD) → `restoreCompliance`, then the draw **succeeds again** | `0x1` | `0x1` | 100.00% | COMPLIANT |

The A-3 refusal ([`0x9a2359c9…`](https://testnet.arcscan.app/tx/0x9a2359c9e12e2c7f921029f07d91f57c36c84e7064852fde936937b56671c360)) is a receipt with status `0x0`, 172,586 of 1,000,000 gas used. Replaying the identical call decodes to `DrawNotAllowed(CURE)`; the gate's own verdict for that state was `allowed = false`, reason `BELOW_THRESHOLD`. That is the demo: the control refusing a draw it is designed to refuse, on the chain, with a receipt — not a caught JavaScript error.

Full per-step detail, including every credential-submission and `syncCovenant` transaction, is in [`scenarios/output/arc-facility-evidence.md`](./scenarios/output/arc-facility-evidence.md).

### Credential freshness

Checked-in fixtures are deterministic for local tests. Public runs generate labelled mock observations relative to a recorded chain timestamp before signing — `credentialMaxAge` is 24 hours, so fixtures with baked timestamps evaluate `UNASSESSED` on any later day. Generated fixtures, their source commitments, sequences and signed payloads are saved alongside the evidence, and a signed field is never modified afterward.

## Provider adapter

Fixtures in [`packages/provider-adapter/fixtures`](./packages/provider-adapter/fixtures) resemble a forward-trade lifecycle but name only a fictional provider. Mapping is deterministic:

- `trade.id` → hashed `tradeIdCommitment`
- canonical full fixture → `sourceCommitment`
- buy/sell currencies → settlement/exposure `bytes3`
- remaining buy amount → exact six-decimal `uint128` units
- booked/partially funded/cancelled/closed/disputed → canonical status
- API observation, expiry, maturity, and sequence → typed credential fields

The CLI exports a signed credential. Use only a disposable local or testnet mock-signer key and never commit it:

```bash
node --import tsx packages/provider-adapter/src/cli.ts \
  packages/provider-adapter/fixtures/arc-forward-active.json \
  /tmp/mock-signed-hedge.json
```

It requires `MOCK_HEDGE_ISSUER_PRIVATE_KEY`, `CREDENTIAL_REGISTRY_ADDRESS`, `CHAIN_ID`, and `FACILITY_ID` in the process environment.

## Dashboard

```bash
pnpm --filter @fx-coverage/dashboard dev
```

No environment variables to fill in: the dashboard reads every address from [`deployments/arc-testnet.json`](./deployments/arc-testnet.json) at build time (E-MAN-4 — nothing outside that file hardcodes a deployed address) and falls back to a bundled, schema-valid, obviously-fake fixture manifest at `apps/dashboard/fixtures/arc-testnet.fixture.json` if the real one is ever absent. A banner always states which one is active.

With the deployment configured, it reads:

- frozen facility policy;
- current exposure and active hedge credentials, with per-hedge eligibility reasons;
- gross and counted eligible amounts and coverage, shown **separately** — over-hedging stays visible, only the counted figure (capped at 100% of the exposure) governs a draw;
- vault state, principal, reserve availability, and cure deadline; and
- recent credential, policy, draw, waiver, cure, restoration, and repayment events, alongside the deployed A-1 … A-4 evidence above.

**Every write is simulated before it is sent.** `simulateContract` runs against `draw`, `syncCovenant`, `restoreCompliance`, and `repay` before any wallet signature is requested; a refusal is decoded from the vault's own custom error (`DrawNotAllowed`, `ReserveViolation`, …) via `BaseError.walk`/`ContractFunctionRevertedError` and rendered as a plain-language verdict — rule, observed value, required value, remedy, then the machine code — before the operator ever commits gas. A held draw is not an error state; it is the control working, and it is presented that way. A coverage-gate strip above the amount field re-simulates on every change, so the refusal is never news by the time a button is clicked.

The UI does not possess issuer keys or calculate a competing frontend coverage result — every verdict shown is the gate's own, from `evaluate()` or a live `simulateContract` call, never re-derived in the browser.

## Trust and safety assumptions

- The facility documents and lender decide which issuers are acceptable.
- The exposure source and hedge source are independent.
- Issuers truthfully map accepted offchain systems into the typed fields.
- Full borrower records and trade confirmations remain private and are represented only by commitments.
- Missing, stale, revoked, disputed, mismatched, or inadequate inputs fail closed before a draw.
- A failed draw transaction cannot persist a cure transition; a keeper should call permissionless synchronization to record it.
- Breach never liquidates an offchain borrower, transfers the reserve, or purchases a hedge.
- The admin may issue only a disclosed waiver bounded by the frozen maximum duration.
- Repayment remains available in every state.

## Known limitations

- No real lender, servicer, bank, broker, verifier, borrower, exporter, or cooperative is integrated.
- No production USDC, real funds, price oracle, mark-to-market, settlement, margin, or liquidation exists.
- ECDSA EOAs are supported; ERC-1271 contract signers are not yet implemented.
- One policy pair and at most eight active hedge IDs are evaluated per facility.
- Haircuts are facility-wide rather than trade-specific.
- Policy is non-upgradeable; a changed economic policy requires a new facility.
- The contracts are tested but unaudited and not production-ready.
- The current evidence proves technical behavior on a public testnet, not customer demand, provider authorization, legal truth, or a mainnet deployment. Arc mainnet is a separate, later milestone.

## License

No license has been selected yet. Do not assume permission for production reuse until a license file is added.
