---
title: "Install"
description: "signa is not published. Run it from a checkout, or build a self-contained tarball and install that, which puts signa on your PATH without the repository."
---

# Install

:::warning
**`signa` is not published to any registry.** There is no `npm install signa` to run, and any package by that name is not this one. The two ways below are the only ways to get it today.
:::

## From a checkout

The simplest option, and the one every other page uses. See [Run locally](/run-locally):

```bash
pnpm install
pnpm signa status
```

## As a self-contained package

The CLI builds into a single executable that carries everything it needs, so it runs without the repository, without a workspace, and without installing any dependency.

```bash
pnpm pack:cli
```

That writes `dist/signa-cli-<version>.tgz`. Install it from that path:

```bash
npm install --global ./dist/signa-cli-0.1.0.tgz
signa evidence show
```

Nothing is fetched from a registry: the tarball is the whole program.

### What is inside it

| | |
|---|---|
| Files | `dist/bin.js`, four evidence records, and `package.json` |
| Dependencies | None. The workspace packages, generated ABIs, deployment manifest, and incur, viem and zod are all bundled |
| Requires | Node 22 or later |
| Size | About 490 kB packed |

The four recorded runs on the [Evidence](/evidence) page ship inside the package, which is why `signa evidence show` works with no network at all.

### Updating

`signa --update` does nothing on purpose:

```json
{ "code": "UPDATE_FAILED", "message": "@signa/cli is not published, so signa cannot update itself. Reinstall it from source." }
```

It contacts no registry and runs no package manager. Rebuild and reinstall the tarball to move to a newer build.

### Removing it

```bash
npm uninstall --global @signa/cli
```

## Which commands need what

Nothing here needs a key to read. Only the commands that take `--account` can change anything, and they need a [Foundry](https://getfoundry.sh) keystore: see [Submit a credential](/guides/submit-a-credential).

| | Needs |
|---|---|
| `evidence show`, `credentials inspect` | Nothing. No network, no key |
| `status`, `facility show`, `coverage show`, `credentials list`, `draw simulate`, `tx show` | An RPC |
| `credentials submit`, `covenant sync`, `covenant restore`, `draw send` | An RPC, a keystore, and `cast` on your PATH |
