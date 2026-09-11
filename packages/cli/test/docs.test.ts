import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { REFERENCE_PAGES, commandManifest } from "../../../apps/docs/scripts/generate-reference.ts";
import { EVIDENCE_PAGE, renderEvidencePage } from "../../../scripts/generate-docs-evidence.ts";
import { REPO_ROOT, envelopeFile, runSigna } from "./helpers.ts";

const PAGES = new URL("apps/docs/src/pages/", REPO_ROOT);
const REFERENCE = new URL("reference/", PAGES);

function pages(): { file: string; text: string }[] {
  const walk = (directory: URL, prefix: string): { file: string; text: string }[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`)
        : entry.name.endsWith(".md") || entry.name.endsWith(".mdx")
          ? [{ file: `${prefix}${entry.name}`, text: readFileSync(new URL(entry.name, directory), "utf8") }]
          : [],
    );
  return walk(PAGES, "");
}

/** Every `pnpm signa …` the docs show, in a fenced block or inline in a sentence. */
function documentedCommands(): { file: string; command: string }[] {
  return pages().flatMap(({ file, text }) => {
    const inline = [...text.matchAll(/`(pnpm(?:\s+-s)?\s+signa\b[^`]*)`/g)].map((match) => match[1] ?? "");
    const blocks = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^pnpm(?:\s+-s)?\s+signa\b/.test(line));
    return [...inline, ...blocks].map((command) => ({ file, command: command.replace(/#.*$/, "").trim() }));
  });
}

/** Commands whose stdout a reader is told to parse must silence pnpm's banner. */
const PARSED_OUTPUT = /--json\b|--format(?:\s+|=)(?:json|jsonl|yaml)\b|--llms|--schema\b/;
/** `<file>` and `[record]` in a usage synopsis: a shape to fill in, not a runnable example. */
const PLACEHOLDER = /^[<[].*[>\]]$/;
/**
 * A documented command that names a signer. These are never executed here: running one would
 * unlock a real keystore on whoever's machine this runs on and broadcast a transaction. Their
 * behaviour is covered against a local Anvil chain, with disposable accounts, in anvil.test.ts.
 */
const NAMES_A_SIGNER = /(^|\s)--account(\s|=)/;
/** A flag that already selects the output, so the test must not append `--json`. */
const SELECTS_OUTPUT = /^--(json|llms|llms-full|schema|help|version|format)$/;

test("the Evidence page is generated from the bundled records", () => {
  assert.equal(readFileSync(EVIDENCE_PAGE, "utf8"), renderEvidencePage(), "apps/docs/src/pages/evidence.md drifted: run `pnpm generate:docs`");
});

test("the Reference pages are generated from the shipped command tree, error codes, envelope schema and manifest", async () => {
  for (const page of REFERENCE_PAGES) {
    const path = new URL(page.file, REFERENCE);
    assert.ok(existsSync(path), `missing reference page ${page.file}`);
    assert.equal(readFileSync(path, "utf8"), await page.render(), `apps/docs/src/pages/reference/${page.file} drifted: run \`pnpm generate:docs\``);
  }
});

test("every signa command the docs show, in a block or a sentence, is one signa ships and runs clean", async () => {
  const known = (await commandManifest()).map((command) => command.name);
  const envelope = envelopeFile();
  const commands = documentedCommands();
  assert.ok(commands.length >= 20, `the docs show the commands they describe (found ${commands.length})`);

  const ran = new Set<string>();
  for (const { file, command } of commands) {
    const words = command.split(/\s+/).slice(command.startsWith("pnpm -s") ? 3 : 2);
    const path = words.filter((word) => !word.startsWith("-") && !PLACEHOLDER.test(word));
    // An empty path names no command: `pnpm signa` as prose for the runner, or a root flag such
    // as `signa --llms`. There is nothing to match against the command tree.
    if (path.length > 0) {
      assert.ok(
        known.some((name) => path.join(" ") === name || path.join(" ").startsWith(`${name} `)),
        `${file}: \`${command}\` is not a command signa ships`,
      );
    }
    if (words.length === 0 || words.some((word) => PLACEHOLDER.test(word)) || ran.has(command)) continue;
    if (NAMES_A_SIGNER.test(command)) continue;
    ran.add(command);
    const args = words.map((word) => (word.endsWith(".json") && !existsSync(join(fileURLToPath(REPO_ROOT), word)) ? envelope : word));
    const run = await runSigna(args.some((arg) => SELECTS_OUTPUT.test(arg)) ? args : [...args, "--json"]);
    assert.equal(run.exitCode, 0, `${file}: ${command}\n${run.stdout}`);
  }
  assert.ok(ran.size >= 8, `the docs' runnable examples are actually run (ran ${ran.size})`);
});

test("a command whose output is parsed runs through `pnpm -s`, so pnpm's banner stays off stdout", () => {
  for (const { file, command } of documentedCommands()) {
    if (PARSED_OUTPUT.test(command)) assert.match(command, /^pnpm\s+-s\s+signa\b/, `${file}: \`${command}\` needs pnpm -s`);
  }
});

test("the docs give no install command for a package that is not published", () => {
  for (const { file, text } of pages()) {
    assert.doesNotMatch(text, /npm (i|install)\b[^\n]*(@signa|signa)|pnpm (add|dlx)\b[^\n]*signa|npx signa|yarn (add|global)\b[^\n]*signa/, file);
  }
});
