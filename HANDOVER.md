# HANDOVER — 2026-09-10, 20:30 EDT

**Submission closes 2026-09-13, 12:00 pm EDT.** Roughly 2 days 15 hours from this writing.

**Read [START-HERE.md](./START-HERE.md) for the standing architecture.** This file is the state of play at the end of the 10 September session, and the two things only a human can do.

---

## The claim is proven and on chain

Everything below was verified by reading the chain directly, not by trusting an agent's report.

**Signa Covenant is live on Arc Testnet (chain `5042002`)**, four contracts, all verified on Blockscout with readable source.

| Contract | Address |
|---|---|
| FacilityRegistry | `0xB54fe913C4a7dE73Bc285338dCbb384AEec5e448` |
| CredentialRegistry | `0xD921734C9314442a74Cd3FEBAB8028b2Bb9A7624` |
| CoverageEngine | `0x3341B76fEFF4CE691781fEAa4C76EA95479b9b6b` |
| **CovenantVault** | `0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51` |

Facility `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2`.

### A-1 → A-4: the covenant governs the money

Byte-identical calldata `0x3b30414700…000f4240`, three times, same vault:

| | Transaction | Receipt |
|---|---|---|
| **A-2** draw at 100% coverage | `0x89b939cd1315a295ab1d0b44b4b8a1d33abe7bd0ffc502af864a415c1f715ef6` | `0x1` |
| **A-3** same draw at 68.4% | `0x5cad2c042e76a9f043eeb5988a733975d9dbf05fcb74cb58b44796581a09399a` | **`0x0`** |
| **A-4** same draw, coverage restored | `0x1ef19c5a24e0fdd63ecdc0e6eee3d251041a03ddd4d4082753377ef382fb516a` | `0x1` |

The refusal reverts with selector `0xbe986785` — `DrawNotAllowed(uint8)` — argument `2`, `CURE`. Not out-of-gas, not a transport error. Nothing changed between those three calls except the evidence underneath them.

Full record: `scenarios/output/arc-facility-evidence.json`.

### And the override of the covenant is governed too

**The facility admin is a Privy 2-of-2 key quorum** at `0x55C4DD3770A44695735717CB7b7005AC7dE9edA1`. `FacilityRegistry` writes `admin` once and has no setter, so that is permanent.

First quorum-approved waiver: **`0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b`**, sent from the quorum wallet, receipt `0x1`, block 61473309. Two named approvers — risk officer, then treasury lead — neither sufficient alone.

The evidence also records the *earlier refusal*, when the facility was compliant and pre-validation blocked the proposal before it reached Privy. A waiver you cannot create when there is nothing to waive is the system working.

Records: `packages/privy-waiver/evidence/arc-waiver-evidence.json` and `arc-policy-evidence.json`.

---

## Current state

| | |
|---|---|
| Facility | **COMPLIANT**, 10000 bps, no active waiver — ready to film |
| Suite | 64 TypeScript, 31 Solidity, dashboard builds |
| Trunk | one branch, all lanes merged, clean-clone verified |
| Quorum wallet gas | 0.2879 USDC |
| Deployer gas | 0.5142 USDC |
| Repo | `estmcmxci/signa-arc`, **still private** |

Top up gas at `faucet.circle.com` — 20 USDC per address every 2 hours — if a rehearsal drains it.

---

## The only two things left, and both are yours

### 1. Make the repository public

```bash
gh repo edit estmcmxci/signa-arc --visibility public
```

**This is a hard qualification gate.** Every sponsor track requires a public repo. Suggested: run a clean-clone check first — `git clone`, `pnpm install --frozen-lockfile`, `pnpm check` — it passed at 64/31 as of this writing.

### 2. Record the video

`output/VIDEO-SCRIPT.md` is recording-ready: scenes with timings, the words to say, what is on screen, and the current transaction hashes. 2–4 minutes, 720p or better, must name **Arc: Best DeFi/Onchain Finance Application**.

**Before you sit down:** the dashboard says "wallet not connected" and the action buttons are inactive without one. To click Draw on camera you need a browser wallet holding the operator key `0x7e09657321F1818825a9A15cedd9D95308130ED4`. The acceptance run used keys held by the scenario runner, not a browser.

**Do not skip the boundary statement** (A-8). Signatures authenticate who asserted what; they do not prove a hedge legally exists. The hedge feed is a labelled mock. No bank has agreed to sign anything.

---

## Three environments

| | |
|---|---|
| **Dev** | ✅ `pnpm scenario:coffee` against local Anvil. No gas, no credentials. Reaches BREACH, cure expiry and repayment-during-breach, which the Arc scenario does not. |
| **Testnet** | ✅ Deployed, verified, A-1→A-4 and the quorum waiver. |
| **Mainnet** | ⏳ **Does not exist yet.** `rpc.arc.network` does not resolve; Circle's own skill says "NEVER target mainnet — Arc is testnet only." The Arc track pays a further $2,500 for a mainnet deploy **by Sept 30**, so plan for it after submission. |

**Two things to carry into the mainnet deploy, both learned the hard way:**

1. **The facility admin is immutable.** The quorum wallet must exist and be funded *before* `createFacility` is called. We burned a facility learning this — the first one has an EOA admin that can never be changed, which is why a second facility exists and why the manifest points at the newer one.
2. **Privy will probably still not broadcast.** See below; it is not a testnet-only limitation.

---

## Open questions and things not finished

**Privy cannot broadcast on Arc — mechanism unproven.** `eth_sendTransaction` on `eip155:5042002` returns `401 App is not authorized to transact on chain`, while seven other chains pass the same gate. `eth_signTransaction` works, so we sign with Privy and broadcast ourselves — which Privy's own docs prescribe *"when using a custom RPC or gas sponsor"*. The *reason* Arc is refused is not established: no chain config appears on the app object, `/v1/chains` and the per-app equivalents 404, and there is no public repo where server-side chain support is defined. See `ARC-FIELD-NOTES.md` §5c. **A message to Privy's Slack is drafted in `packages/privy-waiver/WIRE-UP.md`** — sending it is a two-minute job and the answer may simplify the mainnet deploy.

**The approver console is a demo server.** It runs on localhost, holds the app secret, and has no login. Approver keys are non-extractable WebCrypto keys in browser IndexedDB, not passkeys — Privy has no server endpoint that accepts a WebAuthn assertion. `WIRE-UP.md` states this plainly; keep it that way.

**A Privy policy cannot cap the waiver duration.** Its calldata comparator never matches integer arguments narrower than `uint64`, and `createWaiver`'s duration is `uint32` — tested across seven widths. The policy *does* restrict the wallet to `createWaiver`, on that vault, on Arc, proven with negative controls. The duration cap is enforced by the contract and by pre-validation instead.

**Claims discipline for the writeup.** Name the 2-of-3 Gnosis Safe as the alternative evaluated. **Do not claim Privy is more trust-minimised than a Safe** — a Safe does m-of-n better and more verifiably. The honest argument is that Privy's approvers never touch a chain: no gas, no extension, no seed phrase, and the same primitive restricts which function on which contract the admin key may ever call, which a Safe needs an audited Guard module to match.

**Superseded but deliberately kept.** The first facility `0x39cbb5ce…` and vault `0x1970feb699…` are not part of the story and are not referenced in prose. They *do* appear in `scenarios/output/` and `packages/privy-waiver/evidence/` as historical records, and in `packages/privy-waiver/test/*.ts` as golden-vector fixtures — the test constants are inputs to precomputed signatures, and replacing them breaks four tests. Do not "tidy" either.

**Not done, deliberately.** The React 19 + wagmi conversion and the landing page, both from `~/signa-frontend-research.md`. They were "if there were more time" items.

---

## Where the research lives

Outside the repo, because it is working material rather than product:

- `~/signa-frontend-research.md` — 1,560 lines. Emil Kowalski's shipped values, institutional fintech landing pages, operator dashboards, and how to present a refusal as correct behaviour.
- `~/signa-privy-integration.md` — 817 lines. The solved authorize payload, organization wallets, the policy engine's limits, and the honest Safe comparison.
- `~/privy-lab/` — 19 numbered experiments against the live Privy API, indexed in its README.
- `~/signa-backup-2026-09-09.git` — mirror of the pre-purge history.

`signa-batches` (private) holds the Base work, the business material, and the four private strategy documents.

---

## The one-sentence version

**A drawdown on Arc was permitted, then refused by the covenant when coverage fell, then permitted again — and the power to override that covenant requires two people. Both are on chain, with receipts.**

What remains is publishing it and saying it out loud.
