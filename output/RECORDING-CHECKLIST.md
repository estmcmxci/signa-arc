# Publish and record

Submission deadline: **Sunday September 13, 2026, 12:00 pm EDT** (16:00 UTC).

HANDOVER.md owns the completed chain work. The A-1 → A-4 receipts and the quorum-approved waiver are already proven. Use those records for filming.

## 1. Make the repository public

GitHub reported `estmcmxci/signa-arc` as **PRIVATE** on September 11 during recording preparation. Run:

```bash
gh repo edit estmcmxci/signa-arc --visibility public --accept-visibility-change-consequences
gh repo view estmcmxci/signa-arc --json visibility,url
```

The second command should report `PUBLIC`. Open https://github.com/estmcmxci/signa-arc in a signed-out/private browser window and confirm the README and evidence links load. This publishes the repository already on GitHub; local preparation files appear there only after they are committed and pushed.

The installed CLI requires the consequences flag; the shorter command in HANDOVER.md omits it. HANDOVER.md also records that the clean-clone check already passed.

## 2. Capture the dashboard shot first

The script's exposure-credential cutoff is **Friday September 11, 5:47:22 pm EDT** (21:47:22 UTC). Before then, capture scene 3a if the live dashboard actually shows the expected state.

```bash
cd ~/signa
pnpm --filter @fx-coverage/dashboard dev
```

- Use the URL printed by Vite; its default is http://localhost:5173.
- Record at 1920×1080, with the truth banner and readable policy values in frame.
- This is a read-only shot. An unconnected wallet is expected; no Draw click is scripted.
- If the live evidence is stale or coverage differs, use the fallback below. The time cutoff is not a guarantee of current state.

**After the cutoff:** use the dashboard's **Scenario evidence** panel for scene 3a and keep the live coverage/verdict panels out of that shot. Retain the fictional/mock/testnet disclosure as an overlay if scrolling hides the banner. Replace only scene 3a's narration with:

> “This is our recorded Arc Testnet run. Policy: full coverage after a five percent haircut. Exposure: one dollar owed. Watch one call — draw one USDC — sent three times, byte for byte identical.”

The remaining explorer scenes show historical transactions and remain usable. Present the sequence as the recorded run; do not imply that historical compliance is today's live verdict.

## 3. Record from the existing script

Open [VIDEO-SCRIPT.md](./VIDEO-SCRIPT.md) for the exact tabs, crops, timings, and sources. Use [VIDEO-NARRATION.md](./VIDEO-NARRATION.md) for the spoken text. Record a short microphone sample first, then time one full read.

| Time | Shot |
|---|---|
| 0:00–0:27 | Title, Arc bounty, problem cards |
| 0:27–0:48 | Architecture, verified vault source |
| 0:48–1:01 | Dashboard policy/evidence, or historical fallback |
| 1:01–1:18 | First draw: Success, 1 USDC, coverage 10000 bps |
| 1:18–1:37 | Sequence 2 update, coverage 6840 bps, CURE |
| 1:37–2:09 | Identical calldata; Failed; three seconds of silence; DrawNotAllowed(CURE) |
| 2:09–2:29 | Sequence 4, restoreCompliance, third draw Success |
| 2:29–3:05 | Why Arc: USDC views, EURC reference, architecture |
| 3:05–3:29 | Labelled mock payload and matching accepted digest; boundary statement |
| 3:29–3:43 | End card with public repository and evidence |

For the failed draw, use `0x5cad2c042e76a9f043eeb5988a733975d9dbf05fcb74cb58b44796581a09399a`, as recorded in HANDOVER.md and VIDEO-SCRIPT.md. Use the script's tab list for all explorer links.

Keep scene 3d's pause and all of scene 5. Cut the three optional sentences first if the recording runs long. Keep the final export within **2–4 minutes**, including the end-card hold. The full script already occupies most of that window; the quorum waiver remains linked evidence rather than an unplanned extra scene.

## 4. Check the exported video

- Duration is 2–4 minutes; resolution is at least 1280×720; voice and explorer text are clear.
- The Arc bounty is named aloud and shown on screen.
- The three draw outcomes are visible: permitted → refused → permitted.
- The refusal shows the same calldata and the CURE revert reason.
- The boundary is spoken: signatures authenticate assertions; they do not prove a hedge legally exists. No bank has agreed to sign anything.
- The labelled mock and matching on-chain digest are visible.
- The end card points to the public repository. Check the eventual video link in a signed-out browser before submitting.

Leave time before Sunday's noon EDT deadline for upload, processing, and submission. Publication and the final recording are still yours to complete.
