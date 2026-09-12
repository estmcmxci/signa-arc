// Client for the Privy quorum approver service (packages/privy-waiver). The browser
// never holds the Privy app secret and never talks to Privy directly: every request
// goes to this same-origin path, which the Vite proxy forwards to 127.0.0.1:8787.
// Nothing here reimplements packages/privy-waiver/src/service.ts — it only calls it.

const BASE = '/api';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new Error('The approver service is not reachable at 127.0.0.1:8787. Start it, or continue reading and simulating without it.');
  }
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || `${response.status} ${response.statusText}`);
  return body as T;
}

export type ApproverPublicInfo = { role: string; publicKey: string };
export type ReadinessCoverage = {
  coverageBps: number;
  requiredCoverageBps: number;
  resultReason: string;
  exposureReason: string;
  eligibleHedgeCount: number;
  totalHedgeCount: number;
};
export type ReadinessInfo = {
  error?: string;
  covenantState?: string;
  activeWaiver?: boolean;
  waiverEndsAt?: string;
  coverage?: ReadinessCoverage;
  refusals: string[];
  maxWaiverDurationSeconds: number;
};
export type PolicyCondition = { field: string; operator: string; value: string };
export type PolicyRule = { action: string; method: string; conditions: PolicyCondition[] };
export type PolicyInfo = { id: string; name: string; owner_id?: string; rules: PolicyRule[] };
export type ServiceInfo = {
  walletId?: string;
  chainId?: number;
  walletAddress?: string;
  walletOwnerId?: string;
  threshold?: number;
  approvers?: ApproverPublicInfo[];
  facility?: { vault?: string };
  explorer?: string;
  readiness?: ReadinessInfo;
  policies?: PolicyInfo[] | { error: string };
};

export type ApprovalMember = { publicKey: string; signedAt?: number };
export type WaiverCreatedInfo = {
  facilityId: string;
  reasonCommitment: string;
  facilityMatches: boolean;
  reasonCommitmentMatches: boolean;
  startsAt: string;
  endsAt: string;
};
export type BroadcastInfo = { hash: string; blockNumber: string; status: string; signer?: string; waiverCreated?: WaiverCreatedInfo };
export type CallInfo = {
  to: string;
  data: string;
  chainId: number;
  nonce: number;
  gasLimit: string;
  maxFeePerGasWei: string;
  value?: string;
  functionName: string;
  args: string[];
};
export type ActionContext = { covenantState: string; coverageBps: number; requiredCoverageBps: number; resultReason: string; checkedAt: string };
export type ServiceAction = {
  intentId: string;
  kind: string;
  status: string;
  createdAt: number;
  reason?: string;
  call: CallInfo;
  approvals: { threshold: number; members: ApprovalMember[] };
  context?: ActionContext;
  signingPayload?: string;
  broadcast?: BroadcastInfo;
};

export const fetchInfo = (): Promise<ServiceInfo> => api<ServiceInfo>('/info');
export const fetchActions = (): Promise<ServiceAction[]> => api<ServiceAction[]>('/actions');
export const proposeWaiver = (durationSeconds: number, reason: string): Promise<void> =>
  api<void>('/waivers', { method: 'POST', body: JSON.stringify({ durationSeconds, reason }) });
export const fetchSigningPayload = (intentId: string): Promise<{ text: string; timestamp: number }> =>
  api(`/actions/${encodeURIComponent(intentId)}/signing-payload`);
export const approveAction = (
  intentId: string,
  body: { publicKey: string; signature: string; encoding: 'p1363'; timestamp: number },
): Promise<void> => api<void>(`/actions/${encodeURIComponent(intentId)}/approve`, { method: 'POST', body: JSON.stringify(body) });
export const rejectAction = (intentId: string): Promise<void> => api<void>(`/actions/${encodeURIComponent(intentId)}/reject`, { method: 'POST' });
export const broadcastAction = (intentId: string): Promise<void> => api<void>(`/actions/${encodeURIComponent(intentId)}/execute`, { method: 'POST' });

// ---- What each approver signs, checked before signing. Ported field-for-field from
// packages/privy-waiver/ui/approver.html's inspect(), the reference implementation —
// this must read the transaction out of the exact bytes being signed, so what this
// desk shows is what gets signed. Never sign a payload that fails any check.

const CREATE_WAIVER_SELECTOR = '0x6738bca7';
export type InspectionCheck = readonly [label: string, ok: boolean];
export type Inspection = { checks: InspectionCheck[]; decoded: string; ok: boolean };

export function inspectPayload(action: Pick<ServiceAction, 'intentId' | 'call'>, signingPayloadText: string): Inspection {
  const checks: InspectionCheck[] = [];
  let decoded = '';
  try {
    const payload = JSON.parse(signingPayloadText) as {
      intent_id?: string;
      body?: { method?: string; params?: { transaction?: Record<string, unknown> } };
    };
    const tx = payload.body?.params?.transaction ?? {};
    const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
    checks.push(['signs a transaction (eth_signTransaction)', payload.body?.method === 'eth_signTransaction']);
    checks.push(['bound to this proposal', payload.intent_id === action.intentId]);
    checks.push(['target contract matches', same(tx['to'], action.call.to)]);
    checks.push(['calldata matches', same(tx['data'], action.call.data)]);
    checks.push(['chain is Arc Testnet', BigInt(tx['chain_id'] as string) === BigInt(action.call.chainId)]);
    checks.push(['nonce matches', BigInt(tx['nonce'] as string) === BigInt(action.call.nonce)]);
    checks.push(['moves no value', BigInt((tx['value'] as string | undefined) ?? 0) === 0n]);
    const data = String(tx['data'] ?? '');
    if (data.startsWith(CREATE_WAIVER_SELECTOR) && data.length === 138) {
      decoded = `createWaiver: ${parseInt(data.slice(10, 74), 16)} seconds, reason commitment 0x${data.slice(74)}`;
    }
  } catch (error) {
    checks.push([`payload is readable (${(error as Error).message})`, false]);
  }
  return { checks, decoded, ok: checks.every(([, ok]) => ok) };
}

/** proposed → each role approved → Privy signed → broadcast → receipt 0x1 → WaiverCreated checked. */
export function actionSteps(action: ServiceAction, roles: readonly string[], roleOf: (publicKey: string) => string): { label: string; done: boolean; at?: number | undefined }[] {
  const signedAt = (role: string) => action.approvals.members.find((m) => roleOf(m.publicKey) === role)?.signedAt;
  const waiver = action.broadcast?.waiverCreated;
  return [
    { label: 'Proposed', done: true, at: action.createdAt },
    ...roles.map((role) => ({ label: `${role} approved`, done: Boolean(signedAt(role)), at: signedAt(role) })),
    { label: 'Privy signed', done: action.status === 'executed' || Boolean(action.broadcast) },
    { label: 'Broadcast to Arc', done: Boolean(action.broadcast) },
    { label: 'Receipt 0x1', done: action.broadcast?.status === 'success' },
    ...(action.kind === 'waiver.create' ? [{ label: 'WaiverCreated checked', done: Boolean(waiver?.facilityMatches && waiver?.reasonCommitmentMatches) }] : []),
  ];
}

/**
 * Privy calls a fully-approved, signed intent "executed" — its term for signed, not broadcast.
 * A signed transaction can sit unbroadcast indefinitely (it has, for 40 minutes, across a killed
 * process), so this must never read as done until this service's own receipt says so.
 */
export function actionStatus(action: ServiceAction): { tone: 'ok' | 'hold' | 'breach' | 'error'; label: string } {
  if (action.status === 'executed' && action.broadcast) {
    return action.broadcast.status === 'success' ? { tone: 'ok', label: 'BROADCAST' } : { tone: 'breach', label: 'BROADCAST · REVERTED' };
  }
  if (action.status === 'executed') return { tone: 'hold', label: 'SIGNED · NOT BROADCAST' };
  if (action.status === 'pending') return { tone: 'hold', label: 'PENDING APPROVAL' };
  if (action.status === 'granted' || action.status === 'processing') return { tone: 'hold', label: 'PRIVY PROCESSING' };
  if (action.status === 'failed') return { tone: 'error', label: 'FAILED' };
  return { tone: 'hold', label: action.status.toUpperCase() };
}
