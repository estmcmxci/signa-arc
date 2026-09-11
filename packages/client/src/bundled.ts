import bundledArcTestnet from "./deployments/arc-testnet.json" with { type: "json" };

import { parseDeploymentManifest, type DeploymentManifest } from "./deployment.ts";

/**
 * The public Arc Testnet manifest, bundled with the client so no command depends on the
 * repository layout at runtime. It is a copy of `deployments/arc-testnet.json`, and
 * `test/manifest.test.ts` fails if the two differ.
 */
export const BUNDLED_MANIFEST_COPY_OF = "deployments/arc-testnet.json";

export function bundledManifest(): DeploymentManifest {
  return parseDeploymentManifest(bundledArcTestnet);
}
