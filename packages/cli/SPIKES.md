# incur spikes: first P0 slice

Pinned: `incur` 0.5.1 (exact), with its own `z` (zod 4.4.3). Node 24.1.0, TypeScript 5.9.3.

This was verified against the installed package: its README, `dist/*.d.ts` and `dist/*.js`, and runs of this CLI. The installed skill (`~/.agents/skills/incur/SKILL.md`) is older than this version. Where the two disagree, this file describes 0.5.1.

## Parsing

| Behaviour | Pinned by |
|---|---|
| **Nested groups.** `Cli.create("evidence")` mounted with `cli.command(evidence)` gives `signa evidence show`. | `test/cli.test.ts`: help lists the implemented commands |
| **Kebab-case flags.** camelCase option keys become kebab-case flags: `rpcUrl` is `--rpc-url`. `--flag value` and `--flag=value` both parse. | `test/cli.test.ts`: the manifest resolves option, then SIGNA_MANIFEST |
| **No numeric coercion.** A `z.string()` option arrives verbatim: `1`, `0010.50`, `1e6` and `0.0000001` are never turned into numbers. The draw-amount rule (ERD C-06) can therefore parse them exactly. | `test/cli.test.ts`: decimal strings are never coerced |
| **Enum arguments.** Usage renders the values, as `signa evidence show [acceptance\|coverage-drop\|waiver\|restore]`. An unknown value fails `VALIDATION_ERROR`. | `test/cli.test.ts`, `test/evidence.test.ts` |
| **Common options.** incur has both `globals`, a CLI-wide schema parsed before the command, and per-command `options`, and both work. Chosen: per-command `options` from one shared schema, so `evidence show --help` does not list `--manifest` and `--rpc-url`, which do not apply to it. | `src/cli.ts` |
| **Environment.** A per-command `env` schema reads `SIGNA_MANIFEST` and `SIGNA_RPC_URL`, and `serve(argv, { env })` injects them in tests. | `test/cli.test.ts` |

## Output and errors

- **`--json`** prints exactly the command's data, as one pretty-printed JSON document. Without it, output is TOON; in a terminal it is formatted for people.
- **The envelope flag is `--full-output`**, which prints `{ ok, data, meta: { command, duration } }`. The skill calls it `--verbose`, but 0.5.1 has no such flag: it answers `Unknown flag: --verbose`, code `UNKNOWN`, exit 1. `meta.duration` varies between runs, so Signa's stable shape is `data`, versioned by `schemaVersion: 1`.
- **Errors print to stdout.** `c.error({ code, message, retryable })` prints `{ code, message, retryable }`, which is one JSON document under `--json`, and exits 1, or `exitCode` if set. incur's own errors are `COMMAND_NOT_FOUND` (with a `cta`), `VALIDATION_ERROR` (with `fieldErrors`) and `UNKNOWN` (an unknown flag or an uncaught throw). None goes to stderr; stderr carries only deprecation warnings.
- **Exit codes.** Success never calls `exit`, so the exit code is 0. Every error exits 1 unless `exitCode` says otherwise. Signa uses 1 for all of its codes, and consumers branch on `code`.
- **TTY detection** uses `process.stdout.isTTY`. `serve()` can override `stdout`, `exit` and `env`, but not stderr.
- **Limitation: group help ignores `--json`.** `signa evidence` and `signa evidence --json` print help text. Help is not a command result, so this is documented rather than worked around.
- **Run through pnpm with `-s`.** `pnpm signa …` prints pnpm's own script banner on stdout first, and `pnpm -s signa … --json` suppresses it. The docs use `-s` wherever output is parsed.

## Discovery

- **Import-safe definition.** `src/cli.ts` builds the command tree and `src/bin.ts` calls `serve()`. Importing `cli.ts` in a fresh process prints nothing and creates no RPC client; `test/cli.test.ts` checks this.
- **Command manifests.**
  - `--llms` prints a Markdown table of commands.
  - `--llms --format json` prints `{ version: "incur.v1", commands: [{ name, description }] }`.
  - `--llms-full` adds the schemas.
  - `<command> --schema --format json` prints JSON Schema for a command's options, env and output.

  Docs tooling can read all of these without running a handler. This slice's only generated page, Evidence, is built from the evidence module rather than from any handler.
- **Write surfaces built into every incur CLI:**
  - **`--update`** runs `npm|pnpm|bun add --global <package>@latest` for whichever `package.json` above the executing script declares the `signa` bin. It does this **even with `update: false`**, which only turns off background checks (`dist/Cli.js`, around line 360, and `dist/internal/update.js`).

    In P0, `@signa/cli` declares no bin, so `--update` fails with `UPDATE_FAILED`. `test/cli.test.ts` checks that, and fails if a bin appears.

    **P2 decision:** before adding the bin, set `update: { package: "<owned name>" }` or a custom `install` that refuses.
  - **`mcp add` and `skills add`** write agent configuration when a user runs them, and **`--mcp`** serves every command as an MCP tool. A command opts out with `mcp: false` (`dist/Mcp.js`, `collectToolEntries`). Every P0 command is read-only; every P1 write command must set `mcp: false` until an MCP write policy exists.
  - **`cli.fetch`** (HTTP, and MCP over HTTP) exists only when called, and Signa never calls it.
- **Broken type declarations.** Line 360 of incur 0.5.1's `dist/Cli.d.ts` references `_args` and `_options`, which are never declared (TS2304). `skipLibCheck` contains this in `packages/cli/tsconfig.json` alone. The root configuration is unchanged, and the CLI's own sources are still checked strictly.

# Foundry keystore spike: before P1

Pinned: Foundry `cast` 1.5.0-stable (commit `1c578544`). Run against a local Anvil
(`--chain-id 5042002`, port 8546) on 2026-09-11. **No transaction was sent to Arc.**

Every run used a throwaway keystore created under `mktemp -d` and deleted afterwards, holding
Anvil's first published account (`0xf39F…2266`). The user's own
`~/.foundry/keystores` was listed before and after each run and never read or written.
ERD C-13 stands: a user's local keystores are never part of tests.

## What the tooling does

| Question | Answer | How it was shown |
|---|---|---|
| Named address lookup | `cast wallet address --keystore <path>` returns the address | matched `0xf39F…2266` exactly |
| Signing | `cast wallet sign` signs messages and EIP-712 typed data (`--data --from-file`) | 65-byte signature; `cast wallet verify` accepts the signer and rejects a different address |
| Sending | `cast send --async` prints only the transaction hash and exits | see hash capture below |
| Password file | `--password-file <path>`, or `ETH_PASSWORD` holding the *path* | address lookup, signing and sending all succeeded unattended |
| Wrong password | exit **1**, `Failed to decrypt keystore "<path>"` | no key or password material in the output |
| Unreachable RPC | exit **1** | `error sending request for url` |

## The three findings that shape the adapter

**1. Hash capture before any receipt wait is available, and required.**
`cast send --async` returns the hash and exits 0 without waiting. With mining disabled, the hash was
captured while the transaction was still in the mempool (`cast tx` showed `blockNumber=None`),
`cast receipt --async` exited 1 with `tx not found`, and after mining the *same* hash reconciled to
block 6, `status 1`. So: send with `--async`, journal the hash, then reconcile separately. A plain
`cast send` only prints once the receipt arrives, so a timeout there would lose the hash.

**2. A failed receipt does not make the signer subprocess fail.**
Sending to an always-reverting contract with an explicit `--gas-limit` (skipping estimation)
**broadcast the transaction, and `cast send` exited 0 while the receipt carried `status 0x0`.**
Success must therefore be decided by the receipt status, never by the subprocess exit code.
This confirms ERD A-CLI-07 against the real tool.

Conversely, *without* `--gas-limit` the same send was refused before broadcast: gas estimation
failed (`execution reverted`), `cast` exited 1, and the account nonce was unchanged (7 → 7), so
nothing was broadcast. That is the `broadcast: false` refusal path. The adapter passes no
`--gas-limit`, keeping estimation as a last-line refusal behind our own simulation.

**3. `--account <name>` only ever resolves `~/.foundry/keystores`.**
`FOUNDRY_KEYSTORES_DIR`, `ETH_KEYSTORE_DIR` and `FOUNDRY_KEYSTORE_DIR` were all ignored; each still
resolved to the default directory. `ETH_KEYSTORE`, holding a full path, works.
**Decision:** the CLI keeps `--account <name>` as its own interface and resolves the name itself
against a keystore directory, defaulting to `~/.foundry/keystores` and overridable for tests, then
passes `--keystore <path>` to `cast`. Named lookup for humans, temp keystores for tests, and no
dependence on an undocumented environment variable.

**4. The keystore file carries no address.**
`cast wallet import` writes only `crypto`, `id` and `version` (scrypt KDF); there is no `address`
field. Reading the signer's address therefore *requires* the password. The send sequence is
unlock → address → verify chain, facility and role → simulate → send, and the password must be
resolvable before any role check, not just at broadcast.

## TTY, pipes and cancellation

- **A prompt exists.** On a pty, `cast` prints `Enter keystore password:`.
- **It never prompts forever in a pipe.** With stdin closed, and with a pipe that never delivers,
  `cast` exited **1** immediately with `Device not configured (os error 6)`; it opens the terminal
  directly and fails when there is none. ERD C-14 is satisfied by the tool itself.
- **Not verified: clean interruption of an interactive prompt.** Three harnesses were tried. A
  literal `0x03` byte through `script` is forwarded as data rather than raised as `SIGINT`, and
  driving `script` from a fifo fails with `tcgetattr/ioctl: Operation not supported on socket`.
  No key material leaked in any attempt, but the cancellation path itself remains unproven here.
  **Bounded decision:** no Signa contract depends on interactive prompting. Unattended use requires
  an explicitly configured password file, which is fully verified above; the prompt is left to
  `cast` for humans at a real terminal. Revisit only if an interactive contract is ever added.

## Not used

`--unsafe-password` and `--private-key` put secrets on the command line, where `ps` can read them.
They appear in this file only because the spike used `--unsafe-password` to *create* a throwaway
keystore. The CLI never offers a raw-key option and never passes a password as an argument.
The scenario keystore decryption was not read or copied.
