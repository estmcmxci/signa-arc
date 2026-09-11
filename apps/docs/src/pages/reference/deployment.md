---
title: "Deployment"
description: "The Arc Testnet deployment signa reads by default: contracts, settlement asset, roles and the facility's frozen policy, from the bundled manifest."
---

# Deployment

Generated from the deployment manifest bundled with the CLI, a copy of `deployments/arc-testnet.json`. `signa status` checks this deployment live, and every report says which manifest it used.

|  |  |
|---|---|
| Chain | Arc Testnet, 5042002 |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | https://testnet.arcscan.app |
| Deployed source | `5fefd2322f148cdbd713fa9b266c74b6f044b940` |
| Deployed at | 2026-09-10T20:52:58.000Z |
| Facility | `0x899dc705b298baf794bb1fab7734bdd59b48f7eda766f6830d6c30768cc0d5e2` |

## Contracts

| Contract | Address | Deployed in |
|---|---|---|
| facilityRegistry | [`0xB54fe913C4a7dE73Bc285338dCbb384AEec5e448`](https://testnet.arcscan.app/address/0xB54fe913C4a7dE73Bc285338dCbb384AEec5e448) | block 61422394 |
| credentialRegistry | [`0xD921734C9314442a74Cd3FEBAB8028b2Bb9A7624`](https://testnet.arcscan.app/address/0xD921734C9314442a74Cd3FEBAB8028b2Bb9A7624) | block 61422413 |
| coverageEngine | [`0x3341B76fEFF4CE691781fEAa4C76EA95479b9b6b`](https://testnet.arcscan.app/address/0x3341B76fEFF4CE691781fEAa4C76EA95479b9b6b) | block 61422417 |
| covenantVault | [`0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51`](https://testnet.arcscan.app/address/0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51) | block 61456107 |

## Assets and roles

|  | Address | Note |
|---|---|---|
| Settlement asset | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) | USDC, 6 decimals. Everything is accounted in this view. |
| Exposure denomination | [`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`](https://testnet.arcscan.app/address/0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a) | EURC. Referenced only; never transferred, held or approved. |
| Facility admin | [`0x55C4DD3770A44695735717CB7b7005AC7dE9edA1`](https://testnet.arcscan.app/address/0x55C4DD3770A44695735717CB7b7005AC7dE9edA1) | A privy 2-of-2 key quorum: Risk officer and Treasury lead. |
| Operator | [`0x7e09657321F1818825a9A15cedd9D95308130ED4`](https://testnet.arcscan.app/address/0x7e09657321F1818825a9A15cedd9D95308130ED4) | Draws and repays. `draw simulate` sends as this address. |
| Exposure issuer | [`0x4317497399f27d52007d7f2012EAd27f148B6662`](https://testnet.arcscan.app/address/0x4317497399f27d52007d7f2012EAd27f148B6662) | A test key held by the project. No bank signs anything here. |
| Hedge issuer | [`0xAD515A2BE433e78B6b570064797626012e272e0a`](https://testnet.arcscan.app/address/0xAD515A2BE433e78B6b570064797626012e272e0a) | A test key held by the project; the hedge data is a labelled mock. |

## The facility's frozen policy

| Setting | Value | Meaning |
|---|---|---|
| `minCoverageBps` | 10000 | Coverage required, in basis points. |
| `defaultHaircutBps` | 500 | Discount applied to a hedge's notional. |
| `credentialMaxAgeSeconds` | 86400 | How old an assertion may be before the engine calls it stale. |
| `maturityToleranceSeconds` | 604800 | How far a hedge's maturity may fall short of the exposure's. |
| `reserveAmount` | 500000 | Units of the settlement asset the vault must keep. |
| `cureWindowSeconds` | 432000 | How long the facility may stay in CURE before BREACH. |
| `maxWaiverDurationSeconds` | 259200 | The longest waiver the admin may create. |
| `maxActiveHedges` | 8 | Active hedge assertions allowed at once. |
| `settlementCurrency` | USD | What the facility settles in. |
| `exposureCurrency` | EUR | What the exposure is denominated in. |

The policy is frozen: `FacilityRegistry` writes it once, and the facility's admin can never change.

This is a fictional facility on a testnet, with labelled mock provider data and testnet USDC. The recorded runs are on [Recorded on Arc Testnet](/evidence).
