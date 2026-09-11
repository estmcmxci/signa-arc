import { readFileSync } from "node:fs";

import { Cli, z } from "incur";
import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";

import { SignaError, readDeploymentStatus, type StatusClient } from "@signa/client";

import { invocationDirectory, resolveConfig } from "./config.ts";
import { EVIDENCE_RECORD_IDS, RECORDED_NOTICE, evidenceRecord, evidenceSummary } from "./evidence/index.ts";

/**
 * The `signa` command tree. Importing this module builds the definition and does nothing else:
 * no argv parsing, no RPC client, no file reads. `bin.ts` serves it; tests call `serve()` with
 * injected argv, env and dependencies; docs tooling reads its metadata.
 *
 * Pinned to incur 0.5.1 (see SPIKES.md). Every command here is read-only.
 */

export const SIGNA_CLI_VERSION = "0.0.0";

export type SignaCliDependencies = {
  /** Creates the client for live reads. `evidence show` never calls it. Tests inject one. */
  publicClient?: ((rpcUrl: string) => StatusClient) | undefined;
  /** Reads a manifest named by `--manifest` or `SIGNA_MANIFEST`. */
  readFile?: ((path: string) => Uint8Array) | undefined;
  cwd?: (() => string) | undefined;
};

/** Options every live command takes (ERD C-02). */
const liveOptions = z.object({
  manifest: z.string().optional().describe("Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest"),
  rpcUrl: z.string().optional().describe("RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl"),
});

const liveEnv = z.object({
  SIGNA_MANIFEST: z.string().optional().describe("Deployment manifest file, used when --manifest is not given"),
  SIGNA_RPC_URL: z.string().optional().describe("RPC URL, used when --rpc-url is not given"),
});

const statusOutput = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("report"),
  dataMode: z.literal("live"),
  context: z.object({
    chainId: z.number(),
    facilityId: z.string(),
    vault: z.string(),
    manifest: z.object({
      source: z.enum(["option", "environment", "bundled"]),
      path: z.string().optional().describe("Absolute path, for a manifest file"),
      sha256: z.string().optional().describe("SHA-256 of the manifest file's bytes"),
      copyOf: z.string().optional().describe("The repository file the bundled manifest copies"),
    }),
    rpc: z.object({ url: z.string().describe("Redacted RPC URL"), source: z.enum(["option", "environment", "manifest"]) }),
    block: z.object({ number: z.string(), hash: z.string(), timestamp: z.string() }).describe("The block every check was read at"),
  }),
  ready: z.literal(true),
  checks: z.array(z.object({ check: z.string(), detail: z.string() })),
  scope: z.string(),
});

const recordSource = z.object({ path: z.string(), sha256: z.string() });
const recordSummary = z.object({
  id: z.enum(EVIDENCE_RECORD_IDS),
  title: z.string(),
  description: z.string(),
  recordedAt: z.string().describe("When the record was made, not now"),
  outcome: z.string(),
  summary: z.string(),
  transactions: z.number(),
  source: recordSource,
});
const recordDetail = recordSummary.extend({
  network: z.object({ chainId: z.number(), explorer: z.string() }),
  facilityId: z.string(),
  steps: z.array(
    z.object({
      label: z.string(),
      action: z.string(),
      transactionHash: z.string().optional(),
      explorer: z.string().optional(),
      blockNumber: z.string().optional(),
      sender: z.string().optional(),
      expectedStatus: z.string().optional(),
      actualStatus: z.string().optional(),
      covenantState: z.string().optional(),
      coverageBps: z.number().optional(),
      reason: z.string().optional(),
      result: z.string().optional(),
      at: z.string().optional(),
    }),
  ),
  approvals: z.array(z.object({ role: z.string(), signedAt: z.string() })).optional(),
  disclaimers: z.array(z.string()),
});
const recordedBase = {
  schemaVersion: z.literal(1),
  kind: z.literal("report"),
  dataMode: z.literal("recorded"),
  notice: z.string(),
};
const evidenceOutput = z.union([
  z.object({ ...recordedBase, chainId: z.number(), facilityId: z.string(), records: z.array(recordSummary) }),
  z.object({ ...recordedBase, record: recordDetail }),
]);

export function createSignaCli(dependencies: SignaCliDependencies = {}) {
  const publicClient = dependencies.publicClient ?? arcPublicClient;
  const readFile = dependencies.readFile ?? ((path: string) => readFileSync(path));
  const cwd = dependencies.cwd ?? (() => invocationDirectory());

  const cli = Cli.create("signa", {
    version: SIGNA_CLI_VERSION,
    description: "Inspect a Signa Covenant facility on Arc Testnet, and read its recorded evidence. Read-only: no command here needs a key.",
    // No automatic update checks. See SPIKES.md for what `--update` does.
    update: false,
  });

  cli.command("status", {
    description: "Check the manifest and live connectivity: chain, contract code and facility wiring, all read at one block",
    options: liveOptions,
    env: liveEnv,
    output: statusOutput,
    examples: [
      { description: "Check the bundled Arc Testnet deployment" },
      { options: { manifest: "./deployments/arc-testnet.json" }, description: "Check a manifest file" },
    ],
    hint: "status reports connectivity and deployment wiring only. It does not report coverage, covenant state, or whether a draw would be permitted.",
    async run(c) {
      try {
        const config = resolveConfig({
          manifestOption: c.options.manifest,
          rpcUrlOption: c.options.rpcUrl,
          env: c.env,
          readFile,
          cwd: cwd(),
        });
        const status = await readDeploymentStatus(publicClient(config.rpcUrl), config.manifest, config.rpcUrl);
        return {
          schemaVersion: 1 as const,
          kind: "report" as const,
          dataMode: "live" as const,
          context: {
            chainId: status.chainId,
            facilityId: config.manifest.facility.id,
            vault: config.manifest.contracts.covenantVault.address,
            manifest: config.manifestProvenance,
            rpc: config.rpc,
            block: status.block,
          },
          ready: true as const,
          checks: status.checks,
          scope: "Connectivity and deployment wiring at one block. Not a report of coverage, covenant state or draw eligibility.",
        };
      } catch (error) {
        if (error instanceof SignaError) return c.error({ code: error.code, message: error.message, retryable: error.retryable });
        throw error;
      }
    },
  });

  const evidence = Cli.create("evidence", {
    description: "Recorded evidence from Arc Testnet: past transactions, not current state",
  });
  evidence.command("show", {
    description: "Show recorded evidence: the acceptance run, the coverage drop, the quorum waiver and the restoration. No RPC, no key",
    args: z.object({
      record: z.enum(EVIDENCE_RECORD_IDS).optional().describe("One record to show step by step. Omit it for a summary of every record"),
    }),
    output: evidenceOutput,
    examples: [
      { description: "Summarise every recorded run" },
      { args: { record: "acceptance" }, description: "Show the A-1 to A-4 acceptance steps" },
      { args: { record: "waiver" }, description: "Show the quorum-approved waiver" },
    ],
    hint: RECORDED_NOTICE,
    run(c) {
      return c.args.record ? evidenceRecord(c.args.record) : evidenceSummary();
    },
  });
  cli.command(evidence);

  return cli;
}

function arcPublicClient(rpcUrl: string): StatusClient {
  return createPublicClient({ chain: arcTestnet, transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });
}

export const cli = createSignaCli();
export default cli;
