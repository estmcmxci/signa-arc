import type { Address, Hex } from "viem";

import type { AuthorizationPayloadInput } from "./authorization.ts";
import { encodeCreateWaiver, encodeRevokeWaiver, reasonCommitment, type PinnedTransaction } from "./arc.ts";
import type { Policy, PolicyInput } from "./privy-client.ts";

/**
 * The Privy policy on the facility admin wallet. It may sign `createWaiver` on the facility's
 * vault, on Arc Testnet, moving no value. Privy denies whatever no rule allows, so this one ALLOW
 * rule is everything the admin key can ever sign. The quorum still approves each call; the policy
 * bounds what the quorum can be asked to approve.
 *
 * The key quorum owns the policy, so changing it, deleting it or detaching it from the wallet
 * takes both approvers, the same as a waiver.
 *
 * It does not cap `duration`. Privy's calldata comparator never matches integer arguments
 * narrower than uint64 (measured), and `duration` is uint32. The contract enforces
 * `maxWaiverDuration`, and QuorumAdminService refuses a longer waiver before proposing it.
 *
 * Privy evaluates a policy when it executes an intent, not when the intent is proposed, so a call
 * the policy denies would still collect both approvals and only then fail. QuorumAdminService only
 * proposes createWaiver, after checking the chain would accept it.
 */

export const WAIVER_POLICY_NAME = "Signa admin: createWaiver on the vault only";

/** Privy decodes calldata with this. revokeWaiver is listed so it decodes, and is then refused by name. */
const VAULT_POLICY_ABI = [
  {
    type: "function",
    name: "createWaiver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "duration", type: "uint32" },
      { name: "reasonCommitment", type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "function", name: "revokeWaiver", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

export function waiverOnlyPolicy(vault: Address, chainId: number, ownerId: string): PolicyInput {
  return {
    version: "1.0",
    name: WAIVER_POLICY_NAME,
    chain_type: "ethereum",
    owner_id: ownerId,
    rules: [
      {
        name: "createWaiver on the facility vault",
        method: "eth_signTransaction",
        action: "ALLOW",
        conditions: [
          { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(chainId) },
          { field_source: "ethereum_transaction", field: "to", operator: "eq", value: vault },
          { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0x0" },
          {
            field_source: "ethereum_calldata",
            field: "function_name",
            abi: VAULT_POLICY_ABI,
            operator: "eq",
            value: "createWaiver",
          },
        ],
      },
    ],
  };
}

/** How a stored policy differs from the expected one, ignoring the ids and ABI copy Privy keeps. */
export function policyProblems(policy: Policy, expected: PolicyInput): string[] {
  const conditions = (rules: PolicyInput["rules"]) =>
    rules.map((rule) =>
      [rule.method, rule.action, ...rule.conditions.map((c) => `${c.field_source}.${c.field} ${c.operator} ${String(c.value).toLowerCase()}`)].join(" | "),
    );
  const problems: string[] = [];
  if (policy.chain_type !== expected.chain_type) problems.push(`chain_type ${policy.chain_type}`);
  if ((policy.owner_id ?? null) !== (expected.owner_id ?? null)) problems.push(`owner ${String(policy.owner_id)}`);
  const actual = conditions(policy.rules);
  const wanted = conditions(expected.rules);
  if (actual.length !== wanted.length || actual.some((rule, index) => rule !== wanted[index])) {
    problems.push(`rules ${JSON.stringify(actual)}`);
  }
  return problems;
}

/** What every approver signs to change the wallet's policies: a PATCH of the wallet itself. */
export function walletUpdateAuthorizationInput(
  walletUrl: string,
  body: { policy_ids: string[] },
  appId: string,
): AuthorizationPayloadInput {
  return { version: 1, method: "PATCH", url: walletUrl, body, headers: { "privy-app-id": appId } };
}

export type PolicyControl = {
  name: string;
  /** How it differs from the one call the policy allows. */
  varies: string;
  expect: "allowed" | "denied";
  tx: PinnedTransaction;
};

/** Unmineable: the wallet will never reach this nonce, and no block's base fee is 1 wei. */
const PROBE_NONCE = 1_000_000_000;

/**
 * The allowed call, then one variant per condition that must deny it: another function on the
 * vault, the same function on another contract, and the same call on another chain. The last
 * allowed case records the policy's known gap: it cannot see `duration`. Nothing is broadcast.
 */
export function policyControls(input: {
  wallet: Address;
  vault: Address;
  otherContract: Address;
  chainId: number;
  maxWaiverDurationSeconds: number;
}): PolicyControl[] {
  const commitment = reasonCommitment("policy control: signed, never broadcast");
  const probe = (to: Address, data: Hex, chainId = input.chainId): PinnedTransaction => ({
    chainId,
    from: input.wallet,
    to,
    data,
    nonce: PROBE_NONCE,
    gas: 200_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 0n,
  });
  const createWaiver = encodeCreateWaiver(3_600, commitment);
  return [
    { name: "createWaiver on the facility vault", varies: "nothing: the one allowed call", expect: "allowed", tx: probe(input.vault, createWaiver) },
    { name: "revokeWaiver on the facility vault", varies: "another function", expect: "denied", tx: probe(input.vault, encodeRevokeWaiver()) },
    { name: "createWaiver on the FacilityRegistry", varies: "another contract", expect: "denied", tx: probe(input.otherContract, createWaiver) },
    { name: "createWaiver on the vault, chain 1", varies: "another chain", expect: "denied", tx: probe(input.vault, createWaiver, 1) },
    {
      name: "createWaiver above maxWaiverDuration",
      varies: "duration: the policy cannot cap uint32, so the contract and pre-validation do",
      expect: "allowed",
      tx: probe(input.vault, encodeCreateWaiver(input.maxWaiverDurationSeconds * 10, commitment)),
    },
  ];
}
