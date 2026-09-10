# Signa Covenant: A-1 … A-4 on Arc Testnet

Chain 5042002, explorer https://testnet.arcscan.app.

Outcome: **complete**. Fictional EUR-denominated loan book. Mock provider and exposure data. Testnet USDC only; no real counterparties. Mock provider data — no Ebury connection or endorsement.

Deployed source `7d66394654fa2147da495027af6d64cac38d2cf8`; scenario `7e4c8cca076c83fb994c6e8c50d0bec2a6cf9655`. Every draw sends the identical calldata `0x3b30414700000000000000000000000000000000000000000000000000000000000f4240` from the operator `0x7e09657321F1818825a9A15cedd9D95308130ED4`.

| Criterion | Action | Transaction | Expected | Actual | Coverage (bps) | Reason | Covenant state |
|---|---|---|---|---|---|---|---|
| A-1 | deposit 5000000 (deployment funding) | [0x9f896bd5…](https://testnet.arcscan.app/tx/0x9f896bd522079b8af2b4f6e566d363498c2e546acf8e7552b6347d78da7b2288) | 0x1 | 0x1 | 0 | MISSING_EXPOSURE | UNASSESSED |
| A-1 | submit exposure credential seq 1 (1.000000 USD) | [0x15b73554…](https://testnet.arcscan.app/tx/0x15b73554179d4661f99073e6748e5363b66955d51742f0f4fb8108f7964980d2) | 0x1 | 0x1 | 0 | BELOW_THRESHOLD | UNASSESSED |
| A-1 | submit hedge seq 1 (1.060000 USD, booked) | [0x633f7a92…](https://testnet.arcscan.app/tx/0x633f7a9260c06aec05047457647dbfec8496c878c016400ad9fec1be5f2ccf5e) | 0x1 | 0x1 | 10000 | NONE | UNASSESSED |
| A-2 | draw 1000000 | [0x0f71bb58…](https://testnet.arcscan.app/tx/0x0f71bb58a39a9426d9ebe52d02462800662e6a72e3d9348ab52f53f5f66eba40) | 0x1 | 0x1 | 10000 | NONE | COMPLIANT |
| A-3 | submit hedge seq 2 (0.720000 USD, partially_funded) | [0xca119756…](https://testnet.arcscan.app/tx/0xca119756b901cc3cbed093f854ec6a5cf609d4921ceba649b8a4d54e840d2839) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | COMPLIANT |
| A-3 | syncCovenant | [0x01b1a65f…](https://testnet.arcscan.app/tx/0x01b1a65f6c8888b784180a199556422f8d0fd4704c7a781be7aa268e1701e0a8) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | CURE |
| A-3 | draw 1000000 | [0x9a2359c9…](https://testnet.arcscan.app/tx/0x9a2359c9e12e2c7f921029f07d91f57c36c84e7064852fde936937b56671c360) | 0x0 | 0x0 | 6840 | BELOW_THRESHOLD | CURE |
| A-4 | submit hedge seq 4 (1.060000 USD, booked) | [0xe05c354c…](https://testnet.arcscan.app/tx/0xe05c354c752d4cfc26ec8a08d61484a6e7ed3a28af2c38deeb930e855ac2fc46) | 0x1 | 0x1 | 10000 | NONE | CURE |
| A-4 | restoreCompliance | [0x4c932e28…](https://testnet.arcscan.app/tx/0x4c932e285d72032dcb5cf41a6904dbcfe3cb537cc363642cf9450b3d198f824c) | 0x1 | 0x1 | 10000 | NONE | COMPLIANT |
| A-4 | draw 1000000 | [0x68598df3…](https://testnet.arcscan.app/tx/0x68598df3e76b0ac2bc8272b11edc5a63e6542dc387243f42b926f3e3ed60d7a1) | 0x1 | 0x1 | 10000 | NONE | COMPLIANT |

The A-3 draw [0x9a2359c9e12e2c7f921029f07d91f57c36c84e7064852fde936937b56671c360](https://testnet.arcscan.app/tx/0x9a2359c9e12e2c7f921029f07d91f57c36c84e7064852fde936937b56671c360) failed with status 0x0, using 172586 of its 1000000 gas limit. Replaying the identical call at blocks 61436239 and 61436240 returns `0xbe9867850000000000000000000000000000000000000000000000000000000000000002`, which decodes to `DrawNotAllowed(CURE)`. The gate's own verdict for that state was `allowed = false`, reason `BELOW_THRESHOLD`.
