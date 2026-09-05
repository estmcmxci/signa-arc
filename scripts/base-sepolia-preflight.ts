import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
} from "viem";

import {
  evaluateBaseSepoliaPreflight,
  type BaseSepoliaPreflightSnapshot,
} from "./lib/base-sepolia-preflight.ts";
import type { DeploymentRoles } from "./lib/deployment-manifest.ts";

const execFileAsync = promisify(execFile);

await main();

async function main() {
  try {
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
    const rpcUrlValid = validHttpUrl(rpcUrl);
    const roles: DeploymentRoles = {
      facilityAdmin: environmentAddress("FACILITY_ADMIN"),
      originatorOperator: environmentAddress("ORIGINATOR_OPERATOR"),
      exposureIssuer: environmentAddress("EXPOSURE_ISSUER"),
      hedgeIssuer: environmentAddress("HEDGE_ISSUER"),
    };
    const sourceCommit = requiredEnvironment("SOURCE_COMMIT");
    const workingDirectory = resolve(process.cwd());
    const repositoryRoot = resolve((await git(["rev-parse", "--show-toplevel"])).trim());
    const repositoryCommit = (await git(["rev-parse", "HEAD"])).trim();
    const repositoryClean =
      repositoryRoot === workingDirectory
        ? (await git(["status", "--porcelain", "--untracked-files=all"])).trim() === ""
        : false;

    const walletList = await commandOutput("cast", ["wallet", "list"]);
    const deployerAliasPresent = walletList
      .split(/\r?\n/)
      .some((line) => /(^|\s)deployer(\s|$)/.test(line));

    const client = createPublicClient({ transport: http(rpcUrl) });
    const [chainId, latestBlock, adminBalance, operatorBalance] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.getBalance({ address: roles.facilityAdmin }),
      client.getBalance({ address: roles.originatorOperator }),
    ]);

    const snapshot: BaseSepoliaPreflightSnapshot = {
      rpcUrlValid,
      chainId,
      latestBlock,
      roles,
      repositoryRoot,
      workingDirectory,
      repositoryCommit,
      sourceCommit,
      repositoryClean,
      deployerAliasPresent,
      etherscanApiKeyPresent: Boolean(process.env.ETHERSCAN_API_KEY?.trim()),
      adminBalance,
      operatorBalance,
    };
    const report = evaluateBaseSepoliaPreflight(snapshot);

    process.stdout.write("Base Sepolia deployment preflight (read-only)\n");
    for (const check of report.checks) {
      process.stdout.write(`${check.ok ? "PASS" : "FAIL"}  ${check.id}: ${check.detail}\n`);
    }
    process.stdout.write(report.ready ? "READY: safe to dry-run deployment\n" : "NOT READY: resolve failed checks before deployment\n");
    if (!report.ready) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `Preflight could not complete: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function environmentAddress(name: string): Address {
  const value = requiredEnvironment(name);
  if (!isAddress(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${name} must be a nonzero address`);
  }
  return getAddress(value);
}

function validHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

async function git(args: string[]): Promise<string> {
  return commandOutput("git", args);
}

async function commandOutput(command: string, args: string[]): Promise<string> {
  try {
    return (await execFileAsync(command, args, { encoding: "utf8" })).stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} ${args.join(" ")} failed: ${message}`);
  }
}
