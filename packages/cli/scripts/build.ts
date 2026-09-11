import { chmodSync, cpSync, mkdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/**
 * Builds the installable `signa` (ERD §10, P2).
 *
 * Everything the CLI needs at run time is bundled into one file: the workspace packages, the
 * generated ABIs, the bundled deployment manifest and incur, viem and zod. The published package
 * therefore declares no dependencies at all, needs no workspace, and never reads `contracts/out`.
 * `test/packed.test.ts` proves that by running the packed tarball from a temporary directory with
 * no node_modules and no repository.
 *
 * The selected historical evidence is copied beside the bundle rather than inlined, so each record
 * stays byte-identical to the repository's copy and its SHA-256 still means something.
 */

const PACKAGE = new URL("../", import.meta.url);
const DIST = new URL("dist/", PACKAGE);
const path = (url: URL) => fileURLToPath(url);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const result = await build({
  entryPoints: [path(new URL("src/bin.ts", PACKAGE))],
  outfile: path(new URL("bin.js", DIST)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Nothing is external: a node builtin is resolved by the platform, and everything else is inlined.
  packages: "bundle",
  legalComments: "none",
  // No shebang banner: esbuild keeps the one `src/bin.ts` already carries, and a second is a syntax error.
  metafile: true,
});

// The records the CLI ships, copied verbatim. `evidence/index.ts` reads them beside the bundle.
cpSync(path(new URL("src/evidence/records/", PACKAGE)), path(new URL("records/", DIST)), { recursive: true });

chmodSync(path(new URL("bin.js", DIST)), 0o755);

const bytes = statSync(path(new URL("bin.js", DIST))).size;
const external = Object.keys(result.metafile.inputs).filter((input) => input.includes("node_modules")).length;
console.log(`built dist/bin.js (${(bytes / 1024).toFixed(0)} KiB), ${external} bundled module(s) from node_modules, records copied`);
