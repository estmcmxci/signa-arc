# Signa Covenant: the Privy policy on the facility admin wallet

Chain 5042002, explorer https://testnet.arcscan.app. Checked 2026-09-10T22:13:56.817Z against the live Privy API. Outcome: **verified**.

Nothing was broadcast. Every probe carries nonce 1,000,000,000 and a fee cap of 1 wei, so none could ever be mined.

| | |
|---|---|
| Policy | `y5x9g8gglndai2hosm47zvxf`, "Signa admin: createWaiver on the vault only" |
| Owner | key quorum `pbf1jtt1knpsl30eyp0z163t`: changing, deleting or detaching it takes both approvers |
| Governs | Privy wallet `zc9i4be5osru1qyzfci337mi`, the facility admin [0x55C4DD3770A44695735717CB7b7005AC7dE9edA1](https://testnet.arcscan.app/address/0x55C4DD3770A44695735717CB7b7005AC7dE9edA1). Its policies: `["y5x9g8gglndai2hosm47zvxf"]` |
| Allows | ALLOW `eth_signTransaction` when `ethereum_transaction.chain_id eq 5042002`, `ethereum_transaction.to eq 0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51`, `ethereum_transaction.value eq 0x0`, `ethereum_calldata.function_name eq createWaiver` |
| Denies | everything else: Privy denies whatever no rule allows |
| Does not cap | duration: Privy's calldata comparator never matches integers narrower than uint64, and duration is uint32. The contract enforces `maxWaiverDuration`, and the service refuses a longer waiver before proposing it. |

## Transaction controls

Each signed by both approvers through `POST /v1/wallets/{id}/rpc`.

| Control | Varies | Call | To | Chain | Expected | Actual | Privy's answer |
|---|---|---|---|---|---|---|---|
| createWaiver on the facility vault | nothing: the one allowed call | `createWaiver(3600, 0xdbf5916755ac680101ed91421d71dc301390379006370356666cfe3a7fcf4166)` | `0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51` | 5042002 | allowed | allowed | signed; recovers to `0x55C4DD3770A44695735717CB7b7005AC7dE9edA1` |
| revokeWaiver on the facility vault | another function | `revokeWaiver()` | `0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51` | 5042002 | denied | denied | 400 `{"error":"RPC request denied due to policy violation","code":"policy_violation"}` |
| createWaiver on the FacilityRegistry | another contract | `createWaiver(3600, 0xdbf5916755ac680101ed91421d71dc301390379006370356666cfe3a7fcf4166)` | `0xB54fe913C4a7dE73Bc285338dCbb384AEec5e448` | 5042002 | denied | denied | 400 `{"error":"RPC request denied due to policy violation","code":"policy_violation"}` |
| createWaiver on the vault, chain 1 | another chain | `createWaiver(3600, 0xdbf5916755ac680101ed91421d71dc301390379006370356666cfe3a7fcf4166)` | `0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51` | 1 | denied | denied | 400 `{"error":"RPC request denied due to policy violation","code":"policy_violation"}` |
| createWaiver above maxWaiverDuration | duration: the policy cannot cap uint32, so the contract and pre-validation do | `createWaiver(2592000, 0xdbf5916755ac680101ed91421d71dc301390379006370356666cfe3a7fcf4166)` | `0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51` | 5042002 | allowed | allowed | signed; recovers to `0x55C4DD3770A44695735717CB7b7005AC7dE9edA1` |

## Governance controls

| Attempt | How | Expected | Actual | Privy's answer |
|---|---|---|---|---|
| Change the wallet's policies with one approver's signature | PATCH the wallet with its current policy_ids, signed by the risk officer alone: a no-op if accepted | refused | refused | 401 `{"error":"Number of signatures in `privy-authorization-signature` header does not match the wallet's authorization threshold.","code":"invalid_data"}` |
| Change the policy with the app secret alone | PATCH the policy with its current name and no signature: a no-op if accepted | refused | refused | 401 `{"error":"Missing `privy-authorization-signature` header or no signatures provided. Learn more about authorization signatures here: https://docs.privy.io/api-reference/authorization-signatures","code":"invalid_data"}` |

## Checks

- walletOwnerIsTheKeyQuorum: yes
- policyIsOwnedByTheKeyQuorum: yes
- policyIsExactlyTheExpectedOne: yes
- walletIsGovernedByThisPolicyAlone: yes
- everyTransactionControlAsExpected: yes
- changingThePolicyTakesBothApprovers: yes
