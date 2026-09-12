---
title: "Commands"
description: "Every signa command, generated from the shipped command tree: arguments, options, environment variables, output fields and examples."
---

# Commands

Generated from the command tree `signa` ships, so it cannot drift from the binary.

Most commands only read, and need no key. The commands that take `--account` sign with a Foundry keystore and broadcast exactly one transaction: they are marked below, and they are the only ones that can move anything.

Add `--json` for one JSON document on stdout, or `--schema --format json` for a command's JSON Schema. [For agents](/agents) describes the shared result shape and the error codes.

## signa covenant restore

Simulate and send CovenantVault.restoreCompliance, which returns a cured facility to COMPLIANT

```bash
pnpm signa covenant restore --account <account> [options]
```

**Signs and sends one transaction.** It is simulated first as the named signer; if that refuses, nothing is broadcast. The hash is recorded in the operation journal before any receipt wait, and success is decided by the receipt.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |
| `--account` | `string` | yes | Keystore name to sign with, resolved in SIGNA_KEYSTORE_DIR or ~/.foundry/keystores |
| `--password-file` | `string` | no | File holding the keystore password. Without it, cast prompts, which needs a terminal |
| `--timeout` | `string` | no | Whole seconds to wait for a receipt before reporting the transaction pending. Default 120 |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |
| `SIGNA_KEYSTORE_DIR` | `string` | Directory --account names resolve in. Default ~/.foundry/keystores |
| `SIGNA_PASSWORD_FILE` | `string` | File holding the keystore password, used when --password-file is not given |
| `SIGNA_JOURNAL` | `string` | Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl |
| `XDG_STATE_HOME` | `string` | Base directory for the default operation journal location |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"transaction"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` | The preflight block, at which the action was simulated |
| `account` | `object` |  |
| `broadcast` | `true` | A refused action never reaches this result: it exits nonzero as ACTION_REFUSED |
| `transaction` | `object` |  |
| `journal` | `object` |  |
| `scope` | `string` |  |
| `request` | `object` |  |
| `covenant` | `object` |  |
| `evaluation` | `object` |  |

### Examples

- Return a cured facility to COMPLIANT:

```bash
pnpm signa covenant restore --account operator
```

## signa covenant sync

Simulate and send CovenantVault.syncCovenant, which records the covenant state the engine evaluates now

```bash
pnpm signa covenant sync --account <account> [options]
```

**Signs and sends one transaction.** It is simulated first as the named signer; if that refuses, nothing is broadcast. The hash is recorded in the operation journal before any receipt wait, and success is decided by the receipt.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |
| `--account` | `string` | yes | Keystore name to sign with, resolved in SIGNA_KEYSTORE_DIR or ~/.foundry/keystores |
| `--password-file` | `string` | no | File holding the keystore password. Without it, cast prompts, which needs a terminal |
| `--timeout` | `string` | no | Whole seconds to wait for a receipt before reporting the transaction pending. Default 120 |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |
| `SIGNA_KEYSTORE_DIR` | `string` | Directory --account names resolve in. Default ~/.foundry/keystores |
| `SIGNA_PASSWORD_FILE` | `string` | File holding the keystore password, used when --password-file is not given |
| `SIGNA_JOURNAL` | `string` | Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl |
| `XDG_STATE_HOME` | `string` | Base directory for the default operation journal location |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"transaction"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` | The preflight block, at which the action was simulated |
| `account` | `object` |  |
| `broadcast` | `true` | A refused action never reaches this result: it exits nonzero as ACTION_REFUSED |
| `transaction` | `object` |  |
| `journal` | `object` |  |
| `scope` | `string` |  |
| `request` | `object` |  |
| `covenant` | `object` |  |
| `evaluation` | `object` | At the receipt block |

### Examples

- Record the covenant state the engine evaluates now:

```bash
pnpm signa covenant sync --account operator
```

## signa coverage show

Show the engine's evaluation, gross and counted coverage, and the eligibility verdict on each credential, all read at one block

```bash
pnpm signa coverage show [options]
```

Reads only: no key, no transaction.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"report"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `evaluation` | `object` | CoverageEngine.evaluate at the block |
| `exposure` | `object` |  |
| `hedges` | `array of object` |  |
| `covenant` | `object` | The vault's stored state, reported separately from the evaluation |
| `explanation` | `string` |  |
| `scope` | `string` |  |

### Examples

- Evaluate coverage on Arc Testnet now:

```bash
pnpm signa coverage show
```

## signa credentials inspect

Check a signed credential envelope offline: its format, domain, facility, digest and recovered signer. No RPC, no key

```bash
pnpm signa credentials inspect <file> [options]
```

Reads only: no key, no transaction, and no RPC.

### Arguments

| Argument | Type | Description |
|---|---|---|
| `file` | `string` | A signed credential envelope, as JSON |

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"report"` |  |
| `dataMode` | `"offline"` |  |
| `context` | `object` | No block: nothing was read from a chain |
| `envelope` | `object` |  |
| `established` | `array of string` |  |
| `notEstablished` | `array of string` |  |

### Examples

- Inspect an envelope against the bundled deployment:

```bash
pnpm signa credentials inspect ./hedge-envelope.json
```

## signa credentials list

List the current exposure and active hedge assertions, with sequences and age at the report block

```bash
pnpm signa credentials list [options]
```

Reads only: no key, no transaction.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"report"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `credentialMaxAgeSeconds` | `number` |  |
| `exposure` | `object \| null` |  |
| `hedges` | `array of object` |  |
| `note` | `string` |  |

### Examples

- List the credentials the registry holds for the facility:

```bash
pnpm signa credentials list
```

## signa credentials submit

Submit a signed credential envelope to the registry: checked offline, checked against the current sequence, simulated, then sent as one transaction

```bash
pnpm signa credentials submit <file> --account <account> [options]
```

**Signs and sends one transaction.** It is simulated first as the named signer; if that refuses, nothing is broadcast. The hash is recorded in the operation journal before any receipt wait, and success is decided by the receipt.

### Arguments

| Argument | Type | Description |
|---|---|---|
| `file` | `string` | A signed credential envelope, as JSON |

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |
| `--account` | `string` | yes | Keystore name to sign with, resolved in SIGNA_KEYSTORE_DIR or ~/.foundry/keystores |
| `--password-file` | `string` | no | File holding the keystore password. Without it, cast prompts, which needs a terminal |
| `--timeout` | `string` | no | Whole seconds to wait for a receipt before reporting the transaction pending. Default 120 |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |
| `SIGNA_KEYSTORE_DIR` | `string` | Directory --account names resolve in. Default ~/.foundry/keystores |
| `SIGNA_PASSWORD_FILE` | `string` | File holding the keystore password, used when --password-file is not given |
| `SIGNA_JOURNAL` | `string` | Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl |
| `XDG_STATE_HOME` | `string` | Base directory for the default operation journal location |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"transaction"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` | The preflight block, at which the action was simulated |
| `account` | `object` |  |
| `broadcast` | `true` | A refused action never reaches this result: it exits nonzero as ACTION_REFUSED |
| `transaction` | `object` |  |
| `journal` | `object` |  |
| `scope` | `string` |  |
| `request` | `object` |  |
| `accepted` | `object` | What the registry holds at the receipt block |
| `eligibility` | `object` | Read at the receipt block. Acceptance by the registry is not eligibility for coverage |
| `note` | `string` |  |

### Examples

- Submit a hedge credential the issuer signed:

```bash
pnpm signa credentials submit ./hedge-envelope.json --account operator
```

## signa draw send

Simulate CovenantVault.draw as the facility's operator, then send it once. This moves funds

```bash
pnpm signa draw send --account <account> --amount <amount> [options]
```

**Signs and sends one transaction.** It is simulated first as the named signer; if that refuses, nothing is broadcast. The hash is recorded in the operation journal before any receipt wait, and success is decided by the receipt.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |
| `--account` | `string` | yes | Keystore name to sign with, resolved in SIGNA_KEYSTORE_DIR or ~/.foundry/keystores |
| `--password-file` | `string` | no | File holding the keystore password. Without it, cast prompts, which needs a terminal |
| `--timeout` | `string` | no | Whole seconds to wait for a receipt before reporting the transaction pending. Default 120 |
| `--amount` | `string` | yes | USDC to draw, as a decimal string: 1 is one USDC, 1000000 units |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |
| `SIGNA_KEYSTORE_DIR` | `string` | Directory --account names resolve in. Default ~/.foundry/keystores |
| `SIGNA_PASSWORD_FILE` | `string` | File holding the keystore password, used when --password-file is not given |
| `SIGNA_JOURNAL` | `string` | Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl |
| `XDG_STATE_HOME` | `string` | Base directory for the default operation journal location |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"transaction"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` | The preflight block, at which the action was simulated |
| `account` | `object` |  |
| `broadcast` | `true` | A refused action never reaches this result: it exits nonzero as ACTION_REFUSED |
| `transaction` | `object` |  |
| `journal` | `object` |  |
| `scope` | `string` |  |
| `request` | `object` |  |
| `vault` | `object` | At the receipt block |
| `covenant` | `object` | At the receipt block; draw syncs the covenant before it proceeds |

### Examples

- Draw one USDC as the operator:

```bash
pnpm signa draw send --amount 1 --account operator
```

## signa draw simulate

Simulate CovenantVault.draw as the facility's operator at one block, and decode a refusal. Nothing is sent

```bash
pnpm signa draw simulate --amount <amount> [options]
```

Reads only: no key, no transaction.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |
| `--amount` | `string` | yes | USDC to draw, as a decimal string: 1 is one USDC, 1000000 units |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"simulation"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `request` | `object` |  |
| `allowed` | `boolean` |  |
| `outcome` | `"permitted" \| "refused"` |  |
| `refusal` | `object` |  |
| `evaluation` | `object` |  |
| `scope` | `string` |  |

### Examples

- Simulate drawing one USDC:

```bash
pnpm signa draw simulate --amount 1
```

- Simulate drawing half a USDC:

```bash
pnpm signa draw simulate --amount 0.5
```

## signa evidence show

Show recorded evidence: the acceptance run, the coverage drop, the quorum waiver and the restoration. No RPC, no key

```bash
pnpm signa evidence show [record]
```

Reads only: no key, no transaction, and no RPC.

### Arguments

| Argument | Type | Description |
|---|---|---|
| `record` | `"acceptance" \| "coverage-drop" \| "waiver" \| "restore"` | One record to show step by step. Omit it for a summary of every record |

### Examples

- Summarise every recorded run:

```bash
pnpm signa evidence show
```

- Show the A-1 to A-4 acceptance steps:

```bash
pnpm signa evidence show acceptance
```

- Show the quorum-approved waiver:

```bash
pnpm signa evidence show waiver
```

## signa facility show

Show the frozen policy, role addresses, vault balance and principal, stored covenant state and waiver, all read at one block

```bash
pnpm signa facility show [options]
```

Reads only: no key, no transaction.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"report"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `policy` | `object` |  |
| `roles` | `object` |  |
| `vault` | `object` |  |
| `covenant` | `object` |  |
| `manifestDifferences` | `array of object` | Where the chain disagrees with the manifest |
| `scope` | `string` |  |

### Examples

- Show the Arc Testnet facility:

```bash
pnpm signa facility show
```

## signa status

Check the manifest and live connectivity: chain, contract code and facility wiring, all read at one block

```bash
pnpm signa status [options]
```

Reads only: no key, no transaction.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"report"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `ready` | `true` |  |
| `checks` | `array of object` |  |
| `scope` | `string` |  |

### Examples

- Check the bundled Arc Testnet deployment:

```bash
pnpm signa status
```

- Check a manifest file:

```bash
pnpm signa status --manifest ./deployments/arc-testnet.json
```

## signa tx show

Report whether a transaction is pending, mined successfully, or mined and reverted, with its decoded events or revert reason

```bash
pnpm signa tx show <hash> [options]
```

Reads only: no key, no transaction.

### Arguments

| Argument | Type | Description |
|---|---|---|
| `hash` | `string` | Transaction hash, 0x and 64 hex characters |

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"report"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `hash` | `string` |  |
| `state` | `"mined" \| "pending" \| "unknown"` |  |
| `status` | `"success" \| "reverted" \| null` | Null while pending or unknown |
| `transaction` | `object \| null` |  |
| `pending` | `object \| null` |  |
| `revert` | `object \| null` | Recovered by replaying the call at the receipt block. Null when it succeeded, or when no reason is disclosed |
| `undecodableRevert` | `string \| null` | Revert data no known contract error decodes. Never guessed at |
| `scope` | `string` |  |

### Examples

- Reconcile a transaction reported pending:

```bash
pnpm signa tx show 0x38b3fd96e8a065030cdc1e551394e8aa9784e59edd0f225544614069e099d414
```

## signa waiver approve

Approve the proposal in flight as one of the two quorum members, signing a freshly stamped payload

```bash
pnpm signa waiver approve --role <role> [options]
```

**Changes a proposal, not the chain.** It authorizes a Privy intent; nothing reaches Arc until `signa waiver broadcast`. No keystore is involved, and Privy credentials come from the environment, never a flag.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |
| `--role` | `"risk-officer" \| "treasury-lead"` | yes | Which approver key signs |
| `--intent` | `string` | no | The proposal to act on. Defaults to the one in flight, since only one can be |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |
| `PRIVY_APP_ID` | `string` | Privy app id. Required by every waiver command except status |
| `PRIVY_APP_SECRET` | `string` | Privy app secret. Read from the environment only, never from a flag, which would land in shell history |
| `PRIVY_API_URL` | `string` | Privy API base URL. Defaults to https://api.privy.io |
| `PRIVY_WALLET_ID` | `string` | Overrides the quorum wallet the manifest names |
| `PRIVY_APPROVER_KEY_DIR` | `string` | Approver key directory. Defaults to ~/.signa-privy-waiver/approvers |
| `PRIVY_WAIVER_STORE` | `string` | Where proposals are recorded. Defaults to ~/.signa-privy-waiver/actions.json |
| `SIGNA_JOURNAL` | `string` | Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl |
| `XDG_STATE_HOME` | `string` | Base directory for the default operation journal location |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"proposal"` | Not a chain transaction: a Privy intent, which only broadcast puts on chain |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `proposal` | `object` |  |
| `store` | `object` |  |
| `scope` | `string` |  |
| `approved` | `object` |  |
| `remaining` | `number` | Approvals still needed before Privy will sign |

### Examples

- Approve as the risk officer:

```bash
pnpm signa waiver approve --role risk-officer
```

## signa waiver broadcast

Broadcast the transaction Privy signed once both approvals are in, and decide by the receipt

```bash
pnpm signa waiver broadcast [options]
```

**Broadcasts one transaction**, the one the key quorum already signed. Its hash is recorded before any receipt wait, and success is decided by the receipt, never by the signing service.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |
| `--intent` | `string` | no | The proposal to act on. Defaults to the one in flight, since only one can be |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |
| `PRIVY_APP_ID` | `string` | Privy app id. Required by every waiver command except status |
| `PRIVY_APP_SECRET` | `string` | Privy app secret. Read from the environment only, never from a flag, which would land in shell history |
| `PRIVY_API_URL` | `string` | Privy API base URL. Defaults to https://api.privy.io |
| `PRIVY_WALLET_ID` | `string` | Overrides the quorum wallet the manifest names |
| `PRIVY_APPROVER_KEY_DIR` | `string` | Approver key directory. Defaults to ~/.signa-privy-waiver/approvers |
| `PRIVY_WAIVER_STORE` | `string` | Where proposals are recorded. Defaults to ~/.signa-privy-waiver/actions.json |
| `SIGNA_JOURNAL` | `string` | Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl |
| `XDG_STATE_HOME` | `string` | Base directory for the default operation journal location |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"transaction"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `proposal` | `object` |  |
| `broadcast` | `true` |  |
| `transaction` | `object` |  |
| `waiverCreated` | `object \| null` | The event the receipt must carry, checked against this facility and the stated reason |
| `journal` | `object` |  |
| `scope` | `string` |  |

### Examples

- Broadcast the approved waiver:

```bash
pnpm signa waiver broadcast
```

## signa waiver propose

Propose a waiver as a Privy intent, after checking the contract would accept it. Nothing is signed or sent

```bash
pnpm signa waiver propose --duration <duration> --reason <reason> [options]
```

**Changes a proposal, not the chain.** It authorizes a Privy intent; nothing reaches Arc until `signa waiver broadcast`. No keystore is involved, and Privy credentials come from the environment, never a flag.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |
| `--duration` | `string` | yes | How long the waiver lasts, in whole seconds. Rehearse with 300: a waiver cannot be revoked |
| `--reason` | `string` | yes | Why the covenant is being overridden. Only its keccak256 goes on chain |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |
| `PRIVY_APP_ID` | `string` | Privy app id. Required by every waiver command except status |
| `PRIVY_APP_SECRET` | `string` | Privy app secret. Read from the environment only, never from a flag, which would land in shell history |
| `PRIVY_API_URL` | `string` | Privy API base URL. Defaults to https://api.privy.io |
| `PRIVY_WALLET_ID` | `string` | Overrides the quorum wallet the manifest names |
| `PRIVY_APPROVER_KEY_DIR` | `string` | Approver key directory. Defaults to ~/.signa-privy-waiver/approvers |
| `PRIVY_WAIVER_STORE` | `string` | Where proposals are recorded. Defaults to ~/.signa-privy-waiver/actions.json |
| `SIGNA_JOURNAL` | `string` | Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl |
| `XDG_STATE_HOME` | `string` | Base directory for the default operation journal location |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"proposal"` | Not a chain transaction: a Privy intent, which only broadcast puts on chain |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `proposal` | `object` |  |
| `store` | `object` |  |
| `scope` | `string` |  |
| `willSign` | `string` | Exactly what each approver will authorize |

### Examples

- Propose a five-minute waiver:

```bash
pnpm signa waiver propose --duration 300 --reason Hedge rolled early; replacement confirmed for value tomorrow
```

## signa waiver reject

Reject the proposal in flight, releasing the wallet nonce it pinned so a later waiver can be proposed

```bash
pnpm signa waiver reject [options]
```

**Changes a proposal, not the chain.** It authorizes a Privy intent; nothing reaches Arc until `signa waiver broadcast`. No keystore is involved, and Privy credentials come from the environment, never a flag.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |
| `--intent` | `string` | no | The proposal to act on. Defaults to the one in flight, since only one can be |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |
| `PRIVY_APP_ID` | `string` | Privy app id. Required by every waiver command except status |
| `PRIVY_APP_SECRET` | `string` | Privy app secret. Read from the environment only, never from a flag, which would land in shell history |
| `PRIVY_API_URL` | `string` | Privy API base URL. Defaults to https://api.privy.io |
| `PRIVY_WALLET_ID` | `string` | Overrides the quorum wallet the manifest names |
| `PRIVY_APPROVER_KEY_DIR` | `string` | Approver key directory. Defaults to ~/.signa-privy-waiver/approvers |
| `PRIVY_WAIVER_STORE` | `string` | Where proposals are recorded. Defaults to ~/.signa-privy-waiver/actions.json |
| `SIGNA_JOURNAL` | `string` | Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl |
| `XDG_STATE_HOME` | `string` | Base directory for the default operation journal location |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"proposal"` | Not a chain transaction: a Privy intent, which only broadcast puts on chain |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `proposal` | `object` |  |
| `store` | `object` |  |
| `scope` | `string` |  |

### Examples

- Reject the proposal in flight:

```bash
pnpm signa waiver reject
```

## signa waiver status

Report whether the contract would accept a waiver now, and every reason it would refuse one

```bash
pnpm signa waiver status [options]
```

Reads only: no key, no transaction.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `--manifest` | `string` | no | Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest |
| `--rpc-url` | `string` | no | RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl |

### Environment variables

| Variable | Type | Description |
|---|---|---|
| `SIGNA_MANIFEST` | `string` | Deployment manifest file, used when --manifest is not given |
| `SIGNA_RPC_URL` | `string` | RPC URL, used when --rpc-url is not given |
| `PRIVY_APP_ID` | `string` | Privy app id. Required by every waiver command except status |
| `PRIVY_APP_SECRET` | `string` | Privy app secret. Read from the environment only, never from a flag, which would land in shell history |
| `PRIVY_API_URL` | `string` | Privy API base URL. Defaults to https://api.privy.io |
| `PRIVY_WALLET_ID` | `string` | Overrides the quorum wallet the manifest names |
| `PRIVY_APPROVER_KEY_DIR` | `string` | Approver key directory. Defaults to ~/.signa-privy-waiver/approvers |
| `PRIVY_WAIVER_STORE` | `string` | Where proposals are recorded. Defaults to ~/.signa-privy-waiver/actions.json |
| `SIGNA_JOURNAL` | `string` | Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl |
| `XDG_STATE_HOME` | `string` | Base directory for the default operation journal location |

### Output

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` |  |
| `kind` | `"report"` |  |
| `dataMode` | `"live"` |  |
| `context` | `object` |  |
| `wouldAccept` | `boolean` | Whether createWaiver would be accepted now. A refusal is an answer, so this exits 0 either way |
| `refusals` | `array of string` | Every reason the contract would refuse a waiver of any duration. Empty when it would accept one |
| `covenant` | `object` |  |
| `coverage` | `object` | A fresh evaluation, because createWaiver syncs before it checks |
| `maxWaiverDurationSeconds` | `number` |  |
| `scope` | `string` |  |

### Examples

- Check whether a waiver could be created now:

```bash
pnpm signa waiver status
```
