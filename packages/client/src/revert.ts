import { BaseError, ExecutionRevertedError, decodeErrorResult, type Abi, type Hex } from "viem";

import { coverageEngineAbi, covenantVaultAbi, credentialRegistryAbi, facilityRegistryAbi } from "./abis.ts";
import { formatAmount } from "./amounts.ts";
import { COVENANT_STATES, enumName } from "./enums.ts";

/**
 * Revert decoding shared by simulation, sending and transaction inspection. Only errors the
 * deployed contracts actually declare are decoded; anything else stays raw rather than being
 * guessed at, because a fabricated reason is worse than an honest "undecodable".
 */

export const KNOWN_ERRORS = [...covenantVaultAbi, ...coverageEngineAbi, ...facilityRegistryAbi, ...credentialRegistryAbi].filter(
  (item) => item.type === "error",
) as Abi;

export type DecodedError = { error: string; args: Record<string, string>; data: Hex; explanation: string };

/** The revert data carried anywhere in a viem error's cause chain, if any. */
export function revertData(error: unknown): Hex | undefined {
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

/** Whether the chain rejected the call, as opposed to the transport failing to deliver it. */
export function isRevert(error: unknown): boolean {
  return revertData(error) !== undefined || (error instanceof BaseError && error.walk((cause) => cause instanceof ExecutionRevertedError) !== null);
}

/** Decodes revert data against the deployed contracts' errors, or null when none matches. */
export function decodeContractError(data: Hex): DecodedError | null {
  if (!data || data === "0x") return null;
  let decoded: { errorName: string; args: readonly unknown[] | undefined };
  try {
    decoded = decodeErrorResult({ abi: KNOWN_ERRORS, data }) as { errorName: string; args: readonly unknown[] | undefined };
  } catch {
    return null;
  }
  const args = decoded.args ?? [];
  switch (decoded.errorName) {
    case "DrawNotAllowed": {
      const state = enumName(COVENANT_STATES, args[0] as number);
      return {
        error: "DrawNotAllowed",
        args: { state },
        data,
        explanation: `after its own covenant sync the facility is ${state}, and a draw needs compliant coverage or an active waiver`,
      };
    }
    case "ReserveViolation": {
      const [balance, requested, reserve] = args as [bigint, bigint, bigint];
      return {
        error: "ReserveViolation",
        args: { balance: formatAmount(balance).usdc, requested: formatAmount(requested).usdc, reserve: formatAmount(reserve).usdc },
        data,
        explanation: `it would leave the vault below its reserve. Balance ${formatAmount(balance).usdc}, requested ${formatAmount(requested).usdc}, reserve ${formatAmount(reserve).usdc} USDC`,
      };
    }
    default:
      return {
        error: decoded.errorName,
        args: Object.fromEntries(args.map((value, index) => [String(index), typeof value === "bigint" ? value.toString() : String(value)])),
        data,
        explanation: `the contract refused with ${decoded.errorName}`,
      };
  }
}
