import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Cli, z } from "incur";

import { SIGNA_CLI_VERSION, SIGNA_PACKAGE_NAME, createSignaCli } from "../src/cli.ts";
import { REPO_ROOT, onlyJson, runSigna } from "./helpers.ts";

const deployedBytes = readFileSync(new URL("deployments/arc-testnet.json", REPO_ROOT));

function manifestFile(mutate?: (manifest: Record<string, any>) => void, raw?: string): string {
  const directory = mkdtempSync(join(tmpdir(), "signa-manifest-"));
  const path = join(directory, "manifest.json");
  const manifest = JSON.parse(deployedBytes.toString("utf8"));
  mutate?.(manifest);
  writeFileSync(path, raw ?? JSON.stringify(manifest, null, 2));
  return path;
}

test("importing the command definition runs nothing: no argv, no RPC client, no output", () => {
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", "const m = await import('./src/cli.ts'); process.stdout.write(typeof m.default.serve);"],
    { cwd: new URL("../", import.meta.url), encoding: "utf8", env: { ...process.env, SIGNA_RPC_URL: "http://127.0.0.1:9" } },
  );
  assert.equal(output, "function");
  assert.doesNotThrow(() =>
    createSignaCli({
      publicClient: () => {
        throw new Error("no command should create a client while the tree is built");
      },
    }),
  );
});

test("help lists the implemented commands, and nothing that is only specified", async () => {
  const root = await runSigna(["--help"]);
  assert.equal(root.exitCode, 0);
  assert.match(root.stdout, /status\s+Check the manifest and live connectivity/);
  assert.match(root.stdout, /evidence\s+Recorded evidence from Arc Testnet: past transactions, not current state/);
  for (const group of ["facility", "coverage", "credentials", "draw", "covenant", "tx", "waiver"]) {
    assert.match(root.stdout, new RegExp(`^\\s+${group}\\s`, "m"), group);
  }
  // Repayment and deposit approval orchestration are later work, and must not appear.
  for (const unimplemented of ["repay", "deposit"]) {
    assert.doesNotMatch(root.stdout, new RegExp(`^\\s+${unimplemented}\\s`, "m"), `${unimplemented} is later work`);
  }
  const credentialsHelp = await runSigna(["credentials", "--help"]);
  assert.match(credentialsHelp.stdout, /^\s+inspect\s/m);
  assert.match(credentialsHelp.stdout, /^\s+list\s/m);
  assert.match(credentialsHelp.stdout, /^\s+submit\s/m);
  const drawHelp = await runSigna(["draw", "--help"]);
  assert.match(drawHelp.stdout, /^\s+simulate\s/m);
  assert.match(drawHelp.stdout, /^\s+send\s/m);
  const status = await runSigna(["status", "--help"]);
  assert.match(status.stdout, /--manifest <string>/);
  assert.match(status.stdout, /--rpc-url <string>/);
  const show = await runSigna(["evidence", "show", "--help"]);
  assert.match(show.stdout, /Usage: signa evidence show \[acceptance\|coverage-drop\|waiver\|restore\]/, "incur renders an enum argument's values");
  assert.equal(root.rpcUrls.length + status.rpcUrls.length + show.rpcUrls.length, 0, "help never creates an RPC client");
});

test("status --json prints one JSON document: live data, bundled provenance, one block", async () => {
  const run = await runSigna(["status", "--json"]);
  assert.equal(run.exitCode, 0);
  const result = onlyJson(run);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, "report");
  assert.equal(result.dataMode, "live");
  assert.equal(result.ready, true);
  assert.deepEqual(result.context.manifest, { source: "bundled", copyOf: "deployments/arc-testnet.json" });
  assert.deepEqual(result.context.rpc, { url: "https://rpc.testnet.arc.network", source: "manifest" });
  assert.equal(result.context.chainId, 5_042_002);
  assert.equal(result.context.vault, "0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51");
  assert.equal(result.context.block.number, "61500000");
  assert.equal(result.checks.length, 13);
  assert.match(result.scope, /Not a report of coverage, covenant state or draw eligibility/);
  assert.deepEqual(run.rpcUrls, ["https://rpc.testnet.arc.network"]);
});

test("the manifest resolves option, then SIGNA_MANIFEST, then the bundled copy; the RPC URL likewise", async () => {
  const path = manifestFile();
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  const fromOption = onlyJson(await runSigna(["status", "--manifest", path, "--json"], { env: { SIGNA_MANIFEST: "/nonexistent.json" } }));
  assert.deepEqual(fromOption.context.manifest, { source: "option", path, sha256 });
  const fromEnv = onlyJson(await runSigna(["status", "--json"], { env: { SIGNA_MANIFEST: path } }));
  assert.deepEqual(fromEnv.context.manifest, { source: "environment", path, sha256 });

  const keyed = "https://arc.example/v2/abcdefghijklmnop1234?apikey=s3cret";
  const rpcOption = await runSigna(["status", "--rpc-url", keyed, "--json"], { env: { SIGNA_RPC_URL: "https://ignored.example" } });
  assert.deepEqual(onlyJson(rpcOption).context.rpc, { url: "https://arc.example/v2/redacted?apikey=redacted", source: "option" });
  assert.deepEqual(rpcOption.rpcUrls, [keyed], "the client gets the real URL");
  assert.doesNotMatch(rpcOption.stdout, /s3cret|abcdefghijklmnop1234/, "the output never does");
  const rpcEnv = onlyJson(await runSigna(["status", "--json"], { env: { SIGNA_RPC_URL: "https://arc-rpc.example" } }));
  assert.deepEqual(rpcEnv.context.rpc, { url: "https://arc-rpc.example", source: "environment" });
});

test("a missing or malformed manifest fails INVALID_MANIFEST before any RPC client exists, with no fallback", async () => {
  const cases: [string, string[], Record<string, string>, RegExp][] = [
    ["wrong chain", ["--manifest", manifestFile((m) => (m.chainId = 1))], {}, /chainId must be 5042002, received 1/],
    ["18 decimals", ["--manifest", manifestFile((m) => (m.settlementAsset.decimals = 18))], {}, /settlementAsset\.decimals must be 6/],
    ["not JSON", ["--manifest", manifestFile(undefined, "{ not json")], {}, /is not valid JSON/],
    ["missing file", ["--manifest", "/nonexistent/arc-testnet.json"], {}, /cannot read the manifest at \/nonexistent\/arc-testnet\.json \(ENOENT\)/],
    ["missing file from SIGNA_MANIFEST", [], { SIGNA_MANIFEST: "/nonexistent/arc-testnet.json" }, /cannot read the manifest/],
  ];
  for (const [label, args, env, pattern] of cases) {
    const run = await runSigna(["status", ...args, "--json"], { env });
    assert.equal(run.exitCode, 1, label);
    const error = onlyJson(run);
    assert.equal(error.code, "INVALID_MANIFEST", label);
    assert.match(error.message, pattern, label);
    assert.deepEqual(run.rpcUrls, [], `${label}: no RPC client was created`);
  }
});

test("bad input, the wrong chain, a mismatched deployment and an unreachable RPC each fail with their code and exit 1", async () => {
  const cases: [string, Parameters<typeof runSigna>[1], string[], string, RegExp][] = [
    ["non-http RPC URL", {}, ["--rpc-url", "ftp://arc.example"], "INVALID_INPUT", /must be an http\(s\) URL/],
    ["another chain", { rpc: { chainId: 84_532 } }, [], "CHAIN_MISMATCH", /reports chain 84532/],
    ["no vault code", { rpc: { missingCode: "0xa68fB25ba98d522ce8326471A6b6BF3732E3bF51" } }, [], "DEPLOYMENT_MISMATCH", /no contract code at covenantVault/],
    ["unreachable RPC", { rpc: { failWith: new Error("connect ECONNREFUSED") } }, [], "RPC_UNAVAILABLE", /RPC request to https:\/\/rpc\.testnet\.arc\.network failed/],
  ];
  for (const [label, options, args, code, pattern] of cases) {
    const run = await runSigna(["status", ...args, "--json"], options);
    assert.equal(run.exitCode, 1, label);
    const error = onlyJson(run);
    assert.equal(error.code, code, label);
    assert.match(error.message, pattern, label);
  }
});

test("human output renders the same report without --json", async () => {
  const run = await runSigna(["status"]);
  assert.equal(run.exitCode, 0);
  assert.match(run.stdout, /dataMode: live/);
  assert.match(run.stdout, /ready: true/);
});

test("incur 0.5.1: decimal strings are never coerced to numbers", async () => {
  const probe = Cli.create("probe", { update: false }).command("amount", {
    options: z.object({ amount: z.string() }),
    run: (c) => ({ amount: c.options.amount }),
  });
  for (const amount of ["1", "0010.50", "1e6", "0.0000001"]) {
    let stdout = "";
    await probe.serve(["amount", "--amount", amount, "--json"], { stdout: (text) => void (stdout += text), exit: () => {}, env: {} });
    assert.equal(JSON.parse(stdout).amount, amount);
  }
});

test("incur 0.5.1: the envelope flag is --full-output, --verbose is refused, and discovery lists exactly the shipped commands", async () => {
  const envelope = onlyJson(await runSigna(["status", "--full-output", "--json"]));
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.schemaVersion, 1);
  assert.equal(envelope.meta.command, "status");

  const verbose = await runSigna(["status", "--verbose", "--json"]);
  assert.equal(verbose.exitCode, 1);
  assert.deepEqual(onlyJson(verbose), { code: "UNKNOWN", message: "Unknown flag: --verbose" });

  const unknown = await runSigna(["repay", "send", "--json"]);
  assert.equal(unknown.exitCode, 1);
  assert.equal(onlyJson(unknown).code, "COMMAND_NOT_FOUND", "repayment orchestration is later work and does not exist yet");

  const manifest = onlyJson(await runSigna(["--llms", "--format", "json"]));
  assert.equal(manifest.version, "incur.v1");
  assert.deepEqual(manifest.commands.map((command: { name: string }) => command.name).sort(), [
    "covenant restore",
    "covenant sync",
    "coverage show",
    "credentials inspect",
    "credentials list",
    "credentials submit",
    "draw send",
    "draw simulate",
    "evidence show",
    "facility show",
    "status",
    "tx show",
    "waiver approve",
    "waiver broadcast",
    "waiver propose",
    "waiver reject",
    "waiver status",
  ]);
  const schema = onlyJson(await runSigna(["status", "--schema", "--format", "json"]));
  assert.deepEqual(Object.keys(schema.options.properties).sort(), ["manifest", "rpcUrl"]);
});

test("--update contacts no registry and installs nothing, because the package is not published", async () => {
  const cliPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(cliPackage.bin, { signa: "./dist/bin.js" }, "P2 declares the bin");
  assert.equal(cliPackage.version, SIGNA_CLI_VERSION, "the package version and the CLI's own version must not drift");

  // incur 0.5.1 honours --update even with updates disabled, and with a bin declared it would
  // otherwise infer a package name and run `npm install --global <name>@latest`. Against a name
  // nobody owns that installs whatever someone else registered. Supplying both check and install
  // makes incur use ours instead, so nothing is fetched and no package manager is executed.
  const source = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
  const configuration = source.slice(source.indexOf("update: {"), source.indexOf("});", source.indexOf("update: {")));
  assert.match(configuration, /check: \(\) =>/, "a custom check keeps --update off the registry");
  assert.match(configuration, /install: \(\) =>/, "a custom install keeps --update away from any package manager");

  const run = await runSigna(["--update", "--json"]);
  assert.equal(run.exitCode, 1);
  const error = onlyJson(run);
  assert.equal(error.code, "UPDATE_FAILED");
  // Our own message, which proves our installer ran rather than incur's global install.
  assert.match(error.message, new RegExp(`^${SIGNA_PACKAGE_NAME.replace("/", "\\/")} is not published`));
});

test("every command that signs is marked destructive and hidden from MCP clients", () => {
  // incur exposes commands as MCP tools by default. A command that can move funds must not be
  // one of them. There is no MCP server to interrogate here, so this reads the definitions.
  const source = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
  const blocks = source.split(/\.command\(/).slice(1).filter((block) => /options: writeOptions/.test(block));
  assert.equal(blocks.length, 4, "credentials submit, covenant sync, covenant restore and draw send all sign");
  for (const block of blocks) {
    const definition = block.slice(0, block.indexOf("async run"));
    const name = /description: "([^"]{0,60})/.exec(definition)?.[1] ?? "?";
    assert.match(definition, /mcp: false/, `a signing command must set mcp: false (${name})`);
    assert.match(definition, /destructive: true/, `a signing command must be marked destructive (${name})`);
  }
});

test("every waiver command that changes anything is destructive and hidden from MCP clients", () => {
  // The waiver group signs through a Privy key quorum rather than a keystore, so it is not caught
  // by the writeOptions guard above. `waiver status` only reads and stays available.
  const source = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
  const group = source.slice(source.indexOf('const waiver = Cli.create("waiver"'), source.indexOf("cli.command(waiver);"));
  const blocks = group.split(/waiver\.command\(/).slice(1);
  assert.equal(blocks.length, 5, "status, propose, approve, reject and broadcast");
  for (const block of blocks) {
    const name = /^"([a-z]+)"/.exec(block)?.[1] ?? "?";
    const definition = block.slice(0, block.indexOf("async run"));
    if (name === "status") {
      assert.doesNotMatch(definition, /destructive: true/, "status only reads");
      continue;
    }
    assert.match(definition, /mcp: false/, `${name} must not be an MCP tool`);
    assert.match(definition, /destructive: true/, `${name} must be marked destructive`);
  }
  // A Privy credential must never be reachable through a flag, where it would land in shell history.
  assert.doesNotMatch(group, /PRIVY_APP_SECRET: z\.string\(\)[^\n]*describe/, "the secret is environment-only");
  assert.match(source, /PRIVY_APP_SECRET: z\.string\(\)\.optional\(\)\.describe/, "and is declared as environment, not an option");
});
