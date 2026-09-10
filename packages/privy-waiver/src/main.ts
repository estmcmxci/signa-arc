import { getAddress, isAddressEqual } from "viem";

import { createArcGateway, loadManifest } from "./arc.ts";
import { PrivyClient, loadPrivyConfig, type Policy } from "./privy-client.ts";
import { createApproverServer } from "./server.ts";
import { QuorumAdminService, type FacilityConfig } from "./service.ts";
import { JsonFileStore, defaultStorePath } from "./store.ts";

/**
 * Starts the approver console on localhost. See WIRE-UP.md.
 *
 *   set -a; . ./.env; set +a
 *   PRIVY_WALLET_ID=... node --import tsx packages/privy-waiver/src/main.ts
 *
 * It is a demo server: it holds the Privy app secret, binds to 127.0.0.1 and has no login.
 *
 * Without PRIVY_WALLET_ID it runs in key-setup mode and needs no credentials: approvers open the
 * page and create their keys, which a quorum can then be built from. With it, it REQUIRES
 * CREDENTIALS and runs the full propose, approve and execute flow.
 */

const env = process.env;
const manifest = loadManifest();
const port = Number(env.PORT ?? 8787);
const walletId = env.PRIVY_WALLET_ID?.trim();

const server = walletId ? await quorumServer(walletId) : keySetupServer();
server.listen(port, "127.0.0.1", () => {
  console.log(`Approver console: http://127.0.0.1:${port}${walletId ? "" : "  (key-setup mode: no Privy wallet yet)"}`);
});

function keySetupServer() {
  return createApproverServer(undefined, async () => ({
    chainId: manifest.chainId,
    explorer: manifest.explorer,
    walletId: null,
  }));
}

async function quorumServer(id: string) {
  const privy = new PrivyClient(loadPrivyConfig(env));
  // The address comes from Privy, never from configuration, so it cannot drift from the wallet.
  const wallet = await privy.getWallet(id);
  const walletAddress = getAddress(wallet.address);
  const arc = createArcGateway(manifest);
  // Addresses come from the manifest (E-MAN-4): its facility is ours when its admin is this wallet.
  const facility: FacilityConfig | undefined = isAddressEqual(manifest.roles.facilityAdmin, walletAddress)
    ? {
        id: manifest.facility.id,
        vault: manifest.contracts.covenantVault.address,
        registry: manifest.contracts.facilityRegistry.address,
        coverageEngine: manifest.contracts.coverageEngine.address,
      }
    : undefined;
  const service = new QuorumAdminService(privy, arc, new JsonFileStore(defaultStorePath(env)), {
    walletId: id,
    walletAddress,
    explorer: manifest.explorer,
    ...(facility ? { facility } : {}),
  });
  // The policies change only under both approvers' signatures, so a short cache is safe.
  const policies = cached(30_000, async (): Promise<Policy[]> => {
    const current = await privy.getWallet(id);
    return Promise.all((current.policy_ids ?? []).map((policyId) => privy.getPolicy(policyId)));
  });
  const quorum = manifest.facilityAdminQuorum;
  return createApproverServer(service, async () => ({
    chainId: manifest.chainId,
    explorer: manifest.explorer,
    walletId: id,
    walletAddress,
    walletOwnerId: wallet.owner_id ?? null,
    threshold: quorum?.walletId === id ? quorum.threshold : null,
    approvers: quorum?.walletId === id ? quorum.approvers : [],
    facility: facility ?? null,
    readiness: facility ? await service.waiverReadiness().catch((error: unknown) => ({ error: String(error) })) : null,
    policies: await policies().catch((error: unknown) => ({ error: String(error) })),
  }));
}

function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let entry: { at: number; value: Promise<T> } | undefined;
  return () => {
    if (!entry || Date.now() - entry.at > ttlMs) {
      const value = load();
      entry = { at: Date.now(), value };
      value.catch(() => {
        entry = undefined;
      });
    }
    return entry.value;
  };
}
