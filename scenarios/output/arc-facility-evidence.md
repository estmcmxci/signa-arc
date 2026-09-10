# Signa Covenant: A-1 … A-4 on Arc Testnet

Chain 5042002, explorer https://testnet.arcscan.app.

Outcome: **complete**. Fictional EUR-denominated loan book. Mock provider and exposure data. Testnet USDC only; no real counterparties. Mock provider data — no Ebury connection or endorsement.

Deployed source `5fefd2322f148cdbd713fa9b266c74b6f044b940`; scenario `ef80a89f54f830513d86015425c5961571a28f48`. Every draw sends the identical calldata `0x3b30414700000000000000000000000000000000000000000000000000000000000f4240` from the operator `0x7e09657321F1818825a9A15cedd9D95308130ED4`.

| Criterion | Action | Transaction | Expected | Actual | Coverage (bps) | Reason | Covenant state |
|---|---|---|---|---|---|---|---|
| A-1 | deposit 2500000 (facility funding) | [0x0ce7305b…](https://testnet.arcscan.app/tx/0x0ce7305bd96565c50e9d5ba1605ea23714fdb7960cbc303f12da349a974f4625) | 0x1 | 0x1 | 0 | MISSING_EXPOSURE | UNASSESSED |
| A-1 | submit exposure credential seq 1 (1.000000 USD) | [0x7cdfc40d…](https://testnet.arcscan.app/tx/0x7cdfc40d07c9269766de7d794b8d4c45d2a28654982f75b9ef4cf7e8c1f1e463) | 0x1 | 0x1 | 0 | BELOW_THRESHOLD | UNASSESSED |
| A-1 | submit hedge seq 1 (1.060000 USD, booked) | [0x74624886…](https://testnet.arcscan.app/tx/0x74624886be53a97ffb19975c75df721b109c99559e5083a9e3f236af515a827e) | 0x1 | 0x1 | 10000 | NONE | UNASSESSED |
| A-2 | draw 1000000 | [0x89b939cd…](https://testnet.arcscan.app/tx/0x89b939cd1315a295ab1d0b44b4b8a1d33abe7bd0ffc502af864a415c1f715ef6) | 0x1 | 0x1 | 10000 | NONE | COMPLIANT |
| A-3 | submit hedge seq 2 (0.720000 USD, partially_funded) | [0x33570a7d…](https://testnet.arcscan.app/tx/0x33570a7d13bd1301cc31a379db4319596de7066c51f49a600371286b6c8ab504) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | COMPLIANT |
| A-3 | syncCovenant | [0x5e2fc3ec…](https://testnet.arcscan.app/tx/0x5e2fc3ec45af81901d941a6d62413f045698a43efadb7ac942e5ec56646bdb16) | 0x1 | 0x1 | 6840 | BELOW_THRESHOLD | CURE |
| A-3 | draw 1000000 | [0x5cad2c04…](https://testnet.arcscan.app/tx/0x5cad2c042e76a9f043eeb5988a733975d9dbf05fcb74cb58b44796581a09399a) | 0x0 | 0x0 | 6840 | BELOW_THRESHOLD | CURE |
| A-4 | submit hedge seq 4 (1.060000 USD, booked) | [0x4d986e6d…](https://testnet.arcscan.app/tx/0x4d986e6de66d4bbabb9ab5afbf91ac1470d4de49b9680f82e09c561eed40ab3c) | 0x1 | 0x1 | 10000 | NONE | CURE |
| A-4 | restoreCompliance | [0xd4d2578b…](https://testnet.arcscan.app/tx/0xd4d2578bd944cd207d441c4a70e86d594eae89aa5cfb894119ca53a03896b26c) | 0x1 | 0x1 | 10000 | NONE | COMPLIANT |
| A-4 | draw 1000000 | [0x1ef19c5a…](https://testnet.arcscan.app/tx/0x1ef19c5a24e0fdd63ecdc0e6eee3d251041a03ddd4d4082753377ef382fb516a) | 0x1 | 0x1 | 10000 | NONE | COMPLIANT |

The A-3 draw [0x5cad2c042e76a9f043eeb5988a733975d9dbf05fcb74cb58b44796581a09399a](https://testnet.arcscan.app/tx/0x5cad2c042e76a9f043eeb5988a733975d9dbf05fcb74cb58b44796581a09399a) failed with status 0x0, using 172586 of its 1000000 gas limit. Replaying the identical call at blocks 61462543 and 61462544 returns `0xbe9867850000000000000000000000000000000000000000000000000000000000000002`, which decodes to `DrawNotAllowed(CURE)`. The gate's own verdict for that state was `allowed = false`, reason `BELOW_THRESHOLD`.
