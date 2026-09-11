import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

import { getAddress, type Address, type Hex } from "viem";

import { SignaError, redactRpcUrl } from "@signa/client";

/**
 * The narrow signer adapter (ERD §6): address lookup and one broadcast, over Foundry's `cast`.
 * Settled by the keystore spike in SPIKES.md, which pinned three things this file depends on:
 *
 * - `cast`'s own `--account` only ever resolves `~/.foundry/keystores`, and no environment
 *   variable redirects it, so the name is resolved here and passed as `--keystore <path>`.
 *   Tests point SIGNA_KEYSTORE_DIR at a temporary directory and never touch a user's keystores.
 * - A keystore file carries no address, so reading the address requires the password. Address
 *   lookup therefore happens first, and every later check depends on it.
 * - `--async` returns the hash without waiting, which is what lets a send journal its hash
 *   before any receipt wait.
 *
 * No password or private key is ever passed as an argument, where `ps` could read it: only the
 * path of a password file. `cast`'s `--unsafe-password` and `--private-key` are never used.
 */

export type CastRun = (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export type Signer = {
  /** The `--account` name, as asked for. */
  account: string;
  address: Address;
  keystore: string;
  /** Broadcasts one transaction and returns its hash without waiting for a receipt. */
  send(request: { to: Address; data: Hex }): Promise<Hex>;
};

export type SignerEnv = {
  SIGNA_KEYSTORE_DIR?: string | undefined;
  SIGNA_PASSWORD_FILE?: string | undefined;
};

export type OpenSignerOptions = {
  account: string;
  passwordFile?: string | undefined;
  rpcUrl: string;
  env: SignerEnv;
  cwd: string;
  run?: CastRun | undefined;
};

/** Runs `cast` and captures its output. `cast` is never given a shell. */
export const runCast: CastRun = (args) =>
  new Promise((resolvePromise) => {
    const child = spawn("cast", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => void (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => void (stderr += chunk.toString()));
    child.on("error", (error) =>
      resolvePromise({
        stdout: "",
        stderr: (error as { code?: string }).code === "ENOENT" ? "cast is not installed or not on PATH; Signa signs through Foundry's cast" : error.message,
        exitCode: 127,
      }),
    );
    child.on("close", (code) => resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 }));
  });

/** The directory `--account <name>` is resolved against. */
export function keystoreDirectory(env: SignerEnv): string {
  return env.SIGNA_KEYSTORE_DIR && env.SIGNA_KEYSTORE_DIR.length > 0 ? env.SIGNA_KEYSTORE_DIR : join(homedir(), ".foundry", "keystores");
}

/** Resolves `--account <name>` to a keystore file. The name is a file name, never a path. */
export function keystorePath(account: string, env: SignerEnv): string {
  if (account.length === 0 || account.includes(sep) || account.includes("/") || account === "." || account === "..") {
    throw new SignaError("INVALID_INPUT", `--account takes the name of a keystore, not a path: ${account}`);
  }
  return join(keystoreDirectory(env), account);
}

function passwordArgs(options: OpenSignerOptions): string[] {
  const named = options.passwordFile ?? options.env.SIGNA_PASSWORD_FILE;
  if (!named) return [];
  const path = resolve(options.cwd, named);
  if (!existsSync(path)) throw new SignaError("SIGNER_UNAVAILABLE", `the password file ${path} does not exist`);
  return ["--password-file", path];
}

/** Turns a failed `cast` run into a SignerUnavailable, with the RPC URL redacted. */
function castFailed(what: string, result: { stdout: string; stderr: string }, rpcUrl: string): SignaError {
  const redacted = redactRpcUrl(rpcUrl);
  const detail = (result.stderr || result.stdout || "no output").split("\n")[0] ?? "";
  const scrubbed = rpcUrl ? detail.split(rpcUrl).join(redacted) : detail;
  return new SignaError("SIGNER_UNAVAILABLE", `${what}: ${scrubbed}`);
}

/**
 * Opens a signer: resolves the keystore, unlocks it far enough to read its address, and returns
 * an adapter that can broadcast exactly one transaction at a time. Opening does not send anything.
 */
export async function openSigner(options: OpenSignerOptions): Promise<Signer> {
  const run = options.run ?? runCast;
  const keystore = keystorePath(options.account, options.env);
  if (!existsSync(keystore)) {
    throw new SignaError("SIGNER_UNAVAILABLE", `no keystore named ${options.account} in ${keystoreDirectory(options.env)}`);
  }
  const password = passwordArgs(options);
  const looked = await run(["wallet", "address", "--keystore", keystore, ...password]);
  if (looked.exitCode !== 0) throw castFailed(`cannot read the address of keystore ${options.account}`, looked, options.rpcUrl);
  let address: Address;
  try {
    address = getAddress(looked.stdout.trim());
  } catch {
    throw new SignaError("SIGNER_UNAVAILABLE", `cast did not return an address for keystore ${options.account}`);
  }
  return {
    account: options.account,
    address,
    keystore,
    async send(request) {
      // No --gas-limit: gas estimation stays as a last-line refusal before anything is broadcast.
      const sent = await run(["send", "--keystore", keystore, ...password, "--rpc-url", options.rpcUrl, "--async", request.to, request.data]);
      if (sent.exitCode !== 0) throw castFailed("the transaction was not broadcast", sent, options.rpcUrl);
      const hash = sent.stdout.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw castFailed("cast did not return a transaction hash", sent, options.rpcUrl);
      return hash as Hex;
    },
  };
}
