# NEXT SESSION — 2026-09-12, 00:30 EDT

**Submission closes Sunday 2026-09-13, 12:00 pm EDT.** Roughly 35 hours from this writing.

Read [HANDOVER.md](./HANDOVER.md) for what is proven on chain, then [START-HERE.md](./START-HERE.md) for the architecture. This file is the state at the end of the 11 September night session, the decision we reached, and what to build next.

---

## The decision this session reached

**Privy must be visible in the demo, and it is not.** That is the whole job next session.

Privy holds the **facility admin** key: a server wallet owned by a 2-of-2 key quorum, a risk officer and a treasury lead. It is the only party that can grant a waiver when the covenant blocks a draw. It produced a real waiver on chain — `0xf6f7d9ec90f0dc41eaf46c5b2acbdb7e7567eb279afa7690e4a957ab6c3cf34b`, receipt `0x1`, block 61473309.

That flow currently lives on a **separate page** (`packages/privy-waiver/ui/approver.html`, its own Node server), so a judge watching the operator desk never sees Privy at all.

### What to build

Bring **propose → approve → broadcast** onto the operator desk at `/app/`, as the lender's view:

1. Borrower's draw is refused — coverage below the minimum.
2. The lender's side proposes a waiver.
3. Risk officer approves. One of two. Nothing executes.
4. Treasury lead approves. Two of two — **Privy signs** the transaction with the admin key.
5. We broadcast the signed transaction to Arc. `WaiverCreated` lands.
6. Borrower draws again. Permitted.

Steps 2–4 are the point: custody and multi-party approval of the key that can override the rule.

### Settled details

- **Single browser, two key slots.** The user demos both approvers himself. The cryptography is real — two distinct P-256 keys, quorum enforced by Privy, no execution until the second signature — but both keys are in one browser. **Say so out loud once in the video.** The research doc requires this be labelled: both keys server-side is "a demo shortcut and must be labelled as one."
- **Remove the wallet connect button from the desk.** The borrower's key is a Foundry keystore, not a browser wallet, so the button promises something the demo cannot do, and it is currently the only broken control on the page. It reports "Wallet connection did not complete" for every failure that is not a user rejection, and two wallets (Phantom, MetaMask) announce themselves.
- The desk reads the live facility fine with no wallet connected.

---

## Who the parties are

This caused real confusion. From `CovenantVault.draw()`: it is `onlyOperator`, and the drawn USDC transfers **to** `policy.operator`.

| Role | Who | Key custody | Address |
|---|---|---|---|
| **Operator** | The **borrower** — the credit originator drawing on the facility | Foundry keystore | `0x7e09657321F1818825a9A15cedd9D95308130ED4` |
| **Facility admin** | The **lender's** side — risk officer + treasury lead | **Privy 2-of-2 quorum** | `0x55C4DD3770A44695735717CB7b7005AC7dE9edA1` |
| **Exposure issuer** | The servicer. R-ROLE-2: answers to the lender, never the borrower | Foundry keystore | `0x4317497399f27d52007d7f2012EAd27f148B6662` |
| **Hedge issuer** | Verifier of the broker's confirmations | Foundry keystore | `0xAD515A2BE433e78B6b570064797626012e272e0a` |

**The operator desk is the borrower's screen.** Privy is the lender's custody story. They are different screens because they are different hands — that separation *is* the product, and collapsing it into one login would undermine the claim.

### Hard constraints, read from the contracts

- **The operator cannot be changed.** `FacilityRegistry` has exactly three mutating functions after creation: `freezeFacility`, `setExposureIssuer`, `setHedgeIssuer`. There is no setter for `operator` or `admin`. So a Privy wallet cannot become the operator of this facility. Do not propose it again.
- **Privy signs; we broadcast.** `eth_sendTransaction` on Arc returns `401 App is not authorized to transact on chain`. `eth_signTransaction` works, so the flow is: approve → Privy signs → `eth_sendRawTransaction` from us.
- **A Privy policy cannot cap the waiver duration** — its comparator never matches integers narrower than `uint64`, and the duration is `uint32`. The contract enforces the cap instead.

---

## State at close

| | |
|---|---|
| Branch | `main` = `integration` = `dce8d2a`, worktree clean |
| Unpushed | **61 commits.** `origin/main` is still `808f26e` from 10 September |
| Facility | **COMPLIANT**, 10000 bps, no active waiver |
| Suite | 151 TypeScript + 31 Solidity; dashboard 17 unit + 20 browser; docs build 15 pages |
| Servers | dashboard `127.0.0.1:5176` (may have died with the session); docs `localhost:5180` |

### What shipped tonight

- **CLI** complete through P2 — `signa` inspects, signs and sends, packaged and proven to run outside the checkout. Publishing is blocked by `private: true`, deliberately.
- **Docs site** — 15 pages including a new `/architecture` page. The landing, security and desk links point at it; `/architecture.html` still serves the original artifact, which the video script opens on camera.
- **Credentials refreshed on chain** — exposure seq 2 (`0x37a3359a…`), hedge seq 7 (`0xc18a9146…`), `restoreCompliance` (`0xcfaa10a1…`), all receipts `0x1`.
- **Logo** — traced to vector, two themed variants, on all four dashboard surfaces and the docs.
- **Landing copy** rewritten repeatedly with the user. Hero is his words. Every explanation is under 280 characters.

### Copy still open

- **§07 contact band** — "Talk to us about your drawdown process" asks a stranger for their process before the page has earned it.
- **§03 versus §02** — "What the vault enforces" still restates the four mechanism steps above it. Decide whether it survives.
- The four audience cards in §05 are **deliberately untouched**. The user said so explicitly.

---

## Then the actual gates

None of the engineering above is a submission requirement. These are:

1. **Push.** 61 commits are invisible to judges. ETHGlobal's rules say they check commit history.
2. **Record the video** from `output/VIDEO-SCRIPT.md`. Four minutes maximum, no speeding up — that disqualifies.
3. **Cover image.** The logo is done; the cover is not.
4. **Finish the form:** prizes (Arc: Best DeFi/Onchain Finance Application), video, the Future text drafted in session, then Final.

---

## Working notes

- **Worktrees:** `~/signa` is on `frontend/research`; the integration worktree under `id-agents-desktop/workspace/signa-integration` holds everything and is where work happened. `main` is not checked out anywhere.
- **Keystores:** `~/.foundry/keystores` — four real keys. The password lives in the macOS Keychain, service `signa-arc-testnet-keystores`, account `signa-arc`. Never print it.
- **Never run docs commands naming `--account`** in the docs tests: they execute what the documentation shows and would unlock a real keystore.
- **Backticks in commit messages execute** inside double-quoted shell strings. Use a quoted heredoc with `git commit -F`. This has already caused one incident.
- **Claims discipline:** no bank has signed anything, both issuers are test keys held by the project, testnet only, sponsors are integration targets and never partners.
