/// <reference types="vite/client" />
import { arcTestnet } from 'viem/chains';
import { answer, chainAddresses, fixtureAddresses, FixtureChain, SLOW_RPC_MS, type ManifestAddresses } from './chain';
import { assertFixtureContext, FIXTURE_STATES } from './fixtures';

// Installs the /test-ui/ entry's fixture chain before the desk evaluates: test-ui/index.html
// loads ./entry.ts ahead of main.tsx, and no build input includes it. ?chain=<state> runs the
// desk's live read/simulate paths against it; ?state=<state> keeps the snapshot fixtures. In
// both, localStorage is the tab's sessionStorage (nothing reaches the live desk's
// preferences), and fetch and WebSocket cannot leave the page's origin except to the fixture
// node. The desk itself has no wallet connector, so this harness carries no wallet fixture —
// see test/chain.test.ts and test/support/fixtureWallet.ts for that, which test chain.ts's
// fidelity directly and are never bundled. If any of this cannot be set up, the harness
// removes #app and the desk does not render.

export type RequestRoute = 'page' | 'rpc' | 'blocked';

/** Where a page request may go: its own origin, the fixture node, or nowhere. */
export function routeRequest(url: string, pageOrigin: string, rpcUrls: readonly string[]): RequestRoute {
  const target = new URL(url, pageOrigin);
  if (target.origin === pageOrigin) return 'page';
  const bare = (value: string) => value.replace(/\/+$/, '');
  return rpcUrls.some((rpc) => bare(new URL(rpc).href) === bare(target.href)) ? 'rpc' : 'blocked';
}

export function installHarness(manifest: (ManifestAddresses & { rpcUrl: string }) | null): void {
  assertFixtureContext(import.meta.env.DEV, location.pathname);
  const params = new URLSearchParams(location.search);
  const state = params.get('chain');
  try {
    if (state !== null && !(FIXTURE_STATES as readonly string[]).includes(state)) {
      throw new Error(`Unknown chain fixture state "${state}". Use one of ${FIXTURE_STATES.join(', ')}.`);
    }
    if (state !== null && !manifest) {
      throw new Error('The chain fixture answers for the deployment manifest’s addresses, and no deployed manifest is configured.');
    }
    isolateStorage();
    const chain = new FixtureChain(state ?? 'compliant', manifest ? chainAddresses(manifest) : fixtureAddresses());
    guardNetwork(chain, [...arcTestnet.rpcUrls.default.http, ...(manifest ? [manifest.rpcUrl] : [])]);
    document.documentElement.dataset.fixture = state === null ? 'snapshot' : 'chain';
    renderControls(chain, state);
  } catch (error) {
    failClosed(error);
  }
}

function isolateStorage(): void {
  const tab = window.sessionStorage;
  Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => tab });
  if (window.localStorage !== tab) throw new Error('Browser storage could not be separated from the live desk’s.');
}

function guardNetwork(chain: FixtureChain, rpcUrls: readonly string[]): void {
  const pageFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const route = routeRequest(url, location.origin, rpcUrls);
    if (route === 'page') return pageFetch(input, init);
    if (route === 'blocked') throw new TypeError(`UI fixture: blocked a request to ${new URL(url).origin}. This entry contacts no network service.`);
    if (chain.transport === 'fail') throw new TypeError('UI fixture: the RPC was made to fail. No endpoint was contacted.');
    if (chain.transport === 'slow') await new Promise((resolve) => setTimeout(resolve, SLOW_RPC_MS));
    const body = input instanceof Request ? await input.text() : String(init?.body ?? '');
    return new Response(await answer(chain, body), { headers: { 'Content-Type': 'application/json' } });
  };
  const PageSocket = window.WebSocket;
  window.WebSocket = class extends PageSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const target = new URL(url, location.href);
      if (target.hostname !== location.hostname) throw new DOMException(`UI fixture: blocked a WebSocket to ${target.origin}.`, 'SecurityError');
      super(url, protocols);
    }
  };
}

function failClosed(error: unknown): never {
  document.getElementById('app')?.remove();
  const notice = document.createElement('div');
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'margin:32px;padding:16px;border:2px solid #ff8389;font:14px/1.5 system-ui';
  notice.textContent = `The UI fixture harness did not start, so the desk is not shown. ${error instanceof Error ? error.message : String(error)}`;
  document.body.prepend(notice);
  throw error;
}

const CONTROLS_CSS = `
.fixture-controls{margin:16px 32px 0;border:1px dashed var(--hold);border-radius:var(--radius-md);padding:10px 14px;background:var(--surface);color:var(--text);font:12px/1.5 var(--font-sans)}
.fixture-controls summary{color:var(--hold);font-weight:600;letter-spacing:.02em;cursor:pointer}
.fixture-controls h2{font-size:12px;margin:0 0 6px;color:var(--hold)}
.fixture-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:10px}
.fixture-grid p{margin:0;overflow-wrap:anywhere}
.fixture-buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.fixture-controls button,.fixture-controls select{min-height:32px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:var(--raised);color:var(--text);padding:4px 10px;font:inherit}
.fixture-note{color:var(--muted);margin:6px 0 0}
.fixture-log{margin:10px 0 0;padding-left:18px;color:var(--muted);max-height:8em;overflow:auto}
@media(max-width:680px){.fixture-controls{margin:12px 16px 0}}`;

function renderControls(chain: FixtureChain, state: string | null): void {
  const chainMode = state !== null;
  const style = document.createElement('style');
  style.textContent = CONTROLS_CSS;
  document.head.append(style);
  const panel = document.createElement('aside');
  panel.className = 'fixture-controls';
  panel.setAttribute('aria-label', 'UI fixture controls');
  const scenario = chainMode
    ? `<label>Chain state <select data-control="state">${FIXTURE_STATES.map((s) => `<option${s === state ? ' selected' : ''}>${s}</option>`).join('')}</select></label><p class="fixture-note"><a href="?state=${state}">Show this state as a snapshot fixture</a></p>`
    : '<p class="fixture-note">Use the desk’s Test state control.</p><p class="fixture-note"><a href="?chain=compliant">Run the desk on the simulated chain</a></p>';
  panel.innerHTML = `<details open><summary>UI fixture controls · ${chainMode ? `simulated chain (${state})` : 'snapshot fixture'}</summary>
<p class="fixture-note">${chainMode ? 'The desk below reads this page’s simulated chain. No key exists and nothing leaves the tab.' : 'The desk shows fabricated snapshots.'}</p>
<div class="fixture-grid"><section aria-labelledby="fixture-scenario-heading"><h2 id="fixture-scenario-heading">Scenario</h2>${scenario}</section>
${chainMode ? '<section aria-labelledby="fixture-chain-heading"><h2 id="fixture-chain-heading">Chain</h2><p data-status="chain"></p><div class="fixture-buttons"><button type="button" data-control="mine">Mine a block</button></div></section>' : ''}</div>
<ol class="fixture-log" aria-label="Fixture activity" aria-live="polite" tabindex="0" data-status="log"></ol></details>`;
  document.body.prepend(panel);

  const find = <T extends Element>(selector: string) => panel.querySelector<T>(selector);
  const logList = find<HTMLElement>('[data-status="log"]')!;
  const chainStatus = find<HTMLElement>('[data-status="chain"]');
  const log: string[] = [];

  const update = (message?: string) => {
    if (message) log.unshift(`${new Date().toISOString().slice(11, 19)} UTC · ${message}`);
    log.splice(6);
    if (chainStatus) chainStatus.textContent = `Block ${chain.head.number}`;
    logList.replaceChildren(...log.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
  };

  find<HTMLSelectElement>('[data-control="state"]')?.addEventListener('change', (event) => {
    location.search = `?chain=${(event.target as HTMLSelectElement).value}`;
  });
  find<HTMLButtonElement>('[data-control="mine"]')?.addEventListener('click', () => chain.mine());
  chain.subscribe(update);
  update();
}
