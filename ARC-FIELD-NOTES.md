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

### USDC contract-call path ✅ executed 2026-09-09

E2 broadcast a minimal Solidity contract against `0x3600…`: an EOA approved 1 USDC, the contract called `transferFrom` to itself, then called `transfer` back to the EOA. The contract also called `approve`. All three calls returned ABI `bool true`, recorded in probe events; allowances and balances matched. **The ERC-20 path used by `CovenantVault.deposit()` and `draw()` works without a token adapter in this probe.** This does not claim the full CovenantVault was deployed/tested on Arc, or that every ERC-20 edge case was exercised. The earlier claim that documentation alone closed the risk was premature. Evidence and negative cases: §7, E2.

## 3. The decimals contract — read this before touching the ratio

This is the single most dangerous property of the chain, and it is the reason **R-F2-7** exists.

> *"`USDC.balanceOf(addr)` (6 decimals) and `addr.balance` / `eth_getBalance` (18 decimals) represent the same underlying balance. The ERC-20 interface truncates the last 12 decimal places of the native value; amounts smaller than 1×10⁻⁶ USDC are not represented in `balanceOf` but are still present in the native balance."*
> — Arc docs, stablecoin-native model

**One balance, two views. Not two assets.**

| View | Decimals | Used for |
|---|---|---|
| Native | 18 | gas accounting, `msg.value`, native sends |
| ERC-20 at `0x3600…` | 6 | balances, transfers, approvals, **all our accounting** |

✅ **E2, 2026-09-09:** `decimals()` returned `6`. After deposit, the probe held `1000000` ERC-20 units and `1000000000000000000` native units. A same-block comparison on the gas-paying deployer at block `61287969` returned native `19963816632750000000` and ERC-20 `19963816`: `native = ERC20 × 10^12 + 632750000000`. This verifies truncation, not exact multiplication equality once gas leaves sub-micro-USDC dust.

### The rule we build to

**The vault touches only the ERC-20 view. Native 18-decimal USDC pays gas and is never accounted.** One normalisation boundary at the credential edge. A failing test pins it before any Arc code is written.

### This is a known, open bug against Arc itself

[`circlefin/arc-node#91`](https://github.com/circlefin/arc-node/issues/91) — *"USDC decimal ambiguity: 18 decimals as native gas token vs 6 decimals as ERC-20 — undocumented, causes silent value bugs."* Open as of 2026-09-09, labelled documentation.

The reporter's summary: *"values will just be wrong by a factor of 10^12"*, with no error raised. Three documented failure modes: gas-fee display off by 10¹², `eth_getBalance` disagreeing with `balanceOf` for the same address and token, and transfer-validation comparisons producing wrong results.

**Use this.** R-F2-7 is not defensive paranoia about a hypothetical — it is a filed, open, undocumented hazard on Circle's own chain, and our architecture names it and tests for it. That belongs in the video and the writeup.

## 4. Deploy and verify

✅ **Executed 2026-09-09, Foundry `1.5.0-stable`.** Code, command logs, broadcast receipts and explorer screenshots live in `~/arc-lab/smoke`, not this repo. The exact commands below ran through `run.py`; `--sign` checks chain ID, retrieves the keystore password from macOS Keychain, and appends `--keystore /Users/oakgroup/arc-lab/keystores/arc-smoke --password <secret>` in memory. Logs redact the password. No plaintext private key was written. `wallet_setup.py` used `cast wallet import arc-smoke --interactive --keystore-dir /Users/oakgroup/arc-lab/keystores`; its first attempt failed to provide a controlling terminal, and the corrected import succeeded.

The funded address is `0x245e0ce4d9978C95aa4Aa4B5ED5371c0eD13EF62`. Password: macOS Keychain service `arc-lab-smoke-20260909`, account `arc-smoke`. These are disposable testnet probes with unrestricted methods, not production templates.

```bash
cd /Users/oakgroup/arc-lab/smoke
cast chain-id --rpc-url https://rpc.testnet.arc.network
# Returned 5042002. Faucet funded before any broadcasts.

# forge create: Solidity 0.8.24 / Paris from lab foundry.toml
python3 run.py --sign --log e1-create.txt forge create src/Probe.sol:Probe \
  --rpc-url https://rpc.testnet.arc.network --broadcast

# Single deploy through a script, same settings
python3 run.py --sign --log e1-script.txt forge script script/Probe.s.sol:ProbeScript \
  --rpc-url https://rpc.testnet.arc.network --broadcast

# Three deployments with chained constructor args, same settings
python3 run.py --sign --log e1-multi.txt forge script script/Probe.s.sol:MultiProbeScript \
  --rpc-url https://rpc.testnet.arc.network --broadcast

# Repeat with the real repo's compiler/EVM settings; optimizer 200 in both configs
python3 run.py --sign --log e1-multi-prague.txt forge script script/Probe.s.sol:MultiProbeScript \
  --rpc-url https://rpc.testnet.arc.network --broadcast --use 0.8.30 --evm-version prague

python3 run.py --sign --log e2-deploy.txt forge create src/USDCProbe.sol:USDCProbe \
  --rpc-url https://rpc.testnet.arc.network --broadcast --use 0.8.30 --evm-version prague

# Verification: both completed with Pass - Verified and rendered readable source
python3 run.py --log e3-verify-noargs.txt forge verify-contract \
  0x1bC98E456dC2B082B7aa002D95bf4CEed6D91DA9 src/Probe.sol:Probe \
  --chain-id 5042002 --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/ \
  --compiler-version 0.8.30 --evm-version prague --watch

cast abi-encode 'constructor(address,uint256)' 0x1bC98E456dC2B082B7aa002D95bf4CEed6D91DA9 123
# Output passed literally below:
python3 run.py --log e3-verify-args.txt forge verify-contract \
  0x7Be5CB15b2835CD5740b5bD1974bf5b6988582F7 src/Probe.sol:ProbeArgs \
  --chain-id 5042002 --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/ \
  --compiler-version 0.8.30 --evm-version prague \
  --constructor-args 0x0000000000000000000000001bc98e456dc2b082b7aa002d95bf4ceed6d91da9000000000000000000000000000000000000000000000000000000000000007b --watch

# Contract ERC-20 path that ran: approve 1 USDC, then pull it into the probe
python3 run.py --sign --log e2-approve.txt cast send \
  0x3600000000000000000000000000000000000000 'approve(address,uint256)' \
  0x60431dac0C37D746f0fA2777ef959ba8b9a5abF1 1000000 \
  --rpc-url https://rpc.testnet.arc.network --json
python3 run.py --sign --log e2-deposit.txt cast send \
  0x60431dac0C37D746f0fA2777ef959ba8b9a5abF1 'deposit(uint256)' 1000000 \
  --rpc-url https://rpc.testnet.arc.network --json
python3 run.py --log e2-vault-balance.txt cast call \
  0x3600000000000000000000000000000000000000 'balanceOf(address)(uint256)' \
  0x60431dac0C37D746f0fA2777ef959ba8b9a5abF1 --rpc-url https://rpc.testnet.arc.network
```

✅ Both script variants completed without legacy fee flags, gas overrides, `--skip-simulation`, or nonce adjustments. Script receipts were status `0x1`. `--keystore` was tested; the equivalent default-directory `--account` lookup was not. Foundry displayed `Estimated amount required: 0.006002595 ETH` for the single script (45 gwei / 133391 estimated gas); this is **USDC on Arc**, not ETH. Its actual receipt used 102619 gas at 25 gwei, costing `0.002565475` USDC. E5 additionally proved that **`cast send --json` can exit 0 for receipt status `0x0`**: check the receipt, not just the process exit code.

✅ Browser evidence: [Probe source](https://testnet.arcscan.app/address/0x1bC98E456dC2B082B7aa002D95bf4CEed6D91DA9?tab=contract) and [ProbeArgs source](https://testnet.arcscan.app/address/0x7Be5CB15b2835CD5740b5bD1974bf5b6988582F7?tab=contract). Both showed **Contract source code verified (exact match)**, Solidity source, compiler `v0.8.30+commit.73712a01`, Prague, optimizer 200; the latter decoded constructor args as the first address and `123`. Both verification jobs needed two 15-second pending-queue polls. No API key was supplied. Screenshots: `~/arc-lab/smoke/logs/e3-Probe-page.png` and `e3-ProbeArgs-page.png`. The initial browser script's string checks missed non-breaking spaces in the source editor; visible source and screenshots confirmed rendering, and the script now normalizes those spaces.

❓ **Actual application deployment remains untested.** Read-only inspection found `contracts/script/Deploy.s.sol` explicitly rejects chains other than `84532` (Base Sepolia) and deploys `MockUSDC`. Do not run it unchanged against Arc. E1 answers the Foundry/RPC compatibility question, not application adaptation. The former unexecuted CovenantVault commands have been removed from this section.

✅ Environment negative: sandboxed `cast chain-id` panicked with `Attempted to create a NULL object.` in `system-configuration-0.6.1/src/dynamic_store.rs:154`; the same command outside the sandbox returned `5042002`. This is an environment failure, not evidence of an Arc RPC incompatibility.

### E4 — managed-wallet signing, 2026-09-09

✅ E4 executed with `@metamask/agent-wallet/6.2.0` on Node `v24.1.0`:

```bash
mm wallet sign-typed-data --chain-id 5042002 --payload '<HedgeCredential JSON>' \
  --wait --wallet-timeout 60 \
  --intent 'Arc E4 smoke test: dummy HedgeCredential, no deployed facility or transaction'
```

Here `<HedgeCredential JSON>` abbreviates the actual inline JSON passed, not a runnable literal. It used the exact `hedgeCredentialTypes` in `packages/credentials/src/index.ts`, domain name `FXCoverageCredentials`, version `1`, chain ID `5042002`, and dummy verifying contract `0x0000000000000000000000000000000000000001`. Message: facility ID = 32 bytes of `11`; trade commitment = 32 bytes of `22`; base/quote = `0x455552` / `0x555344`; remaining notional = `1000000`; maturity = `1790000000`; status = `0`; observedAt = `1788985800`; validUntil = `1788989400`; sequence = `1`; source commitment = 32 bytes of `33`. Integer fields other than status were JSON decimal strings.

Result: `{"ok":false,"error":{"code":"UNSUPPORTED_CHAIN","message":"No EVM chain configured for chainId 5042002.","hint":"Run `mm chains list` to see supported chains, then pass a valid chain name, numeric chain id, or CAIP-2 id."}}`. No signature was returned; viem recovery could not be performed. `mm wallet address` returned server-mode address `0x9bff63174618a7660c566ef4b5d6bf484fa5034b`. No transaction or faucet funding was needed for this offchain attempt.

✅ Experiment A executed 2026-09-09, same mm `6.2.0` / Node `v24.1.0`, in `~/arc-lab`. E4 ran through a **server** wallet, so its failure could have come from either the local CLI or MetaMask's backend. BYOK signs locally, which separates the two.

A disposable BIP-39 mnemonic was generated with viem's `generateMnemonic` and put straight into the macOS Keychain (service `arc-lab-byok-20260909`); it was never printed and no private key was exported. `mm init --wallet byok` reported `{"walletMode":"byok","mnemonicEncrypted":true}`, and `mm wallet show` then reported mode `byok`, walletId `byok:evm:0`, address `0x09058676dfaD73F0c1899FfC0D1E7F5a41A607Db` — identical to viem's own `mnemonicToAccount` derivation of the same mnemonic, so the local key path is sound. The server wallet was not touched; `~/.metamask` was backed up to `~/.metamask.backup-pre-byok-20260909` first, and the CLI was afterwards returned to server mode with `ensv2-e2e` (`0x9bff…034b`) re-selected as active.

```bash
mm wallet sign-typed-data --chain-id 5042002 --payload "$(cat payload.json)" \
  --wait --wallet-timeout 60 \
  --intent 'Experiment A: BYOK EIP-712 HedgeCredential on Arc, no deployed facility or transaction'
```

The payload was rebuilt from `packages/credentials/src/index.ts` — domain name `FXCoverageCredentials`, version `1`, chainId `5042002`, verifying contract `0x0000000000000000000000000000000000000001`, `hedgeCredentialTypes` verbatim, primaryType `HedgeCredential`, and the identical E4 message fixture.

Result: byte-for-byte the same failure as E4 — `{"ok":false,"error":{"code":"UNSUPPORTED_CHAIN","message":"No EVM chain configured for chainId 5042002."}}`. Under `--verbose` the throw lands immediately after `[progress] Submitting...`, with only `Checking authentication` / `Session loaded` before it and no wallet or signing job ever created. No signature, so viem recovery was again impossible.

**Control (does *not* count as an Arc result).** The same payload with `chainId` swapped to `1` in both the flag and the domain returned `{"ok":true,"data":{"mode":"byok","address":"0x0905…07Db","status":"APPROVED"}}` — so the schema, the payload encoding and the BYOK wallet are all accepted, and chain resolution is the only thing that fired on Arc. But note what the control did *not* return: **no `signature` field**, with or without `--wait`, in either `--json` or text output. ⚠️ In this version's BYOK path a signature is approved but never handed back, which is a second, independent blocker sitting behind the chain gate. The minified `dist/chunks/cliWalletExecutor-Wa0Yy_Wm.js` calls the SDK with `wait:!1` and spreads `signature` only when present, which is consistent with that observation — but the minified window did not let us confirm that site is BYOK-specific, so the *mechanism* stays ⚠️ while the missing signature is ✅ observed. That chunk also references an internal `allowDomainChainIdMismatch` option which the CLI never exposes as a flag.

**Key handling:** Circle's skill is explicit that `--private-key` on the command line is *"acceptable only for local testing"* and that non-local deploys should use an encrypted keystore or `cast wallet import`. Testnet counts as non-local for this rule. `.env*` stays gitignored.

## 5. Documented gotchas

1. **Never call `decimals()` on a native sentinel** (`0xEeee…eEEeE`, `0x0000…0000`). Not ERC-20 contracts; the call reverts.
2. **Never alias the EIP-7528 native sentinel to USDC.** Arc: it *"conflates native value transfers with ERC-20 transfers."*
3. **Never sum or swap the two views.** USDC ↔ native is not a conversion; it is the same asset seen twice. Reject any code path that treats it as a swap.
4. **A native transfer can revert on a sufficient balance** — Arc docs cite *"the blocklist or zero-address rules."*
   → **Relevant to us:** `draw()` transfers to the borrower. A blocklisted borrower reverts for a reason that has nothing to do with coverage. Do not debug that live for the first time on camera.
5. **Gas is cheap and dollar-denominated.** Testnet transactions have averaged about $0.004.
6. **`cast send` exits `0` on a reverted transaction.** ✅ Observed in E5: an explicit `--gas-limit` broadcast to the zero address produced receipt `status 0x0`, `gasUsed 21000`, and a `revertReason` — while the process exit code was `0`.
   → **Relevant to us:** any scenario, deploy script, or CI step that treats exit code as success will report a green run containing a failed transaction. **Assert `receipt.status == 0x1` on every broadcast.** This is PRD acceptance criterion A-9.

✅ **E5, 2026-09-09:** native transfer to zero reverted with `Zero address not allowed`; contract ERC-20 transfer to zero reverted with `ERC20: transfer to the zero address`. Both are `Error(string)` (`0x08c379a0`), not a custom error or `false` return. Insufficient balance and allowance also reverted with strings in E2. Blocklist behavior remains ⚠️ documented, untested. Full commands/errors and the failed native receipt are under §7.

## 5b. The explorer API rate-limits, and failure looks like absence ⚠️

`testnet.arcscan.app/api` allows **10 requests**, and the allowance is **shared by every process on the machine**. Exceed it and you get HTTP 429 with `x-ratelimit-limit: 10` — and critically, the body still parses as JSON with an **empty `SourceCode` field**, which is byte-identical to the response for an unverified contract.

**Verified 2026-09-10 the hard way.** A monitor polling four addresses every 45 seconds reported `4/4 verified`, then `0/4`, then non-JSON, while the contracts' verification state never changed. All four were verified the whole time. An unquoted URL fails the same way.

**Consequences:**
1. Never poll this endpoint on a schedule. Query it once, deliberately, and space retries by minutes.
2. Treat an empty `SourceCode` as *unknown*, never as *unverified*. Check the HTTP status before believing the body.
3. Prefer the v2 API or a browser for a definitive answer.

The wider lesson for any monitor: a watcher that queries a rate-limited third party becomes a liar under its own load. Watch local state unless there is genuinely no alternative.

## 6. Faucet — not a constraint

`https://faucet.circle.com` — 20 USDC per address per chain every 2 hours; USDC, EURC, and cirBTC; Arc Testnet listed by default.

✅ **2026-09-09:** user claimed 20 USDC from Circle for the smoke deployer; [faucet receipt](https://testnet.arcscan.app/tx/0xf72a74ce1431e58af2dd6636de97dc729cb43ff18fbb7bfa3b97668312fd3c1d) had status `1`, block `61286792`. `cast balance` returned `20000000000000000000`; `balanceOf` at that block returned `20000000`. No experiment transaction preceded this funding. The two-hour limit itself remains ⚠️ untested.

**This does not constrain the demo.** Coverage is a ratio — `counted / outstanding` — so the vault's absolute balance never enters the verdict. A facility funded with 1.0 USDC proves exactly what one funded with 5,000,000 proves. Arc fixtures are denominated fractionally for this reason.

## 7. Open questions and smoke answers

| # | Question | Why it matters |
|---|---|---|
| 1 | ~~Does `forge script --broadcast` work against Arc, or only `forge create`?~~ | ✅ **E1, 2026-09-09: both work.** Single script and three-contract script with dependent constructor arguments succeeded; the latter also passed under the repo's Solidity 0.8.30 / Prague settings. Receipt polling, sequential nonces and default fees worked for these probes. Malachite/RPC concern not reproduced; no fallback needed for the tested workflow. Existing `Deploy.s.sol` still requires Arc adaptation (Base chain guard / MockUSDC); it was not deployed. §4 gives commands; evidence below. |
| 2 | Does the vault ever touch the EURC contract, or is EUR only a denomination? | As designed, the vault holds and moves USDC only; the exposure is EUR-denominated but no EURC moves. Satisfies "meaningful use of Arc and USDC", but an Arc judge may expect the EURC contract to appear. Decide before recording. |
| 3 | Which currency is `outstandingValue` denominated in? | The code implies settlement currency (USD): `remainingNotional` maps from `remaining_buy_amount`, the buy leg, and is compared directly against `outstandingValue`. `ETHONLINE-WORKSTREAMS.md` §1 instead says "hedged EURC notional ÷ EURC exposure." Different ratios. The code's reading is unit-coherent; the workstreams line is the one to correct. |
| 4 | Are there EVM divergences from the Osaka baseline that touch our contracts? | ❓ Full divergence review remains open. ✅ E1/E2, 2026-09-09: probes compiled for Solidity 0.8.30 / Prague deployed and executed correctly. This tests the current build target on a narrow path; it does not establish Osaka-wide compatibility or exercise all application opcodes. |
| 5 | Do the two issuer keys need gas at all? | They sign EIP-712 offchain and a keeper submits. If so, only the deployer, admin, operator and keeper need funding. |
| 6 | ~~Can `mm wallet sign-typed-data` sign an Arc HedgeCredential despite missing Arc chain support?~~ | ✅ **Answered — no, in both wallet modes. E4 (server) + Experiment A (BYOK), executed 2026-09-09:** mm `6.2.0` returns `UNSUPPORTED_CHAIN` / `No EVM chain configured for chainId 5042002.` for the repo's exact schema and Arc domain, identically whether the wallet is a server wallet or a local BYOK key. The gate is **local and mode-independent**: it fires before any wallet job is created, so MetaMask's backend is never reached and no server-side chain policy is implicated. A chainId-1 control on the identical payload was `APPROVED`, which isolates chain resolution as the sole cause of the Arc failure. **Closed for this version.** Neither the direct CLI path nor a `customEvmChains` patch is on the demo path — the credential issuers sign with viem directly (see Q5). Invocation, control and the second blocker in §4. |
| 7 | ~~Does USDC support the contract `approve` / `transferFrom` / `transfer` path required by CovenantVault?~~ | ✅ **E2, 2026-09-09: yes on the executed probe.** `approve` from both EOA and contract worked, allowance read back correctly, the contract pulled 1 USDC and sent it back in two transfers. All three contract calls emitted `true`. Negative calls reverted with `Error(string)`. This replaces the earlier documentation-only closure in §2/§8. Full application integration remains untested. |
| 8 | ~~Does `forge verify-contract` against Arc Blockscout actually render source?~~ | ✅ **E3, 2026-09-09: yes.** Verification with and without constructor args passed; browser pages rendered Solidity, exact-match status and decoded args. No API key. Commands and source links in §4. This closes the explorer-link quality question for these probes. |
| 9 | ~~What does transfer to the zero address revert with?~~ | ✅ **E5, 2026-09-09:** native: `Zero address not allowed`; ERC-20 from contract: `ERC20: transfer to the zero address`. Both `Error(string)`, selector `0x08c379a0`. Native broadcast with an explicit gas limit produced receipt status `0x0` but CLI exit `0`; automation must check receipt status. Blocklist behavior was not tested. |

### Smoke evidence — 2026-09-09

✅ Session began **16:30 EDT**, hard stop **19:30 EDT**; experiments, cleanup and write-back completed approximately **16:57 EDT** (27 minutes elapsed). E4 was advanced while funding was coordinated. E1 ran approximately 16:41–16:44 (45m cap); E2 16:44–16:46 (45m cap); E3 16:46–16:49 (30m cap); E4 16:34–16:36 (15m cap); E5 16:47–16:50 (15m cap, overlapped explorer validation). No experiment exhausted its timebox. The additional mm/BYOK investigation above belongs to the separately recorded Experiment A, not this smoke's E4 execution.

✅ **E1 deployment evidence.** Addresses and receipts are preserved under `~/arc-lab/smoke/broadcast/Probe.s.sol/5042002/`, with timestamped JSON files as well as the overwritten `run-latest.json`. All listed deployment receipts succeeded:

| Path | Contract address | Transaction |
|---|---|---|
| `forge create`, 0.8.24 / Paris | `0xedF8d52D43142b8d1002373A1Ee8D5d75491F3BA` | `0x71d742f26895a54009c722b5ab5094e962515b657a5f0117d5b4787f3a0205ac` |
| Single script, 0.8.24 / Paris | `0xa40D046548C104170b9851CA1640FDa0ee0FEAbF` | `0x6bd5dcafb1b7d4c7a74a3cdb32075bdb5de421b9666453101a70517baec52226` |
| Multi script, 0.8.24 / Paris, final dependent contract | `0x739223611D6eaE5e3347658879Cc4FD64c95e80B` | `0x6a12ab7c74566b42e8cb47fc0533bf561a1a4f823b3882c5652490c8a6a6bccc` |
| Multi script, 0.8.30 / Prague, Probe | `0x1bC98E456dC2B082B7aa002D95bf4CEed6D91DA9` | `0x80afcf3738b78ff8c636b8310d01ba6571b40b6a5f9ca00cdd4a1a7eb394a306` |
| Multi script, 0.8.30 / Prague, first ProbeArgs | `0x7Be5CB15b2835CD5740b5bD1974bf5b6988582F7` | `0x04bbc55aec94914b3557e52966123fe30187be020f80e4df21c38299d6587ee7` |
| Multi script, 0.8.30 / Prague, second ProbeArgs | `0x3673e0042080bB0cA4f7b9e1c63C4cA6Ab681897` | `0xfb7a6848866a7efa3c3a0ab71225579bcc5e2a5f5e842199016135046e44ac5b` |

✅ `peer()` on the Paris final contract returned `0x2FBe77477288b12BD46E42B170228547794F9017`. On the Prague final contract, `peer()` returned `0x7Be5CB15b2835CD5740b5bD1974bf5b6988582F7` and `value()` returned `456`. Nonces were 1 for the single script, 2–4 for Paris multi, and 5–7 for Prague multi. We did not separately probe every RPC method such as `eth_feeHistory`; success applies to the workflow Foundry actually used.

✅ **E2 ledger.** Probe `0x60431dac0C37D746f0fA2777ef959ba8b9a5abF1` was deployed with Solidity 0.8.30 / Prague in tx `0x813fa54c8999bfaac780775e15b5e96291209e63bdcc266f0141865e6e388a55`.

| Executed operation | Observation | Transaction |
|---|---|---|
| EOA `approve(probe, 1000000)` | Allowance read back `1000000` | `0xc650db3ea445c785effa74402139e9244cb4bc8e08b6b277fda8f042378ca623` |
| Probe `deposit(1000000)` → USDC `transferFrom` | Probe emitted selector `0x23b872dd`, result `true`; token balance `1000000`, native `10^18`, allowance became `0` | `0x14b4704419b1d5c11931fcd3e17f638494f8f9e0c336c68e14c83c308ddd3231` |
| Probe `approve(deployer, 123)` → USDC `approve` | Selector `0x095ea7b3`, result `true`; allowance read back `123` | `0x2b13afcd81a441a78f6d1d15c912052dda4853f70edf71de4cdf5bc7e983a35d` |
| Probe `send(deployer, 250000)` → USDC `transfer` | Selector `0xa9059cbb`, result `true`; probe balance became `750000` | `0xbf8b4f6724665219d7fa94f74c8f827331511e98d5eabb0f791aac477f3c7184` |
| Return remaining `750000` | Result `true`; final probe token balance `0` | `0x16e55932159512f7e2bef3a61c3f2158914f521b4c040d0e2abb3bb8afe1ee2c` |
| Clear contract's test allowance | Result `true`; allowance read back `0` | `0xa3314f902e07376b8cdf8189058b48fd2e0bc62ff5d3a2308ef33174b94fd333` |

✅ These receipts all had status `0x1`. Probe events have signature `Result(bytes4,bool)`; the return-value data was a 32-byte word ending in `01`. Success was therefore checked beyond receipt status alone. Gas was paid by the EOA; the probe's 1-USDC balance comparison was not reduced by its caller's gas.

✅ **E2 negatives, `cast call` simulations, no failing broadcast:** with probe balance `1000000`, `send(deployer, 1000001)` returned `Error: server returned an error response: error code 3: execution reverted: ERC20: transfer amount exceeds balance`. With EOA allowance exhausted, `deposit(1)` using the deployer as `--from` returned the same prefix and `ERC20: transfer amount exceeds allowance`. Both supplied ABI `Error(string)` data starting `0x08c379a0`. These errors bubbled from USDC through the probe rather than returning `false`. Exact raw data is in `logs/e2-failure-insufficient.txt` and `logs/e2-failure-allowance.txt`.

✅ At block `61287969`, after returning test funds and clearing allowance, deployer native balance was `19963816632750000000` (19.96381663275 USDC). The difference from faucet funding is `0.03618336725` USDC; no value reached zero in E5. Raw fixed-block comparison logs are `e2-pinned-native.txt` and `e2-pinned-erc20.txt`.

✅ **E5 exact attempts.** These commands ran via the same logger/unlock wrapper as §4:

```bash
python3 run.py --log e5-native-simulation.txt cast call \
  0x0000000000000000000000000000000000000000 --value 1000000000000 \
  --from 0x245e0ce4d9978C95aa4Aa4B5ED5371c0eD13EF62 --rpc-url https://rpc.testnet.arc.network
python3 run.py --log e5-erc20-simulation.txt cast call \
  0x60431dac0C37D746f0fA2777ef959ba8b9a5abF1 'send(address,uint256)(bool)' \
  0x0000000000000000000000000000000000000000 1 --rpc-url https://rpc.testnet.arc.network
python3 run.py --sign --log e5-native-send.txt cast send \
  0x0000000000000000000000000000000000000000 --value 1000000000000 \
  --rpc-url https://rpc.testnet.arc.network --json
python3 run.py --sign --log e5-native-broadcast.txt cast send \
  0x0000000000000000000000000000000000000000 --value 1000000000000 --gas-limit 100000 \
  --rpc-url https://rpc.testnet.arc.network --json
```

✅ The first two calls reverted with RPC code `3`. Native data: `0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000185a65726f2061646472657373206e6f7420616c6c6f7765640000000000000000` (`Zero address not allowed`). ERC-20 data: `0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002345524332303a207472616e7366657220746f20746865207a65726f20616464726573730000000000000000000000000000000000000000000000000000000000` (`ERC20: transfer to the zero address`).

✅ Default `cast send` failed before broadcast: `Error: Failed to estimate gas: server returned an error response: error code 3: execution reverted: Zero address not allowed`, followed by the same data and `Error("Zero address not allowed")`. Explicit `--gas-limit 100000` broadcast [tx `0x6d427dff…8064e1b`](https://testnet.arcscan.app/tx/0x6d427dff73e0b3fcabaef706fa4fe9ffd8a133bbd4558e9b5512a11ca8064e1b), receipt status `0x0`, gas used `21000`, empty logs, `revertReason` containing the native error and data. Process exit was **0**. The ERC-20 zero-address result was simulated through the contract; no ERC-20 failing transaction was broadcast.

## 8. Corrections

Things we believed and then disproved. Kept so we do not re-learn them.

| Date | Believed | Actually |
|---|---|---|
| 2026-09-09 | mm might sign an Arc credential because the chain ID is only EIP-712 domain data | ✅ E4: mm `6.2.0` rejects `--chain-id 5042002` with `UNSUPPORTED_CHAIN`: `No EVM chain configured for chainId 5042002.` No signature produced; viem recovery untested. |
| 2026-09-09 | E4's `UNSUPPORTED_CHAIN` might have come from MetaMask's backend, since E4 ran through a server wallet — leaving open that a server-side chain policy was the real gate | ✅ **Experiment A:** BYOK mode, which signs locally, fails identically. The throw lands right after `Submitting...` with no wallet job created, so the request never leaves the machine. The blocker is the local chain resolver alone. Both wallets' `policyYaml` do list `allowed_chains` without `5042002`, but that policy is never consulted — the resolver throws first. |
| 2026-09-09 | Adding a `customEvmChains` entry would be enough to make `mm wallet sign-typed-data` usable for Arc credentials | ⚠️ Not sufficient on its own. The chainId-1 control was `APPROVED` and still returned **no signature** in BYOK mode, with or without `--wait`. Clearing the chain gate would expose a second blocker, not a working path. Untested in server mode. |
| 2026-09-09 | The faucet limit would force the demo's scale, possibly onto `MockUSDC` | Irrelevant. Coverage is a ratio; fractional USDC proves the same thing. Overweighted a non-issue. |
| 2026-09-09 | Documentation alone closed the `0x3600…` USDC `approve`/`transferFrom` risk and proved the full vault worked unchanged | The original ✅ was premature. ✅ E2 now verifies `approve`, allowance, contract `transferFrom` and contract `transfer` with real receipts, bool-return events and balances. Full vault integration and unexercised ERC-20 cases remain untested. |
| 2026-09-09 | Circle documenting only `forge create` might mean Arc cannot run `forge script --broadcast` | ✅ E1: create, single script, and multi-contract scripts with constructor dependencies all succeeded, including Solidity 0.8.30 / Prague. No fee/nonce workaround needed for these probes. |
| 2026-09-09 | A working forge script transport would make the current `Deploy.s.sol` ready to use on Arc | ✅ Read-only inspection: it hardcodes chain `84532` and deploys MockUSDC. Transport is verified; application adaptation is still required. No application files were changed. |
| 2026-09-09 | Foundry's `Estimated amount required: … ETH` identifies the asset charged on Arc | ✅ E1: it is a misleading label; native USDC paid gas. Single-script actual cost was `0.002565475` USDC. |
| 2026-09-09 | `cast send --json` exit code 0 implies a successful transaction | ✅ E5 disproved this on Foundry 1.5.0: native zero-address transaction returned process exit 0 with receipt status `0x0` and `revertReason`. Inspect receipt status. |
| 2026-09-09 | Push-to-mainnet was a deadline-day trap (`PRD.md` §13) | Mainnet is a **separate Sept 30 deadline**, decoupled from submission entirely. |
| 2026-09-09 | ETHOnline closed 2026-09-16 | **2026-09-13, 12:00 pm EDT.** |
| 2026-09-10 | Contracts were unverified on Blockscout, because `getsourcecode` returned empty | All four were verified the whole time. The endpoint rate-limits at 10 shared requests and returns empty `SourceCode` on 429 — indistinguishable from unverified. See §5b. |
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
