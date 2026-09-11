/**
 * Every failure a Signa command reports (ERD §6). Consumers branch on `code`, never on the
 * message. The full set is fixed now so it stays stable as commands are added. P0 commands raise
 * INVALID_INPUT, INVALID_MANIFEST, CHAIN_MISMATCH, DEPLOYMENT_MISMATCH, RPC_UNAVAILABLE,
 * INVALID_SIGNATURE and SIMULATION_FAILED. The rest are reserved for P1 operations.
 */
export const SIGNA_ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_MANIFEST",
  "CHAIN_MISMATCH",
  "DEPLOYMENT_MISMATCH",
  "RPC_UNAVAILABLE",
  "INVALID_SIGNATURE",
  "SIMULATION_FAILED",
  "STALE_SEQUENCE",
  "SIGNER_UNAVAILABLE",
  "SIGNER_ROLE_MISMATCH",
  "ACTION_REFUSED",
  "TRANSACTION_REVERTED",
  "TRANSACTION_PENDING",
] as const;

export type SignaErrorCode = (typeof SIGNA_ERROR_CODES)[number];

/** What each code means and which commands raise it. The generated error reference reads this. */
export const ERROR_DESCRIPTIONS: Record<SignaErrorCode, { meaning: string; raisedBy: string }> = {
  INVALID_INPUT: {
    meaning:
      "An argument, option or input file has the wrong shape. Examples: an RPC URL that is not http(s); a draw amount that is not a positive six-decimal number; a credential envelope that is malformed, or signed for another chain, registry or facility.",
    raisedBy: "status, facility show, coverage show, credentials list, credentials inspect, draw simulate",
  },
  INVALID_MANIFEST: {
    meaning: "The deployment manifest cannot be read, is not JSON, or fails validation. There is no fallback to another manifest.",
    raisedBy: "every command that reads a manifest",
  },
  CHAIN_MISMATCH: { meaning: "The RPC is not on Arc Testnet (5042002).", raisedBy: "status, facility show, coverage show, credentials list, draw simulate" },
  DEPLOYMENT_MISMATCH: {
    meaning:
      "The chain disagrees with the manifest. A contract has no code; a read reverts or returns nothing; or the wiring differs, as with a vault bound to another facility or an operator the facility does not name.",
    raisedBy: "status, facility show, coverage show, credentials list, draw simulate",
  },
  RPC_UNAVAILABLE: {
    meaning: "The RPC could not be reached, or failed. Retrying may help.",
    raisedBy: "status, facility show, coverage show, credentials list, draw simulate",
  },
  INVALID_SIGNATURE: {
    meaning: "A credential envelope's digest does not match its credential, or its signature does not recover to the claimed issuer.",
    raisedBy: "credentials inspect",
  },
  SIMULATION_FAILED: {
    meaning:
      "The simulated draw reverted without revert data, or with data that no known contract error decodes. Unlike a decoded refusal, which is a completed inquiry, this is a failed one.",
    raisedBy: "draw simulate",
  },
  STALE_SEQUENCE: { meaning: "Reserved for P1 credential submission: the registry already holds this sequence or a later one.", raisedBy: "not raised in this release" },
  SIGNER_UNAVAILABLE: { meaning: "Reserved for P1 operations: no signer could be opened.", raisedBy: "not raised in this release" },
  SIGNER_ROLE_MISMATCH: { meaning: "Reserved for P1 operations: the signer is not the role the operation needs.", raisedBy: "not raised in this release" },
  ACTION_REFUSED: { meaning: "Reserved for P1 operations: a requested send refused during preflight. Nothing was broadcast.", raisedBy: "not raised in this release" },
  TRANSACTION_REVERTED: { meaning: "Reserved for P1 operations: the transaction was mined with receipt status 0x0.", raisedBy: "not raised in this release" },
  TRANSACTION_PENDING: { meaning: "Reserved for P1 operations: no receipt arrived before the timeout. The hash is kept.", raisedBy: "not raised in this release" },
};

export class SignaError extends Error {
  override readonly name = "SignaError";

  constructor(
    readonly code: SignaErrorCode,
    message: string,
    /** Whether the same request might succeed later, such as after an RPC outage. */
    readonly retryable = false,
    /**
     * Structured facts a consumer needs when the failure still leaves work behind, above all the
     * hash of a transaction that was broadcast but has no receipt yet. incur 0.5.1 fixes the error
     * document to `{ code, message, retryable }` plus a `cta`, so the CLI surfaces these through
     * the cta rather than inventing a field incur would drop.
     */
    readonly details?: Readonly<Record<string, string>> | undefined,
  ) {
    super(message);
  }
}
