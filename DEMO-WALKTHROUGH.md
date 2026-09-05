# Deterministic Prototype Walkthrough

**Target length:** 75–90 seconds  
**Status:** Script ready; record only after Base Sepolia receipts and public dashboard exist  
**Required banner:** `Base Sepolia / fictional facility / mock provider data`

This walkthrough demonstrates contract behavior, not a real lender, borrower, provider integration, legal hedge, or production system. Replace every bracketed receipt placeholder only with verified Base Sepolia evidence from `deployments/base-sepolia-scenario.json`.

## Recording script

### 0:00–0:09 — Boundary

**Screen:** Dashboard masthead and persistent truth banner.

**Voiceover:**

> This is a fictional Colombian coffee-finance facility using a mock USD-like test token and mock provider data on Base Sepolia. There is no lender, bank, broker, Ebury, exporter, or cooperative integration.

### 0:09–0:20 — Frozen policy

**Screen:** Facility policy card: USD/COP, 80% threshold, freshness, maturity tolerance, reserve, and ten-minute demo cure window.

**Voiceover:**

> The facility freezes its economic rules: an 80% minimum coverage ratio, credential freshness and maturity requirements, a retained reserve, and a short testnet cure window.

### 0:20–0:31 — Independent assertions

**Screen:** Exposure and active-hedge panels; point to distinct issuer addresses and source commitments.

**Voiceover:**

> A mock servicer signs the current exposure. A different mock verifier signs minimum hedge lifecycle facts. EIP-712 binds each assertion to this registry and chain. The signatures prove who asserted the fields—not that the offchain derivative is legally true.

### 0:31–0:42 — Compliant draw

**Screen:** USD 5.0M exposure, USD 4.5M eligible hedge, 90% coverage, `COMPLIANT`; open the successful draw receipt.

**Voiceover:**

> Five million dollars of authenticated exposure against four-and-a-half million of eligible cover produces 90%. The 80% rule passes, and the originator can draw while the configured reserve remains in the vault.

**Receipt:** `[T-01 COMPLIANT DRAW URL]`

### 0:42–0:54 — Fresh failure

**Screen:** Exposure grows to USD 6.0M, coverage reads 75%; open the reverted draw receipt and then the cure-sync receipt.

**Voiceover:**

> When exposure grows to six million, coverage falls to 75%. The next draw evaluates fresh state and reverts even though the prior cached state was compliant. A permissionless sync records the cure.

**Receipts:** `[T-04 REVERTED DRAW URL]`, `[T-04 CURE SYNC URL]`

### 0:54–1:06 — Restoration

**Screen:** Higher-sequence hedge at USD 5.0M, 83.33%, `COMPLIANT`; open restoration receipt.

**Voiceover:**

> A higher-sequence hedge update raises eligible cover to five million. Coverage returns to 83.33%, a fresh onchain evaluation resolves the cure, and draw availability returns.

**Receipt:** `[T-13 RESTORATION URL]`

### 1:06–1:19 — Cancellation and breach safety

**Screen:** Cancellation, zero eligible coverage, `CURE`, then `BREACH`; show vault balance unchanged across breach.

**Voiceover:**

> Cancellation removes that trade from eligible cover. After the disclosed cure window, the facility enters breach. Nothing liquidates the borrower, transfers the reserve, or buys a replacement hedge.

**Receipts:** `[CANCELLATION URL]`, `[T-14 BREACH SYNC URL]`

### 1:19–1:28 — Repayment and close

**Screen:** Repayment receipt and reduced principal; end on trust statement.

**Voiceover:**

> Repayment still succeeds during breach and reduces principal. Base is the capital-control venue; the accepted external issuers remain responsible for the facts they assert.

**Receipt:** `[T-16 REPAYMENT URL]`

## Pre-recording evidence checks

- [ ] Dashboard URL is public and reads the manifest addresses.
- [ ] All five contracts are source-verified on Sepolia Basescan.
- [ ] Persistent Base Sepolia/fictional/mock banner is visible at desktop and mobile widths.
- [ ] Exposure and hedge issuer addresses differ and match the deployment manifest.
- [ ] Every receipt link resolves to chain ID `84532`.
- [ ] Coverage values shown by the dashboard match `CoverageEngine.evaluate` at the cited blocks.
- [ ] Vault balance is identical immediately before and after breach synchronization.
- [ ] Repayment receipt is successful and principal falls by the stated amount.
- [ ] No target, incumbent, bank, provider, exporter, or cooperative logo appears.
- [ ] No narration says “verified hedge,” “trustless legal proof,” “partner,” “customer,” or “integration.”

## Failure backup

Record a clean screen capture after the live run and retain stills for the compliant, cure, restored, and breach states. If the live public RPC is rate-limited during the application video, show the recorded Base Sepolia receipt links and explain that the dashboard is reading the same deployed contracts; never substitute local hashes while calling them Sepolia evidence.

