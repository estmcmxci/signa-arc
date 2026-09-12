import { z } from "incur";

import { EVIDENCE_RECORD_IDS } from "./evidence/index.ts";

/**
 * Output schemas for every command, kept beside the command tree (ERD §6). They type each
 * handler's return value, and `--schema`, `--llms-full` and the generated command reference
 * publish them. Every result carries `schemaVersion: 1`, `kind` and `dataMode`.
 */

const amount = z.object({ units: z.string().describe("Six-decimal units, as a decimal string"), usdc: z.string().describe("The same amount in USDC, as a decimal string") });
const block = z.object({ number: z.string(), hash: z.string(), timestamp: z.string() }).describe("The block every read was pinned to");
const manifest = z.object({
  source: z.enum(["option", "environment", "bundled"]),
  path: z.string().optional().describe("Absolute path, for a manifest file"),
  sha256: z.string().optional().describe("SHA-256 of the manifest file's bytes"),
  copyOf: z.string().optional().describe("The repository file the bundled manifest copies"),
});

/** Context every live result carries (ERD C-04). */
export const liveContext = z.object({
  chainId: z.number(),
  facilityId: z.string(),
  vault: z.string(),
  manifest,
  rpc: z.object({ url: z.string().describe("Redacted RPC URL"), source: z.enum(["option", "environment", "manifest"]) }),
  block,
});

const liveBase = { schemaVersion: z.literal(1), kind: z.literal("report"), dataMode: z.literal("live"), context: liveContext };

export const statusOutput = z.object({
  ...liveBase,
  ready: z.literal(true),
  checks: z.array(z.object({ check: z.string(), detail: z.string() })),
  scope: z.string(),
});

export const facilityOutput = z.object({
  ...liveBase,
  policy: z.object({
    settlementCurrency: z.string(),
    exposureCurrency: z.string(),
    minCoverageBps: z.number(),
    defaultHaircutBps: z.number(),
    credentialMaxAgeSeconds: z.number(),
    maturityToleranceSeconds: z.number(),
    reserve: amount,
    curePeriodSeconds: z.number(),
    maxWaiverDurationSeconds: z.number(),
    maxActiveHedges: z.number(),
    settlementAsset: z.string(),
    frozen: z.boolean(),
  }),
  roles: z.object({
    admin: z.string(),
    operator: z.string(),
    exposureIssuer: z.object({ address: z.string(), approved: z.boolean().describe("Whether the registry approves this manifest issuer at the block") }),
    hedgeIssuer: z.object({ address: z.string(), approved: z.boolean() }),
  }),
  vault: z.object({ address: z.string(), balance: amount, principal: amount, availableToDraw: amount }),
  covenant: z.object({
    storedState: z.string().describe("The state the vault last recorded; it changes only when the vault syncs"),
    cureDeadline: z.string().nullable(),
    waiver: z.object({ active: z.boolean(), endsAt: z.string().nullable(), reasonCommitment: z.string().nullable(), stateBeforeWaiver: z.string().nullable() }),
  }),
  manifestDifferences: z.array(z.object({ field: z.string(), manifest: z.string(), chain: z.string() })).describe("Where the chain disagrees with the manifest"),
  scope: z.string(),
});

export const coverageOutput = z.object({
  ...liveBase,
  evaluation: z.object({
    assessed: z.boolean(),
    compliant: z.boolean(),
    coverageBps: z.number(),
    requiredCoverageBps: z.number(),
    outstandingValue: amount,
    grossEligible: amount,
    countedEligible: amount,
    eligibleHedgeCount: z.number(),
    totalHedgeCount: z.number(),
    exposureReason: z.string(),
    resultReason: z.string(),
  }).describe("CoverageEngine.evaluate at the block"),
  exposure: z.object({ eligibility: z.string().describe("CoverageEngine.exposureEligibility") }),
  hedges: z.array(z.object({ tradeIdCommitment: z.string(), eligibility: z.string().describe("CoverageEngine.hedgeEligibility"), adjustedNotional: amount })),
  covenant: z.object({ storedState: z.string(), activeWaiver: z.boolean() }).describe("The vault's stored state, reported separately from the evaluation"),
  explanation: z.string(),
  scope: z.string(),
});

const timing = {
  observedAt: z.string().nullable(),
  validUntil: z.string().nullable(),
  ageSeconds: z.number().describe("Block time minus observedAt"),
  validForSeconds: z.number().describe("validUntil minus block time; negative once passed"),
};

export const credentialsListOutput = z.object({
  ...liveBase,
  credentialMaxAgeSeconds: z.number(),
  exposure: z
    .object({
      sequence: z.string(),
      issuer: z.string(),
      digest: z.string(),
      acceptedAt: z.string().nullable(),
      issuerEpoch: z.string(),
      outstandingValue: amount,
      exposureCurrency: z.string(),
      settlementCurrency: z.string(),
      exposureMaturity: z.string().nullable(),
      ...timing,
      sourceCommitment: z.string(),
    })
    .nullable(),
  hedges: z.array(
    z.object({
      tradeIdCommitment: z.string(),
      sequence: z.string(),
      status: z.string(),
      issuer: z.string(),
      digest: z.string(),
      acceptedAt: z.string().nullable(),
      issuerEpoch: z.string(),
      remainingNotional: amount,
      baseCurrency: z.string(),
      quoteCurrency: z.string(),
      maturity: z.string().nullable(),
      ...timing,
      sourceCommitment: z.string(),
    }),
  ),
  note: z.string(),
});

export const inspectOutput = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("report"),
  dataMode: z.literal("offline"),
  context: z.object({
    chainId: z.number(),
    facilityId: z.string(),
    credentialRegistry: z.string(),
    manifest,
    input: z.object({ path: z.string(), sha256: z.string() }),
  }).describe("No block: nothing was read from a chain"),
  envelope: z.object({
    kind: z.enum(["exposure", "hedge"]),
    digest: z.string(),
    recoveredSigner: z.string(),
    claimedIssuer: z.string(),
    manifestRole: z.enum(["exposureIssuer", "hedgeIssuer"]).nullable().describe("The manifest role this signer holds, if any. Not a live authorization check"),
    domain: z.object({ name: z.string(), version: z.string(), chainId: z.number(), verifyingContract: z.string() }),
    credential: z.record(z.string(), z.union([z.string(), z.number()])),
  }),
  established: z.array(z.string()),
  notEstablished: z.array(z.string()),
});

export const drawSimulateOutput = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("simulation"),
  dataMode: z.literal("live"),
  context: liveContext,
  request: z.object({ function: z.literal("draw"), amount, sender: z.string().describe("The facility's operator"), vault: z.string() }),
  allowed: z.boolean(),
  outcome: z.enum(["permitted", "refused"]),
  refusal: z
    .object({
      error: z.string().describe("The decoded contract error"),
      args: z.record(z.string(), z.string()),
      data: z.string().describe("Raw revert data"),
      explanation: z.string(),
    })
    .optional(),
  evaluation: z.object({ compliant: z.boolean(), coverageBps: z.number(), requiredCoverageBps: z.number(), resultReason: z.string(), activeWaiver: z.boolean() }),
  scope: z.string(),
});

const recordSource = z.object({ path: z.string(), sha256: z.string() });
const recordSummary = z.object({
  id: z.enum(EVIDENCE_RECORD_IDS),
  title: z.string(),
  description: z.string(),
  recordedAt: z.string().describe("When the record was made, not now"),
  outcome: z.string(),
  summary: z.string(),
  transactions: z.number(),
  source: recordSource,
});
const recordDetail = recordSummary.extend({
  network: z.object({ chainId: z.number(), explorer: z.string() }),
  facilityId: z.string(),
  steps: z.array(
    z.object({
      label: z.string(),
      action: z.string(),
      transactionHash: z.string().optional(),
      explorer: z.string().optional(),
      blockNumber: z.string().optional(),
      sender: z.string().optional(),
      expectedStatus: z.string().optional(),
      actualStatus: z.string().optional(),
      covenantState: z.string().optional(),
      coverageBps: z.number().optional(),
      reason: z.string().optional(),
      result: z.string().optional(),
      at: z.string().optional(),
    }),
  ),
  approvals: z.array(z.object({ role: z.string(), signedAt: z.string() })).optional(),
  disclaimers: z.array(z.string()),
});
const recordedBase = { schemaVersion: z.literal(1), kind: z.literal("report"), dataMode: z.literal("recorded"), notice: z.string() };
export const evidenceOutput = z.union([
  z.object({ ...recordedBase, chainId: z.number(), facilityId: z.string(), records: z.array(recordSummary) }),
  z.object({ ...recordedBase, record: recordDetail }),
]);

// ---------------------------------------------------------------------------------------------
// P1 operations. Every one of these broadcasts at most one transaction.

const event = z.object({ name: z.string(), args: z.record(z.string(), z.string()) });

/** A mined, successful transaction. A revert or a timeout is an error, not a result. */
const minedTransaction = z.object({
  hash: z.string(),
  status: z.literal("success").describe("Receipt status 0x1. The receipt decides, not the signer subprocess exit code"),
  block: block.describe("The receipt's own block, which postconditions are read at"),
  from: z.string(),
  to: z.string().nullable(),
  nonce: z.number(),
  gasUsed: z.string(),
  effectiveGasPrice: z.string(),
  events: z.array(event).describe("Logs decoded against the deployed contracts' events"),
});

const sendBase = {
  schemaVersion: z.literal(1),
  kind: z.literal("transaction"),
  dataMode: z.literal("live"),
  context: liveContext.describe("The preflight block, at which the action was simulated"),
  account: z.object({ name: z.string().describe("The --account name"), address: z.string() }),
  broadcast: z.literal(true).describe("A refused action never reaches this result: it exits nonzero as ACTION_REFUSED"),
  transaction: minedTransaction,
  journal: z.object({ path: z.string().describe("The operation journal, which lives outside the repository") }),
  scope: z.string(),
};

export const credentialsSubmitOutput = z.object({
  ...sendBase,
  request: z.object({
    function: z.enum(["submitExposure", "submitHedge"]),
    registry: z.string(),
    kind: z.enum(["exposure", "hedge"]),
    sequence: z.string(),
    digest: z.string(),
    issuer: z.string(),
    tradeIdCommitment: z.string().optional().describe("Hedge only: the sequence scope is (facility, trade commitment)"),
  }),
  accepted: z.object({
    sequence: z.string(),
    digest: z.string(),
    issuer: z.string(),
    acceptedAt: z.string().nullable(),
    matchesSubmitted: z.boolean().describe("Whether the registry now holds exactly the envelope that was submitted"),
  }).describe("What the registry holds at the receipt block"),
  eligibility: z.object({
    coverageBps: z.number(),
    requiredCoverageBps: z.number(),
    compliant: z.boolean(),
    resultReason: z.string(),
    credential: z.string().describe("The engine's eligibility verdict on this credential"),
  }).describe("Read at the receipt block. Acceptance by the registry is not eligibility for coverage"),
  note: z.string(),
});

const covenantTransition = z.object({
  storedStateBefore: z.string().describe("At the preflight block"),
  storedStateAfter: z.string().describe("At the receipt block"),
  changed: z.boolean(),
  activeWaiver: z.boolean(),
  cureDeadline: z.string().nullable(),
});

export const covenantSyncOutput = z.object({
  ...sendBase,
  request: z.object({ function: z.literal("syncCovenant"), vault: z.string() }),
  covenant: covenantTransition,
  evaluation: z.object({ compliant: z.boolean(), coverageBps: z.number(), requiredCoverageBps: z.number(), resultReason: z.string() }).describe("At the receipt block"),
});

export const covenantRestoreOutput = z.object({
  ...sendBase,
  request: z.object({ function: z.literal("restoreCompliance"), vault: z.string() }),
  covenant: covenantTransition,
  evaluation: z.object({ compliant: z.boolean(), coverageBps: z.number(), requiredCoverageBps: z.number(), resultReason: z.string() }),
});

export const drawSendOutput = z.object({
  ...sendBase,
  request: z.object({ function: z.literal("draw"), amount, vault: z.string(), sender: z.string() }),
  vault: z.object({ balance: amount, principal: amount, availableToDraw: amount }).describe("At the receipt block"),
  covenant: z.object({ storedState: z.string(), activeWaiver: z.boolean() }).describe("At the receipt block; draw syncs the covenant before it proceeds"),
});

export const txShowOutput = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("report"),
  dataMode: z.literal("live"),
  context: z.object({
    chainId: z.number(),
    rpc: z.object({ url: z.string(), source: z.enum(["option", "environment", "manifest"]) }),
    block: block.describe("The chain head when the transaction was looked up"),
  }),
  hash: z.string(),
  state: z.enum(["mined", "pending", "unknown"]),
  status: z.enum(["success", "reverted"]).nullable().describe("Null while pending or unknown"),
  transaction: minedTransaction.partial().nullable(),
  pending: z.object({ nonce: z.number().nullable(), from: z.string().nullable() }).nullable(),
  revert: z
    .object({ error: z.string(), args: z.record(z.string(), z.string()), data: z.string(), explanation: z.string() })
    .nullable()
    .describe("Recovered by replaying the call at the receipt block. Null when it succeeded, or when no reason is disclosed"),
  undecodableRevert: z.string().nullable().describe("Revert data no known contract error decodes. Never guessed at"),
  scope: z.string(),
});

// ---------------------------------------------------------------------------------------------
// The waiver desk. A waiver is authorized by a Privy key quorum, not by a keystore, so these
// results carry a proposal rather than a signer.

/** Where the quorum's proposals are recorded, and what the admin wallet is. */
const quorumContext = z.object({
  chainId: z.number(),
  facilityId: z.string(),
  vault: z.string(),
  admin: z.object({
    walletId: z.string().describe("The Privy wallet the manifest names as the facility admin"),
    address: z.string(),
  }),
  manifest,
  rpc: z.object({ url: z.string(), source: z.enum(["option", "environment", "manifest"]) }),
});

export const waiverStatusOutput = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("report"),
  dataMode: z.literal("live"),
  context: quorumContext,
  wouldAccept: z.boolean().describe("Whether createWaiver would be accepted now. A refusal is an answer, so this exits 0 either way"),
  refusals: z.array(z.string()).describe("Every reason the contract would refuse a waiver of any duration. Empty when it would accept one"),
  covenant: z.object({ storedState: z.string(), activeWaiver: z.boolean(), waiverEndsAt: z.string() }),
  coverage: z.object({
    compliant: z.boolean(),
    coverageBps: z.number(),
    requiredCoverageBps: z.number(),
    resultReason: z.string(),
    exposureReason: z.string(),
  }).describe("A fresh evaluation, because createWaiver syncs before it checks"),
  maxWaiverDurationSeconds: z.number(),
  scope: z.string(),
});

const proposal = z.object({
  intentId: z.string(),
  kind: z.string(),
  status: z.string().describe("Privy's status for the intent"),
  description: z.string(),
  reason: z.string().optional().describe("The stated reason. Only its keccak256 goes on chain"),
  createdAt: z.string(),
  expiresAt: z.string(),
  call: z.object({
    to: z.string(),
    data: z.string(),
    functionName: z.string(),
    args: z.array(z.string()),
    chainId: z.number(),
    nonce: z.number().describe("Pinned at proposal. Only one proposal can be in flight"),
    value: z.string(),
  }),
  approvals: z.object({
    threshold: z.number(),
    collected: z.number(),
    members: z.array(z.object({ publicKey: z.string(), signedAt: z.string().nullable() })),
  }),
  broadcast: z
    .object({ hash: z.string(), status: z.string(), blockNumber: z.string(), explorerUrl: z.string() })
    .optional(),
});

const proposalBase = {
  schemaVersion: z.literal(1),
  kind: z.literal("proposal").describe("Not a chain transaction: a Privy intent, which only broadcast puts on chain"),
  dataMode: z.literal("live"),
  context: quorumContext,
  proposal,
  store: z.object({ path: z.string().describe("Where proposals are recorded, outside every repository") }),
  scope: z.string(),
};

export const waiverProposeOutput = z.object({ ...proposalBase, willSign: z.string().describe("Exactly what each approver will authorize") });
export const waiverApproveOutput = z.object({
  ...proposalBase,
  approved: z.object({ role: z.string(), publicKey: z.string(), signedAt: z.string() }),
  remaining: z.number().describe("Approvals still needed before Privy will sign"),
});
export const waiverRejectOutput = z.object(proposalBase);

export const waiverBroadcastOutput = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("transaction"),
  dataMode: z.literal("live"),
  context: quorumContext,
  proposal,
  broadcast: z.literal(true),
  transaction: z.object({
    hash: z.string(),
    status: z.literal("success").describe("Decided by the receipt, never by Privy's own status"),
    blockNumber: z.string(),
    explorerUrl: z.string(),
  }),
  waiverCreated: z
    .object({
      facilityId: z.string(),
      reasonCommitment: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      logIndex: z.number(),
      facilityMatches: z.boolean(),
      reasonCommitmentMatches: z.boolean(),
    })
    .nullable()
    .describe("The event the receipt must carry, checked against this facility and the stated reason"),
  journal: z.object({ path: z.string() }),
  scope: z.string(),
});
