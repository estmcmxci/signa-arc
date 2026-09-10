# Signa Covenant

**Capital access, backed by verified commitments.**

Signa is the company. Covenant is the product: an FX coverage gate that makes authenticated coverage an enforceable condition of USDC drawdowns. Verified coverage determines whether a vault can release funds; when coverage changes, access follows the facility's policy.

`CovenantVault` is the reference host that proves the gate works. The product is intended to support other host vaults, assets, and issuers; external host integrations are not yet implemented. The name reflects the financial commitments that govern capital access.

**Current state:** working and tested local prototype; the Arc application is not yet deployed.

**Delivery target:** the Arc Testnet EUR/USD scenario and acceptance criteria A-1 through A-4 in [PRD.md](./PRD.md). See [START-HERE.md](./START-HERE.md) for the current build queue and [ARC-FIELD-NOTES.md](./ARC-FIELD-NOTES.md) for verified chain behavior.

**Existing local demonstration:** fictional COP-repayable Colombian coffee working-capital portfolio

**Provider data:** mock only — no Ebury connection, integration, or endorsement

This repository demonstrates one narrow claim: independently authenticated exposure and hedge assertions can produce a deterministic FX coverage result that safely governs new capital actions in an EVM vault.

The product is an **FX coverage-control layer for onchain credit**. It does not recommend, arrange, execute, custody, or represent ownership of an FX derivative. An authorized signature proves who asserted defined fields; it does not independently prove the legal existence or enforceability of an offchain hedge.

The frozen product boundary is in `PRODUCT-THESIS.md` (private), the implementation authority is [PROTOTYPE-SPEC.md](./PROTOTYPE-SPEC.md), and public claim constraints are in `CLAIMS-EVIDENCE-LEDGER.md` (private).

## What currently works

- Frozen USD/COP facility policy with independently authorized exposure and hedge issuers.
- Direct EIP-712 credentials with runtime chain and registry domain separation.
- Latest-sequence replacement, credential and issuer revocation, revocation epochs that prevent stale credential resurrection after reauthorization, and an eight-active-hedge cap.
- Freshness, currency, status, maturity, uniqueness, and haircut eligibility rules.
- Eligible coverage aggregation with excess cover capped at authenticated exposure.
- Same-transaction coverage evaluation before every draw.
- Reserve retention, cure, breach, bounded waiver, restoration, and repayment states.
- Strict TypeScript mapping of checked-in fictional provider fixtures.
- Deterministic local end-to-end scenario with transaction receipts.
- Responsive dashboard that reads configured contract state and never recomputes coverage in the browser.

The application must remain at `Idea` until the Base Sepolia deployment, source verification, public dashboard, and receipt gates in the Prototype Spec are all satisfied.

## Architecture

```text
Mock servicer signer ── ExposureCredential ─┐
                                            ├─ CredentialRegistry
Mock verifier signer ── HedgeCredential ────┘          │
                                                       ▼
FacilityRegistry ── frozen policy ──────────── CoverageEngine
                                                       │ fresh evaluation
                                                       ▼
                                                 CovenantVault
                                          draw / reserve / cure / repay
```

- [`FacilityRegistry`](./contracts/src/FacilityRegistry.sol) stores economic policy and role-specific issuer authorization.
- [`CredentialRegistry`](./contracts/src/CredentialRegistry.sol) verifies and records the current EIP-712 assertions.
- [`CoverageEngine`](./contracts/src/CoverageEngine.sol) returns eligibility reasons and coverage without fetching prices.
- [`CovenantVault`](./contracts/src/CovenantVault.sol) holds the test token and gates capital actions.
- [`MockUSDC`](./contracts/src/mocks/MockUSDC.sol) is an unrestricted-mint, six-decimal test token—not USDC.
- [`credentials`](./packages/credentials/src/index.ts) is the canonical TypeScript typed-data definition.
- [`provider-adapter`](./packages/provider-adapter/src/index.ts) maps strictly validated fictional fixtures.
- [`coffee-facility.ts`](./scenarios/coffee-facility.ts) runs the evidence-generating local arc.
- [`dashboard`](./apps/dashboard/src/main.ts) reads contract outputs, credentials, and receipts.

## Prerequisites

- Foundry with `forge`, `cast`, and `anvil`
- Node.js 24+
- pnpm 10+

Install JavaScript dependencies and run every current check:

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` builds the Solidity artifacts, typechecks all TypeScript, runs 35 TypeScript tests across typed data, the decimals boundary, the provider adapter, preflight and manifest, runs 25 Solidity tests, and builds the dashboard.

On 2026-08-23, the current authorization-epoch-hardened source passed that sequence from a fresh source-only snapshot after excluding dependency folders, compiler output, broadcasts, local environment files, and dashboard builds. This is not yet a public clean-checkout receipt because the directory has no standalone immutable commit. [GitHub Actions](./.github/workflows/check.yml) will provide that receipt after publication.

The tested toolchain is Node.js `24.1.0`, pnpm `10.17.1`, Foundry `1.5.0`, and Solidity `0.8.30`. The lockfile and Solidity configuration pin dependency resolution, compiler version, and the `prague` EVM target. The first build may fetch the pinned Solidity compiler if it is absent from Foundry's cache; contract tests then run offline.

Direct contract commands:

```bash
forge build
forge test --offline
forge build contracts/src --offline --sizes
```

## Replay the local scenario

> This is the **Base-track** COP scenario, retained while the Arc scenario is built. It runs against local Anvil, not Base, and its evidence is local-only. It moves to the private Base repository once the Arc scenario replaces it.

Start Anvil in one terminal at the fixture timestamp:

```bash
anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --timestamp 1800000000 --silent
```

Run the scenario in another terminal:

```bash
pnpm scenario:coffee
```

The runner deploys actual bytecode and executes:

1. USD 5.0M exposure plus USD 4.5M hedge → 90% coverage and a successful draw.
2. Exposure grows to USD 6.0M → a new draw reverts at 75%, despite previously cached compliance.
3. Permissionless synchronization records `CURE`.
4. A higher-sequence USD 5.0M hedge update → 83.33% coverage, restoration, and another draw.
5. A cancellation update → zero eligible coverage and a new cure.
6. Cure deadline passes → `BREACH` with no liquidation or vault transfer.
7. Repayment succeeds during breach and reduces principal.

The generated record is [`scenarios/output/local-coffee-evidence.json`](./scenarios/output/local-coffee-evidence.json). Its hashes exist only on that local Anvil instance and are not Base Sepolia evidence.

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

Copy the secret-free example and fill deployment addresses:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
pnpm --filter @fx-coverage/dashboard dev
```

Without configured addresses, the page explicitly reports that deployment is pending and shows only the separately labeled recorded local evidence. With addresses configured, it reads:

- frozen facility policy;
- current exposure and active hedge credentials;
- per-hedge eligibility reasons;
- gross and counted eligible amounts and coverage basis points;
- vault state, principal, reserve availability, and cure deadline; and
- recent credential, policy, draw, waiver, cure, restoration, and repayment events.

Wallet controls call `syncCovenant`, `restoreCompliance`, `draw`, and `repay`. The UI does not possess issuer keys or calculate a competing frontend coverage result.

## Arc Testnet deployment

Arc is Circle's EVM-compatible L1 where **USDC is the native gas token**. Canonical constants live in [ARC-FIELD-NOTES.md](./ARC-FIELD-NOTES.md) §1 and are not repeated elsewhere.

| | |
|---|---|
| Chain ID | `5042002` (hex `0x4CEF52`) |
| RPC | `https://rpc.testnet.arc.network` — **not** `arc.io`, which appears in Arc's own tutorial and is wrong |
| Explorer | `https://testnet.arcscan.app` (Blockscout) |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000`, 6 decimals |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`, 6 decimals |
| Faucet | `https://faucet.circle.com` — 20 USDC per address every 2 hours |

`viem` ships Arc natively. Import `arcTestnet` from `viem/chains`; never hand-roll the chain definition.

> **Not yet deployed.** `contracts/script/Deploy.s.sol` still guards on Base `84532` and uses `MockUSDC`. Retargeting it is stage 3 of [ARC-DELIVERY-PLAN.md](./ARC-DELIVERY-PLAN.md). The procedure below is the intended one, and its tooling is independently verified — see the smoke evidence in `ARC-FIELD-NOTES.md` §7.

### One balance, two decimal views

Arc's native USDC carries **18 decimals** and pays gas. The ERC-20 interface at `0x3600…0000` carries **6** and is what every balance, transfer and credential accounts in. They are the same balance seen twice, differing by 10¹².

Mixing them inside the coverage ratio produces a result wrong by a factor of a trillion, with no revert — the vault reports compliance and releases capital. This is a filed, open, undocumented hazard against Arc itself ([`circlefin/arc-node#91`](https://github.com/circlefin/arc-node/issues/91)), not a hypothetical. Every amount crossing into a credential goes through `packages/credentials/src/decimals.ts` (requirement R-F2-7).

### Fund the roles

Four identities, never one key in two roles. The registry reverts with `IssuerRoleConflict` if the exposure and hedge issuers share an address.

```bash
export ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
cast chain-id --rpc-url $ARC_TESTNET_RPC_URL          # expect 5042002
cast wallet import deployer --interactive             # encrypted keystore, never a raw key
```

Fund the deployer, facility admin, and operator from the Circle faucet. The exposure and hedge issuers sign EIP-712 offchain and a keeper submits, so they hold no gas. Gas averages about $0.004 per transaction; fractional funding is ample.

Never pass a private key as a command-line flag. Circle's own guidance is explicit that `--private-key` is acceptable only for local testing.

### Deploy and verify

Both `forge create` and `forge script --broadcast` are verified working against Arc, including multi-contract scripts with dependent constructor arguments under Solidity 0.8.30 / Prague.

```bash
forge script contracts/script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_TESTNET_RPC_URL --account deployer --broadcast

forge verify-contract $ADDR contracts/src/CovenantVault.sol:CovenantVault \
  --chain-id 5042002 --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/
```

Verification renders readable Solidity with decoded constructor arguments and needs no API key.

### Assert receipt status, never exit code

`cast send` exits `0` on a **reverted** transaction — observed with receipt `status 0x0`, `gasUsed 21000`, and a populated `revertReason`. Any script that treats exit code as success will report a green run containing a failed transaction.

Assert in the direction each step expects. Every expected-success transaction asserts `status == 0x1`. The intentional refusal in A-3 asserts an explicitly **failed** receipt plus evidence of `DrawNotAllowed(CURE)`; a transport error or unrelated revert is not acceptance evidence. This is requirement A-9.

### Credential freshness

Checked-in fixtures are deterministic for local tests. Public runs must generate labelled mock observations relative to a recorded chain timestamp before signing — `credentialMaxAge` is 24 hours, so fixtures with baked timestamps evaluate `UNASSESSED` on any later day. Save the generated fixtures, their source commitments, sequences and signed payloads alongside the evidence, and never modify a signed field afterward.

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
- The mock token is intentionally unsafe and unrestricted.
- ECDSA EOAs are supported; ERC-1271 contract signers are not yet implemented.
- One policy pair and at most eight active hedge IDs are evaluated per facility.
- Haircuts are facility-wide rather than trade-specific.
- Policy is non-upgradeable; a changed economic policy requires a new facility.
- The contracts are tested but unaudited and not production-ready.
- The current evidence proves local technical behavior only, not customer demand, provider authorization, legal truth, or Base Sepolia deployment.

## License

No license has been selected yet. Do not assume permission for production reuse until a license file is added.
