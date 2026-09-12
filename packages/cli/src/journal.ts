import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { SignaError } from "@signa/client";

/**
 * An append-only record of every operation that reaches the point of being broadcast (ERD §6).
 *
 * It lives outside the repository on purpose: it names real accounts and real transactions, and
 * a working copy is the wrong place for that. A path inside this checkout is refused outright
 * rather than silently relocated, so a mistake is visible immediately.
 *
 * A send writes `broadcast` with its hash *before* waiting for any receipt. If the wait times
 * out, is interrupted, or the process is killed, the hash is already durably recorded and the
 * transaction can be reconciled later with `signa tx show`.
 */

/**
 * The git working copy a path sits in, if any. Found by walking up looking for `.git`, which is a
 * directory in a normal clone and a file in a worktree. This is asked of the journal path itself
 * rather than measured from this file's own location, which means nothing once the CLI is
 * installed somewhere else entirely.
 */
function gitWorkingCopy(path: string): string | null {
  let directory = dirname(resolve(path));
  for (;;) {
    if (existsSync(join(directory, ".git"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export type JournalEnv = {
  SIGNA_JOURNAL?: string | undefined;
  XDG_STATE_HOME?: string | undefined;
};

export type JournalEntry = {
  event: "simulated" | "broadcast" | "outcome";
  command: string;
  chainId: number;
  facilityId: string;
  account: string;
  signer: string;
  contract: string;
  function: string;
  hash?: string;
  status?: string;
  detail?: string;
};

export type Journal = {
  path: string;
  append(entry: JournalEntry): void;
};

/** Where the journal lives: SIGNA_JOURNAL, else the XDG state directory, else ~/.local/state. */
export function journalPath(env: JournalEnv, cwd: string): string {
  if (env.SIGNA_JOURNAL && env.SIGNA_JOURNAL.length > 0) {
    const named = resolve(cwd, env.SIGNA_JOURNAL);
    const checkout = gitWorkingCopy(named);
    if (checkout) {
      throw new SignaError(
        "INVALID_INPUT",
        `SIGNA_JOURNAL points inside the git working copy at ${checkout}; the operation journal records real accounts and transactions and must live outside a working copy`,
      );
    }
    return named;
  }
  const state = env.XDG_STATE_HOME && env.XDG_STATE_HOME.length > 0 ? env.XDG_STATE_HOME : join(homedir(), ".local", "state");
  return join(state, "signa", "operations.jsonl");
}

/** Opens the journal, creating its directory. Nothing is written until an entry is appended. */
export function openJournal(env: JournalEnv, cwd: string): Journal {
  const path = journalPath(env, cwd);
  return {
    path,
    append(entry) {
      const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        appendFileSync(path, line, { mode: 0o600 });
      } catch (error) {
        // A journal that cannot be written must not swallow a broadcast hash: surface it.
        throw new SignaError("INVALID_INPUT", `cannot write the operation journal at ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
