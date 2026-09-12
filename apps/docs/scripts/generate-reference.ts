import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  ENVELOPE_KEYS,
  ERROR_DESCRIPTIONS,
  EXPOSURE_FIELDS,
  HEDGE_FIELDS,
  SIGNA_ERROR_CODES,
  bundledManifest,
  type EnvelopeField,
} from "../../../packages/client/src/index.ts";
import { createSignaCli } from "../../../packages/cli/src/cli.ts";

/**
 * Generates the Reference pages (ERD §9). Commands come from the command tree `signa` ships,
 * read through incur's own manifest, so the reference cannot drift from the binary; no handler
 * runs and no RPC client is created. Errors, the envelope schema and the deployment table come
 * from the client package and the bundled manifest.
 *
 *   pnpm generate:reference
 *
 * packages/cli/test/docs.test.ts fails when a checked-in page drifts from this output.
 */

const PAGES = new URL("../src/pages/reference/", import.meta.url);

type JsonSchema = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
};
type ManifestCommand = {
  name: string;
  description?: string;
  examples?: { command: string; description?: string }[];
  schema?: { args?: JsonSchema; options?: JsonSchema; env?: JsonSchema; output?: JsonSchema };
};

/** The shipped command tree, as incur describes it. Metadata only: no handler is executed. */
export async function commandManifest(): Promise<ManifestCommand[]> {
  let stdout = "";
  await createSignaCli().serve(["--llms-full", "--format", "json"], { stdout: (text) => void (stdout += text), exit: () => {}, env: {} });
  return (JSON.parse(stdout) as { commands: ManifestCommand[] }).commands;
}

export async function renderCommandsPage(): Promise<string> {
  const commands = await commandManifest();
  const lines = [
    frontmatter("Commands", "Every signa command, generated from the shipped command tree: arguments, options, environment variables, output fields and examples."),
    "# Commands",
    "",
    "Generated from the command tree `signa` ships, so it cannot drift from the binary.",
    "",
    "Most commands only read, and need no key. The commands that take `--account` sign with a Foundry keystore and broadcast exactly one transaction: they are marked below, and they are the only ones that can move anything.",
    "",
    "Add `--json` for one JSON document on stdout, or `--schema --format json` for a command's JSON Schema. [For agents](/agents) describes the shared result shape and the error codes.",
    "",
  ];
  for (const command of commands) {
    const { args, options, env, output } = command.schema ?? {};
    lines.push(`## signa ${command.name}`, "", command.description ?? "", "");
    lines.push("```bash", `pnpm signa ${command.name}${usage(args, options)}`, "```", "");
    lines.push(classify(command.name, options, output), "");
    if (args?.properties) lines.push(...fields("Arguments", args, "Argument"));
    if (options?.properties) lines.push(...fields("Options", options, "Option", true));
    if (env?.properties) lines.push(...fields("Environment variables", env, "Variable"));
    if (output?.properties) lines.push(...fields("Output", output, "Field"));
    if (command.examples?.length) {
      lines.push("### Examples", "");
      for (const example of command.examples) lines.push(`- ${example.description ?? "Example"}:`, "", "```bash", `pnpm signa ${example.command}`, "```", "");
    }
  }
  return lines.join("\n");
}

export function renderErrorsPage(): string {
  const raised = SIGNA_ERROR_CODES.filter((code) => !ERROR_DESCRIPTIONS[code].raisedBy.startsWith("not raised"));
  const reserved = SIGNA_ERROR_CODES.filter((code) => ERROR_DESCRIPTIONS[code].raisedBy.startsWith("not raised"));
  return [
    frontmatter("Error codes", "Every code signa can print, what it means, which command raises it, and the exit codes. Consumers branch on the code, never on the message."),
    "# Error codes",
    "",
    "On failure the exit code is 1 and stdout carries one JSON object. Branch on `code`; the message may change between releases.",
    "",
    ...table(
      ["Field", "Present", "Meaning"],
      [
        ["`code`", "always", "One of the codes below."],
        ["`message`", "always", "Human-readable detail."],
        ["`retryable`", "Signa's own codes", "`true` when the same request may succeed later, as after an RPC outage."],
        ["`cta`", "`COMMAND_NOT_FOUND`, and any failure that left a transaction on the chain", "incur's suggested next commands. For `TRANSACTION_PENDING` and `TRANSACTION_REVERTED` it carries the transaction hash, as `signa tx show <hash>`."],
        ["`fieldErrors`", "`VALIDATION_ERROR`", "incur's failing fields, each with `path`, `code` and `message`."],
      ],
    ),
    "## Raised in this release",
    "",
    ...table(
      ["Code", "Meaning", "Raised by"],
      raised.map((code) => [`\`${code}\``, ERROR_DESCRIPTIONS[code].meaning, ERROR_DESCRIPTIONS[code].raisedBy]),
    ),
    "## From incur, the command framework",
    "",
    ...table(
      ["Code", "Meaning"],
      [
        ["`VALIDATION_ERROR`", "An argument or option failed its schema. `fieldErrors` names each one."],
        ["`COMMAND_NOT_FOUND`", "No such command."],
        ["`UNKNOWN`", "An unknown flag, or an unexpected failure."],
        ["`UPDATE_FAILED`", "`--update` cannot run: `signa` is not published."],
      ],
    ),
    ...(reserved.length === 0
      ? []
      : [
          "## Reserved",
          "",
          "These codes are fixed now so the set stays stable as commands are added. Nothing raises them yet.",
          "",
          ...table(["Code", "Meaning"], reserved.map((code) => [`\`${code}\``, ERROR_DESCRIPTIONS[code].meaning])),
        ]),
    "## What an error looks like",
    "",
    "A read that cannot reach its RPC:",
    "",
    "```json",
    JSON.stringify({ code: "RPC_UNAVAILABLE", message: "RPC request to https://rpc.testnet.arc.network failed: fetch failed", retryable: true }, null, 2),
    "```",
    "",
    "A send refused before anything reached the chain:",
    "",
    "```json",
    JSON.stringify(
      {
        code: "ACTION_REFUSED",
        message: "draw was refused: ReserveViolation, because it would leave the vault below its reserve. Balance 1.500000, requested 2.000000, reserve 0.500000 USDC. Nothing was broadcast.",
        retryable: false,
      },
      null,
      2,
    ),
    "```",
    "",
    "A send whose receipt never arrived. The hash is in the `cta`, and in the operation journal:",
    "",
    "```json",
    JSON.stringify(
      {
        code: "TRANSACTION_PENDING",
        message: "syncCovenant was broadcast as 0xd4a5e4e7cac39d69d0c4a20ff9c2420592ebfe362fbed13579287d0f9517c86b but no receipt arrived within 120s. It was not retried or replaced, and it may still be mined.",
        retryable: true,
        cta: { description: "The transaction was broadcast and its hash is 0xd4a5e4e7cac39d69d0c4a20ff9c2420592ebfe362fbed13579287d0f9517c86b. It was not retried or replaced.", commands: [{ command: "signa tx show 0xd4a5e4e7cac39d69d0c4a20ff9c2420592ebfe362fbed13579287d0f9517c86b" }] },
      },
      null,
      2,
    ),
    "```",
    "",
    "## Was anything broadcast?",
    "",
    "For a write command this is the question that matters, and the code answers it on its own. incur fixes the error document to `code`, `message` and `retryable`, so a failure that left a transaction on the chain carries its hash in the `cta` rather than in a field of its own. The operation journal records the same hash as structured JSON.",
    "",
    ...table(
      ["Outcome", "Broadcast", "Where the hash is"],
      [
        ["Exit 0, a `kind: transaction` result", "Yes, and mined successfully", "`transaction.hash`"],
        ["`ACTION_REFUSED`, `SIGNER_ROLE_MISMATCH`, `STALE_SEQUENCE`, `SIGNER_UNAVAILABLE`, `SIMULATION_FAILED`, `INVALID_*`, `CHAIN_MISMATCH`, `DEPLOYMENT_MISMATCH`", "No. Nothing reached the chain and nothing was spent", "There is none"],
        ["`TRANSACTION_REVERTED`", "Yes, and it failed: receipt status 0x0", "`cta.commands[0]`, and the journal"],
        ["`TRANSACTION_PENDING`", "Yes, and its fate is not yet known. It was not retried or replaced", "`cta.commands[0]`, and the journal"],
        ["`RPC_UNAVAILABLE`", "Unknown if it happened during the wait. Check the journal", "The journal, when the send got that far"],
      ],
    ),
    "## Exit codes",
    "",
    ...table(
      ["Outcome", "Exit code"],
      [
        ["A completed report, including an offline inspection", "0"],
        ["A completed simulation, whether the draw is permitted or refused", "0"],
        ["A send whose transaction mined successfully", "0"],
        ["Any error above, including a refused send, a reverted transaction and a receipt timeout", "1"],
      ],
    ),
    "A refused draw is a valid covenant outcome: the inquiry succeeded, so the exit code is 0 and `allowed` is `false`. A transport failure, or a revert no contract error decodes, is a failed inquiry and exits 1.",
    "",
  ].join("\n");
}

export function renderEnvelopePage(): string {
  const fieldRows = (fields: readonly EnvelopeField[]) => fields.map((field) => [`\`${field.name}\``, `\`${field.type}\``, field.description]);
  return [
    frontmatter(
      "Signed credential envelope",
      "The versioned envelope signa inspects offline: its fields, their ABI widths and encodings, and what inspection does and does not establish.",
    ),
    "# Signed credential envelope",
    "",
    "An envelope carries one exposure or hedge credential exactly as its issuer signed it, with the EIP-712 domain, the signature, and the issuer and digest it claims. `signa credentials inspect <file>` checks one offline.",
    "",
    "Monetary and time fields are decimal strings, never JSON numbers, so no value passes through a floating-point type. Bytes fields are 0x-prefixed hex of exactly their ABI width.",
    "",
    "## The envelope",
    "",
    ...table(["Field", "Type", "Description"], ENVELOPE_KEYS.map((key) => [`\`${key.name}\``, `\`${key.type}\``, key.description])),
    "## `credential`, when `kind` is `exposure`",
    "",
    ...table(["Field", "Type", "Description"], fieldRows(EXPOSURE_FIELDS)),
    "## `credential`, when `kind` is `hedge`",
    "",
    ...table(["Field", "Type", "Description"], fieldRows(HEDGE_FIELDS)),
    "## What inspection establishes",
    "",
    "- The envelope is well-formed, with exact ABI widths and decimal strings.",
    "- Its domain names the selected chain and credential registry.",
    "- Its credential names the selected facility.",
    "- Its digest is the credential's EIP-712 hash, recomputed rather than trusted.",
    "- Its signature recovers to the claimed issuer.",
    "",
    "## What it does not",
    "",
    "- That the registry currently authorizes the signer.",
    "- That the credential has not been revoked.",
    "- That its sequence is above the registry's current one.",
    "- That it would count toward coverage: `signa coverage show` reports the engine's verdict.",
    "",
    "A signature authenticates who asserted something. It does not prove that a hedge legally exists.",
    "",
  ].join("\n");
}

export function renderDeploymentPage(): string {
  const manifest = bundledManifest();
  const explorer = (kind: "address" | "tx", value: string) => `[\`${value}\`](${manifest.explorer}/${kind}/${value})`;
  const policy = manifest.facility.policy;
  const quorum = manifest.facilityAdminQuorum;
  return [
    frontmatter("Deployment", "The Arc Testnet deployment signa reads by default: contracts, settlement asset, roles and the facility's frozen policy, from the bundled manifest."),
    "# Deployment",
    "",
    `Generated from the deployment manifest bundled with the CLI, a copy of \`deployments/arc-testnet.json\`. \`signa status\` checks this deployment live, and every report says which manifest it used.`,
    "",
    ...table(
      ["", ""],
      [
        ["Chain", `Arc Testnet, ${manifest.chainId}`],
        ["RPC", `\`${manifest.rpcUrl}\``],
        ["Explorer", manifest.explorer],
        ["Deployed source", `\`${manifest.sourceCommit}\``],
        ["Deployed at", manifest.deployedAt],
        ["Facility", `\`${manifest.facility.id}\``],
      ],
    ),
    "## Contracts",
    "",
    ...table(
      ["Contract", "Address", "Deployed in"],
      Object.entries(manifest.contracts).map(([name, record]) => [name, explorer("address", record.address), `block ${record.block}`]),
    ),
    "## Assets and roles",
    "",
    ...table(
      ["", "Address", "Note"],
      [
        ["Settlement asset", explorer("address", manifest.settlementAsset.address), `${manifest.settlementAsset.symbol}, ${manifest.settlementAsset.decimals} decimals. Everything is accounted in this view.`],
        ...(manifest.exposureDenomination
          ? [["Exposure denomination", explorer("address", manifest.exposureDenomination.referenceAsset.address), `${manifest.exposureDenomination.referenceAsset.symbol}. Referenced only; never transferred, held or approved.`]]
          : []),
        ["Facility admin", explorer("address", manifest.roles.facilityAdmin), quorum ? `A ${quorum.provider} ${quorum.threshold}-of-${quorum.approvers.length} key quorum: ${quorum.approvers.map((approver) => approver.role).join(" and ")}.` : "Set once, at creation."],
        ["Operator", explorer("address", manifest.roles.operator), "Draws and repays. `draw simulate` sends as this address."],
        ["Exposure issuer", explorer("address", manifest.roles.exposureIssuer), "A test key held by the project. No bank signs anything here."],
        ["Hedge issuer", explorer("address", manifest.roles.hedgeIssuer), "A test key held by the project; the hedge data is a labelled mock."],
      ],
    ),
    "## The facility's frozen policy",
    "",
    ...table(
      ["Setting", "Value", "Meaning"],
      [
        ["`minCoverageBps`", String(policy.minCoverageBps), "Coverage required, in basis points."],
        ["`defaultHaircutBps`", String(policy.defaultHaircutBps), "Discount applied to a hedge's notional."],
        ["`credentialMaxAgeSeconds`", String(policy.credentialMaxAgeSeconds), "How old an assertion may be before the engine calls it stale."],
        ["`maturityToleranceSeconds`", String(policy.maturityToleranceSeconds), "How far a hedge's maturity may fall short of the exposure's."],
        ["`reserveAmount`", policy.reserveAmount, "Units of the settlement asset the vault must keep."],
        ["`cureWindowSeconds`", String(policy.cureWindowSeconds), "How long the facility may stay in CURE before BREACH."],
        ["`maxWaiverDurationSeconds`", String(policy.maxWaiverDurationSeconds), "The longest waiver the admin may create."],
        ...(policy.maxActiveHedges === undefined ? [] : [["`maxActiveHedges`", String(policy.maxActiveHedges), "Active hedge assertions allowed at once."]]),
        ...(policy.settlementCurrency === undefined ? [] : [["`settlementCurrency`", policy.settlementCurrency, "What the facility settles in."]]),
        ...(policy.exposureCurrency === undefined ? [] : [["`exposureCurrency`", policy.exposureCurrency, "What the exposure is denominated in."]]),
      ],
    ),
    "The policy is frozen: `FacilityRegistry` writes it once, and the facility's admin can never change.",
    "",
    "This is a fictional facility on a testnet, with labelled mock provider data and testnet USDC. The recorded runs are on [Recorded on Arc Testnet](/evidence).",
    "",
  ].join("\n");
}

function usage(args: JsonSchema | undefined, options: JsonSchema | undefined): string {
  const positional = Object.keys(args?.properties ?? {}).map((name) => (args?.required?.includes(name) ? ` <${name}>` : ` [${name}]`));
  const required = Object.entries(options?.properties ?? {})
    .filter(([name]) => options?.required?.includes(name))
    .map(([name]) => ` --${kebab(name)} <${name}>`);
  return [...positional, ...required].join("") + (Object.keys(options?.properties ?? {}).length > required.length ? " [options]" : "");
}

function fields(heading: string, schema: JsonSchema, label: string, showRequired = false): string[] {
  const rows = Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const displayed = heading === "Options" ? `--${kebab(name)}` : name;
    const row = [`\`${displayed}\``, `\`${typeName(property)}\``];
    if (showRequired) row.push(schema.required?.includes(name) ? "yes" : "no");
    row.push(property.description ?? "");
    return row;
  });
  const headers = showRequired ? [label, "Type", "Required", "Description"] : [label, "Type", "Description"];
  return [`### ${heading}`, "", ...table(headers, rows)];
}

function typeName(schema: JsonSchema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map(typeName).join(" | ");
  if (schema.type === "array") return `array of ${schema.items ? typeName(schema.items) : "values"}`;
  return Array.isArray(schema.type) ? schema.type.join(" | ") : (schema.type ?? "value");
}

/**
 * What a command can change, taken from the `kind` its own output schema declares, so it cannot
 * drift from the binary: `transaction` puts something on chain, `proposal` authorizes a Privy
 * intent that only `waiver broadcast` puts on chain, and anything else only reads.
 */
function classify(name: string, options: JsonSchema | undefined, output: JsonSchema | undefined): string {
  const kind = output?.properties?.["kind"]?.const;
  if (kind === "transaction") {
    return options?.properties?.["account"]
      ? "**Signs and sends one transaction.** It is simulated first as the named signer; if that refuses, nothing is broadcast. The hash is recorded in the operation journal before any receipt wait, and success is decided by the receipt."
      : "**Broadcasts one transaction**, the one the key quorum already signed. Its hash is recorded before any receipt wait, and success is decided by the receipt, never by the signing service.";
  }
  if (kind === "proposal") {
    return "**Changes a proposal, not the chain.** It authorizes a Privy intent; nothing reaches Arc until `signa waiver broadcast`. No keystore is involved, and Privy credentials come from the environment, never a flag.";
  }
  return `Reads only: no key, no transaction${needsRpc(name) ? "" : ", and no RPC"}.`;
}

function needsRpc(name: string): boolean {
  return !["credentials inspect", "evidence show"].includes(name);
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function table(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`),
    "",
  ];
}

/**
 * YAML frontmatter. Both values are emitted as double-quoted scalars: a description that reads
 * naturally often contains `: `, which YAML would otherwise parse as a mapping key and reject.
 */
function frontmatter(title: string, description: string): string {
  return ["---", `title: ${JSON.stringify(title)}`, `description: ${JSON.stringify(description)}`, "---", ""].join("\n");
}

export const REFERENCE_PAGES: { file: string; render: () => string | Promise<string> }[] = [
  { file: "commands.md", render: renderCommandsPage },
  { file: "errors.md", render: renderErrorsPage },
  { file: "envelope.md", render: renderEnvelopePage },
  { file: "deployment.md", render: renderDeploymentPage },
];

export async function renderReferencePage(file: string): Promise<string> {
  const page = REFERENCE_PAGES.find((candidate) => candidate.file === file);
  if (!page) throw new Error(`no reference page ${file}`);
  return page.render();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const page of REFERENCE_PAGES) {
    writeFileSync(new URL(page.file, PAGES), await page.render());
    console.log(`wrote apps/docs/src/pages/reference/${page.file}`);
  }
}
