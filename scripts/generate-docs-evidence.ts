import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { EVIDENCE_RECORDS, RECORDED_NOTICE, evidenceRecord, type RecordDetail, type RecordedStep } from "../packages/cli/src/evidence/index.ts";

/**
 * Writes the docs' Evidence page from the records bundled with the CLI (ERD §9: evidence links
 * come from their records). The page and `signa evidence show` read the same data. The output is
 * deterministic; packages/cli/test/docs.test.ts fails when the checked-in page drifts.
 *
 *   pnpm generate:docs
 */

export const EVIDENCE_PAGE = new URL("../apps/docs/src/pages/evidence.md", import.meta.url);

export function renderEvidencePage(): string {
  const records = EVIDENCE_RECORDS.map((entry) => evidenceRecord(entry.id).record);
  const lines: string[] = [
    "---",
    "title: Recorded on Arc Testnet",
    "description: The recorded draw that was permitted, refused and permitted again, the coverage drop, the 2-of-2 quorum waiver and the restoration, each with its transactions. Historical records, not current state.",
    "---",
    "",
    "# Recorded on Arc Testnet",
    "",
    ":::warning",
    RECORDED_NOTICE,
    ":::",
    "",
    "Four records, in the order they were made, from one fictional facility on Arc Testnet (chain 5042002) with labelled mock provider data and testnet USDC. A signature authenticates who asserted what. It does not prove that a hedge legally exists.",
    "",
    "`pnpm signa evidence show` prints the same records, and `pnpm signa evidence show <record> --json` prints one of them.",
    "",
    "| Record | Recorded | Outcome | Transactions |",
    "|---|---|---|---|",
    ...records.map((record) => `| \`${record.id}\` | ${record.recordedAt} | ${record.outcome} | ${record.transactions} |`),
    "",
  ];
  for (const record of records) lines.push(...section(record));
  lines.push(
    "---",
    "",
    "This page is generated from the records bundled with the CLI (`pnpm generate:docs`). Each record's SHA-256 is that of the file in the repository.",
    "",
  );
  return lines.join("\n");
}

function section(record: RecordDetail): string[] {
  const lines = [
    `## ${record.title}`,
    "",
    record.description,
    "",
    `- **Record:** \`${record.id}\`, recorded ${record.recordedAt}, outcome ${record.outcome}`,
    `- **Source:** \`${record.source.path}\`, SHA-256 \`${record.source.sha256}\``,
    `- **Summary:** ${record.summary}`,
    "",
  ];
  if (record.approvals) {
    lines.push("| Approver | Signed at |", "|---|---|", ...record.approvals.map((approval) => `| ${approval.role} | ${approval.signedAt} |`), "");
  }
  const hasStatus = record.steps.some((step) => step.actualStatus !== undefined);
  if (hasStatus) {
    lines.push(
      "| Step | Action | Transaction | Block | Expected | Actual | Coverage (bps) | Covenant state |",
      "|---|---|---|---|---|---|---|---|",
      ...record.steps.map(
        (step) => `| ${step.label} | ${cell(step.action)} | ${link(step)} | ${step.blockNumber ?? ""} | ${step.expectedStatus ?? ""} | ${step.actualStatus ?? ""} | ${step.coverageBps ?? ""} | ${step.covenantState ?? ""} |`,
      ),
    );
  } else {
    lines.push(
      "| Step | What happened | Result | At | Transaction |",
      "|---|---|---|---|---|",
      ...record.steps.map((step) => `| ${step.label} | ${cell(step.action)} | ${cell(step.result ?? "")} | ${step.at ?? ""} | ${link(step)} |`),
    );
  }
  lines.push("");
  if (record.disclaimers.length > 0) lines.push(...record.disclaimers.map((text) => `> ${text}`), "");
  return lines;
}

function link(step: RecordedStep): string {
  return step.transactionHash && step.explorer ? `[${step.transactionHash.slice(0, 10)}…](${step.explorer})` : "";
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  writeFileSync(EVIDENCE_PAGE, renderEvidencePage());
  console.log(`wrote ${EVIDENCE_PAGE.pathname}`);
}
