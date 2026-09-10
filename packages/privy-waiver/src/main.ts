import { getAddress, isAddressEqual } from "viem";

import { createArcGateway, loadManifest } from "./arc.ts";
import { quorumFacilityPlan } from "./facility-setup.ts";
import { PrivyClient, loadPrivyConfig } from "./privy-client.ts";
import { createApproverServer } from "./server.ts";
import { QuorumAdminService } from "./service.ts";
import { JsonFileStore, defaultStorePath } from "./store.ts";

/**
 * Starts the approver server on localhost. See WIRE-UP.md.
 *
 *   node --env-file=packages/privy-waiver/.env --import tsx packages/privy-waiver/src/main.ts
 *
 * Without PRIVY_WALLET_ID it runs in key-setup mode and needs no credentials: approvers open the
 * page and create their keys, which the quorum is then built from. With it, it REQUIRES
 * CREDENTIALS and runs the full propose, approve and execute flow.
 */

const env = process.env;
const manifest = loadManifest();
const port = Number(env.PORT ?? 8787);
const walletId = env.PRIVY_WALLET_ID?.trim();

const server = walletId ? await quorumServer(walletId) : keySetupServer();
server.listen(port, "127.0.0.1", () => {
  console.log(`Approver UI: http://127.0.0.1:${port}${walletId ? "" : "  (key-setup mode: no Privy wallet yet)"}`);
});

function keySetupServer() {
  return createApproverServer(undefined, async () => ({
    chainId: manifest.chainId,
    explorer: manifest.explorer,
    walletId: null,
    maxWaiverDurationSeconds: manifest.facility.policy.maxWaiverDurationSeconds,
  }));
}

async function quorumServer(id: string) {
  const privy = new PrivyClient(loadPrivyConfig(env));
  // The address comes from Privy, never from configuration, so it cannot drift from the wallet.
  const wallet = await privy.getWallet(id);
  const walletAddress = getAddress(wallet.address);
  const arc = createArcGateway(manifest);
  // Addresses come from the manifest (E-MAN-4): its vault is ours when its admin is this wallet.
  const vaultSetting = env.PRIVY_WAIVER_VAULT?.trim();
  const vault = vaultSetting
    ? getAddress(vaultSetting)
    : isAddressEqual(manifest.roles.facilityAdmin, walletAddress)
      ? manifest.contracts.covenantVault.address
      : undefined;
  const plan = quorumFacilityPlan(manifest, walletAddress, env.PRIVY_QUORUM_FACILITY_LABEL?.trim() || undefined);
  const service = new QuorumAdminService(
    privy,
    arc,
    new JsonFileStore(defaultStorePath(env)),
    { walletId: id, walletAddress, explorer: manifest.explorer, ...(vault ? { vault } : {}) },
    plan,
  );
  return createApproverServer(service, async () => ({
    chainId: manifest.chainId,
    explorer: manifest.explorer,
    walletId: id,
    walletAddress,
    walletOwnerId: wallet.owner_id ?? null,
    vault: vault ?? null,
    vaultStatus: vault ? await arc.vaultStatus(vault) : null,
    quorumFacilityId: plan.facilityId,
    maxWaiverDurationSeconds: manifest.facility.policy.maxWaiverDurationSeconds,
  }));
}
