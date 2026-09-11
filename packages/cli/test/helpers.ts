import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { bundledManifest } from "@signa/client";

import { fakeArcClient, type FakeArcOptions } from "../../client/test/fixtures/arc-rpc.ts";
import { createSignaCli, type SignaCliDependencies } from "../src/cli.ts";

export const REPO_ROOT = new URL("../../../", import.meta.url);

/**
 * The hedge credential lane B signed at sequence 6 and the registry accepted, written to a
 * temporary file as a signed envelope. `mutate` alters it before writing; `raw` writes bytes
 * instead, for the malformed-input cases.
 */
export function envelopeFile(mutate?: (envelope: Record<string, any>) => void, raw?: string): string {
  const record = JSON.parse(readFileSync(new URL("scenarios/output/arc-hedge-update-seq-6.json", REPO_ROOT), "utf8"));
  const envelope: Record<string, any> = {
    schemaVersion: 1,
    kind: "hedge",
    domain: { name: "FXCoverageCredentials", version: "1", chainId: 5_042_002, verifyingContract: bundledManifest().contracts.credentialRegistry.address },
    credential: { ...record.credential.credential, status: "ACTIVE" },
    signature: record.credential.signature,
    issuer: record.credential.issuer,
    digest: record.credential.digest,
  };
  mutate?.(envelope);
  const path = join(mkdtempSync(join(tmpdir(), "signa-envelope-")), "hedge-envelope.json");
  writeFileSync(path, raw ?? JSON.stringify(envelope, null, 2));
  return path;
}

export type Run = { stdout: string; exitCode: number; rpcUrls: string[] };

/**
 * Runs `signa` in-process with injected argv, environment and RPC, as incur's `serve()` allows.
 * Every live read goes to the fake Arc RPC; `rpcUrls` records each client the CLI asked for.
 */
export async function runSigna(
  argv: string[],
  options: { env?: Record<string, string | undefined>; rpc?: FakeArcOptions; dependencies?: SignaCliDependencies } = {},
): Promise<Run> {
  const rpcUrls: string[] = [];
  const cli = createSignaCli({
    publicClient: (rpcUrl) => {
      rpcUrls.push(rpcUrl);
      return fakeArcClient(options.rpc).client;
    },
    cwd: () => fileURLToPath(REPO_ROOT),
    ...options.dependencies,
  });
  let stdout = "";
  let exitCode = 0;
  await cli.serve(argv, {
    stdout: (text) => void (stdout += text),
    exit: (code) => void (exitCode = code),
    env: options.env ?? {},
  });
  return { stdout, exitCode, rpcUrls };
}

/** Parses stdout as exactly one JSON document; JSON.parse fails on anything around it. */
export function onlyJson(run: Run): any {
  return JSON.parse(run.stdout);
}
