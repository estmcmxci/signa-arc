# ARC-SMOKE-BRIEF

**Purpose:** answer the open questions in `ARC-FIELD-NOTES.md` §7 with throwaway code, before they can surface inside the real build and cost a day.
**Timebox:** 3 hours, hard stop. This is de-risking, not learning Arc.
**Created:** 2026-09-09 · **Submission deadline:** 2026-09-13, 12:00 pm EDT

Read first: `ARC-FIELD-NOTES.md` (what we have verified) and `.claude/skills/use-arc/SKILL.md` (Circle's own guidance, vendored).

---

## Rules

1. **Code lives in `~/arc-lab`, never in this repository.** Experiments are disposable; only findings come back.
2. **The only file you may edit in `~/signa` is `ARC-FIELD-NOTES.md`.** Nothing else — the repo is mid-submission.
3. **No private key in a file, ever.** Use `cast wallet import` for an encrypted keystore. Circle's skill: `--private-key` on the command line is *"acceptable only for local testing."*
4. **Timebox each experiment.** If one overruns, record what you learned, mark it unresolved, and move on. A half-answer written down beats a full answer nobody has time to find.
5. **Report negative results with the same care as positive ones.** "`forge script` fails with X" is the most valuable sentence this session can produce.

## Prerequisites

Fund one address from `https://faucet.circle.com` (Arc Testnet, 20 USDC per address every 2 hours). Gas averages ~$0.004 per transaction, so one claim covers everything here.

```bash
export ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network   # NOT arc.io
cast chain-id --rpc-url $ARC_TESTNET_RPC_URL                 # expect 5042002
```

---

## E1 — Which deploy path works? (45 min)

**Answers:** §7 Q1. **Why it matters:** `contracts/script/Deploy.s.sol` is a forge *script*. Circle documents only `forge create`. Arc runs Malachite, not a geth-family node, and `forge script --broadcast` leans on `eth_estimateGas`, `eth_feeHistory`, EIP-1559 fee fields, nonce handling, and receipt polling — the usual gaps in non-standard RPCs. If scripts don't work, our deploy plan changes shape.

Deploy a trivial contract **both ways** and record which succeeds:

```bash
forge create src/Probe.sol:Probe --rpc-url $ARC_TESTNET_RPC_URL --account deployer --broadcast
forge script script/Probe.s.sol:ProbeScript --rpc-url $ARC_TESTNET_RPC_URL --account deployer --broadcast
```

Record: which worked, the exact error text if one failed, and whether a multi-contract script with constructor args behaves differently from a single deploy. Note anything odd about gas estimation — fees are dollar-denominated and 18-decimal, which Foundry's defaults were not written for.

## E2 — Does the USDC predeploy behave like a real ERC-20? (45 min)

**Answers:** the highest-consequence unknown. **Why it matters:** `CovenantVault.deposit()` calls `transferFrom`, and `draw()` calls `transfer`, against `IERC20Settlement`. Arc's docs say the predeploy at `0x3600000000000000000000000000000000000000` supports the full standard API including approve and allowance. Nobody has confirmed it from a contract.

```bash
USDC=0x3600000000000000000000000000000000000000
cast call $USDC "decimals()(uint8)"   --rpc-url $ARC_TESTNET_RPC_URL   # expect 6
cast call $USDC "balanceOf(address)(uint256)" $ME --rpc-url $ARC_TESTNET_RPC_URL
cast balance $ME --rpc-url $ARC_TESTNET_RPC_URL                         # expect the 10^12 relation
```

Then the part that actually matters: deploy a minimal contract that holds USDC, `approve` it, and `transferFrom` into it. Confirm the balance lands and the return value is `true`.

Record: whether approve/allowance/transferFrom work from a contract; whether `transfer` returns a bool or reverts on failure; and confirm the 10¹² relation between `balanceOf` and `cast balance` empirically rather than trusting the docs.

## E3 — Does Blockscout verification work end to end? (30 min)

**Answers:** §7 explorer-link quality. **Why it matters:** four explorer links pointing at unverified bytecode is a materially weaker demo than four showing readable Solidity.

```bash
forge verify-contract $ADDR src/Probe.sol:Probe \
  --chain-id 5042002 --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/
```

Try it with and without constructor args (`cast abi-encode` + `--constructor-args`). Open the explorer page and confirm the source actually renders. Record the working incantation verbatim — this goes straight into the deploy runbook.

## E4 — Can `mm` sign an Arc credential? (15 min)

**Answers:** a new question, worth its cost. **Why it matters:** `mm chains list` has no Arc entry, so mm cannot send Arc transactions. But EIP-712 signing needs `chainId` only as *data inside the domain* — it may not need chain support at all. If mm can sign, our two credential issuers sign from managed wallets instead of raw keys in a `.env`, which is a better answer to "what if the verifier lies?" and costs nothing.

Build a `HedgeCredential` payload with `chainId: 5042002` and the domain from `packages/credentials/src/index.ts`, sign it with `mm wallet sign-typed-data`, then recover with viem's `recoverTypedDataAddress` and compare against `mm wallet address`.

Pass = recovered address matches. Record either way; a clean negative closes the question.

## E5 — Only if time remains (15 min)

Arc documents that *"a native transfer can revert even with a sufficient balance, for example because of the blocklist or zero-address rules."* `draw()` transfers to a borrower. Try a transfer to the zero address and see what comes back. Knowing the revert shape beats discovering it on camera.

---

## Write-back

Everything learned goes into `ARC-FIELD-NOTES.md`:

- **§7 Open questions** — answer them in place, strike the question, keep the reasoning.
- **§8 Corrections** — if any experiment disproves something we believed, log it there. That table is the point of the document.
- **§4 Deploy and verify** — replace the untested commands with the ones that actually ran.
- Add new sections if a category emerges that the notes do not cover.

Mark every claim ✅ verified, ⚠️ documented but untested, or ❓ open, and date it. Do not upgrade a ⚠️ to a ✅ on the strength of documentation — only on the strength of something you ran.
