import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PAGES } from "./pages.ts";

/**
 * Materialises the agent-readable routes in the static build (ERD §9, P2).
 *
 * Vocs' dev server answers `/quickstart.md`, but its static output only writes the Markdown twins
 * under `/assets/md/`. A hosted site would therefore 404 on exactly the routes the docs tell
 * agents to fetch. Copying each twin to its own route makes them real files, so they work on any
 * static host without provider-specific rewrite rules, and the local preview serves what
 * production will.
 */

const OUT = new URL("../dist/public/", import.meta.url);

let written = 0;
for (const page of PAGES) {
  const source = new URL(page.markdown, OUT);
  if (!existsSync(source)) throw new Error(`missing Markdown twin for ${page.route}: ${page.markdown}`);
  // `/index` is served as `/index.md`; every other route gets `<route>.md`.
  const destination = new URL(`${page.route.replace(/^\//, "")}.md`, OUT);
  mkdirSync(dirname(fileURLToPath(destination)), { recursive: true });
  copyFileSync(source, destination);
  written += 1;
}
console.log(`agent routes: ${written} Markdown route(s) written beside the pages`);
