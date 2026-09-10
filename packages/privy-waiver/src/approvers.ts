import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";

import { generateAuthorizationKeyPair } from "./authorization.ts";

/**
 * The facility admin's two approvers. Their P-256 keys are the only way the quorum wallet can
 * sign, and a facility's admin can never change, so losing them strands the facility. They are
 * written once and never overwritten, readable only by this user, and kept outside the repository
 * so they cannot be committed. Back the directory up.
 */

export const APPROVER_ROLES = [
  { role: "risk-officer", label: "Risk officer" },
  { role: "treasury-lead", label: "Treasury lead" },
] as const;

export type ApproverRole = (typeof APPROVER_ROLES)[number]["role"];

export type ApproverKey = {
  role: ApproverRole;
  label: string;
  publicKey: string;
  privateKey: string;
  createdAt: string;
};

/** The Privy quorum and wallet those keys control, as created. */
export type QuorumRecord = {
  keyQuorumId: string;
  walletId?: string;
  walletAddress?: Address;
  /** The Privy policy attached to the wallet, once scripts/provision-policy.ts has created it. */
  policyId?: string;
  createdAt: string;
};

export function approverKeyDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRIVY_APPROVER_KEY_DIR?.trim() || join(homedir(), ".signa-privy-waiver", "approvers");
}

export function readApprover(directory: string, role: ApproverRole): ApproverKey | undefined {
  const path = join(directory, `${role}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ApproverKey) : undefined;
}

/** Generates and writes a key. The `wx` flag makes the write fail if a key is already there. */
export function createApprover(directory: string, role: ApproverRole): ApproverKey {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const label = APPROVER_ROLES.find((entry) => entry.role === role)?.label ?? role;
  const key: ApproverKey = { role, label, ...generateAuthorizationKeyPair(), createdAt: new Date().toISOString() };
  writeFileSync(join(directory, `${role}.json`), `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return key;
}

export function readQuorumRecord(directory: string): QuorumRecord | undefined {
  const path = join(directory, "quorum.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as QuorumRecord) : undefined;
}

/** Records the quorum and its wallet. Once recorded, neither can be repointed. */
export function writeQuorumRecord(directory: string, record: QuorumRecord): QuorumRecord {
  const existing = readQuorumRecord(directory);
  if (existing && existing.keyQuorumId !== record.keyQuorumId) {
    throw new Error(`${directory} already records key quorum ${existing.keyQuorumId}`);
  }
  if (existing?.walletId && existing.walletId !== record.walletId) {
    throw new Error(`${directory} already records wallet ${existing.walletId}`);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "quorum.json");
  writeFileSync(`${path}.tmp`, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  return record;
}
