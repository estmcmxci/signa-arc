import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PAGES as ALLOWED_PAGES } from "../../../apps/docs/scripts/pages.ts";
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
/** An elided value, as in a hash abbreviated for reading. Illustrative, so never executed. */
const ELIDED = /\u2026/;
/**
 * A documented command that names a signer. These are never executed here: running one would
 * unlock a real keystore on whoever's machine this runs on and broadcast a transaction. Their
 * behaviour is covered against a local Anvil chain, with disposable accounts, in anvil.test.ts.
 */
const NAMES_A_SIGNER = /(^|\s)--account(\s|=)/;
/**
 * A waiver command. Never executed here either: even `waiver status` reads live Arc, and the rest
 * would reach for approver keys in ~/.signa-privy-waiver and Privy credentials belonging to
 * whoever runs the suite. The adapter is covered by waiver.test.ts with an injected service.
 */
const IS_WAIVER = /^pnpm(?:\s+-s)?\s+signa\s+waiver\b/;
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
    if (NAMES_A_SIGNER.test(command) || IS_WAIVER.test(command) || ELIDED.test(command)) continue;
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

/** The lines inside fenced code blocks: what a reader actually copies and runs. */
function commandLines(text: string): string[] {
  const lines = text.split("\n");
  const inside: string[] = [];
  let fenced = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) inside.push(line);
  }
  return inside;
}

test("no code block installs signa from a registry, only from a local path", () => {
  // Installing the tarball this repository builds is honest, and is documented. Installing a name
  // from a registry is not: nothing is published, and a package by that name is not this one.
  // Only fenced blocks are checked, because that is what a reader copies; prose is free to say
  // that `npm install signa` does not exist, which is exactly what the Install page does say.
  const REGISTRY_INSTALL = /(?:npm (?:i|install)|pnpm (?:add|dlx)|yarn (?:add|global add)|bunx|npx)\s+(?:--?\S+\s+)*(?:@signa\/\S+|signa\b)/;
  for (const { file, text } of pages()) {
    for (const line of commandLines(text)) {
      if (/\.tgz|\.\//.test(line)) continue; // a path, not a registry name
      assert.doesNotMatch(line, REGISTRY_INSTALL, `${file}: ${line.trim()}`);
    }
  }
});

test("the Install page shows the local tarball install, and says plainly that nothing is published", () => {
  const install = pages().find((entry) => entry.file === "install.md");
  assert.ok(install, "there is an Install page");
  assert.match(install.text, /not published to any registry/i);
  assert.ok(
    commandLines(install.text).some((line) => /npm install --global \.\/dist\/signa-cli-/.test(line)),
    "it shows installing the tarball this repository builds",
  );
});

test("the site publishes exactly the allowlisted pages, and never ingests repository Markdown", () => {
  // Vocs is pointed at src/pages only, so the site cannot pick up a README, an ERD or a private
  // planning note by walking the repository. This asserts the set is the explicit one.
  assert.deepEqual(
    pages().map((page) => page.file).sort(),
    ALLOWED_PAGES.map((page) => page.source).sort(),
    "add the page to apps/docs/scripts/pages.ts, or remove it from src/pages",
  );
});

test("the hosting configuration builds the workspace, publishes the real Vocs output, and holds no secrets", () => {
  const hosting = JSON.parse(readFileSync(new URL("apps/docs/vercel.json", REPO_ROOT), "utf8"));
  assert.equal(hosting.outputDirectory, "apps/docs/dist/public", "the directory `vocs build` actually writes");
  assert.match(hosting.buildCommand, /@signa\/docs build/);
  assert.match(hosting.installCommand, /--frozen-lockfile/, "a deploy must not resolve new versions");
  // A static site has nothing to configure at run time, so any of these would be a mistake.
  for (const key of ["env", "build", "functions", "crons"]) {
    assert.equal(hosting[key], undefined, `${key} implies runtime configuration this site does not have`);
  }
  assert.equal(JSON.stringify(hosting).includes("${"), false, "no interpolated secret");

  const docsPackage = JSON.parse(readFileSync(new URL("apps/docs/package.json", REPO_ROOT), "utf8"));
  assert.match(docsPackage.scripts.build, /vocs build/);
  assert.match(docsPackage.scripts.build, /agent-routes/, "the build must keep emitting the routes agents are told to fetch");
  assert.match(docsPackage.scripts.build, /relativize-build/, "and must keep stripping local paths");
});
