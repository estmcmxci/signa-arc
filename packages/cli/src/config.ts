import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  BUNDLED_MANIFEST_COPY_OF,
  SignaError,
  bundledManifest,
  parseDeploymentManifest,
  redactRpcUrl,
  type DeploymentManifest,
} from "@signa/client";

/** Where the manifest came from, reported with every live result (ERD C-02, C-04). */
export type ManifestProvenance =
  | { source: "option" | "environment"; path: string; sha256: string }
  | { source: "bundled"; copyOf: string };

export type ResolvedConfig = {
  manifest: DeploymentManifest;
  manifestProvenance: ManifestProvenance;
  /** The RPC URL as given. Never printed: output uses `rpc.url`, which is redacted. */
  rpcUrl: string;
  rpc: { url: string; source: "option" | "environment" | "manifest" };
};

export type ConfigInput = {
  manifestOption: string | undefined;
  rpcUrlOption: string | undefined;
  env: { SIGNA_MANIFEST?: string | undefined; SIGNA_RPC_URL?: string | undefined };
  readFile: (path: string) => Uint8Array;
  cwd: string;
};

/**
 * The directory the user ran the command from. `pnpm signa` runs the script from the repository
 * root and records the invoking directory in INIT_CWD, so a relative `--manifest` resolves
 * against that, falling back to the process's own directory.
 */
export function invocationDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const initCwd = env["INIT_CWD"]?.trim();
  return initCwd ? initCwd : process.cwd();
}

/**
 * Resolves the manifest and RPC URL: the option, then its environment variable, then the bundled
 * public manifest and its `rpcUrl` (ERD C-02). There is no fixture fallback: a named manifest
 * that cannot be read or does not validate is an error.
 */
export function resolveConfig(input: ConfigInput): ResolvedConfig {
  const { manifest, manifestProvenance } = resolveManifest(input);
  const rpcFromEnv = nonEmpty(input.env.SIGNA_RPC_URL);
  const rpcUrl = input.rpcUrlOption ?? rpcFromEnv ?? manifest.rpcUrl;
  const rpcSource = input.rpcUrlOption !== undefined ? "option" : rpcFromEnv !== undefined ? "environment" : "manifest";
  if (!isHttpUrl(rpcUrl)) {
    throw new SignaError("INVALID_INPUT", `the RPC URL from ${rpcSource} must be an http(s) URL, received ${redactRpcUrl(rpcUrl)}`);
  }
  return { manifest, manifestProvenance, rpcUrl, rpc: { url: redactRpcUrl(rpcUrl), source: rpcSource } };
}

/** The manifest alone: `--manifest`, then SIGNA_MANIFEST, then the bundled copy. Offline commands need no RPC. */
export function resolveManifest(
  input: Pick<ConfigInput, "manifestOption" | "env" | "readFile" | "cwd">,
): Pick<ResolvedConfig, "manifest" | "manifestProvenance"> {
  if (input.manifestOption !== undefined && !input.manifestOption.trim()) {
    throw new SignaError("INVALID_INPUT", "--manifest needs a file path");
  }
  const named = input.manifestOption ?? nonEmpty(input.env.SIGNA_MANIFEST);
  return named === undefined
    ? { manifest: bundledManifest(), manifestProvenance: { source: "bundled", copyOf: BUNDLED_MANIFEST_COPY_OF } }
    : readManifest(resolve(input.cwd, named), input.manifestOption !== undefined ? "option" : "environment", input.readFile);
}

function readManifest(
  path: string,
  source: "option" | "environment",
  readFile: (path: string) => Uint8Array,
): { manifest: DeploymentManifest; manifestProvenance: ManifestProvenance } {
  let bytes: Uint8Array;
  try {
    bytes = readFile(path);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new SignaError("INVALID_MANIFEST", `cannot read the manifest at ${path}${typeof code === "string" ? ` (${code})` : ""}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new SignaError("INVALID_MANIFEST", `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return {
      manifest: parseDeploymentManifest(data),
      manifestProvenance: { source, path, sha256: createHash("sha256").update(bytes).digest("hex") },
    };
  } catch (error) {
    if (error instanceof SignaError) throw new SignaError(error.code, `${path}: ${error.message}`);
    throw error;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() ? value : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
