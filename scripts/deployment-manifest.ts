import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getAddress, isAddress, type Address, type Hex } from "viem";

import {
  buildBaseSepoliaManifest,
  type DeploymentRoles,
} from "./lib/deployment-manifest.ts";

const inputPath = resolve(
  process.argv[2] ?? "broadcast/Deploy.s.sol/84532/run-latest.json",
);
const outputPath = resolve(process.argv[3] ?? "deployments/base-sepolia.json");
const required = [
  "SOURCE_COMMIT",
  "FACILITY_ADMIN",
  "ORIGINATOR_OPERATOR",
  "EXPOSURE_ISSUER",
  "HEDGE_ISSUER",
] as const;
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
}

const roles: DeploymentRoles = {
  facilityAdmin: environmentAddress("FACILITY_ADMIN"),
  originatorOperator: environmentAddress("ORIGINATOR_OPERATOR"),
  exposureIssuer: environmentAddress("EXPOSURE_ISSUER"),
  hedgeIssuer: environmentAddress("HEDGE_ISSUER"),
};
const broadcast = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
const manifest = buildBaseSepoliaManifest({
  broadcast,
  roles,
  sourceCommit: process.env.SOURCE_COMMIT!,
  facilityId:
    "0x470e748bc9f7c36de730822cb62ebe2bdba31f20856e010df4ebabaef1bc8db1" as Hex,
});
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote validated Base Sepolia manifest: ${outputPath}\n`);

function environmentAddress(name: string): Address {
  const value = process.env[name];
  if (!value || !isAddress(value)) throw new Error(`${name} must be an address`);
  return getAddress(value);
}

