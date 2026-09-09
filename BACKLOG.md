# Backlog

Operational items. Parked here so they stop presenting themselves as strategy — direction lives in `SPONSOR-STRATEGY-REVIEW.md` (private).

## Unblocked, do when convenient
- [ ] Submit the CRE Confidential Workflows access form. Not a blocker — the local simulator runs without waiting, and a CLI simulation qualifies for the track.
- [ ] Decide whether to approach Circle through `circle.com/join-stablefx`. Its own CTA is "Become a design partner", which is the Oct-31-gate FX signer path, not just a hackathon key.
- [ ] Delete the stale untracked copies of the business docs from this working tree; they are canonical in `~/signa-batches` now.
- [ ] Make this repository public before Sep 16. Every sponsor track requires open source.

## Verify before the workstream that depends on it
- [ ] Does Subgraph Studio index Arc Testnet, or only the Sepolia leg? Gates Workstream E.
- [ ] Which chains can CRE capability DONs write to? Fixes Workstream B's settlement chain.
- [ ] Does `testnet.arcscan.app` support source verification, and via which API?
- [x] ~~Is testnet EURC obtainable in useful quantities, or must it be mocked?~~ Answered 2026-09-09: first-class token, `0x89B5…D72a`, 6 dec, Circle faucet. See `ARC-FIELD-NOTES.md` §2.
- [ ] Which documented Arc EVM divergences touch our contracts?

## Batches artifact — separate repo, separate deadline
Tracked in `~/signa-batches/SUBMISSION-CONTROL.md`. All of it needs founder input: testnet identities and funding, `ETHERSCAN_API_KEY`, outreach approval, personal application fields, the adversity answer, the founder video, final claims consent.

## Design decisions to carry into the EED

- [ ] **Cross-check the exposure credential against the vault's own ledger.** The vault independently knows how much USDC it disbursed and how much came back — a record no external party signs. An exposure credential that is arithmetically inconsistent with that history (claiming a book far smaller than what was lent, net of repayments) is the one place in the machine where a false assertion is *mechanically* detectable rather than merely attributable. Cheap to add, and it closes part of the honest gap on the exposure leg. Surfaced in the 2026-09-07 walkthrough; not built, not designed in detail.
- [ ] Selection rule, not code: the exposure issuer must be a party that answers to the lender (servicer, controlled receivable account), never one aligned with the borrower. Document it in the prototype spec's roles section as a deployment requirement.

- [ ] **Onchain hedge instrument class.** Avantis on Base trades forex (USDJPY confirmed in their docs; verify the full pair list and that it is Base-native before relying on it). A perp is attestable by reading chain state — no broker key, no privacy problem — but has no maturity, so it needs its own instrument class with a heavier haircut and a margin-health condition. Natural fit for the Bankr buildathon rather than the ETHOnline window.

## Known debt
- [ ] `ARC-SYSTEM-DESIGN.md` and `SYSTEM-ARCHITECTURE.md` overlap on the Arc bindings. Fold the Arc doc into the architecture doc once the port starts, rather than maintaining both.
- [ ] The dashboard shell is not wired to anything. It becomes real in Workstream A or C, whichever lands first.
