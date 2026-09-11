import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

/**
 * Checks the static build after `vocs build` (A-DOC-01, A-DOC-03). It verifies that every page and
 * its Markdown twin exist, and that llms.txt indexes every page. It also verifies that no text file
 * in the public output carries a secret-shaped string or a private planning document's name.
 */

const OUT = new URL("../dist/public/", import.meta.url);
const PAGES: [html: string, markdown: string, llms: string][] = [
  ["index.html", "assets/md/index.md", "/index"],
  ["run-locally/index.html", "assets/md/run-locally.md", "/run-locally"],
  ["quickstart/index.html", "assets/md/quickstart.md", "/quickstart"],
  ["agents/index.html", "assets/md/agents.md", "/agents"],
  ["evidence/index.html", "assets/md/evidence.md", "/evidence"],
];
const FORBIDDEN = [
  /PRIVY_APP_SECRET/,
  /BEGIN (EC )?PRIVATE KEY/,
  /wallet-auth:/,
  /"privateKey"/,
  /PRODUCT-THESIS|CUTLIST|SPONSOR-STRATEGY-REVIEW|ETHONLINE-WORKSTREAMS/,
];

const problems: string[] = [];
for (const [html, markdown] of PAGES) {
  if (!existsSync(new URL(html, OUT))) problems.push(`missing page ${html}`);
  if (!existsSync(new URL(markdown, OUT))) problems.push(`missing Markdown twin ${markdown}`);
}
const llms = existsSync(new URL("llms.txt", OUT)) ? readFileSync(new URL("llms.txt", OUT), "utf8") : "";
if (!llms) problems.push("missing llms.txt");
for (const [, , route] of PAGES) {
  if (llms && !llms.includes(`](${route})`)) problems.push(`llms.txt does not index ${route}`);
}
if (!existsSync(new URL("llms-full.txt", OUT))) problems.push("missing llms-full.txt");

let scanned = 0;
const walk = (directory: URL): void => {
  for (const name of readdirSync(directory)) {
    const entry = new URL(name, directory);
    if (statSync(entry).isDirectory()) {
      walk(new URL(`${name}/`, directory));
      continue;
    }
    if (!/\.(html|txt|md|json)$/.test(name)) continue;
    scanned += 1;
    const text = readFileSync(entry, "utf8");
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) problems.push(`${entry.pathname} matches ${pattern}`);
    }
  }
};
walk(OUT);

if (problems.length > 0) {
  console.error(`docs build check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`docs build verified: ${PAGES.length} pages with Markdown twins, llms.txt and llms-full.txt, ${scanned} text files scanned`);
