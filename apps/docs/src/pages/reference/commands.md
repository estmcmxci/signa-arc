---
title: "Commands"
description: "Every signa command, generated from the shipped command tree: arguments, options, environment variables, output fields and examples."
---

# Commands

Generated from the command tree `signa` ships, so it cannot drift from the binary. Every command in this release is read-only: none takes a key, and none sends a transaction.

Add `--json` for one JSON document on stdout, or `--schema --format json` for a command's JSON Schema. [For agents](/agents) describes the shared result shape and the error codes.

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
