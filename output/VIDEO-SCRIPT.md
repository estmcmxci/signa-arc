# Signa Covenant: submission video script

**Bounty:** Arc: Best DeFi/Onchain Finance Application. It is named aloud at 0:00 and at the close.

**Runtime:** 3:43 as written, about 3:32 with the three lines marked *(optional)* cut. The track allows 2 to 4 minutes. If a first read runs past 3:50, cut the optional lines. If it is still long, speed up the delivery. Never trim scene 3d or scene 5.

**Narration:** a human voice at about 150 words a minute, 521 words in total. The demo runs 1:41, the longest scene by a wide margin.

**Format:** record at 1920×1080. The track requires 720p or better. Zoom the browser until hashes and log values read cleanly at that size.

**Source rule:** every number spoken or shown comes from `scenarios/output/arc-facility-evidence.json` or `.md` (the live run on 2026-09-10), or from a read of the deployed contracts. Each one is traced in [Sources](#sources) at the end. If a figure isn't in that table, don't say it.

---

## Before you record

- [ ] **Make the repository public.** `github.com/estmcmxci/signa-arc` must be public, because the end card and the evidence links point there.
- [ ] **Film live dashboard shots before 2026-09-11 18:02:43 UTC.** That's when the exposure credential from the run expires. After it, the dashboard's live panels correctly show stale evidence and a refused draw, which would contradict the COMPLIANT narration. The explorer receipts in the demo don't expire. After the cut-off, show only the dashboard's evidence panel.
- [ ] **Start the dashboard.** Run `pnpm --filter @fx-coverage/dashboard dev` and check its banner reads `Arc Testnet 5042002 · fictional facility · mock provider data`.
- [ ] **Keep the dashboard's intro paragraph out of scene 5.** It calls the hedge feed "shaped like a StableFX RFQ receipt", which conflicts with the narration and with the fixture's own disclaimer.
- [ ] **Never say:** "verified hedge", "partner", "customer", "integration" (of any bank or of Circle), "trustless", "guaranteed", or the name of any bank or broker.
- [ ] **Open these tabs, in this order:**

| Tab | Scene | What | URL |
|---|---|---|---|
| 1 | 2, 4 | Architecture diagram | `ARC-ARCHITECTURE.html` from the repo, opened in the browser |
| 2 | 2 | Vault source, verified | https://testnet.arcscan.app/address/0x1970feb699BCd4dd268a3A8c2590929fc8fd67c2?tab=contract |
| 3 | 3a | Operator dashboard | the URL Vite prints (default http://localhost:5173) |
| 4 | 3b, 3d, 4 | **Draw 1: permitted** | https://testnet.arcscan.app/tx/0x0f71bb58a39a9426d9ebe52d02462800662e6a72e3d9348ab52f53f5f66eba40 |
| 5 | 3c, 5 | Hedge update, sequence 2 | https://testnet.arcscan.app/tx/0xca119756b901cc3cbed093f854ec6a5cf609d4921ceba649b8a4d54e840d2839 |
| 6 | 3c | `syncCovenant` → CURE | https://testnet.arcscan.app/tx/0x01b1a65f6c8888b784180a199556422f8d0fd4704c7a781be7aa268e1701e0a8 |
| 7 | 3d | **Draw 2: REFUSED** | https://testnet.arcscan.app/tx/0x9a2359c9e12e2c7f921029f07d91f57c36c84e7064852fde936937b56671c360 |
| 8 | 3e | Hedge update, sequence 4 | https://testnet.arcscan.app/tx/0xe05c354c752d4cfc26ec8a08d61484a6e7ed3a28af2c38deeb930e855ac2fc46 |
| 9 | 3e | `restoreCompliance` → COMPLIANT | https://testnet.arcscan.app/tx/0x4c932e285d72032dcb5cf41a6904dbcfe3cb537cc363642cf9450b3d198f824c |
| 10 | 3e | **Draw 3: permitted** | https://testnet.arcscan.app/tx/0x68598df3e76b0ac2bc8272b11edc5a63e6542dc387243f42b926f3e3ed60d7a1 |
| 11 | 3e, 6 | Evidence table | https://github.com/estmcmxci/signa-arc/blob/main/scenarios/output/arc-facility-evidence.md |
| 12 | 4 | EURC contract (referenced, never moved) | https://testnet.arcscan.app/address/0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a |
| 13 | 5 | The signed mock, sequence 2 | https://github.com/estmcmxci/signa-arc/blob/main/scenarios/output/arc-facility-evidence.json (the `credentials` entry with `"sequence": 2`) |

On every Arcscan transaction page, the event values are on the **Logs** tab (`?tab=logs`).

---

## Scene 1: The problem (0:00–0:27)

**0:00 On screen:** a title card on a dark background.

> **Signa Covenant**: coverage as a condition of capital
> Arc: Best DeFi/Onchain Finance Application
> *Arc Testnet 5042002 · fictional facility · mock provider data · testnet USDC*

**Say:**

> "This is Signa Covenant, for Arc: Best DeFi and Onchain Finance Application."

**0:05 On screen:** one text card per sentence, with no logos: *owes investors USDC* → *loans repay in euros* → *hedge: at a bank* → *capital: in a vault that can't see it* → *coverage: checked on a calendar* → *drawdowns: on demand*. End on the last line alone.

**Say:**

> "A credit originator owes its investors USDC while its loans repay in euros. The hedge protecting that gap sits at a bank. The capital sits in a vault that can't see it. Operations reconciles coverage on a calendar; drawdowns happen on demand.
> The covenant governs a conversation. It needs to govern the money."

---

## Scene 2: What we built (0:27–0:48)

**0:27 On screen:** tab 1, the architecture diagram's component figure. Move the cursor left to right as each part is named: *Exposure issuer* and *Hedge issuer* → **CredentialRegistry** → **CoverageEngine / ICoverageGate** → **CovenantVault**.

**0:43 On screen:** cut to tab 2 for about 3 seconds, on the vault's verified source on Arcscan. Time it to land on "inside the same transaction".

**Say:**

> "Covenant is a coverage gate on Arc. Two independent issuers sign credentials offchain — one for the loan exposure, one for the hedge. A deterministic engine rules whether that evidence is admissible under the lender's policy. And the vault obeys the ruling inside the same transaction that moves the funds."

---

## Scene 3: The demo (0:48–2:29)

Scene 3 is the core of the video. Hold this lower third on screen for the whole of scene 3:

> `draw(1000000)` · calldata `0x3b304147…000f4240` · operator `0x7e09…0ED4`

### 3a. Set-up (0:48–1:01)

**On screen:** tab 3, the dashboard, with the truth banner in frame. Point at the policy card's **Threshold** and **Default haircut** figures, then at the evidence panel.

**Say:**

> "Our dashboard reads the deployed contracts. Policy: full coverage after a five percent haircut. Exposure: one dollar owed. Watch one call — draw one USDC — sent three times, byte for byte identical."

### 3b. Draw 1: permitted (1:01–1:18)

**1:01 On screen:** tab 4. Show status **Success**, method `draw`, and the token transfer **1 USDC**, vault → operator.

**1:09 On screen:** open the **Logs** tab and zoom on `CovenantSynchronized`: `grossEligible 1007000`, `countedEligible 1000000`, `coverageBps 10000`, `newState 1`.

**Say:**

> "First draw. The hedge covers a dollar and six cents. After the haircut, that's a hundred point seven percent of the exposure — counted at a hundred. Ten thousand basis points. Permitted: status one, and one USDC leaves the vault."

### 3c. The hedge shrinks and the facility enters CURE (1:18–1:37)

**1:18 On screen:** tab 5, **Logs**. `HedgeCredentialAccepted` shows `sequence 2` and `remainingNotional 720000`.

**1:25 On screen:** tab 6, **Logs**. `CovenantSynchronized` shows `previousState 1` → `newState 2`, `grossEligible 684000`, `coverageBps 6840` and `cureDeadline`.

**Say:**

> "Then the hedge issuer signs an update — sequence two. The hedge is down to seventy-two cents; after the haircut, sixty-eight point four percent. Anyone can call sync, and the covenant moves to CURE at six thousand eight hundred forty basis points. *(optional)* A five-day cure clock starts."

### 3d. The refusal (1:37–2:09)

The refusal is the reason for the whole video. Don't rush it.

**1:37 On screen:** a split screen with the **Input** field of tab 4 and tab 7 side by side, both `0x3b304147…000f4240`. Crop so tab 7's status isn't visible yet.

**Say:**

> "Now the same call. Same amount. Same operator."

**1:41 On screen:** cut to tab 7 and show the red **Failed / execution reverted** status and method `draw`. Say nothing for **three full seconds**.

**1:44 On screen:** zoom to **Revert reason: `DrawNotAllowed(uint8 state)`, state = 2**. Keep the Arcscan chrome in frame, so it is clear the explorer is decoding it, not us.

**1:57 On screen:** show that tab 7 lists no token transfer, where tab 4 showed 1 USDC.

**2:00 On screen:** highlight gas used: **172,586 of a 1,000,000 limit**.

**Say** (starting at 1:44):

> "Refused. Receipt status zero. The revert reason is DrawNotAllowed — state two, CURE. This isn't an error caught in a browser; it's a transaction the chain refused, and the explorer decodes why. The vault balance didn't move. Principal didn't move. And it failed on evidence, not gas — it used under a fifth of its gas limit."

**2:06 On screen:** hold on the revert reason. Pause for one second, then:

> "That refusal is the product."

### 3e. Restoration, and the same draw permitted again (2:09–2:29)

**2:09 On screen:** tab 8, **Logs**. `HedgeCredentialAccepted` shows `sequence 4` and `remainingNotional 1060000`.

**2:17 On screen:** tab 9, **Logs**. `CovenantSynchronized` shows `previousState 2` → `newState 1` and `coverageBps 10000`.

**2:24 On screen:** tab 10. Show status **Success** and **1 USDC** vault → operator.

**2:26 On screen:** tab 11, the evidence table. Highlight the three `draw 1000000` rows: `0x1` / `0x0` / `0x1`, at 10000 / 6840 / 10000.

**Say:**

> "Fresh cover must carry a higher sequence; the old credential can't be replayed. Sequence four: a dollar and six cents again. restoreCompliance runs a fresh evaluation — time alone restores nothing — and the facility is compliant at ten thousand. The identical draw — permitted. Status one.
> Same call, different evidence, different outcome."

---

## Scene 4: Why Arc (2:29–3:05)

**2:29 On screen:** back to tab 4, **Logs**. Highlight the two `Transfer` entries for the same draw: one from the native system address, `value 1000000000000000000`, and one from the USDC contract `0x3600…0000`, `value 1000000`. Then point at the transaction fee, which is denominated in USDC.

**2:46 On screen:** tab 12, the EURC contract page. Show it even if the optional line is cut.

**2:52 On screen:** tab 1. Find the diagram's instrument figure: the row that says *"Built. Circle ships it."* against the row describing a rule on whether an attested hedge is admissible, marked *"Empty. This is us."*

**Say:**

> "Why Arc? USDC is the gas token, so the dollar held, the dollar released and the dollar paying gas are one asset — here, logged twice, once native and once as the ERC-20. No volatile second token anywhere in the treasury workflow. Finality is sub-second. *(optional)* The book is in euros; the EURC contract is referenced, never moved.
> And honestly: Circle's StableFX is spot only — no forwards, no NDFs. Circle built the leg that converts currency, not the leg that makes coverage a condition of capital. That's the gap we fill."

---

## Scene 5: The boundary (3:05–3:29)

This is acceptance criterion A-8, so it must not be skipped. It has two parts: the boundary statement is spoken, and the mock seam is shown working.

**On screen:** a split screen, with the truth banner overlaid throughout: `Fictional facility · mock provider data · testnet USDC`.

- **Left, tab 13:** the sequence-2 fixture exactly as signed. Highlight `"mock": true`, `"disclaimer": "Mock provider data — no Ebury connection or endorsement."`, `"provider_name": "Fictional Treasury Desk"`, `"remaining_buy_amount": "0.720000"` and `"sequence": 2`, then its `digest` `0x5d57cd39…9d02`.
- **Right, tab 5, Logs:** `HedgeCredentialAccepted` with the **same digest** `0x5d57cd39…9d02` and `remainingNotional 720000`.

The two digests matching shows the labelled mock going in and the chain accepting it. That is the seam, working.

**Say:**

> "The boundary, stated plainly. A signature authenticates who asserted what; it does not prove a hedge legally exists. The hedge feed is a labelled mock shaped like a broker's API — this file is the sequence-two update the chain accepted, same digest. No bank has agreed to sign anything. The facility is fictional, and this is testnet USDC."

---

## Scene 6: Close (3:29–3:43)

**On screen:** the end card, held for 3 seconds after the narration ends.

> **Signa Covenant**
> Arc: Best DeFi/Onchain Finance Application
> github.com/estmcmxci/signa-arc · evidence: `scenarios/output/arc-facility-evidence.md`
> Draw permitted `0x0f71bb58…` `0x1` · Draw refused `0x9a2359c9…` `0x0` · Draw permitted `0x68598df3…` `0x1`

**Say:**

> "Signa Covenant: coverage as a condition of capital, on Arc. Submitted to Arc — Best DeFi and Onchain Finance Application. *(optional)* Every hash you've seen is public on testnet.arcscan.app."

---

## Sources

Every figure spoken, and every value the script points at, traces to one of the rows below. *Evidence* means `scenarios/output/arc-facility-evidence.json`, where `steps[n]` indexes the evidence table. *Policy* means `FacilityRegistry.getFacility(0x39cbb5ce…2c4d1c)`, read from the deployed registry at `0xB54fe913C4a7dE73Bc285338dCbb384AEec5e448` on 2026-09-10.

| Said or shown | Value | Source |
|---|---|---|
| "full coverage" | `minCoverageBps` 10000 | Policy. Also `requiredCoverageBps` 10000 in every `CovenantSynchronized` event (evidence `steps[3]`, `[5]`, `[8]`, `[9]`) |
| "five percent haircut" | `defaultHaircutBps` 500 | Policy |
| "one dollar owed" | `outstandingValue` 1000000 | evidence `credentials[0]` and `steps[1]` `ExposureCredentialAccepted` |
| "draw one USDC", "byte for byte identical" | `draw.amount` 1000000, calldata `0x3b304147…000f4240` | evidence `draw`. The calldata of all three draws was re-read on-chain after the run |
| "a dollar and six cents" | `remainingNotional` 1060000, sequences 1 and 4 | evidence `steps[2]`, `steps[7]` |
| "a hundred point seven percent … counted at a hundred" | `grossEligible` 1007000, `countedEligible` 1000000 | evidence `steps[3]` `CovenantSynchronized` |
| "ten thousand basis points", "status one" | `coverageBps` 10000, status `0x1` | evidence `steps[3]`, `steps[8]`, `steps[9]` |
| "one USDC leaves the vault" | vault balance 5000000 → 4000000 | evidence `steps[3].vault` |
| "sequence two … seventy-two cents" | `remainingNotional` 720000, sequence 2 | evidence `steps[4]` |
| "sixty-eight point four percent" | `grossEligible` 684000 against 1000000 | evidence `steps[5]` `CovenantSynchronized` |
| "six thousand eight hundred forty", "CURE" | `coverageBps` 6840, `newState` 2 | evidence `steps[5]` |
| "anyone can call sync" | `syncCovenant()` has no access modifier | deployed `CovenantVault` (source `7d66394`, verified on Arcscan) |
| "a five-day cure clock" | `curePeriod` 432000 s, `cureDeadline` 1789495378 | Policy, and evidence `steps[5]` |
| "receipt status zero" | `0x0` | evidence `steps[6].actualStatus` |
| "DrawNotAllowed — state two, CURE" | revert data `0xbe986785…0002` | evidence `steps[6].refusal`, from replays at blocks 61436239 and 61436240. Arcscan's own `revert_reason` shows the same on screen |
| "vault balance didn't move. Principal didn't move." | 4000000 → 4000000; 1000000 → 1000000 | evidence `steps[6].vault` |
| "under a fifth of its gas limit" | 172586 of 1000000 | evidence `steps[6].gasUsed` and `refusal.gasLimit` |
| "the old credential can't be replayed" | `CredentialRegistry` reverts `StaleSequence` unless the sequence rises | deployed `CredentialRegistry` |
| "restoreCompliance runs a fresh evaluation … compliant at ten thousand" | `newState` 1, `coverageBps` 10000 | evidence `steps[8]`. `restoreCompliance` re-evaluates and reverts unless compliant (deployed `CovenantVault`) |
| "logged twice, once native and once as the ERC-20" | `Transfer` values 1000000000000000000 and 1000000 | evidence `steps[3].events` |
| "the book is in euros; EURC referenced, never moved" | currency EUR, EURC `0x89B5…D72a` | evidence `deployment.exposureDenomination` |
| "two independent issuers … offchain" | `0x4317…6662` and `0xAD51…2e0a`; every submission sent by the operator | evidence `identities`, and `steps[n].sender` |
| "same digest" (scene 5) | `0x5d57cd396069e79db9b5fdd79f2d75501d1bab896dda992e52a0e53807ea9d02` | evidence `credentials[2].digest`, which equals the digest in `steps[4]` `HedgeCredentialAccepted` |
| "finality is sub-second" | a claim about Arc, not a measurement; no figure is spoken | Circle's Arc developer guidance (`.claude/skills/use-arc/SKILL.md`). The evidence is consistent with it: the observations at blocks 61436209 and 61436247 are 19 s apart, so 38 blocks in 19 s |
| "StableFX is spot only, no forwards, no NDFs" | a positioning claim; no figure | `PRD.md` §3, checked against Circle's StableFX documentation on 2026-09-09 |

**Don't say these.** None of them is in the evidence:
- any fee or cost in dollars (the explorer shows fees on screen; the evidence doesn't record gas price)
- a per-transaction cost
- block times as numbers
- how long the run took
- any figure about the Circle faucet
