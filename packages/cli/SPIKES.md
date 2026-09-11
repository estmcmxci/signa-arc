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
