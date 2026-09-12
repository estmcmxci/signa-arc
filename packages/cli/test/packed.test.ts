import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SIGNA_CLI_VERSION } from "../src/cli.ts";

/**
 * The point of P2: prove `signa` runs where this repository does not exist.
 *
 * The package is built, packed, and extracted into a temporary directory outside the checkout,
 * and then run with plain `node`. Nothing is installed: the tarball carries no dependencies, so
 * there is no `node_modules` anywhere above it, no workspace package to resolve, and no Foundry
 * build output to read. If the CLI still needed any of those, every command here would fail.
 */

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const REPO = resolve(PACKAGE, "../..");

/** Builds, packs, and unpacks into a fresh temporary directory. Returns the extracted root. */
function packAndExtract(): { root: string; tarball: string; entries: string[] } {
  execFileSync("node", ["--import", "tsx", "scripts/build.ts"], { cwd: PACKAGE, stdio: "pipe" });
  const destination = mkdtempSync(join(tmpdir(), "signa-packed-"));
  const packed = execFileSync("npm", ["pack", "--json", "--pack-destination", destination], { cwd: PACKAGE, encoding: "utf8", stdio: "pipe" });
  const tarball = join(destination, (JSON.parse(packed) as { filename: string }[])[0]!.filename);
  const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean);
  execFileSync("tar", ["-xzf", tarball], { cwd: destination });
  return { root: join(destination, "package"), tarball, entries };
}

/** Runs the packed executable with nothing from this repository in scope. */
function runPacked(root: string, args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [join(root, "dist", "bin.js"), ...args], {
      cwd: root,
      encoding: "utf8",
      // A deliberately bare environment: no SIGNA_* configuration, no NODE_PATH, no repository.
      env: { PATH: process.env["PATH"] ?? "", HOME: root },
      stdio: "pipe",
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return { stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}`, exitCode: failure.status ?? 1 };
  }
}

test("the packed package runs from a temporary directory with no repository, workspace or node_modules", async (t) => {
  const { root, entries } = packAndExtract();

  await t.test("it ships only the built bundle and the records it reads", () => {
    const unexpected = entries.filter((entry) => !/^package\/(package\.json|dist\/)/.test(entry));
    assert.deepEqual(unexpected, [], "the tarball carries nothing but package.json and dist/");
    assert.ok(entries.includes("package/dist/bin.js"), "the executable is packed");
    assert.equal(entries.filter((entry) => entry.endsWith(".json") && entry.includes("dist/records/")).length, 4, "the four selected records are packed");
    assert.deepEqual(entries.filter((entry) => entry.endsWith(".ts")), [], "no TypeScript source is published");
    assert.deepEqual(entries.filter((entry) => entry.includes("node_modules")), [], "no dependency tree is published");
    assert.deepEqual(entries.filter((entry) => entry.includes("contracts/out")), [], "no Foundry build output is published");
  });

  await t.test("its metadata declares the bin and needs nothing installed", () => {
    const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.deepEqual(metadata.bin, { signa: "./dist/bin.js" });
    assert.equal(metadata.version, SIGNA_CLI_VERSION);
    assert.equal(metadata.type, "module");
    assert.deepEqual(metadata.dependencies ?? {}, {}, "a published dependency would have to be resolvable here, and none is");
    assert.match(metadata.engines.node, /22/);
  });

  await t.test("the executable has a shebang and the executable bit", () => {
    const bin = join(root, "dist", "bin.js");
    assert.match(readFileSync(bin, "utf8").split("\n")[0] ?? "", /^#!\/usr\/bin\/env node$/);
    assert.equal(statSync(bin).mode & 0o111, 0o111, "the executable bit survives packing");
  });

  await t.test("nothing it could resolve from is present", () => {
    assert.ok(!root.startsWith(`${REPO}${sep}`), `the packed package must run outside the checkout, not at ${root}`);
    assert.ok(!existsSync(join(root, "node_modules")), "no dependencies are installed beside it");
    for (let directory = root; ; directory = dirname(directory)) {
      assert.ok(!existsSync(join(directory, "node_modules")), `a resolvable node_modules at ${directory} would invalidate this test`);
      if (dirname(directory) === directory) break;
    }
    assert.ok(!existsSync(join(root, "contracts")), "no Foundry artifacts are beside it");
  });

  await t.test("help and discovery work offline", () => {
    const help = runPacked(root, ["--help"]);
    assert.equal(help.exitCode, 0, help.stdout);
    assert.match(help.stdout, /Usage: signa <command>/);
    for (const group of ["status", "facility", "coverage", "credentials", "draw", "covenant", "tx", "evidence"]) {
      assert.match(help.stdout, new RegExp(`\\b${group}\\b`), `${group} is listed`);
    }
    const manifest = JSON.parse(runPacked(root, ["--llms", "--format", "json"]).stdout);
    assert.equal(manifest.version, "incur.v1");
    assert.equal(manifest.commands.length, 12, "every shipped command is discoverable");
  });

  await t.test("recorded evidence works offline, with the records read from beside the bundle", () => {
    const summary = runPacked(root, ["evidence", "show", "--json"]);
    assert.equal(summary.exitCode, 0, summary.stdout);
    const result = JSON.parse(summary.stdout);
    assert.equal(result.dataMode, "recorded");
    assert.equal(result.records.length, 4);
    for (const record of result.records) assert.match(record.source.sha256, /^[0-9a-f]{64}$/, "each record still hashes to its own bytes");

    const detail = JSON.parse(runPacked(root, ["evidence", "show", "acceptance", "--json"]).stdout);
    assert.equal(detail.record.id, "acceptance");
    assert.ok(detail.record.steps.length > 0);
  });

  await t.test("the bundled manifest is present, so a live command fails on the network and not on a missing file", () => {
    // Port 1 refuses immediately. Reaching RPC_UNAVAILABLE proves the manifest, ABIs and every
    // workspace module resolved: a packaging fault would fail earlier and differently.
    const run = runPacked(root, ["status", "--rpc-url", "http://127.0.0.1:1", "--json"]);
    assert.equal(run.exitCode, 1);
    const error = JSON.parse(run.stdout);
    assert.equal(error.code, "RPC_UNAVAILABLE");
    assert.equal(error.retryable, true);
  });

  await t.test("offline credential inspection works, which needs the manifest and the credentials package", () => {
    const envelope = JSON.parse(readFileSync(join(REPO, "scenarios/output/arc-hedge-update-seq-6.json"), "utf8"));
    const file = join(root, "hedge-envelope.json");
    execFileSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(file)}, JSON.stringify(${JSON.stringify({
      schemaVersion: 1,
      kind: "hedge",
      domain: { name: "FXCoverageCredentials", version: "1", chainId: 5_042_002, verifyingContract: "0xD921734C9314442a74Cd3FEBAB8028b2Bb9A7624" },
      credential: { ...envelope.credential.credential, status: "ACTIVE" },
      signature: envelope.credential.signature,
      issuer: envelope.credential.issuer,
      digest: envelope.credential.digest,
    })}))`]);
    const run = runPacked(root, ["credentials", "inspect", "./hedge-envelope.json", "--json"]);
    assert.equal(run.exitCode, 0, run.stdout);
    const result = JSON.parse(run.stdout);
    assert.equal(result.dataMode, "offline");
    assert.equal(result.envelope.manifestRole, "hedgeIssuer");
    assert.equal(result.envelope.recoveredSigner, result.envelope.claimedIssuer, "the signature was recovered by the bundled credentials package");
  });

  await t.test("--update installs nothing from here either", () => {
    const run = runPacked(root, ["--update", "--json"]);
    assert.equal(run.exitCode, 1);
    const error = JSON.parse(run.stdout);
    assert.equal(error.code, "UPDATE_FAILED");
    assert.match(error.message, /is not published/);
  });
});
