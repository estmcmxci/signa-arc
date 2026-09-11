import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Recorded evidence, bundled with the CLI. Each file under `records/` is a byte-identical copy of
 * a record the repository keeps, and `test/evidence.test.ts` fails if a copy drifts. Every value
 * shown comes from those records: what the chain did when each record was made. Nothing here reads
 * the chain, and none of it describes the facility's current state (ERD C-04).
 */

export const RECORDED_NOTICE =
  "Recorded evidence: what these Arc Testnet transactions did when each record was made. It is not the facility's current state; `signa status` checks the live deployment.";

export const EVIDENCE_RECORD_IDS = ["acceptance", "coverage-drop", "waiver", "restore"] as const;
export type EvidenceRecordId = (typeof EVIDENCE_RECORD_IDS)[number];

type RecordKind = "acceptance" | "hedge-update" | "waiver";

/** In chronological order. `source` is where the original lives in the repository. */
export const EVIDENCE_RECORDS: readonly {
  id: EvidenceRecordId;
  kind: RecordKind;
  file: string;
  source: string;
  description: string;
}[] = [
  {
    id: "acceptance",
    kind: "acceptance",
    file: "arc-facility-evidence.json",
    source: "scenarios/output/arc-facility-evidence.json",
    description: "The A-1 to A-4 acceptance run: the same draw attempted three times while the coverage evidence underneath it changed.",
  },
  {
    id: "coverage-drop",
    kind: "hedge-update",
    file: "arc-hedge-update-seq-5.json",
    source: "scenarios/output/arc-hedge-update-seq-5.json",
    description: "A hedge update at sequence 5 followed by syncCovenant, which moved the facility out of compliance before the waiver.",
  },
  {
    id: "waiver",
    kind: "waiver",
    file: "arc-waiver-evidence.json",
    source: "packages/privy-waiver/evidence/arc-waiver-evidence.json",
    description: "A waiver approved by the facility admin's 2-of-2 Privy key quorum, signed by Privy and broadcast to Arc separately.",
  },
  {
    id: "restore",
    kind: "hedge-update",
    file: "arc-hedge-update-seq-6.json",
    source: "scenarios/output/arc-hedge-update-seq-6.json",
    description: "A hedge update at sequence 6 followed by restoreCompliance, after the waiver had ended.",
  },
];

export type RecordSource = { path: string; sha256: string };

export type RecordedStep = {
  label: string;
  action: string;
  transactionHash?: string;
  explorer?: string;
  blockNumber?: string;
  sender?: string;
  expectedStatus?: string;
  actualStatus?: string;
  covenantState?: string;
  coverageBps?: number;
  reason?: string;
  result?: string;
  at?: string;
};

export type RecordSummary = {
  id: EvidenceRecordId;
  title: string;
  description: string;
  recordedAt: string;
  outcome: string;
  summary: string;
  transactions: number;
  source: RecordSource;
};

export type RecordDetail = RecordSummary & {
  network: { chainId: number; explorer: string };
  facilityId: string;
  steps: RecordedStep[];
  approvals?: { role: string; signedAt: string }[];
  disclaimers: string[];
};

const RECORDS_DIR = new URL("./records/", import.meta.url);

export function evidenceSummary() {
  const details = EVIDENCE_RECORDS.map(recordDetail);
  const [first] = details;
  if (!first) throw new Error("no evidence records are bundled");
  return {
    schemaVersion: 1 as const,
    kind: "report" as const,
    dataMode: "recorded" as const,
    notice: RECORDED_NOTICE,
    chainId: first.network.chainId,
    facilityId: first.facilityId,
    records: details.map(({ network: _network, facilityId: _facility, steps: _steps, approvals: _approvals, disclaimers: _disclaimers, ...summary }) => summary),
  };
}

export function evidenceRecord(id: EvidenceRecordId) {
  const entry = EVIDENCE_RECORDS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`no bundled evidence record ${id}`);
  return { schemaVersion: 1 as const, kind: "report" as const, dataMode: "recorded" as const, notice: RECORDED_NOTICE, record: recordDetail(entry) };
}

/** The bundled bytes of one record, for provenance checks. */
export function recordBytes(file: string): Buffer {
  return readFileSync(new URL(file, RECORDS_DIR));
}

function recordDetail(entry: (typeof EVIDENCE_RECORDS)[number]): RecordDetail {
  const bytes = recordBytes(entry.file);
  const data = JSON.parse(bytes.toString("utf8")) as Json;
  const network = object(data, "network");
  const explorer = string(network, "explorer");
  const steps = entry.kind === "acceptance" ? acceptanceSteps(data) : entry.kind === "waiver" ? waiverSteps(data, explorer) : hedgeUpdateSteps(data);
  const approvals = entry.kind === "waiver" ? array(data, "approvals").map((approval) => ({ role: string(approval, "role"), signedAt: string(approval, "signedAt") })) : undefined;
  const disclaimers = [...new Set([optionalString(data, "disclaimer"), optionalString(data, "providerDisclaimer"), optionalString(optionalObject(data, "credential"), "disclaimer")].filter((text): text is string => text !== undefined))];
  return {
    id: entry.id,
    title: string(data, "title"),
    description: entry.description,
    recordedAt: string(data, "generatedAt"),
    outcome: string(data, "outcome"),
    summary: summarize(entry.kind, data, steps),
    transactions: new Set(steps.map((step) => step.transactionHash).filter(Boolean)).size,
    source: { path: entry.source, sha256: createHash("sha256").update(bytes).digest("hex") },
    network: { chainId: number(network, "chainId"), explorer },
    facilityId: string(object(data, "deployment"), "facilityId"),
    steps,
    ...(approvals ? { approvals } : {}),
    disclaimers,
  };
}

function acceptanceSteps(data: Json): RecordedStep[] {
  return array(data, "steps").map((step) => ({
    label: string(step, "criterion"),
    action: string(step, "action"),
    transactionHash: string(step, "transactionHash"),
    explorer: string(step, "explorer"),
    blockNumber: string(step, "blockNumber"),
    sender: string(step, "sender"),
    expectedStatus: string(step, "expectedStatus"),
    actualStatus: string(step, "actualStatus"),
    covenantState: string(step, "covenantState"),
    coverageBps: number(step, "coverageBps"),
    reason: string(step, "reasonCode"),
  }));
}

function hedgeUpdateSteps(data: Json): RecordedStep[] {
  return array(data, "steps").map((step, index) => {
    const covenant = object(step, "covenant");
    return {
      label: String(index + 1),
      action: string(step, "action"),
      transactionHash: string(step, "transactionHash"),
      explorer: string(step, "explorer"),
      blockNumber: string(step, "blockNumber"),
      sender: string(step, "sender"),
      expectedStatus: string(step, "expectedStatus"),
      actualStatus: string(step, "actualStatus"),
      covenantState: string(covenant, "covenantState"),
      coverageBps: number(covenant, "coverageBps"),
      reason: string(covenant, "reasonCode"),
    };
  });
}

/**
 * A waiver step carries a transaction only when its trace names the record's structured
 * `broadcast.transactionHash`, alone or followed by a comma. The hash always comes from that field,
 * never from free text.
 */
export function waiverSteps(data: Json, explorer: string): RecordedStep[] {
  const broadcastHash = string(object(data, "broadcast"), "transactionHash");
  return array(data, "steps").map((step) => {
    const trace = string(step, "trace");
    const namesBroadcast = trace === broadcastHash || trace.startsWith(`${broadcastHash},`);
    return {
      label: String(number(step, "step")),
      action: string(step, "what"),
      result: string(step, "result"),
      at: string(step, "at"),
      ...(namesBroadcast ? { transactionHash: broadcastHash, explorer: `${explorer}/tx/${broadcastHash}` } : {}),
    };
  });
}

/** One line computed from the record's own fields; never a claim the record does not make. */
function summarize(kind: RecordKind, data: Json, steps: RecordedStep[]): string {
  if (kind === "acceptance") {
    return steps
      .filter((step) => step.action.startsWith("draw"))
      .map((step) => `${step.label} ${step.action}: receipt ${step.actualStatus} (expected ${step.expectedStatus}) at ${step.coverageBps} bps, ${step.covenantState}`)
      .join("; ");
  }
  if (kind === "waiver") {
    const broadcast = object(data, "broadcast");
    const covenant = object(data, "covenantState");
    return `createWaiver ${string(broadcast, "transactionHash")}: receipt ${string(broadcast, "actualStatus")} in block ${string(broadcast, "blockNumber")}; covenant ${string(covenant, "before")} to ${string(covenant, "after")} until ${string(covenant, "waiverEndsAt")}`;
  }
  const before = object(data, "before");
  const after = object(object(data, "after"), "atCallBlock");
  return `before: ${string(before, "covenantState")} at ${number(before, "coverageBps")} bps; after block ${string(after, "readAtBlock")}: ${string(after, "covenantState")} at ${number(after, "coverageBps")} bps`;
}

export type Json = { [key: string]: unknown };

function object(value: unknown, key: string): Json {
  const field = (value as Json | undefined)?.[key];
  if (typeof field !== "object" || field === null || Array.isArray(field)) throw new Error(`evidence record field ${key} is not an object`);
  return field as Json;
}

function optionalObject(value: unknown, key: string): Json | undefined {
  const field = (value as Json | undefined)?.[key];
  return typeof field === "object" && field !== null && !Array.isArray(field) ? (field as Json) : undefined;
}

function array(value: unknown, key: string): Json[] {
  const field = (value as Json | undefined)?.[key];
  if (!Array.isArray(field)) throw new Error(`evidence record field ${key} is not an array`);
  return field as Json[];
}

function string(value: unknown, key: string): string {
  const field = (value as Json | undefined)?.[key];
  if (typeof field !== "string") throw new Error(`evidence record field ${key} is not a string`);
  return field;
}

function optionalString(value: unknown, key: string): string | undefined {
  const field = (value as Json | undefined)?.[key];
  return typeof field === "string" ? field : undefined;
}

function number(value: unknown, key: string): number {
  const field = (value as Json | undefined)?.[key];
  if (typeof field !== "number") throw new Error(`evidence record field ${key} is not a number`);
  return field;
}
