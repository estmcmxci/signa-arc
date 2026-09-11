import {
  BaseError,
  ExecutionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  erc20Abi,
  hexToString,
  isAddressEqual,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { coverageEngineAbi, covenantVaultAbi, credentialRegistryAbi, facilityRegistryAbi } from "./abis.ts";
import { formatAmount, type Amount } from "./amounts.ts";
import type { DeploymentManifest } from "./deployment.ts";
import { COVENANT_STATES, EXPOSURE_REASONS, HEDGE_REASONS, HEDGE_STATUSES, RESULT_REASONS, enumName } from "./enums.ts";
import { SignaError } from "./errors.ts";
import { isoTime, openSession, reason, type BlockContext, type ReadClient, type Session } from "./rpc.ts";
import { requireVaultBinding } from "./status.ts";

/**
 * The P0 live reads. Each opens one session and pins every read to its block (ERD C-05). Verdicts
 * come from the contracts themselves: the engine's evaluation and per-credential eligibility, and
 * the vault's own `draw` for simulation. Nothing here re-implements coverage arithmetic.
 */

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

export type LiveContext = { chainId: number; block: BlockContext };

function currency(value: Hex): string {
  return hexToString(value, { size: 3 });
}

function contexts(session: Session): LiveContext {
  return { chainId: session.chainId, block: session.block };
}

// ---------------------------------------------------------------------------------------------
// facility show

export async function readFacility(client: ReadClient, manifest: DeploymentManifest, rpcUrl: string) {
  const session = await openSession(client, rpcUrl);
  await requireVaultBinding(session, manifest);
  const { blockNumber } = session;
  const id = manifest.facility.id;
  const read = session.contract;
  const vault = { address: manifest.contracts.covenantVault.address, abi: covenantVaultAbi, blockNumber } as const;
  const registry = { address: manifest.contracts.facilityRegistry.address, abi: facilityRegistryAbi, blockNumber } as const;

  const policy = await read("FacilityRegistry.getFacility()", () => client.readContract({ ...registry, functionName: "getFacility", args: [id] }));
  const [exposureIssuerApproved, hedgeIssuerApproved, balance, principal, available, state, stateBeforeWaiver, cureDeadline, activeWaiver, waiverEndsAt, waiverReasonCommitment] =
    await Promise.all([
      read("FacilityRegistry.isExposureIssuer()", () => client.readContract({ ...registry, functionName: "isExposureIssuer", args: [id, manifest.roles.exposureIssuer] })),
      read("FacilityRegistry.isHedgeIssuer()", () => client.readContract({ ...registry, functionName: "isHedgeIssuer", args: [id, manifest.roles.hedgeIssuer] })),
      read("settlementAsset.balanceOf(vault)", () =>
        client.readContract({ address: policy.settlementAsset, abi: erc20Abi, blockNumber, functionName: "balanceOf", args: [manifest.contracts.covenantVault.address] }),
      ),
      read("CovenantVault.principal()", () => client.readContract({ ...vault, functionName: "principal" })),
      read("CovenantVault.availableToDraw()", () => client.readContract({ ...vault, functionName: "availableToDraw" })),
      read("CovenantVault.covenantState()", () => client.readContract({ ...vault, functionName: "covenantState" })),
      read("CovenantVault.stateBeforeWaiver()", () => client.readContract({ ...vault, functionName: "stateBeforeWaiver" })),
      read("CovenantVault.cureDeadline()", () => client.readContract({ ...vault, functionName: "cureDeadline" })),
      read("CovenantVault.activeWaiver()", () => client.readContract({ ...vault, functionName: "activeWaiver" })),
      read("CovenantVault.waiverEndsAt()", () => client.readContract({ ...vault, functionName: "waiverEndsAt" })),
      read("CovenantVault.waiverReasonCommitment()", () => client.readContract({ ...vault, functionName: "waiverReasonCommitment" })),
    ]);

  const onChain = {
    settlementCurrency: currency(policy.settlementCurrency),
    exposureCurrency: currency(policy.exposureCurrency),
    minCoverageBps: policy.minCoverageBps,
    defaultHaircutBps: policy.defaultHaircutBps,
    credentialMaxAgeSeconds: policy.credentialMaxAge,
    maturityToleranceSeconds: policy.maturityTolerance,
    reserve: formatAmount(policy.reserveAmount),
    curePeriodSeconds: policy.curePeriod,
    maxWaiverDurationSeconds: policy.maxWaiverDuration,
    maxActiveHedges: policy.maxActiveHedges,
    settlementAsset: policy.settlementAsset,
    frozen: policy.frozen,
  };
  const expected = manifest.facility.policy;
  const comparisons: [string, unknown, unknown][] = [
    ["minCoverageBps", expected.minCoverageBps, onChain.minCoverageBps],
    ["defaultHaircutBps", expected.defaultHaircutBps, onChain.defaultHaircutBps],
    ["credentialMaxAgeSeconds", expected.credentialMaxAgeSeconds, onChain.credentialMaxAgeSeconds],
    ["maturityToleranceSeconds", expected.maturityToleranceSeconds, onChain.maturityToleranceSeconds],
    ["reserveAmount", expected.reserveAmount, onChain.reserve.units],
    ["cureWindowSeconds", expected.cureWindowSeconds, onChain.curePeriodSeconds],
    ["maxWaiverDurationSeconds", expected.maxWaiverDurationSeconds, onChain.maxWaiverDurationSeconds],
    ["maxActiveHedges", expected.maxActiveHedges, onChain.maxActiveHedges],
    ["settlementCurrency", expected.settlementCurrency, onChain.settlementCurrency],
    ["exposureCurrency", expected.exposureCurrency, onChain.exposureCurrency],
    ["settlementAsset", manifest.settlementAsset.address, onChain.settlementAsset],
    ["roles.facilityAdmin", manifest.roles.facilityAdmin, policy.admin],
    ["roles.operator", manifest.roles.operator, policy.operator],
  ];
  const manifestDifferences = comparisons
    .filter(([, manifestValue, chainValue]) => manifestValue !== undefined && String(manifestValue).toLowerCase() !== String(chainValue).toLowerCase())
    .map(([field, manifestValue, chainValue]) => ({ field, manifest: String(manifestValue), chain: String(chainValue) }));

  const waiverRecorded = waiverEndsAt > 0n;
  return {
    ...contexts(session),
    policy: onChain,
    roles: {
      admin: policy.admin,
      operator: policy.operator,
      exposureIssuer: { address: manifest.roles.exposureIssuer, approved: exposureIssuerApproved },
      hedgeIssuer: { address: manifest.roles.hedgeIssuer, approved: hedgeIssuerApproved },
    },
    vault: {
      address: manifest.contracts.covenantVault.address,
      balance: formatAmount(balance),
      principal: formatAmount(principal),
      availableToDraw: formatAmount(available),
    },
    covenant: {
      storedState: enumName(COVENANT_STATES, state),
      cureDeadline: isoTime(cureDeadline),
      waiver: {
        active: activeWaiver,
        endsAt: isoTime(waiverEndsAt),
        reasonCommitment: waiverRecorded ? waiverReasonCommitment : null,
        stateBeforeWaiver: waiverRecorded ? enumName(COVENANT_STATES, stateBeforeWaiver) : null,
      },
    },
    manifestDifferences,
  };
}

// ---------------------------------------------------------------------------------------------
// coverage show

export async function readCoverage(client: ReadClient, manifest: DeploymentManifest, rpcUrl: string) {
  const session = await openSession(client, rpcUrl);
  await requireVaultBinding(session, manifest);
  const { blockNumber } = session;
  const id = manifest.facility.id;
  const read = session.contract;
  const engine = { address: manifest.contracts.coverageEngine.address, abi: coverageEngineAbi, blockNumber } as const;
  const vault = { address: manifest.contracts.covenantVault.address, abi: covenantVaultAbi, blockNumber } as const;

  const [result, exposureReason, tradeIds, state, activeWaiver] = await Promise.all([
    read("CoverageEngine.evaluate()", () => client.readContract({ ...engine, functionName: "evaluate", args: [id] })),
    read("CoverageEngine.exposureEligibility()", () => client.readContract({ ...engine, functionName: "exposureEligibility", args: [id] })),
    read("CredentialRegistry.hedgeTradeIds()", () =>
      client.readContract({ address: manifest.contracts.credentialRegistry.address, abi: credentialRegistryAbi, blockNumber, functionName: "hedgeTradeIds", args: [id] }),
    ),
    read("CovenantVault.covenantState()", () => client.readContract({ ...vault, functionName: "covenantState" })),
    read("CovenantVault.activeWaiver()", () => client.readContract({ ...vault, functionName: "activeWaiver" })),
  ]);
  const hedges = await Promise.all(
    tradeIds.map(async (tradeIdCommitment) => {
      const [hedgeReason, adjustedNotional] = await read("CoverageEngine.hedgeEligibility()", () =>
        client.readContract({ ...engine, functionName: "hedgeEligibility", args: [id, tradeIdCommitment] }),
      );
      return { tradeIdCommitment, eligibility: enumName(HEDGE_REASONS, hedgeReason), adjustedNotional: formatAmount(adjustedNotional) };
    }),
  );

  const evaluation = {
    assessed: result.assessed,
    compliant: result.compliant,
    coverageBps: result.coverageBps,
    requiredCoverageBps: result.requiredCoverageBps,
    outstandingValue: formatAmount(result.outstandingValue),
    grossEligible: formatAmount(result.grossEligible),
    countedEligible: formatAmount(result.countedEligible),
    eligibleHedgeCount: result.eligibleHedgeCount,
    totalHedgeCount: result.totalHedgeCount,
    exposureReason: enumName(EXPOSURE_REASONS, result.exposureReason),
    resultReason: enumName(RESULT_REASONS, result.resultReason),
  };
  const storedState = enumName(COVENANT_STATES, state);
  const ineligible = hedges.filter((hedge) => hedge.eligibility !== "ELIGIBLE");
  const explanation = [
    evaluation.compliant
      ? `Coverage is ${evaluation.coverageBps} of the ${evaluation.requiredCoverageBps} bps required: compliant at this block.`
      : `Coverage is ${evaluation.coverageBps} of the ${evaluation.requiredCoverageBps} bps required: not compliant at this block (${evaluation.resultReason}).`,
    evaluation.exposureReason === "ELIGIBLE" ? "" : `The exposure credential is ${evaluation.exposureReason}.`,
    ineligible.length === 0 ? "" : `${ineligible.length} of ${hedges.length} hedge(s) are not eligible: ${[...new Set(ineligible.map((hedge) => hedge.eligibility))].join(", ")}.`,
    `The vault's stored state is ${storedState}${activeWaiver ? ", with a waiver active" : ""}. The vault records it and updates it only when it syncs; this evaluation is computed at this block.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ...contexts(session),
    evaluation,
    exposure: { eligibility: enumName(EXPOSURE_REASONS, exposureReason) },
    hedges,
    covenant: { storedState, activeWaiver },
    explanation,
  };
}

// ---------------------------------------------------------------------------------------------
// credentials list

export async function readCredentials(client: ReadClient, manifest: DeploymentManifest, rpcUrl: string) {
  const session = await openSession(client, rpcUrl);
  const { blockNumber, blockTimestamp } = session;
  const id = manifest.facility.id;
  const read = session.contract;
  const credentials = { address: manifest.contracts.credentialRegistry.address, abi: credentialRegistryAbi, blockNumber } as const;

  const [exposure, tradeIds, policy] = await Promise.all([
    read("CredentialRegistry.currentExposure()", () => client.readContract({ ...credentials, functionName: "currentExposure", args: [id] })),
    read("CredentialRegistry.hedgeTradeIds()", () => client.readContract({ ...credentials, functionName: "hedgeTradeIds", args: [id] })),
    read("FacilityRegistry.getFacility()", () =>
      client.readContract({ address: manifest.contracts.facilityRegistry.address, abi: facilityRegistryAbi, blockNumber, functionName: "getFacility", args: [id] }),
    ),
  ]);
  const hedges = await Promise.all(
    tradeIds.map((tradeIdCommitment) =>
      read("CredentialRegistry.currentHedge()", () => client.readContract({ ...credentials, functionName: "currentHedge", args: [id, tradeIdCommitment] })),
    ),
  );
  const timing = (observedAt: bigint, validUntil: bigint) => ({
    observedAt: isoTime(observedAt),
    validUntil: isoTime(validUntil),
    ageSeconds: Number(blockTimestamp - observedAt),
    validForSeconds: Number(validUntil - blockTimestamp),
  });

  return {
    ...contexts(session),
    credentialMaxAgeSeconds: policy.credentialMaxAge,
    exposure:
      exposure.digest === ZERO_BYTES32
        ? null
        : {
            sequence: exposure.credential.sequence.toString(),
            issuer: exposure.issuer,
            digest: exposure.digest,
            acceptedAt: isoTime(exposure.acceptedAt),
            issuerEpoch: exposure.issuerEpoch.toString(),
            outstandingValue: formatAmount(exposure.credential.outstandingValue),
            exposureCurrency: currency(exposure.credential.exposureCurrency),
            settlementCurrency: currency(exposure.credential.settlementCurrency),
            exposureMaturity: isoTime(exposure.credential.exposureMaturity),
            ...timing(exposure.credential.observedAt, exposure.credential.validUntil),
            sourceCommitment: exposure.credential.sourceCommitment,
          },
    hedges: hedges.map((hedge, index) => ({
      tradeIdCommitment: tradeIds[index] ?? hedge.credential.tradeIdCommitment,
      sequence: hedge.credential.sequence.toString(),
      status: enumName(HEDGE_STATUSES, hedge.credential.status),
      issuer: hedge.issuer,
      digest: hedge.digest,
      acceptedAt: isoTime(hedge.acceptedAt),
      issuerEpoch: hedge.issuerEpoch.toString(),
      remainingNotional: formatAmount(hedge.credential.remainingNotional),
      baseCurrency: currency(hedge.credential.baseCurrency),
      quoteCurrency: currency(hedge.credential.quoteCurrency),
      maturity: isoTime(hedge.credential.maturity),
      ...timing(hedge.credential.observedAt, hedge.credential.validUntil),
      sourceCommitment: hedge.credential.sourceCommitment,
    })),
    note: "Accepted by the registry is not the same as eligible for coverage. `signa coverage show` reports the engine's verdict on each credential at its own block.",
  };
}

// ---------------------------------------------------------------------------------------------
// draw simulate

const KNOWN_ERRORS = [...covenantVaultAbi, ...coverageEngineAbi, ...facilityRegistryAbi, ...credentialRegistryAbi].filter(
  (item) => item.type === "error",
) as Abi;

export type DecodedRefusal = { error: string; args: Record<string, string>; data: Hex; explanation: string };

/**
 * Simulates `CovenantVault.draw(amount)` with `eth_call` at one block, sent from the manifest's
 * operator: the real vault in its real host context, never `CoverageEngine.assess` from an
 * arbitrary account (ERD §6). A decoded refusal is a completed inquiry. A transport failure, or
 * a revert no contract error decodes, is not: it throws. Nothing is sent, and no state changes.
 */
export async function simulateDraw(client: ReadClient, manifest: DeploymentManifest, rpcUrl: string, units: bigint) {
  const session = await openSession(client, rpcUrl);
  await requireVaultBinding(session, manifest);
  const { blockNumber } = session;
  const id = manifest.facility.id;
  const read = session.contract;
  const vault = manifest.contracts.covenantVault.address;
  const operator = manifest.roles.operator;

  const policy = await read("FacilityRegistry.getFacility()", () =>
    client.readContract({ address: manifest.contracts.facilityRegistry.address, abi: facilityRegistryAbi, blockNumber, functionName: "getFacility", args: [id] }),
  );
  if (!isAddressEqual(policy.operator, operator)) {
    throw new SignaError("DEPLOYMENT_MISMATCH", `the manifest's operator ${operator} is not the facility's operator ${policy.operator}; draw can only be simulated as the operator`);
  }
  const [result, activeWaiver] = await Promise.all([
    read("CoverageEngine.evaluate()", () =>
      client.readContract({ address: manifest.contracts.coverageEngine.address, abi: coverageEngineAbi, blockNumber, functionName: "evaluate", args: [id] }),
    ),
    read("CovenantVault.activeWaiver()", () => client.readContract({ address: vault, abi: covenantVaultAbi, blockNumber, functionName: "activeWaiver" })),
  ]);
  const evaluation = {
    compliant: result.compliant,
    coverageBps: result.coverageBps,
    requiredCoverageBps: result.requiredCoverageBps,
    resultReason: enumName(RESULT_REASONS, result.resultReason),
    activeWaiver,
  };

  const data = encodeFunctionData({ abi: covenantVaultAbi, functionName: "draw", args: [units] });
  let refusal: DecodedRefusal | null = null;
  try {
    await client.call({ account: operator, to: vault, data, blockNumber });
  } catch (error) {
    refusal = decodeRefusal(error, evaluation, session, rpcUrl);
  }
  return {
    ...contexts(session),
    request: { function: "draw" as const, amount: formatAmount(units), sender: operator, vault },
    allowed: refusal === null,
    outcome: refusal === null ? ("permitted" as const) : ("refused" as const),
    ...(refusal ? { refusal } : {}),
    evaluation,
  };
}

function decodeRefusal(
  error: unknown,
  evaluation: { compliant: boolean; coverageBps: number; requiredCoverageBps: number; resultReason: string; activeWaiver: boolean },
  session: Session,
  rpcUrl: string,
): DecodedRefusal {
  const data = revertData(error);
  const reverted = data !== undefined || (error instanceof BaseError && error.walk((cause) => cause instanceof ExecutionRevertedError) !== null);
  if (!reverted) {
    const message = `RPC request to ${session.rpc} failed during the draw simulation: ${reason(error)}`;
    throw new SignaError("RPC_UNAVAILABLE", rpcUrl ? message.split(rpcUrl).join(session.rpc) : message, true);
  }
  if (!data || data === "0x") {
    throw new SignaError("SIMULATION_FAILED", "the simulated draw reverted without revert data, so its reason cannot be decoded");
  }
  let decoded: { errorName: string; args: readonly unknown[] | undefined };
  try {
    decoded = decodeErrorResult({ abi: KNOWN_ERRORS, data }) as { errorName: string; args: readonly unknown[] | undefined };
  } catch {
    throw new SignaError("SIMULATION_FAILED", `the simulated draw reverted with data no known contract error decodes: ${data}`);
  }
  const args = decoded.args ?? [];
  const coverage = `Current evaluation at this block: ${evaluation.coverageBps} of ${evaluation.requiredCoverageBps} bps, ${evaluation.compliant ? "compliant" : `not compliant (${evaluation.resultReason})`}${evaluation.activeWaiver ? ", waiver active" : ""}.`;
  switch (decoded.errorName) {
    case "DrawNotAllowed": {
      const state = enumName(COVENANT_STATES, args[0] as number);
      return {
        error: "DrawNotAllowed",
        args: { state },
        data,
        explanation: `The vault refused the draw: after its own covenant sync the facility is ${state}, and a draw needs compliant coverage or an active waiver. ${coverage}`,
      };
    }
    case "ReserveViolation": {
      const [balance, requested, reserve] = args as [bigint, bigint, bigint];
      return {
        error: "ReserveViolation",
        args: { balance: formatAmount(balance).usdc, requested: formatAmount(requested).usdc, reserve: formatAmount(reserve).usdc },
        data,
        explanation: `The vault refused the draw: it would leave the vault below its reserve. Balance ${formatAmount(balance).usdc}, requested ${formatAmount(requested).usdc}, reserve ${formatAmount(reserve).usdc} USDC. ${coverage}`,
      };
    }
    default:
      return {
        error: decoded.errorName,
        args: Object.fromEntries(args.map((value, index) => [String(index), typeof value === "bigint" ? value.toString() : String(value)])),
        data,
        explanation: `The vault refused the draw with ${decoded.errorName}. ${coverage}`,
      };
  }
}

/** The revert data carried anywhere in a viem error's cause chain, if any. */
function revertData(error: unknown): Hex | undefined {
  if (!(error instanceof BaseError)) return undefined;
  let found: Hex | undefined;
  error.walk((cause) => {
    const value = (cause as { data?: unknown }).data;
    const candidate = typeof value === "object" && value !== null ? (value as { data?: unknown }).data : value;
    if (typeof candidate === "string" && /^0x[0-9a-fA-F]*$/.test(candidate)) found = candidate as Hex;
    return false;
  });
  return found;
}
