import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Removes build-machine paths from the static output after `vocs build`. Vocs 2.9.0 writes them in
 * two places:
 * - each search document's `id` is the page's absolute file path;
 * - the client bundle serializes the resolved config, whose `rootDir` and `cacheDir` are always
 *   absolute.
 * No Vocs option controls either. Neither is used to navigate: search results link by `href`, and
 * `id` only keys results. So both are rewritten relative to the repository root.
 * `verify-build.ts` then fails the build if any local path remains.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const ROOTS = [REPO_ROOT, encodeURI(REPO_ROOT)];
const OUT = new URL("../dist/public/", import.meta.url);
const TEXT = /\.(html|js|mjs|cjs|css|json|txt|md|xml|svg|map|webmanifest)$/;

let files = 0;
let occurrences = 0;
const walk = (directory: URL): void => {
  for (const name of readdirSync(directory)) {
    const entry = new URL(name, directory);
    if (statSync(entry).isDirectory()) {
      walk(new URL(`${name}/`, directory));
      continue;
    }
    if (!TEXT.test(name)) continue;
    const text = readFileSync(entry, "utf8");
    const found = ROOTS.reduce((count, root) => count + text.split(root).length - 1, 0);
    if (found === 0) continue;
    // `<root>/apps/docs/...` becomes `apps/docs/...`; a bare `<root>` becomes `.`.
    const relative = ROOTS.reduce((current, root) => current.split(`${root}/`).join("").split(root).join("."), text);
    writeFileSync(entry, relative);
    files += 1;
    occurrences += found;
  }
};
walk(OUT);
console.log(`relativized ${occurrences} local path(s) in ${files} file(s) under dist/public`);
