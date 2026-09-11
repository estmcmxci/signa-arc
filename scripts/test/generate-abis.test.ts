import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ABI_MODULE, renderAbiModule } from "../generate-abis.ts";

test("the ABIs the client ships match the Foundry build", () => {
  assert.equal(
    readFileSync(ABI_MODULE, "utf8"),
    renderAbiModule(),
    "packages/client/src/abis.ts drifted from contracts/out: run `forge build && pnpm generate:abis`",
  );
});
