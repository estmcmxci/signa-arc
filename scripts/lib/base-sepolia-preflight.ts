import type { DeploymentRoles } from "./deployment-manifest.ts";
import { validateRoles } from "./deployment-manifest.ts";

export const BASE_SEPOLIA_CHAIN_ID = 84_532;

export type PreflightCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type BaseSepoliaPreflightSnapshot = {
  rpcUrlValid: boolean;
  chainId: number;
  latestBlock: bigint;
  roles: DeploymentRoles;
  repositoryRoot: string;
  workingDirectory: string;
  repositoryCommit: string;
  sourceCommit: string;
  repositoryClean: boolean;
  deployerAliasPresent: boolean;
  etherscanApiKeyPresent: boolean;
  adminBalance: bigint;
  operatorBalance: bigint;
};

export type BaseSepoliaPreflightReport = {
  ready: boolean;
  checks: PreflightCheck[];
};

export function evaluateBaseSepoliaPreflight(
  snapshot: BaseSepoliaPreflightSnapshot,
): BaseSepoliaPreflightReport {
  const checks: PreflightCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });

  add("rpc-url", snapshot.rpcUrlValid, snapshot.rpcUrlValid ? "HTTP(S) RPC configured" : "RPC URL must use HTTP(S)");
  add(
    "chain-id",
    snapshot.chainId === BASE_SEPOLIA_CHAIN_ID,
    `RPC chain ID ${snapshot.chainId}; expected ${BASE_SEPOLIA_CHAIN_ID}`,
  );
  add(
    "latest-block",
    snapshot.latestBlock > 0n,
    snapshot.latestBlock > 0n
      ? `RPC returned latest block ${snapshot.latestBlock}`
      : "RPC did not return a live Base Sepolia block",
  );

  try {
    validateRoles(snapshot.roles);
    add("roles", true, "Four nonzero, distinct public role addresses");
  } catch (error) {
    add("roles", false, error instanceof Error ? error.message : String(error));
  }

  const standalone = snapshot.repositoryRoot === snapshot.workingDirectory;
  add(
    "standalone-repository",
    standalone,
    standalone
      ? "Working directory is the Git repository root"
      : `Git root is ${snapshot.repositoryRoot}; expected ${snapshot.workingDirectory}`,
  );
  add(
    "clean-repository",
    snapshot.repositoryClean,
    snapshot.repositoryClean ? "Repository worktree is clean" : "Repository has uncommitted or untracked files",
  );

  const commitFormatValid = /^[0-9a-fA-F]{40,64}$/.test(snapshot.sourceCommit);
  const commitMatches =
    commitFormatValid &&
    snapshot.sourceCommit.toLowerCase() === snapshot.repositoryCommit.toLowerCase();
  add(
    "source-commit",
    commitMatches,
    commitMatches
      ? `SOURCE_COMMIT matches HEAD ${snapshot.repositoryCommit}`
      : "SOURCE_COMMIT must be a 40–64 character hex commit matching repository HEAD",
  );

  add(
    "deployer-alias",
    snapshot.deployerAliasPresent,
    snapshot.deployerAliasPresent
      ? "Foundry keystore alias deployer is present"
      : "Foundry keystore alias deployer is missing",
  );
  add(
    "verification-key",
    snapshot.etherscanApiKeyPresent,
    snapshot.etherscanApiKeyPresent
      ? "ETHERSCAN_API_KEY is present (value not displayed)"
      : "ETHERSCAN_API_KEY is missing",
  );
  add(
    "admin-gas",
    snapshot.adminBalance > 0n,
    snapshot.adminBalance > 0n
      ? `Facility admin has ${snapshot.adminBalance} wei for deployment and scenario transactions`
      : "Facility admin needs Base Sepolia ETH",
  );
  add(
    "operator-gas",
    snapshot.operatorBalance > 0n,
    snapshot.operatorBalance > 0n
      ? `Originator operator has ${snapshot.operatorBalance} wei for draw and repayment transactions`
      : "Originator operator needs Base Sepolia ETH",
  );

  return { ready: checks.every((check) => check.ok), checks };
}
