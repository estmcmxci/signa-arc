import { getAddress, isAddressEqual, keccak256, type Address, type Hex } from "viem";

import { SignaError, type DeploymentManifest } from "@signa/client";

import { approverKeyDirectory, readApprover, type ApproverRole } from "../../privy-waiver/src/approvers.ts";
import { createArcGateway, type ArcManifest } from "../../privy-waiver/src/arc.ts";
import { publicKeyOf, signAuthorizationPayload } from "../../privy-waiver/src/authorization.ts";
import { PrivyClient, loadPrivyConfig, signedTransactionOf } from "../../privy-waiver/src/privy-client.ts";
import { QuorumAdminService, ServiceError, type ActionView, type FacilityConfig } from "../../privy-waiver/src/service.ts";
import { JsonFileStore, defaultStorePath } from "../../privy-waiver/src/store.ts";

/**
 * The `signa waiver` adapter over `packages/privy-waiver`'s QuorumAdminService.
 *
 * The flow is not reimplemented here: proposal, pre-validation, approval verification, signed
 * transaction checking and broadcast all stay in the service. This module resolves what the
 * service needs from the CLI's own configuration and turns its errors into Signa's.
 *
 * `packages/privy-waiver` has no package.json and is not a workspace package, so it is imported by
 * relative path and bundled into `dist/bin.js`. Its `loadManifest()` default is never used: it
 * resolves a repository path relative to its own module URL, which points nowhere once bundled.
 * The CLI passes the manifest it has already resolved and validated.
 */

/** How the service is opened. A read needs no credentials; anything that touches Privy does. */
export type DeskMode = "read" | "authorized";

export type WaiverDesk = {
  service: QuorumAdminService;
  /** Present only when the desk was opened with credentials. */
  privy?: PrivyClient | undefined;
  /** The facility admin, from the manifest, and from Privy itself when authorized. */
  walletAddress: Address;
  walletId: string;
  /** Where proposals are recorded. Outside every repository. */
  storePath: string;
  approverDirectory: string;
};

export type WaiverEnv = {
  PRIVY_APP_ID?: string | undefined;
  PRIVY_APP_SECRET?: string | undefined;
  PRIVY_API_URL?: string | undefined;
  PRIVY_WALLET_ID?: string | undefined;
  PRIVY_APPROVER_KEY_DIR?: string | undefined;
  PRIVY_WAIVER_STORE?: string | undefined;
};

/** The subset of the deployment manifest the Arc gateway and the service read. */
function toArcManifest(manifest: DeploymentManifest): ArcManifest {
  return {
    chainId: manifest.chainId,
    rpcUrl: manifest.rpcUrl,
    explorer: manifest.explorer,
    sourceCommit: manifest.sourceCommit,
    contracts: manifest.contracts,
    settlementAsset: manifest.settlementAsset,
    roles: manifest.roles,
    facility: manifest.facility as ArcManifest["facility"],
    ...(manifest.facilityAdminQuorum ? { facilityAdminQuorum: manifest.facilityAdminQuorum } : {}),
  };
}

function facilityOf(manifest: DeploymentManifest): FacilityConfig {
  return {
    id: manifest.facility.id,
    vault: manifest.contracts.covenantVault.address,
    registry: manifest.contracts.facilityRegistry.address,
    coverageEngine: manifest.contracts.coverageEngine.address,
  };
}

/**
 * The Privy wallet the manifest names as the facility admin's quorum. Taken from the manifest
 * rather than a flag (E-MAN-4); PRIVY_WALLET_ID overrides it for a different deployment.
 */
function walletIdOf(manifest: DeploymentManifest, env: WaiverEnv): string {
  const configured = env.PRIVY_WALLET_ID?.trim();
  const fromManifest = manifest.facilityAdminQuorum?.walletId;
  const walletId = configured || fromManifest;
  if (!walletId) {
    throw new SignaError(
      "INVALID_MANIFEST",
      "this manifest names no facility admin quorum wallet, so there is no wallet to propose a waiver from",
    );
  }
  return walletId;
}

/**
 * Opens the quorum desk. In `read` mode no credential is loaded and Privy is never contacted, so
 * `waiver status` answers from the chain alone. In `authorized` mode the credentials are loaded
 * first, before any network call, and the wallet's address is read from Privy rather than
 * configuration so it cannot drift from the wallet that will sign.
 */
export async function openWaiverDesk(manifest: DeploymentManifest, env: WaiverEnv, mode: DeskMode): Promise<WaiverDesk> {
  const walletId = walletIdOf(manifest, env);
  const storePath = defaultStorePath(env as NodeJS.ProcessEnv);
  const approverDirectory = approverKeyDirectory(env as NodeJS.ProcessEnv);
  const arc = createArcGateway(toArcManifest(manifest));
  const facility = facilityOf(manifest);

  if (mode === "read") {
    // Never used: waiverReadiness reads the chain only. Constructing it contacts nothing.
    const unusable = new PrivyClient({ appId: "", appSecret: "", apiUrl: "https://api.privy.io" });
    const service = new QuorumAdminService(unusable, arc, new JsonFileStore(storePath), {
      walletId,
      walletAddress: manifest.roles.facilityAdmin,
      explorer: manifest.explorer,
      facility,
    });
    return { service, walletAddress: manifest.roles.facilityAdmin, walletId, storePath, approverDirectory };
  }

  // Credentials come from the environment, never a flag, and are required before anything else.
  let privy: PrivyClient;
  try {
    privy = new PrivyClient(loadPrivyConfig(env as NodeJS.ProcessEnv));
  } catch (error) {
    throw new SignaError("SIGNER_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  }
  const wallet = await withServiceErrors(() => privy.getWallet(walletId), "read the quorum wallet from Privy");
  const walletAddress = getAddress(wallet.address);
  if (!isAddressEqual(walletAddress, manifest.roles.facilityAdmin)) {
    throw new SignaError(
      "DEPLOYMENT_MISMATCH",
      `Privy wallet ${walletId} is ${walletAddress}, but the manifest's facility admin is ${manifest.roles.facilityAdmin}`,
    );
  }
  const service = new QuorumAdminService(privy, arc, new JsonFileStore(storePath), {
    walletId,
    walletAddress,
    explorer: manifest.explorer,
    facility,
  });
  return { service, privy, walletAddress, walletId, storePath, approverDirectory };
}

/** Statuses in which a proposal is still the one holding the wallet's pinned nonce. */
const OPEN = new Set(["pending", "granted", "processing", "executed"]);

/**
 * The proposal to act on. Each proposal pins the admin wallet's next nonce and the service allows
 * only one in flight, so with no `--intent` there is normally exactly one to mean.
 */
export async function resolveProposal(desk: WaiverDesk, intentId: string | undefined): Promise<ActionView> {
  if (intentId) return withServiceErrors(() => desk.service.get(intentId), `read proposal ${intentId}`);
  const actions = await withServiceErrors(() => desk.service.list(), "list proposals");
  const open = actions.filter((action) => OPEN.has(action.status) && !action.broadcast);
  if (open.length === 0) {
    throw new SignaError(
      "INVALID_INPUT",
      `no proposal is in flight in ${desk.storePath}. Propose one with \`signa waiver propose\`, or name an earlier one with --intent`,
    );
  }
  if (open.length > 1) {
    throw new SignaError("INVALID_INPUT", `more than one proposal is in flight; name one with --intent: ${open.map((action) => action.intentId).join(", ")}`);
  }
  return open[0] as ActionView;
}

/**
 * The hash of the transaction Privy signed, before anything is broadcast. This is the seam that
 * lets a waiver honour the same invariant as every other write command: the hash is journalled
 * before the wait for a receipt begins, so a timeout or an interruption still leaves it recorded.
 * It is the same hash `broadcastAndConfirm` will use, computed the same way.
 */
export async function signedTransactionHash(desk: WaiverDesk, intentId: string): Promise<Hex> {
  if (!desk.privy) throw new SignaError("SIGNER_UNAVAILABLE", "broadcasting needs Privy credentials in the environment");
  const intent = await withServiceErrors(() => desk.privy!.getIntent(intentId), `read intent ${intentId} from Privy`);
  const signed = signedTransactionOf(intent);
  if (!signed) {
    throw new SignaError(
      "ACTION_REFUSED",
      `intent ${intentId} is ${intent.status} and carries no signed transaction; Privy signs only once both approvals are in. Nothing was broadcast`,
    );
  }
  return keccak256(signed);
}

/**
 * One approver's authorization over a payload the service stamped. Node signs DER, which is what
 * Privy's own SDK sends; the browser console signs P1363 and the service converts it.
 */
export function approverApproval(
  directory: string,
  role: ApproverRole,
  payload: { text: string; timestamp: number },
): { publicKey: string; signature: string; encoding: "der"; timestamp: number } {
  const approver = readApprover(directory, role);
  if (!approver) {
    throw new SignaError(
      "SIGNER_UNAVAILABLE",
      `no ${role} key in ${directory}. Approver keys are created once, in the approver console, and never leave that directory`,
    );
  }
  return {
    publicKey: publicKeyOf(approver.privateKey),
    signature: signAuthorizationPayload(approver.privateKey, new TextEncoder().encode(payload.text)),
    encoding: "der",
    timestamp: payload.timestamp,
  };
}

/**
 * Turns the service's errors into Signa's codes. The service refuses with a 409 when the contract
 * would refuse, which is a refused action, not bad input: nothing was proposed and nothing was
 * broadcast. A 502 only ever comes from `execute`, after the transaction is already on chain.
 */
export async function withServiceErrors<T>(run: () => Promise<T>, what: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ServiceError) {
      if (error.status === 404) throw new SignaError("INVALID_INPUT", error.message);
      if (error.status >= 500) throw new SignaError("TRANSACTION_REVERTED", error.message);
      throw new SignaError("ACTION_REFUSED", error.message);
    }
    if (error instanceof SignaError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new SignaError("RPC_UNAVAILABLE", `could not ${what}: ${detail}`, true);
  }
}

/** The shared, printable view of a proposal. */
export function proposalView(action: ActionView) {
  return {
    intentId: action.intentId,
    kind: action.kind,
    status: action.status,
    description: action.description,
    ...(action.reason === undefined ? {} : { reason: action.reason }),
    createdAt: new Date(action.createdAt).toISOString(),
    expiresAt: new Date(action.expiresAt).toISOString(),
    call: {
      to: action.call.to,
      data: action.call.data,
      functionName: action.call.functionName,
      args: action.call.args,
      chainId: action.call.chainId,
      nonce: action.call.nonce,
      value: "0",
    },
    approvals: {
      threshold: action.approvals.threshold,
      collected: action.approvals.members.filter((member) => member.signedAt !== null).length,
      members: action.approvals.members.map((member) => ({
        publicKey: member.publicKey,
        signedAt: member.signedAt === null ? null : new Date(member.signedAt).toISOString(),
      })),
    },
    ...(action.broadcast
      ? {
          broadcast: {
            hash: action.broadcast.hash,
            status: action.broadcast.status,
            blockNumber: action.broadcast.blockNumber,
            explorerUrl: action.broadcast.explorerUrl,
          },
        }
      : {}),
  };
}
