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

test("the Evidence page is generated from the bundled records", () => {
  assert.equal(readFileSync(EVIDENCE_PAGE, "utf8"), renderEvidencePage(), "apps/docs/src/pages/evidence.md drifted: run `pnpm generate:docs`");
});

test("every signa command the docs show runs against the shipped command tree", async () => {
  const commands = pages().flatMap(({ file, text }) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^pnpm (-s )?signa\b/.test(line))
      .map((line) => ({ file, line, args: line.replace(/#.*$/, "").trim().split(/\s+/).slice(line.startsWith("pnpm -s") ? 3 : 2) })),
  );
  assert.ok(commands.length >= 5, "the docs show the commands they describe");
  for (const { file, line, args } of commands) {
    const discovery = args.some((arg) => ["--help", "--llms", "--llms-full", "--version", "--schema"].includes(arg));
    const run = await runSigna(discovery || args.includes("--json") ? args : [...args, "--json"]);
    assert.equal(run.exitCode, 0, `${file}: ${line}\n${run.stdout}`);
  }
});

test("the docs give no install command for a package that is not published", () => {
  for (const { file, text } of pages()) {
    assert.doesNotMatch(text, /npm (i|install)\b[^\n]*(@signa|signa)|pnpm (add|dlx)\b[^\n]*signa|npx signa|yarn (add|global)\b[^\n]*signa/, file);
  }
});
