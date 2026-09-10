import type { Address, Hex } from "viem";

import { normalizePublicKey, type IntentRequestDetails } from "./authorization.ts";

/**
 * A minimal Privy REST client for the quorum flow, hand-rolled on `fetch` so no dependency is added.
 * `@privy-io/node@0.34.0` has no method for `POST /v1/intents/{id}/authorize` anyway. Paths and
 * bodies follow that SDK's source and Privy's OpenAPI spec as generated into the Rust SDK.
 *
 * `scripts/smoke.ts` exercises every call here against the live API except `rejectIntent` and
 * `getWallet`.
 */

export type PrivyConfig = { appId: string; appSecret: string; apiUrl: string };

export type IntentStatus =
  | "pending"
  | "granted"
  | "processing"
  | "executed"
  | "failed"
  | "expired"
  | "rejected"
  | "dismissed";

export type IntentMember = {
  type: "key" | "user" | "key_quorum";
  signed_at?: number | null;
  public_key?: string;
  user_id?: string;
  key_quorum_id?: string;
  display_name?: string;
};

export type IntentAuthorizationDetail = {
  members: IntentMember[];
  threshold: number;
  display_name?: string;
};

export type RpcIntent = {
  intent_id: string;
  intent_type: string;
  status: IntentStatus;
  resource_id: string;
  created_at: number;
  expires_at: number;
  custom_expiry?: boolean;
  created_by_display_name?: string | null;
  authorization_details: IntentAuthorizationDetail[];
  request_details: IntentRequestDetails;
  action_result?: {
    status_code: number;
    executed_at: number;
    authorized_by_display_name?: string;
    authorized_by_id?: string;
    response_body?: unknown;
  };
  rejected_at?: number;
  dismissal_reason?: string;
};

export type SignTransactionRequest = {
  method: "eth_signTransaction";
  params: { transaction: Record<string, unknown> };
};

/**
 * As `GET /v1/key_quorums/{id}` returns it. Creation takes `public_keys`, but the response lists
 * members under `authorization_keys`: there is no `public_keys` field to read back.
 */
export type KeyQuorum = {
  id: string;
  display_name?: string | null;
  authorization_threshold?: number;
  authorization_keys?: { public_key: string; display_name: string | null }[];
  user_ids?: string[];
  key_quorum_ids?: string[];
};
export type PrivyWallet = { id: string; address: Address; owner_id?: string | null };

export class PrivyApiError extends Error {
  constructor(
    readonly status: number,
    readonly route: string,
    readonly responseBody: string,
  ) {
    super(`Privy ${route} returned ${status}: ${responseBody.slice(0, 500)}`);
  }
}

/** Reads credentials from the environment. They are never written anywhere by this package. */
export function loadPrivyConfig(env: NodeJS.ProcessEnv = process.env): PrivyConfig {
  const appId = env.PRIVY_APP_ID?.trim() ?? "";
  const appSecret = env.PRIVY_APP_SECRET?.trim() ?? "";
  const missing = [appId ? "" : "PRIVY_APP_ID", appSecret ? "" : "PRIVY_APP_SECRET"].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(" and ")}. Copy packages/privy-waiver/.env.example to .env and fill it in.`,
    );
  }
  const apiUrl = (env.PRIVY_API_URL?.trim() || "https://api.privy.io").replace(/\/+$/, "");
  return { appId, appSecret, apiUrl };
}

export class PrivyClient {
  constructor(
    private readonly config: PrivyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get appId(): string {
    return this.config.appId;
  }

  /** The URL a synchronous wallet RPC is sent to, and therefore the URL its signature covers. */
  walletRpcUrl(walletId: string): string {
    return `${this.config.apiUrl}/v1/wallets/${encodeURIComponent(walletId)}/rpc`;
  }

  /**
   * Proposes the transaction as an intent. No authorization signature goes with the proposal, and
   * no custom expiry: the intent keeps Privy's default 72 hours. Always `eth_signTransaction`,
   * never `eth_sendTransaction`: Privy cannot broadcast on Arc (see arc.ts).
   */
  proposeRpcIntent(walletId: string, body: SignTransactionRequest): Promise<RpcIntent> {
    return this.send("POST", `/v1/intents/wallets/${encodeURIComponent(walletId)}/rpc`, body);
  }

  getIntent(intentId: string): Promise<RpcIntent> {
    return this.send("GET", `/v1/intents/${encodeURIComponent(intentId)}`);
  }

  /**
   * The hand-rolled call: `@privy-io/node` has no method for it. One approver's signature per
   * request; Privy executes the intent once the quorum threshold is met. `timestamp` must be the
   * value signed inside the payload (see `intentAuthorizationInput`), in milliseconds.
   */
  authorizeIntent(intentId: string, input: { signature: string; timestamp: number }): Promise<RpcIntent> {
    return this.send("POST", `/v1/intents/${encodeURIComponent(intentId)}/authorize`, input);
  }

  rejectIntent(intentId: string): Promise<RpcIntent> {
    return this.send("POST", `/v1/intents/${encodeURIComponent(intentId)}/reject`);
  }

  createKeyQuorum(input: {
    public_keys: string[];
    authorization_threshold: number;
    display_name?: string;
  }): Promise<KeyQuorum> {
    return this.send("POST", "/v1/key_quorums", input);
  }

  createWallet(input: { chain_type: "ethereum"; owner_id: string; display_name?: string }): Promise<PrivyWallet> {
    return this.send("POST", "/v1/wallets", input);
  }

  getKeyQuorum(keyQuorumId: string): Promise<KeyQuorum> {
    return this.send("GET", `/v1/key_quorums/${encodeURIComponent(keyQuorumId)}`);
  }

  getWallet(walletId: string): Promise<PrivyWallet> {
    return this.send("GET", `/v1/wallets/${encodeURIComponent(walletId)}`);
  }

  /** Synchronous RPC with every signature in the header at once. Only the smoke test uses it. */
  walletRpc(walletId: string, body: SignTransactionRequest, signatures: string[]): Promise<unknown> {
    return this.send("POST", `/v1/wallets/${encodeURIComponent(walletId)}/rpc`, body, {
      "privy-authorization-signature": signatures.join(","),
    });
  }

  private async send<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const credentials = Buffer.from(`${this.config.appId}:${this.config.appSecret}`).toString("base64");
    const response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${credentials}`,
        "privy-app-id": this.config.appId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new PrivyApiError(response.status, `${method} ${path}`, text);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** The raw signed transaction an executed `eth_signTransaction` intent returns, if there is one. */
export function signedTransactionOf(intent: RpcIntent): Hex | undefined {
  const response = intent.action_result?.response_body as
    | { method?: string; data?: { signed_transaction?: string } }
    | undefined;
  const signed = response?.data?.signed_transaction;
  return typeof signed === "string" && signed.startsWith("0x") ? (signed as Hex) : undefined;
}

/**
 * Quorum members that are P-256 keys, with whether each has signed. Intents list member keys in
 * PEM; they come back here as bare base64 SPKI, the spelling approvers and key quorums use.
 */
export function keyMembers(intent: RpcIntent): { publicKey: string; signedAt: number | null }[] {
  return intent.authorization_details.flatMap((detail) =>
    detail.members
      .filter((member) => member.type === "key" && typeof member.public_key === "string")
      .map((member) => ({ publicKey: spki(member.public_key as string), signedAt: member.signed_at ?? null })),
  );
}

function spki(key: string): string {
  try {
    return normalizePublicKey(key);
  } catch {
    return key;
  }
}
