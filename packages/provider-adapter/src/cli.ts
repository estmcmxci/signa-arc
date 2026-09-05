import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { type Address, type Hex } from "viem";

import {
  mapProviderFixture,
  MOCK_PROVIDER_DISCLAIMER,
  signHedgeCredential,
} from "./index.ts";

const [fixtureArgument, outputArgument] = process.argv.slice(2);
if (!fixtureArgument) {
  throw new Error(
    "Usage: tsx packages/provider-adapter/src/cli.ts <fixture.json> [output.json]",
  );
}

const requiredEnvironment = [
  "MOCK_HEDGE_ISSUER_PRIVATE_KEY",
  "CREDENTIAL_REGISTRY_ADDRESS",
  "CHAIN_ID",
  "FACILITY_ID",
] as const;
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
}

const fixture = JSON.parse(await readFile(resolve(fixtureArgument), "utf8")) as unknown;
const credential = mapProviderFixture(fixture, process.env.FACILITY_ID as Hex);
const signed = await signHedgeCredential({
  credential,
  chainId: Number(process.env.CHAIN_ID),
  verifyingContract: process.env.CREDENTIAL_REGISTRY_ADDRESS as Address,
  privateKey: process.env.MOCK_HEDGE_ISSUER_PRIVATE_KEY as Hex,
});
const output = `${JSON.stringify(signed, bigintJsonReplacer, 2)}\n`;

if (outputArgument) await writeFile(resolve(outputArgument), output, "utf8");
else process.stdout.write(output);

process.stderr.write(`${MOCK_PROVIDER_DISCLAIMER}\n`);

function bigintJsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

