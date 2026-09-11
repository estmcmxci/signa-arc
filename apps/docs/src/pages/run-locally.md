---
title: Run locally
description: signa and these docs run from a checkout of the repository. No package is published yet, so these are the local commands, and how to point signa at another manifest or RPC.
---

# Run locally

To put `signa` on your PATH instead of running it from here, see [Install](/install): the CLI builds into one self-contained package.

`signa` is not published to a package registry, so there is no install command yet. Everything runs from a checkout of the repository.

You need Node.js 24 and pnpm 10.17.1, the versions CI uses. Foundry is needed only for the repository's full check, not to run the CLI.

```bash
git clone https://github.com/estmcmxci/signa-arc.git
cd signa-arc
pnpm install --frozen-lockfile
```

## The CLI

```bash
pnpm signa --help
pnpm signa status
pnpm signa evidence show
```

`pnpm signa` runs the workspace CLI through `tsx`. Add `-s` when a program reads the output, so pnpm's own banner stays off stdout:

```bash
pnpm -s signa status --json
```

## Choosing a deployment and an RPC

By default `signa` uses the Arc Testnet manifest bundled with it, a copy of `deployments/arc-testnet.json`, and that manifest's RPC, `https://rpc.testnet.arc.network`. Each can be overridden, and the first of these that is set wins:

| Setting | Option | Environment variable | Default |
|---|---|---|---|
| Deployment manifest | `--manifest <path>` | `SIGNA_MANIFEST` | The bundled Arc Testnet manifest |
| RPC URL | `--rpc-url <url>` | `SIGNA_RPC_URL` | The manifest's `rpcUrl` |

```bash
pnpm signa status --manifest ./deployments/arc-testnet.json
```

A manifest named by an option or an environment variable must exist and validate: `signa` never falls back to another file. Results report which manifest was used, with its path and SHA-256. RPC URLs are redacted in output, so a key in the URL is not printed.

## These docs

```bash
pnpm docs:dev       # development server
pnpm docs:build     # static build into apps/docs/dist/public
pnpm docs:preview   # serve the static build locally
```
