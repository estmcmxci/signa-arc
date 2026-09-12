import assert from "node:assert/strict";
import test from "node:test";

import { PHASES, planRun, type Phase } from "../run-plan.ts";

const fresh = { adopted: [], adoptedWaiver: false, refreshExposure: false } as const;

test("a fresh run sends the whole sequence and adopts nothing", () => {
  assert.deepEqual(planRun(fresh).send, ["W-1", "W-2", "W-3", "W-4", "W-5", "W-6"]);
  assert.deepEqual(planRun(fresh).skip, []);
  assert.equal(planRun(fresh).sendWaiver, true);
  assert.deepEqual(planRun({ ...fresh, refreshExposure: true }).send.at(-1), "W-7");
});

test("a step already on chain is skipped, before the waiver", () => {
  const plan = planRun({ ...fresh, adopted: ["W-1", "W-2", "W-3"] });
  assert.deepEqual(plan.send, ["W-4", "W-5", "W-6"]);
  assert.deepEqual(plan.skip, ["W-1", "W-2", "W-3"]);
});

test("and after it: the draw under the waiver is not sent twice", () => {
  // The regression. The first version guarded only the steps before the waiver, adopted W-5, and
  // then sent it again.
  const plan = planRun({ ...fresh, adopted: ["W-1", "W-2", "W-3", "W-5"], adoptedWaiver: true });
  assert.equal(plan.send.includes("W-5"), false, "an adopted draw must never be re-sent");
  assert.deepEqual(plan.send, ["W-6"]);
  assert.deepEqual(plan.skip, ["W-1", "W-2", "W-3", "W-4", "W-5"]);
});

test("an adopted waiver is not proposed again", () => {
  const plan = planRun({ ...fresh, adoptedWaiver: true });
  assert.equal(plan.sendWaiver, false, "a second proposal would pin the admin wallet's nonce again");
  assert.equal(plan.send.includes("W-4"), false);
  assert.equal(plan.skip.includes("W-4"), true);
  assert.equal(planRun(fresh).sendWaiver, true);
});

test("the exposure is re-observed only when asked for, and never twice", () => {
  assert.equal(planRun(fresh).send.includes("W-7"), false);
  assert.equal(planRun({ ...fresh, refreshExposure: true }).send.includes("W-7"), true);
  const adoptedAlready = planRun({ ...fresh, refreshExposure: true, adopted: ["W-7"] });
  assert.equal(adoptedAlready.send.includes("W-7"), false);
  assert.equal(adoptedAlready.skip.includes("W-7"), true);
});

test("for every combination: nothing adopted is ever sent, and every step is decided once", () => {
  const subsets: Phase[][] = [[]];
  for (const phase of PHASES) for (const subset of [...subsets]) subsets.push([...subset, phase]);
  assert.equal(subsets.length, 128);
  for (const adopted of subsets) {
    for (const adoptedWaiver of [false, true]) {
      for (const refreshExposure of [false, true]) {
        const plan = planRun({ adopted, adoptedWaiver, refreshExposure });
        const context = JSON.stringify({ adopted, adoptedWaiver, refreshExposure });
        for (const phase of adopted) {
          assert.equal(plan.send.includes(phase), false, `${phase} was adopted and sent: ${context}`);
          assert.equal(plan.skip.includes(phase), true, `${phase} was adopted and not skipped: ${context}`);
        }
        if (adoptedWaiver) assert.equal(plan.sendWaiver, false, `waiver adopted and proposed: ${context}`);
        for (const phase of PHASES) {
          const decidedTwice = plan.send.includes(phase) && plan.skip.includes(phase);
          assert.equal(decidedTwice, false, `${phase} is both sent and skipped: ${context}`);
        }
        // Sequence order is the chain's order, whatever order the steps were named in.
        assert.deepEqual([...plan.send], PHASES.filter((phase) => plan.send.includes(phase)), context);
      }
    }
  }
});
