import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { PrivyApiError } from "./privy-client.ts";
import { ServiceError, type Approval, type QuorumAdminService } from "./service.ts";

/**
 * The approver UI's backend. It holds the Privy app secret and no approver key: approvers sign in
 * their own browsers and send only signatures. It binds to localhost and has no login of its own,
 * so it is a demo server, not a deployment.
 */

const UI_PATH = new URL("../ui/approver.html", import.meta.url);
const MAX_BODY_BYTES = 64 * 1024;

export type InfoProvider = () => Promise<Record<string, unknown>>;

/**
 * Without a service there is no Privy wallet yet: the page still loads so approvers can create
 * their keys in this origin's storage, and every other route answers 409.
 */
export function createApproverServer(service: QuorumAdminService | undefined, info: InfoProvider): Server {
  return createServer((request, response) => {
    route(service, info, request, response).catch((error: unknown) => sendError(response, error));
  });
}

async function route(
  service: QuorumAdminService | undefined,
  info: InfoProvider,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  const [api, resource, id, action] = pathname.split("/").filter(Boolean);

  if (method === "GET" && pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(readFileSync(UI_PATH, "utf8"));
    return;
  }
  if (api !== "api") return sendJson(response, 404, { error: "not found" });

  if (method === "GET" && resource === "info" && !id) return sendJson(response, 200, await info());
  if (!service) {
    return sendJson(response, 409, {
      error: "no Privy wallet is configured yet: create the quorum first (WIRE-UP.md, step 4)",
    });
  }
  if (method === "GET" && resource === "actions" && !id) return sendJson(response, 200, await service.list());
  if (method === "POST" && resource === "waivers" && !id) {
    const body = await readJson(request);
    return sendJson(
      response,
      201,
      await service.proposeWaiver({ durationSeconds: Number(body.durationSeconds), reason: String(body.reason ?? "") }),
    );
  }
  if (method === "POST" && resource === "waivers" && id === "revoke") {
    return sendJson(response, 201, await service.proposeWaiverRevocation());
  }
  if (method === "POST" && resource === "setup" && id === "next") {
    return sendJson(response, 201, await service.proposeNextSetupStep());
  }
  if (resource === "actions" && id) {
    const intentId = decodeURIComponent(id);
    if (method === "GET" && !action) return sendJson(response, 200, await service.get(intentId));
    if (method === "POST" && action === "approve") {
      return sendJson(response, 200, await service.approve(intentId, parseApproval(await readJson(request))));
    }
    if (method === "POST" && action === "reject") return sendJson(response, 200, await service.reject(intentId));
    if (method === "POST" && action === "execute") return sendJson(response, 200, await service.execute(intentId));
  }
  sendJson(response, 404, { error: "not found" });
}

function parseApproval(body: Record<string, unknown>): Approval {
  const { publicKey, signature, encoding, timestamp } = body;
  if (typeof publicKey !== "string" || typeof signature !== "string" || typeof timestamp !== "number") {
    throw new ServiceError("an approval needs publicKey, signature and timestamp");
  }
  if (encoding !== "der" && encoding !== "p1363") throw new ServiceError('encoding must be "der" or "p1363"');
  return { publicKey, signature, encoding, timestamp };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ServiceError("request body too large", 413);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ServiceError("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value)));
}

function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof ServiceError) return sendJson(response, error.status, { error: error.message });
  if (error instanceof PrivyApiError) {
    return sendJson(response, 502, { error: error.message, privyStatus: error.status, privyBody: error.responseBody });
  }
  if (error instanceof SyntaxError) return sendJson(response, 400, { error: `malformed JSON: ${error.message}` });
  sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
}
