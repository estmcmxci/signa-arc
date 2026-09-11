import { fileURLToPath } from "node:url";

import { fakeArcClient, type FakeArcOptions } from "../../client/test/fixtures/arc-rpc.ts";
import { createSignaCli, type SignaCliDependencies } from "../src/cli.ts";

export const REPO_ROOT = new URL("../../../", import.meta.url);

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
