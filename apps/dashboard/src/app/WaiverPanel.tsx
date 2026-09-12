import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Copy, Panel } from '../components/ui';
import { manifest, explorer } from '../data/client';
import { percent, short, utc } from '../data/format';
import { waiverProof } from '../data/ledger';
import {
  actionStatus,
  actionSteps,
  approveAction,
  broadcastAction,
  fetchActions,
  fetchInfo,
  fetchSigningPayload,
  inspectPayload,
  proposeWaiver,
  rejectAction,
  type ServiceAction,
} from '../data/approver';
import { forgetApproverKey, importApproverKey, loadApproverKey, signWithApproverKey, type ApproverKey } from '../data/approverKeys';

const DEFAULT_ROLES = ['Risk officer', 'Treasury lead'];
const REHEARSAL_SECONDS = 300; // The recorded default: long enough to demo, short enough that a live take does not burn the facility for its own maxWaiverDuration.

function describeCondition(condition: { field: string; operator: string; value: string }, vault: string | undefined): string {
  if (condition.field === 'to' && vault && condition.value.toLowerCase() === vault.toLowerCase()) return `to = ${short(condition.value)} (this facility's vault)`;
  if (condition.field === 'chain_id') return `chain = ${condition.value} (Arc Testnet)`;
  if (condition.field === 'function_name') return `function = ${condition.value}`;
  return `${condition.field} ${condition.operator === 'eq' ? '=' : condition.operator} ${condition.value}`;
}

export function WaiverPanel() {
  const queryClient = useQueryClient();
  const infoQuery = useQuery({ queryKey: ['approver', 'info'], queryFn: fetchInfo, refetchInterval: 4000, retry: false });
  const info = infoQuery.data;
  const serviceDown = infoQuery.isError;

  const quorum = manifest?.facilityAdminQuorum;
  const roles = quorum?.approvers.length ? quorum.approvers.map((a) => a.role) : DEFAULT_ROLES;
  const expectedKeyFor = (role: string) => quorum?.approvers.find((a) => a.role === role)?.publicKey;
  const roleOf = (publicKey: string): string =>
    quorum?.approvers.find((a) => a.publicKey === publicKey)?.role ?? info?.approvers?.find((a) => a.publicKey === publicKey)?.role ?? `key ${short(publicKey)}`;

  const actionsQuery = useQuery({
    queryKey: ['approver', 'actions'],
    queryFn: fetchActions,
    refetchInterval: 4000,
    enabled: Boolean(info?.walletId),
  });
  const waivers = (actionsQuery.data ?? []).filter((a) => a.kind.startsWith('waiver.'));

  const [keys, setKeys] = useState<Partial<Record<string, ApproverKey>>>({});
  const [pasted, setPasted] = useState<Partial<Record<string, string>>>({});
  const rolesKey = roles.join('|');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Partial<Record<string, ApproverKey>> = {};
      for (const role of roles) {
        const stored = await loadApproverKey(role).catch(() => undefined);
        if (stored) next[role] = stored;
      }
      if (!cancelled) setKeys(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesKey]);

  const [reason, setReason] = useState('');
  const [seconds, setSeconds] = useState(REHEARSAL_SECONDS);
  const [proposing, setProposing] = useState(false);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  async function doImport(role: string) {
    const value = pasted[role];
    if (!value) {
      setNotice(`Paste the ${role} private key (base64 PKCS8) before importing.`);
      return;
    }
    try {
      const key = await importApproverKey(role, value);
      setKeys((prior) => ({ ...prior, [role]: key }));
      setPasted((prior) => ({ ...prior, [role]: '' }));
      setNotice('');
    } catch (error) {
      setNotice(`Could not import the ${role} key: ${(error as Error).message}`);
    }
  }

  async function doForget(role: string) {
    await forgetApproverKey(role);
    setKeys((prior) => {
      const next = { ...prior };
      delete next[role];
      return next;
    });
  }

  async function propose(event: FormEvent) {
    event.preventDefault();
    setNotice('');
    if (!info?.walletId) {
      setNotice('The approver service is not reachable. Start it before proposing a waiver.');
      return;
    }
    setProposing(true);
    const id = toast.loading('Proposing a waiver…');
    try {
      await proposeWaiver(seconds, reason);
      toast.success('Waiver proposed', { id });
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['approver', 'actions'] });
    } catch (error) {
      toast.error('The service refused to propose this', { id, description: (error as Error).message });
      setNotice((error as Error).message);
    } finally {
      setProposing(false);
    }
  }

  async function approve(action: ServiceAction, role: string) {
    setNotice('');
    const key = keys[role];
    if (!key) {
      setNotice(`Import the ${role} key in this browser before approving as ${role}.`);
      return;
    }
    const id = toast.loading(`Signing as ${role}…`);
    try {
      const payload = await fetchSigningPayload(action.intentId);
      const inspection = inspectPayload(action, payload.text);
      if (!inspection.ok) throw new Error('The payload to sign does not match the proposed call. Not signing.');
      const signature = await signWithApproverKey(key, payload.text);
      await approveAction(action.intentId, { publicKey: key.publicKey, signature, encoding: 'p1363', timestamp: payload.timestamp });
      toast.success(`${role} approved`, { id });
      await queryClient.invalidateQueries({ queryKey: ['approver', 'actions'] });
    } catch (error) {
      toast.error('Not signed', { id, description: (error as Error).message });
    }
  }

  async function reject(action: ServiceAction) {
    const id = toast.loading('Rejecting the proposal…');
    try {
      await rejectAction(action.intentId);
      toast.success('Proposal rejected', { id });
      await queryClient.invalidateQueries({ queryKey: ['approver', 'actions'] });
    } catch (error) {
      toast.error('Could not reject', { id, description: (error as Error).message });
    }
  }

  async function broadcast(action: ServiceAction) {
    const id = toast.loading('Verifying the signed transaction and broadcasting to Arc…');
    try {
      await broadcastAction(action.intentId);
      toast.success('Broadcast to Arc', { id });
      await queryClient.invalidateQueries({ queryKey: ['approver', 'actions'] });
      await queryClient.invalidateQueries({ queryKey: ['facility'] });
    } catch (error) {
      toast.error('Broadcast did not complete', { id, description: (error as Error).message });
    }
  }

  const readiness = info?.readiness;
  const policies = Array.isArray(info?.policies) ? info.policies : undefined;
  const adminAddress = manifest?.roles.facilityAdmin;

  return (
    <Panel
      title="Governed exceptions"
      kicker="A waiver does not restore coverage"
      id="waiver"
      aside={<Badge state={readiness?.activeWaiver ? 'WAIVED' : 'UNASSESSED'}>{readiness?.activeWaiver ? 'WAIVER ACTIVE' : 'NO ACTIVE WAIVER'}</Badge>}
    >
      <p className="caption">
        This is the lender's view: the facility administrator is a Privy 2-of-2 quorum. Neither approver can create a waiver alone, and a waiver
        permits an exception — it does not make the evidence compliant.
      </p>

      {serviceDown && (
        <div className="notice error" role="status">
          The approver service is not reachable at <span className="mono">127.0.0.1:8787</span>. Start it with{' '}
          <span className="mono">PRIVY_WALLET_ID=… node --import tsx packages/privy-waiver/src/main.ts</span> to propose or approve a waiver. The
          rest of this desk keeps reading the live facility.
        </div>
      )}

      <div className="waiver-grid">
        <div>
          <h3>1 · Who the admin is</h3>
          <p>
            {adminAddress ? <Copy value={adminAddress} label="facility admin" /> : 'Facility admin unavailable'} is a Privy server wallet owned by a{' '}
            {quorum?.threshold ?? 2}-of-{roles.length} key quorum. Its key may ever sign <span className="mono">createWaiver</span>, on this
            facility's vault, on Arc Testnet, moving no value. Privy denies everything else, including <span className="mono">revokeWaiver</span>{' '}
            and any other contract or chain. A Privy calldata policy cannot compare a <span className="mono">uint32</span>, so it cannot cap the
            duration — the contract's own <span className="mono">maxWaiverDuration</span> does that instead.
          </p>
          {policies && policies.length > 0 && (
            <ul className="conditions">
              {policies.flatMap((policy) =>
                policy.rules.map((rule, i) => (
                  <li key={`${policy.id}:${i}`}>
                    {rule.action} <span className="mono">{rule.method}</span> only when {rule.conditions.map((c) => describeCondition(c, info?.facility?.vault)).join(' and ')}
                  </li>
                )),
              )}
            </ul>
          )}
          {info?.walletId && (!policies || policies.length === 0) && (
            <p className="caption">No Privy policy is attached: the admin key could sign any call both approvers approve.</p>
          )}
        </div>
        <div>
          <p className="caption">Recorded quorum approval · {waiverProof.at.slice(0, 10)}</p>
          <a href={`${explorer}/tx/${waiverProof.hash}`}>Inspect the approved waiver ↗</a>
          <p className="caption">Kept here as historical evidence; it is a separate run from anything proposed below.</p>
        </div>
      </div>

      <h3>2 · Approver keys in this browser</h3>
      <p className="caption">
        Each approver signs with their own P-256 key; it never leaves this browser and the service never sees it. These are plain WebCrypto keys,
        stored non-extractable — <strong>not passkeys</strong>. For this demo both keys sit in one browser; label that on screen and say it once out
        loud.
      </p>
      <div className="approver-cards">
        {roles.map((role) => {
          const key = keys[role];
          const expected = expectedKeyFor(role);
          return (
            <div className="approver-card" key={role}>
              <div className="row">
                <strong>{role}</strong>
                {key && expected && (
                  <Badge state={key.publicKey === expected ? 'ok' : 'error'}>{key.publicKey === expected ? 'MATCHES QUORUM MEMBER' : 'NOT THIS ROLE’S KEY'}</Badge>
                )}
              </div>
              {key ? (
                <>
                  <p className="caption mono">{short(key.publicKey)}</p>
                  <button aria-disabled={false} onClick={() => void doForget(role)}>
                    Forget this key
                  </button>
                </>
              ) : (
                <div className="row">
                  <label className="sr-only" htmlFor={`key-${role}`}>
                    {role} private key, base64 PKCS8
                  </label>
                  <input
                    id={`key-${role}`}
                    type="password"
                    autoComplete="off"
                    placeholder="base64 PKCS8 private key"
                    value={pasted[role] ?? ''}
                    onChange={(e) => setPasted((prior) => ({ ...prior, [role]: e.target.value }))}
                  />
                  <button onClick={() => void doImport(role)}>Import</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <h3>3 · Why a waiver</h3>
      {!info?.walletId ? (
        <p className="caption">{serviceDown ? 'Readiness needs the approver service.' : 'Reading…'}</p>
      ) : readiness?.error ? (
        <p className="caption">Could not read the chain: {readiness.error}</p>
      ) : readiness ? (
        <>
          <p>
            <Badge state={readiness.covenantState ?? 'UNKNOWN'} />
            {readiness.activeWaiver && readiness.waiverEndsAt && <span> · waiver active until {utc(BigInt(readiness.waiverEndsAt))}</span>}
          </p>
          {readiness.coverage && (
            <p className="caption">
              Coverage <strong>{percent(readiness.coverage.coverageBps)}</strong> of {percent(readiness.coverage.requiredCoverageBps)} required (
              {readiness.coverage.resultReason}; {readiness.coverage.eligibleHedgeCount} of {readiness.coverage.totalHedgeCount} hedges eligible;
              exposure {readiness.coverage.exposureReason})
            </p>
          )}
          {readiness.refusals.length ? (
            <div className="notice" role="status">
              The contract would refuse a waiver right now:
              <ul className="conditions">
                {readiness.refusals.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="caption">The contract would accept a waiver now. Coverage is below the threshold, so without one draws are held.</p>
          )}
          <p className="caption">Longest waiver: {(readiness.maxWaiverDurationSeconds / 3600).toFixed(0)} hours (maxWaiverDuration, enforced by the contract).</p>
        </>
      ) : (
        <p className="caption">No facility: the manifest's facility admin is not this wallet.</p>
      )}

      <h3>4 · Propose</h3>
      <form onSubmit={(e) => void propose(e)}>
        <label htmlFor="waiver-reason">Reason</label>
        <textarea
          id="waiver-reason"
          rows={2}
          placeholder="Only its keccak256 hash goes on chain, as the waiver's reason commitment. The text itself stays off it."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <label htmlFor="waiver-seconds">Duration (seconds)</label>
          <input id="waiver-seconds" type="number" min={1} step={1} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} style={{ width: 100 }} />
          <button className="primary" type="submit" aria-disabled={!info?.walletId || proposing || Boolean(readiness?.activeWaiver)}>
            {proposing ? 'Proposing…' : 'Propose'}
          </button>
        </div>
        <p className="caption">
          Rehearse with short durations — a waiver cannot be revoked, and while active, sync and restore leave the vault WAIVED until it lapses.
        </p>
      </form>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <h3>5 · Progress</h3>
      {!waivers.length ? (
        <p className="empty">No waiver proposed yet in this service.</p>
      ) : (
        waivers.map((action) => {
          const steps = actionSteps(action, roles, roleOf);
          const waiver = action.broadcast?.waiverCreated;
          const isOpen = open.has(action.intentId);
          const status = actionStatus(action);
          return (
            <article className="waiver-action" key={action.intentId}>
              <div className="row">
                <Badge state={status.tone}>{status.label}</Badge>
                <span className="caption">
                  {action.approvals.members.filter((m) => m.signedAt).length} of {action.approvals.threshold} approvals · intent{' '}
                  <span className="mono">{short(action.intentId)}</span>
                </span>
              </div>
              <ol className="steps">
                {steps.map((s) => (
                  <li key={s.label} className={s.done ? 'done' : ''}>
                    {s.done ? '✓' : '…'} {s.label}
                  </li>
                ))}
              </ol>
              {action.reason && (
                <p className="caption">
                  Stated reason: {action.reason} <span className="caption">(offchain; its hash is the reason commitment)</span>
                </p>
              )}
              {waiver && (
                <dl className="facts">
                  <div>
                    <dt>WaiverCreated · facility</dt>
                    <dd>{waiver.facilityMatches ? <Badge state="ok">= this facility</Badge> : <Badge state="error">NOT this facility</Badge>}</dd>
                  </div>
                  <div>
                    <dt>WaiverCreated · reason</dt>
                    <dd>{waiver.reasonCommitmentMatches ? <Badge state="ok">= stated reason</Badge> : <Badge state="error">does not match</Badge>}</dd>
                  </div>
                </dl>
              )}
              {action.broadcast && (
                <p>
                  <a href={`${explorer}/tx/${action.broadcast.hash}`}>Inspect on Arcscan ↗</a>{' '}
                  <span className="caption">receipt {action.broadcast.status === 'success' ? '0x1' : action.broadcast.status}</span>
                </p>
              )}
              <div className="action-row">
                {action.status === 'pending' &&
                  roles.map((role) => {
                    const member = action.approvals.members.find((m) => roleOf(m.publicKey) === role);
                    if (!member || member.signedAt) return null;
                    return (
                      <button key={role} className="primary" aria-disabled={!keys[role]} onClick={() => void approve(action, role)}>
                        Approve as {role}
                      </button>
                    );
                  })}
                {action.status === 'pending' && <button onClick={() => void reject(action)}>Reject</button>}
                {action.status === 'executed' && !action.broadcast && (
                  <button className="primary" onClick={() => void broadcast(action)}>
                    Verify and broadcast to Arc
                  </button>
                )}
              </div>
              <details
                open={isOpen}
                onToggle={(e) =>
                  setOpen((prior) => {
                    const next = new Set(prior);
                    if ((e.target as HTMLDetailsElement).open) next.add(action.intentId);
                    else next.delete(action.intentId);
                    return next;
                  })
                }
              >
                <summary>6 · What each approver signs</summary>
                <ApproverSigningDetail action={action} />
              </details>
            </article>
          );
        })
      )}
    </Panel>
  );
}

function ApproverSigningDetail({ action }: { action: ServiceAction }) {
  const payloadQuery = useQuery({
    queryKey: ['approver', 'signing-payload', action.intentId],
    queryFn: () => fetchSigningPayload(action.intentId),
    enabled: action.status === 'pending',
    staleTime: 0,
  });
  if (action.status !== 'pending') return <p className="caption">This proposal is no longer pending, so a fresh payload is not offered.</p>;
  if (payloadQuery.isLoading) return <p className="caption">Fetching a fresh payload…</p>;
  if (payloadQuery.isError) return <p className="caption">Could not fetch a signing payload: {(payloadQuery.error as Error).message}</p>;
  const text = payloadQuery.data?.text;
  if (!text) return null;
  const inspection = inspectPayload(action, text);
  return (
    <>
      <p>{inspection.ok ? <Badge state="ok">matches the call above</Badge> : <Badge state="error">does NOT match the call above</Badge>}</p>
      <ul className="conditions">
        {inspection.checks.map(([label, ok]) => (
          <li key={label} className={ok ? 'ok' : 'bad'}>
            {ok ? 'yes' : 'NO'}: {label}
          </li>
        ))}
      </ul>
      {inspection.decoded && <p className="mono">{inspection.decoded}</p>}
      <pre>{text}</pre>
      <p className="caption">Never sign a payload that does not match the proposed call. This is fetched fresh, not the payload a prior approval used.</p>
    </>
  );
}
