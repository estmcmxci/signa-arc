# FX Coverage Controls for Onchain Credit

**Current state:** working and tested local prototype; **not yet deployed to Base Sepolia**  
**Demonstration:** fictional COP-repayable Colombian coffee working-capital portfolio  
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

`pnpm check` builds the Solidity artifacts, typechecks all TypeScript, runs 15 typed-data/adapter/preflight/manifest tests, runs 25 Solidity tests, and builds the dashboard.

On 2026-08-23, the current authorization-epoch-hardened source passed that sequence from a fresh source-only snapshot after excluding dependency folders, compiler output, broadcasts, local environment files, and dashboard builds. This is not yet a public clean-checkout receipt because the directory has no standalone immutable commit. [GitHub Actions](./.github/workflows/check.yml) will provide that receipt after publication.

The tested toolchain is Node.js `24.1.0`, pnpm `10.17.1`, Foundry `1.5.0`, and Solidity `0.8.30`. The lockfile and Solidity configuration pin dependency resolution, compiler version, and the `prague` EVM target. The first build may fetch the pinned Solidity compiler if it is absent from Foundry's cache; contract tests then run offline.

Direct contract commands:

```bash
forge build
forge test --offline
forge build contracts/src --offline --sizes
```

## Replay the local coffee scenario

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
  packages/provider-adapter/fixtures/mock-forward-active.json \
  /tmp/mock-signed-hedge.json
```

It requires `MOCK_HEDGE_ISSUER_PRIVATE_KEY`, `CREDENTIAL_REGISTRY_ADDRESS`, `CHAIN_ID`, and `FACILITY_ID` in the process environment.

## Dashboard

Copy the secret-free example and fill deployment addresses:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
pnpm --filter @fx-coverage/dashboard dev
```

Without configured addresses, the page explicitly reports that Sepolia deployment is pending and shows only the separately labeled recorded local evidence. With addresses configured, it reads:

- frozen facility policy;
- current exposure and active hedge credentials;
- per-hedge eligibility reasons;
- gross and counted eligible amounts and coverage basis points;
- vault state, principal, reserve availability, and cure deadline; and
- recent credential, policy, draw, waiver, cure, restoration, and repayment events.

Wallet controls call `syncCovenant`, `restoreCompliance`, `draw`, and `repay`. The UI does not possess issuer keys or calculate a competing frontend coverage result.

## Base Sepolia deployment

Base is EVM-compatible. Base Sepolia uses chain ID `84532`, the public test endpoint `https://sepolia.base.org`, and [Sepolia Basescan](https://sepolia.basescan.org/). The public RPC is rate-limited. See Base Docs: [Connecting to Base](https://docs.base.org/base-chain/quickstart/connecting-to-base) and [Deploy Smart Contracts](https://docs.base.org/get-started/deploy-smart-contracts).

The deployment script refuses any chain other than Base Sepolia and does not read a private key. Copy the example, fill four distinct role addresses, and import the facility-admin/deployer key into Foundry's encrypted keystore:

```bash
cp contracts/.env.example contracts/.env
source contracts/.env
cast wallet import deployer --interactive
pnpm preflight:sepolia
forge script contracts/script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account deployer \
  --broadcast \
  --verify
```

Before preflight, set `SOURCE_COMMIT` to the exact standalone repository HEAD. Foundry and Etherscan API V2 use `ETHERSCAN_API_KEY` for BaseScan verification; the command reports only whether it is present. The read-only preflight requires chain `84532`, a live block, a clean standalone commit, four nonzero distinct role addresses, the `deployer` keystore alias, and nonzero test ETH balances for the facility admin and operator. The exposure and hedge issuers sign messages but do not send scenario transactions.

`FACILITY_ADMIN` must be the imported deployer address. The script deploys and funds only the unrestricted test token; never send production assets to these prototype contracts.

The Sepolia policy uses an explicitly demo-only ten-minute cure period so both cure and breach receipts can be captured during a walkthrough. The local unit suite also exercises longer windows; any production facility would choose its own legally agreed duration.

After deployment, do not claim a working Base Sepolia prototype until the manifest, explorer source verification, two accepted issuer credentials, core scenario receipts, and public dashboard are all independently checked.

Convert Foundry's broadcast file into the required validated manifest only after the deployment commit exists:

```bash
SOURCE_COMMIT=<40-to-64-character-hex-commit> pnpm manifest:deployment
```

The generator reads the four role addresses already loaded from `contracts/.env`, rejects any chain other than `84532`, requires all five successful deployment receipts, checks that the broadcast deployer equals `FACILITY_ADMIN`, and writes `deployments/base-sepolia.json`.

Run the onchain evidence arc with four disposable Base Sepolia test keys whose addresses match the manifest:

```bash
cp scenarios/.env.example scenarios/.env
source scenarios/.env
SCENARIO_PHASE=initial pnpm scenario:sepolia
```

Phase one records the compliant draw, failed draw after exposure growth, cure, restoration, second draw, and cancellation. It writes the exact cure deadline to `deployments/base-sepolia-scenario.json`. After that ten-minute deadline:

```bash
SCENARIO_PHASE=finalize pnpm scenario:sepolia
```

The final phase verifies that breach did not move vault funds, records the breach receipt, repays mock principal, and appends explorer links. The runner refuses a wrong chain, mismatched role key, replayed phase one, or premature finalization.

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
