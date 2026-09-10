import { encodeFunctionData, isAddressEqual, keccak256, stringToHex, toBytes, type Address, type Hex } from "viem";

import { facilityRegistryAbi, type ArcGateway, type ArcManifest, type FacilityPolicy } from "./arc.ts";

/**
 * The facility a Privy quorum administers.
 *
 * A facility's admin cannot be handed over: FacilityRegistry writes the policy once, in
 * createFacility, and has no admin setter. So the quorum's own wallet creates the facility, in the
 * same registry and under the same PRD §7 policy, and a new CovenantVault is bound to it. It
 * replaces the EOA-administered facility in the manifest. Every step is an admin call the quorum
 * approves, so the policy itself is created under quorum, not just the waivers.
 */

export const DEFAULT_QUORUM_FACILITY_LABEL = "signa-covenant-arc-eur-usd-privy-quorum";

export type QuorumFacilityPlan = {
  registry: Address;
  engine: Address;
  facilityId: Hex;
  policy: FacilityPolicy;
  exposureIssuer: Address;
  hedgeIssuer: Address;
};

export type SetupStepKind =
  | "facility.create"
  | "facility.setExposureIssuer"
  | "facility.setHedgeIssuer"
  | "facility.freeze";

export type SetupStep =
  | { kind: SetupStepKind; to: Address; data: Hex; description: string }
  | { kind: "complete"; description: string };

/** The same policy as the deployed facility, with the quorum's wallet as admin. */
export function quorumFacilityPlan(
  manifest: ArcManifest,
  adminWallet: Address,
  label: string = DEFAULT_QUORUM_FACILITY_LABEL,
): QuorumFacilityPlan {
  const facilityId = keccak256(toBytes(label));
  const policy = manifest.facility.policy;
  return {
    registry: manifest.contracts.facilityRegistry.address,
    engine: manifest.contracts.coverageEngine.address,
    facilityId,
    policy: {
      facilityId,
      settlementCurrency: stringToHex(policy.settlementCurrency, { size: 3 }),
      exposureCurrency: stringToHex(policy.exposureCurrency, { size: 3 }),
      minCoverageBps: policy.minCoverageBps,
      credentialMaxAge: policy.credentialMaxAgeSeconds,
      maturityTolerance: policy.maturityToleranceSeconds,
      defaultHaircutBps: policy.defaultHaircutBps,
      reserveAmount: BigInt(policy.reserveAmount),
      curePeriod: policy.cureWindowSeconds,
      maxWaiverDuration: policy.maxWaiverDurationSeconds,
      maxActiveHedges: policy.maxActiveHedges,
      settlementAsset: manifest.settlementAsset.address,
      admin: adminWallet,
      operator: manifest.roles.operator,
      frozen: false,
    },
    exposureIssuer: manifest.roles.exposureIssuer,
    hedgeIssuer: manifest.roles.hedgeIssuer,
  };
}

/**
 * Reads the chain and returns the next setup call, so setup is resumable: after any interruption,
 * asking again proposes exactly what is still missing.
 */
export async function nextFacilitySetupStep(
  arc: ArcGateway,
  plan: QuorumFacilityPlan,
): Promise<SetupStep> {
  const { registry, facilityId, policy } = plan;
  const call = (functionName: SetupStepKind, data: Hex, description: string): SetupStep => ({
    kind: functionName,
    to: registry,
    data,
    description,
  });

  if (!(await arc.facilityExists(registry, facilityId))) {
    return call(
      "facility.create",
      encodeFunctionData({ abi: facilityRegistryAbi, functionName: "createFacility", args: [policy] }),
      `Create facility ${facilityId} with the PRD §7 policy and the quorum wallet ${policy.admin} as admin`,
    );
  }

  const onChain = await arc.getFacility(registry, facilityId);
  if (!isAddressEqual(onChain.admin, policy.admin)) {
    throw new Error(
      `facility ${facilityId} already exists with admin ${onChain.admin}, not ${policy.admin}; choose another label`,
    );
  }
  if (!(await arc.isExposureIssuer(registry, facilityId, plan.exposureIssuer))) {
    return call(
      "facility.setExposureIssuer",
      encodeFunctionData({
        abi: facilityRegistryAbi,
        functionName: "setExposureIssuer",
        args: [facilityId, plan.exposureIssuer, true],
      }),
      `Approve ${plan.exposureIssuer} as the facility's exposure issuer`,
    );
  }
  if (!(await arc.isHedgeIssuer(registry, facilityId, plan.hedgeIssuer))) {
    return call(
      "facility.setHedgeIssuer",
      encodeFunctionData({
        abi: facilityRegistryAbi,
        functionName: "setHedgeIssuer",
        args: [facilityId, plan.hedgeIssuer, true],
      }),
      `Approve ${plan.hedgeIssuer} as the facility's hedge issuer`,
    );
  }
  if (!onChain.frozen) {
    return call(
      "facility.freeze",
      encodeFunctionData({ abi: facilityRegistryAbi, functionName: "freezeFacility", args: [facilityId] }),
      `Freeze facility ${facilityId}; its policy can never change afterwards`,
    );
  }
  return { kind: "complete", description: vaultDeployInstruction(plan) };
}

/**
 * The vault has no owner, so any funded key may deploy it once the facility is frozen.
 * `--constructor-args` takes every value after it, so it must come last.
 */
export function vaultDeployInstruction(plan: QuorumFacilityPlan): string {
  return [
    "Facility is frozen. Deploy its CovenantVault, then record it in deployments/arc-testnet.json:",
    `forge create contracts/src/CovenantVault.sol:CovenantVault --broadcast \\`,
    `  --rpc-url https://rpc.testnet.arc.network --account signa-arc-admin \\`,
    `  --constructor-args ${plan.facilityId} ${plan.registry} ${plan.engine}`,
  ].join("\n");
}
