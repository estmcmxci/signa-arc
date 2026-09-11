import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { EVIDENCE_PAGE, renderEvidencePage } from "../../../scripts/generate-docs-evidence.ts";
import { REPO_ROOT, runSigna } from "./helpers.ts";

const PAGES = new URL("apps/docs/src/pages/", REPO_ROOT);
const pages = () =>
  readdirSync(PAGES)
    .filter((file) => file.endsWith(".md") || file.endsWith(".mdx"))
    .map((file) => ({ file, text: readFileSync(new URL(file, PAGES), "utf8") }));

/** Stand-ins for the placeholders the docs use, so every command shape can be run. */
const PLACEHOLDERS: Record<string, string> = { "<record>": "acceptance" };

/**
 * Every `pnpm signa …` the docs show, whether on its own line in a code block or inline in a
 * sentence.
 */
function documentedCommands() {
  return pages().flatMap(({ file, text }) => {
    const inline = [...text.matchAll(/`(pnpm(?:\s+-s)?\s+signa\b[^`]*)`/g)].map((match) => match[1] ?? "");
    const blocks = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^pnpm(?:\s+-s)?\s+signa\b/.test(line));
    return [...inline, ...blocks].map((command) => ({ file, command: command.replace(/#.*$/, "").trim() }));
  });
}

const PARSED_OUTPUT = /--json\b|--format(?:\s+|=)(?:json|jsonl|yaml)\b|--llms|--schema\b/;

test("the Evidence page is generated from the bundled records", () => {
  assert.equal(readFileSync(EVIDENCE_PAGE, "utf8"), renderEvidencePage(), "apps/docs/src/pages/evidence.md drifted: run `pnpm generate:docs`");
});

test("every signa command the docs show, in a block or a sentence, runs against the shipped command tree", async () => {
  const commands = documentedCommands();
  assert.ok(commands.length >= 12, `the docs show the commands they describe (found ${commands.length})`);
  for (const { file, command } of commands) {
    const words = command.split(/\s+/);
    const args = words.slice(words[1] === "-s" ? 3 : 2).map((word) => PLACEHOLDERS[word] ?? word);
    assert.ok(!args.some((arg) => /^<.*>$/.test(arg)), `${file}: \`${command}\` has a placeholder the test cannot fill`);
    const discovery = args.some((arg) => ["--help", "--llms", "--llms-full", "--version", "--schema"].includes(arg));
    const run = await runSigna(discovery || args.includes("--json") ? args : [...args, "--json"]);
    assert.equal(run.exitCode, 0, `${file}: ${command}\n${run.stdout}`);
  }
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
