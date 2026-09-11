/// <reference types="vite/client" />
import manifest from '../../../../deployments/arc-testnet.json';
import evidence from '../../../../scenarios/output/arc-facility-evidence.json';

// Public, checked-in records only. This entry creates no wallet or RPC client.
const repository = 'https://github.com/estmcmxci/signa-arc';
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const amount = (raw: string, places = 6) => {
  const n = BigInt(raw);
  return `${(n / 1_000_000n).toLocaleString('en-US')}.${(n % 1_000_000n).toString().padStart(6, '0').slice(0, places)} USDC`;
};
const percentage = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}%`;
const date = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
function fill(selector: string, value: string) {
  document.querySelectorAll(selector).forEach((node) => { node.textContent = value; });
}
function publicDocsUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return `${repository}#readme`;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : `${repository}#readme`;
  } catch { return `${repository}#readme`; }
}
document.querySelectorAll<HTMLAnchorElement>('[data-docs]').forEach((a) => { a.href = publicDocsUrl(import.meta.env['VITE_DOCS_URL']); });

const names: Record<keyof typeof manifest.contracts, string> = {
  facilityRegistry: 'Facility Registry', credentialRegistry: 'Credential Registry', coverageEngine: 'Coverage Engine', covenantVault: 'Covenant Vault',
};
document.querySelectorAll('[data-contract-links]').forEach((node) => {
  node.innerHTML = Object.entries(manifest.contracts).map(([name, record]) => `<a href="${escape(manifest.explorer)}/address/${record.address}#code"><span class="contract-name">${names[name as keyof typeof names]}</span><code>${record.address} <span aria-hidden="true">↗</span></code></a>`).join('');
});
fill('[data-deployment-date]', date(manifest.deployedAt));
fill('[data-evidence-date]', `${date(evidence.generatedAt)} · ${evidence.generatedAt.slice(11, 19)} UTC`);
document.querySelectorAll<HTMLTimeElement>('[data-deployment-date]').forEach((node) => { node.dateTime = manifest.deployedAt; });
document.querySelectorAll<HTMLTimeElement>('[data-evidence-date]').forEach((node) => { node.dateTime = evidence.generatedAt; });

const draws = evidence.steps.filter((step) => step.action === `draw ${evidence.draw.amount}`);
const proof = document.querySelector('#proof-rows');
if (proof) {
  proof.innerHTML = draws.map((step) => {
    const held = step.actualStatus === '0x0';
    return `<div class="proof-row"><span class="criterion">${escape(step.criterion)}</span><div>Draw <span class="amount-label">${amount(evidence.draw.amount, 2)}</span></div><div class="coverage">${percentage(step.coverageBps)}<span>counted cover</span></div><span class="verdict ${held ? 'held' : 'permitted'}"><span aria-hidden="true">${held ? '▣' : '●'}</span>${held ? 'Held · reverted' : 'Permitted'}</span><a href="${escape(step.explorer)}" aria-label="Inspect ${step.criterion} ${held ? 'reverted' : 'successful'} draw receipt, block ${step.blockNumber}"><span>${short(step.transactionHash)}</span><span aria-hidden="true">↗</span></a></div>`;
  }).join('');
}
const held = draws.find((step) => step.actualStatus === '0x0');
fill('[data-min-coverage]', percentage(manifest.facility.policy.minCoverageBps));
fill('[data-draw-amount]', amount(evidence.draw.amount));
if (held) {
  fill('[data-held-coverage]', percentage(held.coverageBps));
  if (held.vault) {
    fill('[data-held-balance]', `${amount(held.vault.balanceBefore)} → ${amount(held.vault.balanceAfter)}`);
    fill('[data-held-principal]', `${amount(held.vault.principalBefore)} → ${amount(held.vault.principalAfter)}`);
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const feedback = document.querySelector('#copy-feedback');
    if (!feedback) return;
    feedback.textContent = '';
    try {
      await navigator.clipboard.writeText(button.dataset['copy'] ?? '');
      feedback.setAttribute('role', 'status');
      feedback.textContent = 'Refusal reason copied.';
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = 'Copy reason'; }, 2000);
    } catch {
      feedback.setAttribute('role', 'alert');
      feedback.textContent = 'Copy did not complete. Select the visible reason to copy it manually.';
    }
  });
});
const form = document.querySelector<HTMLFormElement>('#contact-form');
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const fields = [['name', 'Name'], ['email', 'Work email'], ['firm', 'Firm'], ['role', 'Role'], ['size', 'Facility size'], ['currencies', 'Currencies']] as const;
  const body = ['I would like to discuss an FX coverage covenant.', '', ...fields.map(([key, label]) => `${label}: ${String(values.get(key) ?? '').trim() || 'Not specified'}`)].join('\n');
  const href = `mailto:m@oakgroup.co?subject=${encodeURIComponent('Signa Covenant — drawdown process')}&body=${encodeURIComponent(body)}`;
  // The browser requests the user's mail app. No email is sent by this page.
  window.location.href = href;
  fill('#contact-feedback', 'Email draft requested. If your mail app did not open, contact m@oakgroup.co directly. Nothing has been sent by this page.');
});
