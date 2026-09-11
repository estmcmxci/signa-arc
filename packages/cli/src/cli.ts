import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Cli, z } from "incur";
import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";

import {
  SignaError,
  inspectEnvelope,
  parseDrawAmount,
  parseEnvelope,
  readCoverage,
  readCredentials,
  readDeploymentStatus,
  readFacility,
  simulateDraw,
  type BlockContext,
  type ReadClient,
} from "@signa/client";

import { invocationDirectory, resolveConfig, resolveManifest, type ResolvedConfig } from "./config.ts";
import { EVIDENCE_RECORD_IDS, RECORDED_NOTICE, evidenceRecord, evidenceSummary } from "./evidence/index.ts";
import {
  coverageOutput,
  credentialsListOutput,
  drawSimulateOutput,
  evidenceOutput,
  facilityOutput,
  inspectOutput,
  statusOutput,
} from "./schemas.ts";

/**
 * The `signa` command tree. Importing this module builds the definition and does nothing else:
 * no argv parsing, no RPC client, no file reads. `bin.ts` serves it; tests call `serve()` with
 * injected argv, env and dependencies; docs tooling reads its metadata.
 *
 * Pinned to incur 0.5.1 (see SPIKES.md). Every command here is read-only: none takes a key or
 * sends a transaction.
 */

export const SIGNA_CLI_VERSION = "0.0.0";

export type SignaCliDependencies = {
  /** Creates the client for live reads. Offline and recorded commands never call it. Tests inject one. */
  publicClient?: ((rpcUrl: string) => ReadClient) | undefined;
  /** Reads a file named on the command line or in SIGNA_MANIFEST. */
  readFile?: ((path: string) => Uint8Array) | undefined;
  cwd?: (() => string) | undefined;
};

/** Options every live command takes (ERD C-02). */
const manifestOption = z.string().optional().describe("Deployment manifest file. Default: SIGNA_MANIFEST, then the bundled Arc Testnet manifest");
const liveOptions = z.object({
  manifest: manifestOption,
  rpcUrl: z.string().optional().describe("RPC URL. Default: SIGNA_RPC_URL, then the manifest's rpcUrl"),
});
const liveEnv = z.object({
  SIGNA_MANIFEST: z.string().optional().describe("Deployment manifest file, used when --manifest is not given"),
  SIGNA_RPC_URL: z.string().optional().describe("RPC URL, used when --rpc-url is not given"),
});

const STATUS_SCOPE = "Connectivity and deployment wiring at one block. Not a report of coverage, covenant state or draw eligibility.";
const FACILITY_SCOPE =
  "The facility's frozen policy, roles, vault balances and the covenant state the vault last stored, at one block. The stored state is not a fresh coverage evaluation: `signa coverage show` gives that.";
const COVERAGE_SCOPE =
  "The coverage engine's evaluation and per-credential verdicts at one block. Coverage evidence expires, so this can change without any transaction.";
const SIMULATION_SCOPE =
  "Simulated with eth_call at this block, sent from the facility's operator. Nothing was sent and no state changed. A permitted simulation does not guarantee that a later draw succeeds.";
const OFFLINE_ESTABLISHED = [
  "The envelope is well-formed, with exact ABI widths and decimal strings.",
  "Its domain names this chain and credential registry.",
  "Its credential names the selected facility.",
  "Its digest is the credential's EIP-712 hash, recomputed.",
  "Its signature recovers to the claimed issuer.",
];
const OFFLINE_NOT_ESTABLISHED = [
  "That the registry currently authorizes the signer.",
  "That the credential has not been revoked.",
  "That its sequence is above the registry's current one.",
  "That it would count toward coverage.",
];

export function createSignaCli(dependencies: SignaCliDependencies = {}) {
  const publicClient = dependencies.publicClient ?? arcPublicClient;
  const readFile = dependencies.readFile ?? ((path: string) => readFileSync(path));
  const cwd = dependencies.cwd ?? (() => invocationDirectory());

  /** Resolves configuration, runs one live read, and wraps it in the shared live context. */
  async function live<T extends { chainId: number; block: BlockContext }>(
    options: { manifest?: string | undefined; rpcUrl?: string | undefined },
    env: { SIGNA_MANIFEST?: string | undefined; SIGNA_RPC_URL?: string | undefined },
    read: (client: ReadClient, config: ResolvedConfig) => Promise<T>,
    before?: () => void,
  ) {
    const config = resolveConfig({ manifestOption: options.manifest, rpcUrlOption: options.rpcUrl, env, readFile, cwd: cwd() });
    before?.();
    const { chainId, block, ...result } = await read(publicClient(config.rpcUrl), config);
    const context = {
      chainId,
      facilityId: config.manifest.facility.id,
      vault: config.manifest.contracts.covenantVault.address,
      manifest: config.manifestProvenance,
      rpc: config.rpc,
      block,
    };
    return { context, result };
  }

  const cli = Cli.create("signa", {
    version: SIGNA_CLI_VERSION,
    description: "Inspect a Signa Covenant facility on Arc Testnet, simulate a draw, check a signed credential offline, and read the recorded evidence. Read-only: no command here needs a key.",
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
      return guarded(c, async () => {
        const { context, result } = await live(c.options, c.env, (client, config) => readDeploymentStatus(client, config.manifest, config.rpcUrl));
        return { schemaVersion: 1 as const, kind: "report" as const, dataMode: "live" as const, context, ready: true as const, checks: result.checks, scope: STATUS_SCOPE };
      });
    },
  });

  const facility = Cli.create("facility", { description: "The facility's policy, roles, vault and stored covenant state" });
  facility.command("show", {
    description: "Show the frozen policy, role addresses, vault balance and principal, stored covenant state and waiver, all read at one block",
    options: liveOptions,
    env: liveEnv,
    output: facilityOutput,
    examples: [{ description: "Show the Arc Testnet facility" }],
    hint: "The stored covenant state is what the vault last recorded. For a fresh evaluation of coverage, run `signa coverage show`.",
    async run(c) {
      return guarded(c, async () => {
        const { context, result } = await live(c.options, c.env, (client, config) => readFacility(client, config.manifest, config.rpcUrl));
        return { schemaVersion: 1 as const, kind: "report" as const, dataMode: "live" as const, context, ...result, scope: FACILITY_SCOPE };
      });
    },
  });
  cli.command(facility);

  const coverage = Cli.create("coverage", { description: "The coverage engine's evaluation of the facility" });
  coverage.command("show", {
    description: "Show the engine's evaluation, gross and counted coverage, and the eligibility verdict on each credential, all read at one block",
    options: liveOptions,
    env: liveEnv,
    output: coverageOutput,
    examples: [{ description: "Evaluate coverage on Arc Testnet now" }],
    hint: "Every verdict comes from CoverageEngine itself. Coverage evidence expires, so a compliant facility can become non-compliant without any transaction.",
    async run(c) {
      return guarded(c, async () => {
        const { context, result } = await live(c.options, c.env, (client, config) => readCoverage(client, config.manifest, config.rpcUrl));
        return { schemaVersion: 1 as const, kind: "report" as const, dataMode: "live" as const, context, ...result, scope: COVERAGE_SCOPE };
      });
    },
  });
  cli.command(coverage);

  const credentials = Cli.create("credentials", { description: "Credentials the registry holds, and offline inspection of a signed envelope" });
  credentials.command("list", {
    description: "List the current exposure and active hedge assertions, with sequences and age at the report block",
    options: liveOptions,
    env: liveEnv,
    output: credentialsListOutput,
    examples: [{ description: "List the credentials the registry holds for the facility" }],
    hint: "Accepted by the registry is not the same as eligible for coverage. `signa coverage show` reports the engine's verdict on each credential.",
    async run(c) {
      return guarded(c, async () => {
        const { context, result } = await live(c.options, c.env, (client, config) => readCredentials(client, config.manifest, config.rpcUrl));
        return { schemaVersion: 1 as const, kind: "report" as const, dataMode: "live" as const, context, ...result };
      });
    },
  });
  credentials.command("inspect", {
    description: "Check a signed credential envelope offline: its format, domain, facility, digest and recovered signer. No RPC, no key",
    args: z.object({ file: z.string().describe("A signed credential envelope, as JSON") }),
    options: z.object({ manifest: manifestOption }),
    env: z.object({ SIGNA_MANIFEST: z.string().optional().describe("Deployment manifest file, used when --manifest is not given") }),
    output: inspectOutput,
    examples: [{ args: { file: "./hedge-envelope.json" }, description: "Inspect an envelope against the bundled deployment" }],
    hint: "Offline inspection proves format, domain and signature only. It does not check live issuer authorization, revocation, the registry's current sequence, or eligibility.",
    async run(c) {
      return guarded(c, async () => {
        const { manifest, manifestProvenance } = resolveManifest({ manifestOption: c.options.manifest, env: c.env, readFile, cwd: cwd() });
        const path = resolve(cwd(), c.args.file);
        let bytes: Uint8Array;
        try {
          bytes = readFile(path);
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          throw new SignaError("INVALID_INPUT", `cannot read the envelope at ${path}${typeof code === "string" ? ` (${code})` : ""}`);
        }
        let data: unknown;
        try {
          data = JSON.parse(new TextDecoder().decode(bytes));
        } catch (error) {
          throw new SignaError("INVALID_INPUT", `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        const envelope = await inspectEnvelope(parseEnvelope(data), manifest);
        return {
          schemaVersion: 1 as const,
          kind: "report" as const,
          dataMode: "offline" as const,
          context: {
            chainId: manifest.chainId,
            facilityId: manifest.facility.id,
            credentialRegistry: manifest.contracts.credentialRegistry.address,
            manifest: manifestProvenance,
            input: { path, sha256: createHash("sha256").update(bytes).digest("hex") },
          },
          envelope,
          established: OFFLINE_ESTABLISHED,
          notEstablished: OFFLINE_NOT_ESTABLISHED,
        };
      });
    },
  });
  cli.command(credentials);

  const draw = Cli.create("draw", { description: "Draw simulation against the real vault" });
  draw.command("simulate", {
    description: "Simulate CovenantVault.draw as the facility's operator at one block, and decode a refusal. Nothing is sent",
    options: liveOptions.extend({
      amount: z.string().describe("USDC to draw, as a decimal string: 1 is one USDC, 1000000 units"),
    }),
    env: liveEnv,
    output: drawSimulateOutput,
    examples: [
      { options: { amount: "1" }, description: "Simulate drawing one USDC" },
      { options: { amount: "0.5" }, description: "Simulate drawing half a USDC" },
    ],
    hint: "A refusal is a valid covenant outcome and exits 0. A transport failure, or a revert no contract error decodes, exits 1.",
    async run(c) {
      return guarded(c, async () => {
        let units = 0n;
        const { context, result } = await live(
          c.options,
          c.env,
          (client, config) => simulateDraw(client, config.manifest, config.rpcUrl, units),
          () => {
            units = parseDrawAmount(c.options.amount);
          },
        );
        return { schemaVersion: 1 as const, kind: "simulation" as const, dataMode: "live" as const, context, ...result, scope: SIMULATION_SCOPE };
      });
    },
  });
  cli.command(draw);

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

/** Runs a handler and turns a SignaError into incur's error result; anything else propagates. */
async function guarded<T>(
  c: { error: (options: { code: string; message: string; retryable?: boolean | undefined }) => never },
  handler: () => Promise<T>,
): Promise<T> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof SignaError) return c.error({ code: error.code, message: error.message, retryable: error.retryable });
    throw error;
  }
}

function arcPublicClient(rpcUrl: string): ReadClient {
  return createPublicClient({ chain: arcTestnet, transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });
}

export const cli = createSignaCli();
export default cli;
