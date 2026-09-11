/**
 * Every failure a Signa command reports (ERD §6). Consumers branch on `code`, never on the
 * message. The full set is fixed now so it stays stable as commands are added; the first P0
 * commands raise only INVALID_INPUT, INVALID_MANIFEST, CHAIN_MISMATCH, DEPLOYMENT_MISMATCH and
 * RPC_UNAVAILABLE.
 */
export const SIGNA_ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_MANIFEST",
  "CHAIN_MISMATCH",
  "DEPLOYMENT_MISMATCH",
  "RPC_UNAVAILABLE",
  "INVALID_SIGNATURE",
  "STALE_SEQUENCE",
  "SIGNER_UNAVAILABLE",
  "SIGNER_ROLE_MISMATCH",
  "ACTION_REFUSED",
  "TRANSACTION_REVERTED",
  "TRANSACTION_PENDING",
] as const;

export type SignaErrorCode = (typeof SIGNA_ERROR_CODES)[number];

export class SignaError extends Error {
  override readonly name = "SignaError";

  constructor(
    readonly code: SignaErrorCode,
    message: string,
    /** Whether the same request might succeed later, such as after an RPC outage. */
    readonly retryable = false,
  ) {
    super(message);
  }
}
