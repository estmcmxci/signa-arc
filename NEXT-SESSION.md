# NEXT SESSION — 2026-09-12, 11:15 EDT

**Submission closes Sunday 2026-09-13, 12:00 pm EDT. 24.5 hours from this writing.**

Read [HANDOVER-PRIVY-DESK.md](./HANDOVER-PRIVY-DESK.md) for the round that just finished and [START-HERE.md](./START-HERE.md) for the standing architecture. This file is the state at the end of the 12 September morning session.

---

## What is done that was not done yesterday

**Privy is on the operator desk.** The waiver panel at `/app/` is the lender's view: the quorum and the single call its key may ever sign, an approver key per role held non-extractable in the browser, the chain's own answer on whether a waiver is possible, and a proposal moving from nobody, to one of two, to signed, to broadcast, to a checked `WaiverCreated`. Approved and broadcast are separate states on screen because they are separate in fact. The desk reaches the local approver service through a Vite proxy and holds no Privy secret.

**Wallet connect and the signing path are gone from the desk.** The borrower's key is a Foundry keystore, so the button promised what the demo cannot do. The desk reads, simulates and explains; the only thing signed anywhere on it is a waiver, by two people.

**The CLI can create a waiver, not only read one.** `signa waiver status | propose | approve | reject | broadcast`, over the same service the console uses. `reject` exists because each proposal pins the admin wallet's next nonce and only one may be in flight.

**The whole sequence has run once, on one facility, in one block range.** Blocks 61678097 to 61684351: a permitted draw, the hedge falling to 0.720000, a sync to CURE, the identical calldata refused with receipt `0x0` and `DrawNotAllowed(CURE)`, a 2-of-2 waiver at [`0x665838e2…`](https://testnet.arcscan.app/tx/0x665838e29a3ffb39e6b909e5e84e6d071945153db049ff01228862ce0863fdf0), the identical calldata then permitted **at 6840 of 10000 bps**, the waiver lapsing, and the facility syncing back to CURE. The exception released the draw without restoring cover, which is the claim, in receipts. Record: `scenarios/output/arc-waiver-run-evidence.{json,md}`.

**The landing page is 286 words and fits one screen.** 1158 words yesterday. See "The landing" below.

---

## State at close

| | |
|---|---|
| `integration` | `9f1c0b9`. **21 commits unpushed.** `origin/main` is `e8b361e` — 63 commits were pushed at 00:50 today, so the history is no longer two days stale |
| `ui/aesthetic` | `9fc9cb8`, 6 commits ahead of `integration`. **Not merged.** Named after the project whose look it borrows; nothing from that project is in this repo |
| Suites | **170 TypeScript, 31 Solidity, 16 docs pages**, `pnpm check` exit 0. Dashboard: **17 unit, 15 browser** (was 20; the wallet tests went with the signing path) |
| Facility | **CURE**, 6840 of 10000 bps, `BELOW_THRESHOLD`, no active waiver, a waiver would be accepted |
| Exposure | Sequence 4, re-observed 08:40 EDT today, **eligible until roughly 08:40 EDT on the 13th** |
| Admin wallet | 0.284 USDC, about 75 waivers at 0.0037 each |
| Fleet | All four agents **stopped**. Their work is merged |

### The expiry, stated exactly

The exposure credential goes stale about **08:40 EDT on the 13th**, and submission closes at **12:00**. That leaves roughly three hours at the end where the live desk cannot show eligible evidence. One more `node --import tsx scenarios/arc-exposure-refresh.ts` on the morning of the 13th removes the problem; it costs about 0.0023 USDC, moves no state, and leaves the facility in CURE.

---

## The landing, and what it cost

Sections removed: the problem, what the vault enforces, the recorded proof, inspect the control, start a conversation, who it is for, and the whole `/security/` page. What remains is the hero, four step cards, a built-with row and a one-line footer.

The reasoning was that a landing page has one job — make a judge believe the claim and open the desk — and most of what was there taught architecture that the 16 documentation pages teach better.

**The cost, recorded because it is a real loss rather than a tidy.** The landing no longer carries: the demonstration framing, "no production offering", the sentence disclaiming loan origination and derivatives, "fictional loan book, mock issuers and test funds", and "signatures establish who made an assertion; they do not prove a hedge legally exists". The only honesty text left on the page is the `Mock issuers` tag inside step 02.

That boundary is still stated on the desk's waiver panel, at the point of use in the desk's credential table, and in the video script as acceptance criterion A-8 — which is where the PRD actually puts it, since A-8 governs the video rather than any page. But it is no longer on the landing, and anyone reviewing the claims discipline should know that was a deliberate trade, not an oversight.

---

## Open, and yours to decide

1. **Merge `ui/aesthetic` or not.** Its six commits are three background layers, zero radius, mono uppercase chrome, glass panels, the four step cards, the 1400px shell and the built-with marks. Two of the six are pure copy and are already on `integration`; the rest is the look. Browser suite is green at 15 on the fork, axe included, on both routes.
2. **The hero's right half is empty.** The reference puts a live panel there. For Signa that would be the facility itself — `CURE · 6840 / 10000 bps · vault 0xa68f…bF51` — read from chain, which would put the proof above the fold and replace what the recorded-proof section used to do. Not built. It needs the landing to read chain again, which was stripped out of `src/landing/main.ts`.
3. **Privy's mark is recoloured**, not a vendor-supplied on-dark asset. Their own site serves it near-black; it was cropped to the lockup and turned white for the dark plate. Arc's and USDC's are their own on-dark files.
4. **The video script has no Privy scene.** You asked me not to write it.
5. **The cover image** is still not done, and it is a form field.

---

## The gates

1. **Refresh the exposure** on the morning of the 13th, before recording.
2. **Record the video** from `output/VIDEO-SCRIPT.md`. Four minutes maximum; speeding it up disqualifies.
3. **Cover image.**
4. **Push.** 21 commits are local. ETHGlobal checks commit history.
5. **Finish the form:** Arc — Best DeFi/Onchain Finance Application, video, the Future text, then Final.

---

## Traps learned today, so they are not relearned

- **A screenshot of `/app/` through the browser tooling is not evidence.** It returns an 852px frame for a 1558px viewport and goes blank after a scripted scroll. I read three captures as "the waiver panel is missing" before measuring the DOM, which showed the panel 815px tall and the page 3473. Measure, do not look.
- **`docs.privy.io/logo/dark.svg` serves Mintlify's starter-kit logo.** It shipped to the page labelled as Privy because it was installed without being viewed. Render a fetched asset and look at it before it goes near the build.
- **A background shell dies with the session that started it.** Lane B's first run was killed between the two approvals; its evidence writer sat in a `finally` that never ran. The fix in that scenario is to journal each step as it lands.
- **An approved Privy intent outlives the process that made it.** Both approvals had landed and Privy had signed; the signed transaction sat unbroadcast for forty minutes across a killed process and was still valid when sent. Nonce and fee cap are the two things to check before broadcasting a stale one.
- **A field that asserts its own construction reads as a passed check.** Three in the waiver evidence did, including one that "re-verified" signatures the process never held. Ask of any evidence field: did this compare two things, or restate one?
- **`vite preview` and the browser cache.** The served HTML was correct while the tab showed the old page; curl the port before doubting the build.
- Editing `configs/signa.yaml` does not retrain live agents — the manager's database is the source of truth, and briefs reach agents through `/ask`.

## Standing notes

- **Keystores:** `~/.foundry/keystores`, password in the macOS Keychain, service `signa-arc-testnet-keystores`, account `signa-arc`. Never print it. Read it into a mode-600 file, use `--password-file`, delete it.
- **Approver keys:** `~/.signa-privy-waiver/approvers/`. Back that directory up: those two keys are the only way the admin wallet can ever sign, and a facility's admin can never change.
- **Backticks in commit messages execute** inside double-quoted shell strings. Use a quoted heredoc with `git commit -F`.
- **Never commit `.claude/`.** Check staging before every commit; the repo is public.
- **Claims discipline:** testnet only, fictional facility, labelled mock issuer data, no bank has signed anything, sponsors are integration targets and never partners. Never "trustless", and never claim Privy is more trust-minimised than a Safe.
