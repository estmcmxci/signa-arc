import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Checks the static build after `vocs build` and `relativize-build.ts` (A-DOC-01, A-DOC-03):
 * - every page and its Markdown twin exist, and llms.txt indexes every page;
 * - no text asset carries a local path: the repository's own root, the home directory, `/Users/` or
 *   `/home/`, in any form;
 * - no text asset carries a secret-shaped string or a private planning document's name.
 * Every text asset is scanned, .js and .json included.
 */

const OUT = new URL("../dist/public/", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const PAGES: [html: string, markdown: string, llms: string][] = [
  ["index.html", "assets/md/index.md", "/index"],
  ["run-locally/index.html", "assets/md/run-locally.md", "/run-locally"],
  ["quickstart/index.html", "assets/md/quickstart.md", "/quickstart"],
  ["agents/index.html", "assets/md/agents.md", "/agents"],
  ["guides/inspect-a-facility/index.html", "assets/md/guides/inspect-a-facility.md", "/guides/inspect-a-facility"],
  ["guides/explain-a-refused-draw/index.html", "assets/md/guides/explain-a-refused-draw.md", "/guides/explain-a-refused-draw"],
  ["reference/commands/index.html", "assets/md/reference/commands.md", "/reference/commands"],
  ["reference/errors/index.html", "assets/md/reference/errors.md", "/reference/errors"],
  ["reference/envelope/index.html", "assets/md/reference/envelope.md", "/reference/envelope"],
  ["reference/deployment/index.html", "assets/md/reference/deployment.md", "/reference/deployment"],
  ["evidence/index.html", "assets/md/evidence.md", "/evidence"],
];
const TEXT = /\.(html|js|mjs|cjs|css|json|txt|md|xml|svg|map|webmanifest)$/;
const LOCAL_PATHS: [needle: string, label: string][] = [
  [REPO_ROOT, "the repository root"],
  [encodeURI(REPO_ROOT), "the repository root, URL-encoded"],
  [homedir(), "the home directory"],
  ["/Users/", "/Users/"],
  ["/home/", "/home/"],
];
/**
 * Example strings in third-party code, not paths from any machine. Vocs bundles an OpenAPI
 * playground whose file-picker examples read `/home/user/documents/report.pdf` and the like; this
 * site configures no OpenAPI pages, so the chunk is never loaded. Allowed only in that chunk.
 */
const THIRD_PARTY_EXAMPLES: { file: RegExp; literal: string }[] = [{ file: /^playground-modal\.client-[\w-]+\.js$/, literal: "/home/user/" }];
const FORBIDDEN = [
  /PRIVY_APP_SECRET/,
  // A PEM header followed by key material. A bare header is not a key: the bundled OpenAPI
  // playground uses `-----BEGIN PRIVATE KEY-----` as an input placeholder.
  /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----(?:\\n|\s)*[A-Za-z0-9+/]{40,}/,
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
const walk = (directory: URL, relative: string): void => {
  for (const name of readdirSync(directory)) {
    const entry = new URL(name, directory);
    if (statSync(entry).isDirectory()) {
      walk(new URL(`${name}/`, directory), `${relative}${name}/`);
      continue;
    }
    if (!TEXT.test(name)) continue;
    scanned += 1;
    const text = readFileSync(entry, "utf8");
    const examples = THIRD_PARTY_EXAMPLES.filter((example) => example.file.test(name)).map((example) => example.literal);
    const scrubbed = examples.reduce((current, literal) => current.split(literal).join(""), text);
    for (const [needle, label] of LOCAL_PATHS) {
      if (scrubbed.includes(needle)) problems.push(`${relative}${name} contains a local path: ${label}`);
    }
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) problems.push(`${relative}${name} matches ${pattern}`);
    }
  }
};
walk(OUT, "dist/public/");

if (problems.length > 0) {
  console.error(`docs build check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `docs build verified: ${PAGES.length} pages with Markdown twins, llms.txt and llms-full.txt; ${scanned} text files scanned, no local paths or secrets`,
);
