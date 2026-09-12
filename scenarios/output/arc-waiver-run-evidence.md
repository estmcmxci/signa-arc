# Signa Covenant: permitted, refused, waived by a 2-of-2 quorum, permitted, lapsed — one facility, one run

Chain 5042002, explorer https://testnet.arcscan.app.

Outcome: **complete**. Fictional EUR-denominated loan book. Mock provider and exposure data. Testnet USDC only; no real counterparties. Mock provider data — no Ebury connection or endorsement.

> **The facility is left in CURE, and that is the last step working.** The facility is left in CURE on purpose. Step six of this run is the waiver lapsing, and a lapsed waiver returns the vault to the state it was in before the exception. Cover is still below policy because nothing in this run restored it. A reader who checks the chain after the run and finds CURE is seeing the last step succeed, not the run fail.

Deployed source `5fefd2322f148cdbd713fa9b266c74b6f044b940`; scenario `af3e8dc4d040f070a3a44dce14de7dec7d48ec04`. Every draw sends the identical calldata `0x3b30414700000000000000000000000000000000000000000000000000000000000f4240` from the operator `0x7e09657321F1818825a9A15cedd9D95308130ED4`. The waiver is sent by the 2-of-2 quorum wallet `0x55C4DD3770A44695735717CB7b7005AC7dE9edA1`.

| Step | Action | Transaction | Expected | Actual | Coverage (bps) | Reason | Covenant state |
|---|---|---|---|---|---|---|---|
| W-1 | approve 2000000 to the vault | [0xf4903747…](https://testnet.arcscan.app/tx/0xf490374765312d104c3c5c2742f66a0cc101efc0ad9ac3781f8eed881fc9bd3c) | 0x1 | 0x1 | 10000 | NONE | COMPLIANT |
| W-1 | deposit 2000000 (facility funding) | [0xb84fac35…](https://testnet.arcscan.app/tx/0xb84fac35ef8680841cceedc55d71c4594014765ca65501ef967eb04a2b4d20e3) | 0x1 | 0x1 | 10000 | NONE | COMPLIANT |
| W-1 | draw 1000000 | [0xc02108e7…](https://testnet.arcscan.app/tx/0xc02108e763210c08859f60c5f6c23994833fdc33b78c04dc4b3bce67d13e6ccd) | 0x1 | 0x1 | 10000 | NONE | COMPLIANT |
| W-2 | submit hedge seq 8 (720000 USD base units) | [0xfbee0cd9…](https://testnet.arcscan.app/tx/0xfbee0cd95352a78804188c09c988b15d975c722e050885bad3479af980ae027e) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | COMPLIANT |
| W-2 | syncCovenant | [0x8d6a5e03…](https://testnet.arcscan.app/tx/0x8d6a5e03fa7590e9231d3fff3c244f1978328eb432dddf88f0cf22bc87ba8dfd) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | CURE |
| W-3 | draw 1000000 | [0xe4f039a9…](https://testnet.arcscan.app/tx/0xe4f039a990dd4e2a1f8663a92b4a6d476dff4fc5566643e7958a79269c88194f) | 0x0 | 0x0 | 6840 | BELOW_THRESHOLD | CURE |
| W-4 | createWaiver(300 s) by the 2-of-2 quorum | [0x665838e2…](https://testnet.arcscan.app/tx/0x665838e29a3ffb39e6b909e5e84e6d071945153db049ff01228862ce0863fdf0) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | WAIVED |
| W-5 | draw 1000000 | [0x2aa35390…](https://testnet.arcscan.app/tx/0x2aa35390f0041fb6dde6b9241bdeece769e18171f27c0216a2419e921116337d) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | WAIVED |
| W-6 | syncCovenant (after the waiver lapsed) | [0x151680a3…](https://testnet.arcscan.app/tx/0x151680a3f8caab6896945bde3d190dd9620273f248dd9da6ee2d56c14f095fdc) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | CURE |
| W-7 | submit exposure seq 3 (re-observed, outside the sequence) | [0xf6395fa9…](https://testnet.arcscan.app/tx/0xf6395fa9fe654c4651dad8ed475ee94402665c61e5624c43fc03d3e4416ca5ff) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | CURE |

The refused draw [0xe4f039a990dd4e2a1f8663a92b4a6d476dff4fc5566643e7958a79269c88194f](https://testnet.arcscan.app/tx/0xe4f039a990dd4e2a1f8663a92b4a6d476dff4fc5566643e7958a79269c88194f) failed with status 0x0, using 172586 of its 1000000 gas limit. Replaying the identical call at blocks 61678136 and 61678137 returns `0xbe9867850000000000000000000000000000000000000000000000000000000000000002`, which decodes to `DrawNotAllowed(CURE)`. The gate's own verdict at that block was `allowed = false`, reason `BELOW_THRESHOLD`.

## The override took two people

Privy intent `r60i4ex2el0w2rqqe0mgdufn`, 300 s, ending 2026-09-12T05:24:47.000Z. Stated reason: Hedge replacement in progress with the broker; a bounded 300-second exception while cover is restored. Arc Testnet rehearsal, fictional facility. — only its keccak256 `0x954d76348692d1dfa9b9542e6994b41319ff3bffdb6d1ed14615986dc999dc51` goes on chain.

| Approver | Signed at |
|---|---|
| Risk officer | 2026-09-12T04:39:37.940Z |
| Treasury lead | 2026-09-12T04:39:41.004Z |

Broadcast: [0x665838e29a3ffb39e6b909e5e84e6d071945153db049ff01228862ce0863fdf0](https://testnet.arcscan.app/tx/0x665838e29a3ffb39e6b909e5e84e6d071945153db049ff01228862ce0863fdf0).

Gas: the quorum wallet held 0.28793051675 USDC before this run and 0.28418363075 after it, spending 0.003746886 on the waiver — about 75 more at this gas price. faucet.circle.com funds 20 USDC per address every two hours.

Both approver keys sat in one process for this run, which is a rehearsal convenience and not how a quorum is meant to be held.
