import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Cli, z } from "incur";
import { createPublicClient, encodeFunctionData, erc20Abi, http, isAddressEqual, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";

import {
  COVENANT_STATES,
  EXPOSURE_REASONS,
  HEDGE_REASONS,
  RESULT_REASONS,
  SignaError,
  coverageEngineAbi,
  covenantVaultAbi,
  credentialRegistryAbi,
  enumName,
  facilityRegistryAbi,
  formatAmount,
  inspectEnvelope,
  isoTime,
  openSession,
  parseDrawAmount,
  parseEnvelope,
  readCoverage,
  readCredentials,
  readDeploymentStatus,
  readFacility,
  readTransaction,
  requireVaultBinding,
  simulateDraw,
  type BlockContext,
  type MinedTransaction,
  type ReadClient,
  type ReceiptClient,
} from "@signa/client";

import { invocationDirectory, resolveConfig, resolveManifest, type ResolvedConfig } from "./config.ts";
import { EVIDENCE_RECORD_IDS, RECORDED_NOTICE, evidenceRecord, evidenceSummary } from "./evidence/index.ts";
import { openJournal } from "./journal.ts";
import { performSend, requireSignerRole, type SendContext } from "./operations.ts";
import { openSigner, runCast, type CastRun } from "./signer.ts";
import {
  covenantRestoreOutput,
  covenantSyncOutput,
  coverageOutput,
  credentialsSubmitOutput,
  drawSendOutput,
  txShowOutput,
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
  /** Creates the client for live reads and receipts. Offline and recorded commands never call it. */
  publicClient?: ((rpcUrl: string) => ReceiptClient) | undefined;
  /** Reads a file named on the command line or in SIGNA_MANIFEST. */
  readFile?: ((path: string) => Uint8Array) | undefined;
  cwd?: (() => string) | undefined;
  /** Runs Foundry's `cast`, which is how a write command signs. Tests inject a fake. */
  cast?: CastRun | undefined;
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

/** Options every write command adds (ERD §6). A write command always names its signer. */
const writeOptions = liveOptions.extend({
  account: z.string().describe("Keystore name to sign with, resolved in SIGNA_KEYSTORE_DIR or ~/.foundry/keystores"),
  passwordFile: z.string().optional().describe("File holding the keystore password. Without it, cast prompts, which needs a terminal"),
  timeout: z.string().optional().describe("Whole seconds to wait for a receipt before reporting the transaction pending. Default 120"),
});
const writeEnv = liveEnv.extend({
  SIGNA_KEYSTORE_DIR: z.string().optional().describe("Directory --account names resolve in. Default ~/.foundry/keystores"),
  SIGNA_PASSWORD_FILE: z.string().optional().describe("File holding the keystore password, used when --password-file is not given"),
  SIGNA_JOURNAL: z.string().optional().describe("Operation journal file. Must be outside the repository. Default $XDG_STATE_HOME/signa/operations.jsonl"),
  XDG_STATE_HOME: z.string().optional().describe("Base directory for the default operation journal location"),
});

const SEND_SCOPE =
  "One transaction, simulated as the signer at the preflight block and then broadcast once. Its hash is recorded before any receipt wait. Success is decided by the receipt, not by the signing tool's exit code. Postconditions are read at the receipt's own block.";
const SUBMIT_NOTE =
  "The registry accepted this credential. That is not the same as it counting toward coverage: the eligibility above is the engine's separate verdict at the same block.";
const TX_SCOPE = "One transaction's current state, read at the chain head. A pending transaction may still be mined, replaced or dropped.";

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
  const cast = dependencies.cast ?? runCast;

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

  /**
   * Everything a write command needs, in the order the keystore spike fixed: configuration,
   * a chain-checked session, the vault binding, then the signer, whose address cannot be read
   * without unlocking the keystore. Opening a signer sends nothing.
   */
  async function operate(
    options: { manifest?: string | undefined; rpcUrl?: string | undefined; account: string; passwordFile?: string | undefined; timeout?: string | undefined },
    env: {
      SIGNA_MANIFEST?: string | undefined;
      SIGNA_RPC_URL?: string | undefined;
      SIGNA_KEYSTORE_DIR?: string | undefined;
      SIGNA_PASSWORD_FILE?: string | undefined;
      SIGNA_JOURNAL?: string | undefined;
      XDG_STATE_HOME?: string | undefined;
    },
    command: string,
    before?: () => void,
  ) {
    const config = resolveConfig({ manifestOption: options.manifest, rpcUrlOption: options.rpcUrl, env, readFile, cwd: cwd() });
    before?.();
    const timeoutMs = timeoutSeconds(options.timeout) * 1_000;
    const client = publicClient(config.rpcUrl);
    const session = await openSession(client, config.rpcUrl);
    await requireVaultBinding(session, config.manifest);
    const signer = await openSigner({ account: options.account, passwordFile: options.passwordFile, rpcUrl: config.rpcUrl, env, cwd: cwd(), run: cast });
    const journal = openJournal(env, cwd());
    const send: SendContext = { session, client, signer, journal, timeoutMs, command, chainId: session.chainId, facilityId: config.manifest.facility.id };
    return {
      config,
      client,
      session,
      send,
      account: { name: signer.account, address: signer.address },
      signer,
      journal,
      context: {
        chainId: session.chainId,
        facilityId: config.manifest.facility.id,
        vault: config.manifest.contracts.covenantVault.address,
        manifest: config.manifestProvenance,
        rpc: config.rpc,
        block: session.block,
      },
    };
  }

  /** Reads a file named on the command line, as bytes, with a clear error when it cannot. */
  function readNamedFile(file: string, what: string): { path: string; data: unknown } {
    const path = resolve(cwd(), file);
    let bytes: Uint8Array;
    try {
      bytes = readFile(path);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new SignaError("INVALID_INPUT", `cannot read the ${what} at ${path}${typeof code === "string" ? ` (${code})` : ""}`);
    }
    try {
      return { path, data: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch (error) {
      throw new SignaError("INVALID_INPUT", `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  credentials.command("submit", {
    description: "Submit a signed credential envelope to the registry: checked offline, checked against the current sequence, simulated, then sent as one transaction",
    args: z.object({ file: z.string().describe("A signed credential envelope, as JSON") }),
    options: writeOptions,
    env: writeEnv,
    output: credentialsSubmitOutput,
    destructive: true,
    mcp: false,
    examples: [{ args: { file: "./hedge-envelope.json" }, options: { account: "operator" }, description: "Submit a hedge credential the issuer signed" }],
    hint: "The envelope is submitted exactly as signed. A sequence or timestamp is never rewritten to make a submission fit; a credential the registry has overtaken is reported as STALE_SEQUENCE and nothing is sent.",
    async run(c) {
      return guarded(c, async () => {
        const file = readNamedFile(c.args.file, "envelope");
        const parsed = parseEnvelope(file.data);
        const { config, client, session, send, context, account, journal } = await operate(c.options, c.env, "credentials submit");
        const inspection = await inspectEnvelope(parsed, config.manifest);
        const registry = config.manifest.contracts.credentialRegistry.address;
        const id = config.manifest.facility.id;
        const exposure = parsed.kind === "exposure";
        const tradeIdCommitment = exposure ? undefined : parsed.credential.tradeIdCommitment;

        // Sequence scope is (facility) for exposure and (facility, trade commitment) for hedge.
        const held = exposure
          ? await session.contract("CredentialRegistry.currentExposure()", () =>
              client.readContract({ address: registry, abi: credentialRegistryAbi, blockNumber: session.blockNumber, functionName: "currentExposure", args: [id] }),
            )
          : await session.contract("CredentialRegistry.currentHedge()", () =>
              client.readContract({ address: registry, abi: credentialRegistryAbi, blockNumber: session.blockNumber, functionName: "currentHedge", args: [id, tradeIdCommitment as Hex] }),
            );
        if (parsed.credential.sequence <= held.credential.sequence) {
          throw new SignaError(
            "STALE_SEQUENCE",
            `the registry already holds sequence ${held.credential.sequence} for this ${parsed.kind}${exposure ? "" : ` trade commitment ${tradeIdCommitment}`}, and this envelope is sequence ${parsed.credential.sequence}. The signed envelope is left as it is; nothing was broadcast.`,
          );
        }

        const functionName = exposure ? ("submitExposure" as const) : ("submitHedge" as const);
        const data = exposure
          ? encodeFunctionData({ abi: credentialRegistryAbi, functionName: "submitExposure", args: [parsed.credential, parsed.signature] })
          : encodeFunctionData({ abi: credentialRegistryAbi, functionName: "submitHedge", args: [parsed.credential, parsed.signature] });
        const transaction = await performSend(send, { contract: registry, data, functionName }, config.rpcUrl);

        // Postconditions, at the receipt's own block.
        const at = transaction.blockNumber;
        const accepted = exposure
          ? await session.contract("CredentialRegistry.currentExposure()", () =>
              client.readContract({ address: registry, abi: credentialRegistryAbi, blockNumber: at, functionName: "currentExposure", args: [id] }),
            )
          : await session.contract("CredentialRegistry.currentHedge()", () =>
              client.readContract({ address: registry, abi: credentialRegistryAbi, blockNumber: at, functionName: "currentHedge", args: [id, tradeIdCommitment as Hex] }),
            );
        const engine = { address: config.manifest.contracts.coverageEngine.address, abi: coverageEngineAbi, blockNumber: at } as const;
        const evaluation = await session.contract("CoverageEngine.evaluate()", () => client.readContract({ ...engine, functionName: "evaluate", args: [id] }));
        const verdict = exposure
          ? enumName(EXPOSURE_REASONS, await session.contract("CoverageEngine.exposureEligibility()", () => client.readContract({ ...engine, functionName: "exposureEligibility", args: [id] })))
          : enumName(
              HEDGE_REASONS,
              (await session.contract("CoverageEngine.hedgeEligibility()", () => client.readContract({ ...engine, functionName: "hedgeEligibility", args: [id, tradeIdCommitment as Hex] })))[0],
            );

        return {
          schemaVersion: 1 as const,
          kind: "transaction" as const,
          dataMode: "live" as const,
          context,
          account,
          request: {
            function: functionName,
            registry,
            kind: parsed.kind,
            sequence: parsed.credential.sequence.toString(),
            digest: inspection.digest,
            issuer: parsed.issuer,
            ...(tradeIdCommitment ? { tradeIdCommitment } : {}),
          },
          broadcast: true as const,
          transaction: transactionResult(transaction),
          accepted: {
            sequence: accepted.credential.sequence.toString(),
            digest: accepted.digest,
            issuer: accepted.issuer,
            acceptedAt: isoTime(accepted.acceptedAt),
            matchesSubmitted: accepted.digest.toLowerCase() === inspection.digest.toLowerCase(),
          },
          eligibility: {
            coverageBps: evaluation.coverageBps,
            requiredCoverageBps: evaluation.requiredCoverageBps,
            compliant: evaluation.compliant,
            resultReason: enumName(RESULT_REASONS, evaluation.resultReason),
            credential: verdict,
          },
          journal: { path: journal.path },
          note: SUBMIT_NOTE,
          scope: SEND_SCOPE,
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
  draw.command("send", {
    description: "Simulate CovenantVault.draw as the facility's operator, then send it once. This moves funds",
    options: writeOptions.extend({ amount: z.string().describe("USDC to draw, as a decimal string: 1 is one USDC, 1000000 units") }),
    env: writeEnv,
    output: drawSendOutput,
    destructive: true,
    mcp: false,
    examples: [{ options: { amount: "1", account: "operator" }, description: "Draw one USDC as the operator" }],
    hint: "Only the facility's operator can draw; any other account is refused before anything is simulated. A refused draw exits nonzero and broadcasts nothing, and the covenant sync the draw would have performed is rolled back with it.",
    async run(c) {
      return guarded(c, async () => {
        // The amount is validated before any keystore is unlocked or any RPC client is made.
        const units = parseDrawAmount(c.options.amount);
        const { config, client, session, send, context, account, signer, journal } = await operate(c.options, c.env, "draw send");
        const id = config.manifest.facility.id;
        const vault = config.manifest.contracts.covenantVault.address;
        const policy = await session.contract("FacilityRegistry.getFacility()", () =>
          client.readContract({ address: config.manifest.contracts.facilityRegistry.address, abi: facilityRegistryAbi, blockNumber: session.blockNumber, functionName: "getFacility", args: [id] }),
        );
        requireSignerRole(signer, policy.operator, "operator");

        const data = encodeFunctionData({ abi: covenantVaultAbi, functionName: "draw", args: [units] });
        const transaction = await performSend(send, { contract: vault, data, functionName: "draw" }, config.rpcUrl);

        const at = transaction.blockNumber;
        const vaultAt = { address: vault, abi: covenantVaultAbi, blockNumber: at } as const;
        const [balance, principal, available, state, activeWaiver] = await Promise.all([
          session.contract("settlementAsset.balanceOf(vault)", () =>
            client.readContract({ address: policy.settlementAsset, abi: erc20Abi, blockNumber: at, functionName: "balanceOf", args: [vault] }),
          ),
          session.contract("CovenantVault.principal()", () => client.readContract({ ...vaultAt, functionName: "principal" })),
          session.contract("CovenantVault.availableToDraw()", () => client.readContract({ ...vaultAt, functionName: "availableToDraw" })),
          session.contract("CovenantVault.covenantState()", () => client.readContract({ ...vaultAt, functionName: "covenantState" })),
          session.contract("CovenantVault.activeWaiver()", () => client.readContract({ ...vaultAt, functionName: "activeWaiver" })),
        ]);
        return {
          schemaVersion: 1 as const,
          kind: "transaction" as const,
          dataMode: "live" as const,
          context,
          account,
          request: { function: "draw" as const, amount: formatAmount(units), vault, sender: signer.address },
          broadcast: true as const,
          transaction: transactionResult(transaction),
          vault: { balance: formatAmount(balance), principal: formatAmount(principal), availableToDraw: formatAmount(available) },
          covenant: { storedState: enumName(COVENANT_STATES, state), activeWaiver },
          journal: { path: journal.path },
          scope: SEND_SCOPE,
        };
      });
    },
  });
  cli.command(draw);

  const transactions = Cli.create("tx", { description: "Inspect a transaction by hash" });
  transactions.command("show", {
    description: "Report whether a transaction is pending, mined successfully, or mined and reverted, with its decoded events or revert reason",
    args: z.object({ hash: z.string().describe("Transaction hash, 0x and 64 hex characters") }),
    options: liveOptions,
    env: liveEnv,
    output: txShowOutput,
    examples: [{ args: { hash: "0x38b3fd96e8a065030cdc1e551394e8aa9784e59edd0f225544614069e099d414" }, description: "Reconcile a transaction reported pending" }],
    hint: "This is how a transaction reported TRANSACTION_PENDING is reconciled later. Its hash is in the operation journal. Nothing here sends or replaces anything.",
    async run(c) {
      return guarded(c, async () => {
        const hash = c.args.hash.trim();
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new SignaError("INVALID_INPUT", `not a transaction hash: ${c.args.hash}`);
        const config = resolveConfig({ manifestOption: c.options.manifest, rpcUrlOption: c.options.rpcUrl, env: c.env, readFile, cwd: cwd() });
        const client = publicClient(config.rpcUrl);
        const session = await openSession(client, config.rpcUrl);
        const found = await session.transport(() => readTransaction(client, hash as Hex));
        const mined = found.state === "mined" ? found : null;
        return {
          schemaVersion: 1 as const,
          kind: "report" as const,
          dataMode: "live" as const,
          context: { chainId: session.chainId, rpc: config.rpc, block: session.block },
          hash,
          state: found.state,
          status: mined ? mined.status : null,
          transaction: mined ? transactionResult(mined) : null,
          pending: found.state === "pending" ? { nonce: found.nonce, from: found.from } : null,
          revert: mined?.revert ?? null,
          undecodableRevert: mined?.undecodableRevert ?? null,
          scope: TX_SCOPE,
        };
      });
    },
  });
  cli.command(transactions);

  const covenant = Cli.create("covenant", { description: "Move the vault's recorded covenant state, by sending a transaction" });

  /** The shared body of `covenant sync` and `covenant restore`: they differ only in the call. */
  async function moveCovenant(
    options: { manifest?: string | undefined; rpcUrl?: string | undefined; account: string; passwordFile?: string | undefined; timeout?: string | undefined },
    env: Parameters<typeof operate>[1],
    command: string,
    fn: "syncCovenant" | "restoreCompliance",
  ) {
    const { config, client, session, send, context, account, journal } = await operate(options, env, command);
    const id = config.manifest.facility.id;
    const vault = config.manifest.contracts.covenantVault.address;
    const before = await session.contract("CovenantVault.covenantState()", () =>
      client.readContract({ address: vault, abi: covenantVaultAbi, blockNumber: session.blockNumber, functionName: "covenantState" }),
    );
    const data = encodeFunctionData({ abi: covenantVaultAbi, functionName: fn, args: [] });
    const transaction = await performSend(send, { contract: vault, data, functionName: fn }, config.rpcUrl);

    const at = transaction.blockNumber;
    const vaultAt = { address: vault, abi: covenantVaultAbi, blockNumber: at } as const;
    const [after, activeWaiver, cureDeadline, evaluation] = await Promise.all([
      session.contract("CovenantVault.covenantState()", () => client.readContract({ ...vaultAt, functionName: "covenantState" })),
      session.contract("CovenantVault.activeWaiver()", () => client.readContract({ ...vaultAt, functionName: "activeWaiver" })),
      session.contract("CovenantVault.cureDeadline()", () => client.readContract({ ...vaultAt, functionName: "cureDeadline" })),
      session.contract("CoverageEngine.evaluate()", () =>
        client.readContract({ address: config.manifest.contracts.coverageEngine.address, abi: coverageEngineAbi, blockNumber: at, functionName: "evaluate", args: [id] }),
      ),
    ]);
    return {
      context,
      account,
      vault,
      transaction: transactionResult(transaction),
      covenant: {
        storedStateBefore: enumName(COVENANT_STATES, before),
        storedStateAfter: enumName(COVENANT_STATES, after),
        changed: before !== after,
        activeWaiver,
        cureDeadline: isoTime(cureDeadline),
      },
      evaluation: {
        compliant: evaluation.compliant,
        coverageBps: evaluation.coverageBps,
        requiredCoverageBps: evaluation.requiredCoverageBps,
        resultReason: enumName(RESULT_REASONS, evaluation.resultReason),
      },
      journal: { path: journal.path },
    };
  }

  covenant.command("sync", {
    description: "Simulate and send CovenantVault.syncCovenant, which records the covenant state the engine evaluates now",
    options: writeOptions,
    env: writeEnv,
    output: covenantSyncOutput,
    destructive: true,
    mcp: false,
    examples: [{ options: { account: "operator" }, description: "Record the covenant state the engine evaluates now" }],
    hint: "A sync records whatever the engine evaluates: it can move the facility into CURE as readily as out of it. The stored state before and after are both reported.",
    async run(c) {
      return guarded(c, async () => {
        const { vault, ...base } = await moveCovenant(c.options, c.env, "covenant sync", "syncCovenant");
        return {
          schemaVersion: 1 as const,
          kind: "transaction" as const,
          dataMode: "live" as const,
          ...base,
          request: { function: "syncCovenant" as const, vault },
          broadcast: true as const,
          scope: SEND_SCOPE,
        };
      });
    },
  });

  covenant.command("restore", {
    description: "Simulate and send CovenantVault.restoreCompliance, which returns a cured facility to COMPLIANT",
    options: writeOptions,
    env: writeEnv,
    output: covenantRestoreOutput,
    destructive: true,
    mcp: false,
    examples: [{ options: { account: "operator" }, description: "Return a cured facility to COMPLIANT" }],
    hint: "restoreCompliance only succeeds when coverage is genuinely sufficient again. If it is not, the simulation refuses and nothing is broadcast.",
    async run(c) {
      return guarded(c, async () => {
        const { vault, ...base } = await moveCovenant(c.options, c.env, "covenant restore", "restoreCompliance");
        return {
          schemaVersion: 1 as const,
          kind: "transaction" as const,
          dataMode: "live" as const,
          ...base,
          request: { function: "restoreCompliance" as const, vault },
          broadcast: true as const,
          scope: SEND_SCOPE,
        };
      });
    },
  });
  cli.command(covenant);

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

/** `--timeout`, in whole seconds. Bounded so a wait cannot become an indefinite hang. */
function timeoutSeconds(value: string | undefined): number {
  if (value === undefined) return 120;
  if (!/^[1-9][0-9]*$/.test(value)) throw new SignaError("INVALID_INPUT", `--timeout takes whole seconds above zero: ${value}`);
  const seconds = Number(value);
  if (seconds > 3_600) throw new SignaError("INVALID_INPUT", `--timeout is at most 3600 seconds: ${value}`);
  return seconds;
}

/** The public shape of a mined transaction. The revert fields belong to `tx show`, not to a send. */
function transactionResult(transaction: MinedTransaction) {
  return {
    hash: transaction.hash,
    status: transaction.status as "success",
    block: transaction.block,
    from: transaction.from,
    to: transaction.to,
    nonce: transaction.nonce,
    gasUsed: transaction.gasUsed,
    effectiveGasPrice: transaction.effectiveGasPrice,
    events: transaction.events,
  };
}

/**
 * Runs a handler and turns a SignaError into incur's error result; anything else propagates.
 *
 * incur 0.5.1 fixes the error document to `{ code, message, retryable }` and a `cta`, so a
 * failure that leaves a transaction on the chain carries its hash through the cta, which is the
 * only structured field available. The journal holds the same hash in full JSON.
 */
async function guarded<T>(
  c: {
    error: (options: {
      code: string;
      message: string;
      retryable?: boolean | undefined;
      cta?: { description?: string | undefined; commands: { command: string; description?: string | undefined }[] } | undefined;
    }) => never;
  },
  handler: () => Promise<T>,
): Promise<T> {
  try {
    return await handler();
  } catch (error) {
    if (!(error instanceof SignaError)) throw error;
    const hash = error.details?.["hash"];
    return c.error({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(hash
        ? {
            cta: {
              description: `The transaction was broadcast and its hash is ${hash}. It was not retried or replaced.`,
              commands: [{ command: `signa tx show ${hash}`, description: "Read its current state, and the decoded reason if it reverted" }],
            },
          }
        : {}),
    });
  }
}

function arcPublicClient(rpcUrl: string): ReceiptClient {
  return createPublicClient({ chain: arcTestnet, transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });
}

export const cli = createSignaCli();
export default cli;
