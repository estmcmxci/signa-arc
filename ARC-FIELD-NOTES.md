# ARC-FIELD-NOTES

**What this is:** everything we have actually verified about Arc, with the source and the date we verified it. The build brain. `PRD.md` says what we are required to build; this says what the chain will let us do.

**How to use it:** check here before you assume anything about Arc. If you learn something new, add it here with a source and a date. If something here turns out to be wrong, correct it in place *and* log it under **Corrections** — a brain that hides its mistakes teaches us the wrong lesson twice.

**Related:** Circle's own guidance is vendored verbatim at `.claude/skills/use-arc/SKILL.md` — read that first for how to build; read this for what we found that it does not cover.

**Status legend:** ✅ verified · ⚠️ documented but untested by us · ❓ open

---

## 1. Chain constants

Verified 2026-09-09 by importing `arcTestnet` from `viem/chains` at viem `2.56.3`, in this repo.

| Field | Value | |
|---|---|---|
| Network | Arc Testnet | ✅ |
| Chain ID | `5042002` (hex `0x4CEF52`) | ✅ |
| RPC | `https://rpc.testnet.arc.network` | ✅ |
| RPC fallbacks | `rpc.quicknode.testnet.arc.network`, `rpc.blockdaemon.testnet.arc.network` | ✅ |
| WebSocket | `wss://rpc.testnet.arc.network` | ⚠️ |
| Explorer | `https://testnet.arcscan.app` | ✅ |
| Explorer API | `https://testnet.arcscan.app/api` | ✅ |
| Native currency | `{ name: "USDC", symbol: "USDC", decimals: 18 }` | ✅ |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11`, from block 0 | ✅ |
| CCTP domain | `26` | ⚠️ |
| Consensus | Malachite BFT (Informal Systems, acquired by Circle) | ⚠️ |
| Finality | sub-second; ~780ms benchmarked at 100 validators / 1MB blocks | ⚠️ |
| Mainnet | **Does not exist yet.** Circle's skill: *"NEVER target mainnet -- Arc is testnet only."* | ✅ |

**`viem` ships Arc natively — never hand-roll the chain definition.** Circle's skill states it outright: *"Arc Testnet is available by default in Viem -- a custom chain definition is NEVER required."* Import `arcTestnet` from `viem/chains`.

> Note for whoever writes the Arc scenario: `scenarios/coffee-facility.ts:74` hand-rolls a chain with `nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }`. That file is the **Base/COP** scenario and is deliberately left alone. The Arc scenario must import `arcTestnet` instead.

### RPC hostname — resolved

Arc's own tutorial page says `rpc.testnet.arc.io`. Circle's `use-arc` skill and viem's shipped chain definition both say `rpc.testnet.arc.network`. **Use `.network`.** Two independent Circle-controlled sources agree on it against one doc page.

## 2. Tokens

| Token | Address | Decimals | |
|---|---|---|---|
| USDC (ERC-20 view) | `0x3600000000000000000000000000000000000000` | 6 | ✅ |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 | ✅ |
| USYC (tokenised MMF shares) | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` | 6 | ⚠️ |
| StableFX `FxEscrow` | `0xd68256f4D69C6BbEcB873D8588AE0Dc6B8E22E10` | — | ⚠️ |
| CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | — | ⚠️ |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | — | ⚠️ |

All addresses above are **testnet**. Arc's docs: *"Mainnet addresses are not yet available."*

### The USDC ERC-20 supports the full standard API ✅

Arc's docs confirm `transferFrom`, `approve`, and allowance management. **`CovenantVault`'s `IERC20Settlement` interface works unchanged** — no adapter, no `MockUSDC` fallback needed for the facility balance. This was our biggest open risk and it is closed.

## 3. The decimals contract — read this before touching the ratio

This is the single most dangerous property of the chain, and it is the reason **R-F2-7** exists.

> *"`USDC.balanceOf(addr)` (6 decimals) and `addr.balance` / `eth_getBalance` (18 decimals) represent the same underlying balance. The ERC-20 interface truncates the last 12 decimal places of the native value; amounts smaller than 1×10⁻⁶ USDC are not represented in `balanceOf` but are still present in the native balance."*
> — Arc docs, stablecoin-native model

**One balance, two views. Not two assets.**

| View | Decimals | Used for |
|---|---|---|
| Native | 18 | gas accounting, `msg.value`, native sends |
| ERC-20 at `0x3600…` | 6 | balances, transfers, approvals, **all our accounting** |

### The rule we build to

**The vault touches only the ERC-20 view. Native 18-decimal USDC pays gas and is never accounted.** One normalisation boundary at the credential edge. A failing test pins it before any Arc code is written.

### This is a known, open bug against Arc itself

[`circlefin/arc-node#91`](https://github.com/circlefin/arc-node/issues/91) — *"USDC decimal ambiguity: 18 decimals as native gas token vs 6 decimals as ERC-20 — undocumented, causes silent value bugs."* Open as of 2026-09-09, labelled documentation.

The reporter's summary: *"values will just be wrong by a factor of 10^12"*, with no error raised. Three documented failure modes: gas-fee display off by 10¹², `eth_getBalance` disagreeing with `balanceOf` for the same address and token, and transfer-validation comparisons producing wrong results.

**Use this.** R-F2-7 is not defensive paranoia about a hypothetical — it is a filed, open, undocumented hazard on Circle's own chain, and our architecture names it and tests for it. That belongs in the video and the writeup.

## 4. Deploy and verify

```bash
# env
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network

# deploy — Circle's documented pattern
forge create src/CovenantVault.sol:CovenantVault \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast

# verify — Blockscout, NOT Etherscan
forge verify-contract $ADDR src/CovenantVault.sol:CovenantVault \
  --chain-id 5042002 \
  --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/

# read / write
cast call $ADDR "coverageBps()(uint256)" --rpc-url $ARC_TESTNET_RPC_URL
cast send $ADDR "syncCovenant()" --rpc-url $ARC_TESTNET_RPC_URL --private-key $PRIVATE_KEY
```

Constructor args go through `cast abi-encode` and `--constructor-args`.

**Key handling:** Circle's skill is explicit that `--private-key` on the command line is *"acceptable only for local testing"* and that non-local deploys should use an encrypted keystore or `cast wallet import`. Testnet counts as non-local for this rule. `.env*` stays gitignored.

## 5. Documented gotchas

1. **Never call `decimals()` on a native sentinel** (`0xEeee…eEEeE`, `0x0000…0000`). Not ERC-20 contracts; the call reverts.
2. **Never alias the EIP-7528 native sentinel to USDC.** Arc: it *"conflates native value transfers with ERC-20 transfers."*
3. **Never sum or swap the two views.** USDC ↔ native is not a conversion; it is the same asset seen twice. Reject any code path that treats it as a swap.
4. **A native transfer can revert on a sufficient balance** — Arc docs cite *"the blocklist or zero-address rules."*
   → **Relevant to us:** `draw()` transfers to the borrower. A blocklisted borrower reverts for a reason that has nothing to do with coverage. Do not debug that live for the first time on camera.
5. **Gas is cheap and dollar-denominated.** Testnet transactions have averaged about $0.004.

## 6. Faucet — not a constraint

`https://faucet.circle.com` — 20 USDC per address per chain every 2 hours; USDC, EURC, and cirBTC; Arc Testnet listed by default.

**This does not constrain the demo.** Coverage is a ratio — `counted / outstanding` — so the vault's absolute balance never enters the verdict. A facility funded with 1.0 USDC proves exactly what one funded with 5,000,000 proves. Arc fixtures are denominated fractionally for this reason.

## 7. Open questions ❓

| # | Question | Why it matters |
|---|---|---|
| 1 | Does `forge script --broadcast` work against Arc, or only `forge create`? | `contracts/script/Deploy.s.sol` uses forge script. Circle documents only `forge create`. Malachite is not a geth-family node; `eth_feeHistory`, fee fields, nonce handling and receipt polling are the usual gaps. **Fallback:** `forge create` + `cast send`. |
| 2 | Does the vault ever touch the EURC contract, or is EUR only a denomination? | As designed, the vault holds and moves USDC only; the exposure is EUR-denominated but no EURC moves. Satisfies "meaningful use of Arc and USDC", but an Arc judge may expect the EURC contract to appear. Decide before recording. |
| 3 | Which currency is `outstandingValue` denominated in? | The code implies settlement currency (USD): `remainingNotional` maps from `remaining_buy_amount`, the buy leg, and is compared directly against `outstandingValue`. `ETHONLINE-WORKSTREAMS.md` §1 instead says "hedged EURC notional ÷ EURC exposure." Different ratios. The code's reading is unit-coherent; the workstreams line is the one to correct. |
| 4 | Are there EVM divergences from the Osaka baseline that touch our contracts? | `PRD.md` §13. Our Solidity is conservative — no exotic opcodes — so rated low, but read the list rather than assume. |
| 5 | Do the two issuer keys need gas at all? | They sign EIP-712 offchain and a keeper submits. If so, only the deployer, admin, operator and keeper need funding. |

## 8. Corrections

Things we believed and then disproved. Kept so we do not re-learn them.

| Date | Believed | Actually |
|---|---|---|
| 2026-09-09 | The faucet limit would force the demo's scale, possibly onto `MockUSDC` | Irrelevant. Coverage is a ratio; fractional USDC proves the same thing. Overweighted a non-issue. |
| 2026-09-09 | The `0x3600…` USDC might be a restricted precompile that breaks `approve`/`transferFrom` | Full standard ERC-20 API, confirmed in Arc's docs. `IERC20Settlement` works unchanged. |
| 2026-09-09 | Push-to-mainnet was a deadline-day trap (`PRD.md` §13, `ETHONLINE-WORKSTREAMS.md` §1) | Mainnet is a **separate Sept 30 deadline** worth $2,500. Decoupled from submission entirely. |
| 2026-09-09 | ETHOnline closed 2026-09-16 | **2026-09-13, 12:00 pm EDT.** |
| 2026-09-09 | Arc's RPC was `rpc.testnet.arc.io` (from Arc's own tutorial) | `rpc.testnet.arc.network`, per Circle's skill and viem's shipped definition. |

## 9. Sources

- Circle, *Introducing Arc* — https://www.circle.com/blog/introducing-arc-an-open-layer-1-blockchain-purpose-built-for-stablecoin-finance
- Arc docs, stablecoin-native model — https://docs.arc.io/arc/concepts/stablecoin-native-model
- Arc docs, contract addresses — https://docs.arc.io/arc/references/contract-addresses
- Arc docs, deploy on Arc — https://docs.arc.io/arc/tutorials/deploy-on-arc
- Circle `use-arc` skill — https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md (vendored at `.claude/skills/use-arc/SKILL.md`)
- `circlefin/arc-node#91`, decimal ambiguity — https://github.com/circlefin/arc-node/issues/91
- StableFX developer docs — https://developers.circle.com/stablefx
- Arc, *How Arc supports 24/7 onchain FX* — https://www.arc.io/blog/how-arc-can-support-247-onchain-fx
- Circle testnet faucet — https://faucet.circle.com
- Arc docs index for agents — https://docs.arc.network/llms.txt
