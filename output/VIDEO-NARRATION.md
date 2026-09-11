# Signa Covenant: narration only

Spoken text extracted from [VIDEO-SCRIPT.md](./VIDEO-SCRIPT.md). Use that script for shots and timing. Optional sentences are marked inline. For filming after Friday September 11, 5:47:22 pm EDT, use the scene 3a replacement in [RECORDING-CHECKLIST.md](./RECORDING-CHECKLIST.md).

## Scene 1: The problem (0:00–0:27)

This is Signa Covenant, for Arc: Best DeFi and Onchain Finance Application.

A credit originator owes its investors USDC while its loans repay in euros. The hedge protecting that gap sits at a bank. The capital sits in a vault that can't see it. Operations reconciles coverage on a calendar; drawdowns happen on demand.
The covenant governs a conversation. It needs to govern the money.

## Scene 2: What we built (0:27–0:48)

Covenant is a coverage gate on Arc. Two independent issuers sign credentials offchain — one for the loan exposure, one for the hedge. A deterministic engine rules whether that evidence is admissible under the lender's policy. And the vault obeys the ruling inside the same transaction that moves the funds.

## Scene 3: The demo (0:48–2:29)

### 3a. Set-up (0:48–1:01)

Our dashboard reads the deployed contracts. Policy: full coverage after a five percent haircut. Exposure: one dollar owed. Watch one call — draw one USDC — sent three times, byte for byte identical.

### 3b. Draw 1: permitted (1:01–1:18)

First draw. The hedge covers a dollar and six cents. After the haircut, that's a hundred point seven percent of the exposure — counted at a hundred. Ten thousand basis points. Permitted: status one, and one USDC leaves the vault.

### 3c. The hedge shrinks and the facility enters CURE (1:18–1:37)

Then the hedge issuer signs an update — sequence two. The hedge is down to seventy-two cents; after the haircut, sixty-eight point four percent. Anyone can call sync, and the covenant moves to CURE at six thousand eight hundred forty basis points. *(optional)* A five-day cure clock starts.

### 3d. The refusal (1:37–2:09)

Now the same call. Same amount. Same operator.

*[Show the failed receipt. Pause for three full seconds.]*

Refused. Receipt status zero. The revert reason is DrawNotAllowed — state two, CURE. This isn't an error caught in a browser; it's a transaction the chain refused, and the explorer decodes why. The vault balance didn't move. Principal didn't move. And it failed on evidence, not gas — it used under a fifth of its gas limit.

*[Hold the revert reason. Pause for one second.]*

That refusal is the product.

### 3e. Restoration, and the same draw permitted again (2:09–2:29)

Fresh cover must carry a higher sequence; the old credential can't be replayed. Sequence four: a dollar and six cents again. restoreCompliance runs a fresh evaluation — time alone restores nothing — and the facility is compliant at ten thousand. The identical draw — permitted. Status one.
Same call, different evidence, different outcome.

## Scene 4: Why Arc (2:29–3:05)

Why Arc? USDC is the gas token, so the dollar held, the dollar released and the dollar paying gas are one asset — here, logged twice, once native and once as the ERC-20. No volatile second token anywhere in the treasury workflow. Finality is sub-second. *(optional)* The book is in euros; the EURC contract is referenced, never moved.
And honestly: Circle's StableFX is spot only — no forwards, no NDFs. Circle built the leg that converts currency, not the leg that makes coverage a condition of capital. That's the gap we fill.

## Scene 5: The boundary (3:05–3:29)

The boundary, stated plainly. A signature authenticates who asserted what; it does not prove a hedge legally exists. The hedge feed is a labelled mock shaped like a broker's API — this file is the sequence-two update the chain accepted, same digest. No bank has agreed to sign anything. The facility is fictional, and this is testnet USDC.

## Scene 6: Close (3:29–3:43)

Signa Covenant: coverage as a condition of capital, on Arc. Submitted to Arc — Best DeFi and Onchain Finance Application. *(optional)* Every hash you've seen is public on testnet.arcscan.app.

*[Hold the end card for three seconds after narration ends.]*
