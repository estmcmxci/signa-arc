/// <reference types="vite/client" />
import { arcTestnet } from 'viem/chains';
import { answer, ARC_CHAIN_ID, chainAddresses, fixtureAddresses, FixtureChain, SLOW_RPC_MS, type ManifestAddresses, type ReplacementReason } from './chain';
import { assertFixtureContext, FIXTURE_STATES } from './fixtures';
import { FixtureWallet, OTHER_ACCOUNT, OTHER_CHAIN } from './wallet';

// Installs the /test-ui/ entry's fixture chain and wallet before the desk evaluates:
// test-ui/index.html loads ./entry.ts ahead of main.tsx, and no build input includes
// it. ?chain=<state> runs the desk's live paths against them; ?state=<state> keeps
// the snapshot fixtures. In both, the fixture wallet is window.ethereum, browser
// wallets' EIP-6963 announcements are dropped, localStorage is the tab's
// sessionStorage (nothing reaches the live desk's journal or wallet state), and fetch
// and WebSocket cannot leave the page's origin except to the fixture node. If any of
// that cannot be set up, the harness removes #app and the desk does not render.

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
    const wallet = new FixtureWallet(chain, {
      ...(params.get('wallet') === 'other-account' ? { account: OTHER_ACCOUNT } : {}),
      ...(params.get('wallet') === 'wrong-chain' ? { chainId: OTHER_CHAIN.id } : {}),
    });
    guardNetwork(chain, [...arcTestnet.rpcUrls.default.http, ...(manifest ? [manifest.rpcUrl] : [])]);
    installWallet(wallet);
    window.addEventListener('eip6963:announceProvider', (event) => event.stopImmediatePropagation(), true);
    document.documentElement.dataset.fixture = state === null ? 'snapshot' : 'chain';
    renderControls(chain, wallet, state);
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

function installWallet(wallet: FixtureWallet): void {
  Object.defineProperty(window, 'ethereum', { configurable: true, enumerable: true, get: () => wallet, set: () => undefined });
  if (window.ethereum !== wallet) {
    throw new Error('A browser wallet extension owns window.ethereum on this page. Open the fixture entry in a browser profile without wallet extensions.');
  }
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
.fixture-controls h2,.fixture-prompt h2{font-size:12px;margin:0 0 6px;color:var(--hold)}
.fixture-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:10px}
.fixture-grid p{margin:0;overflow-wrap:anywhere}
.fixture-buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.fixture-controls button,.fixture-prompt button,.fixture-controls select{min-height:32px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:var(--raised);color:var(--text);padding:4px 10px;font:inherit}
.fixture-controls button:disabled{opacity:.55;cursor:not-allowed}
.fixture-check{display:flex;gap:8px;align-items:center;margin-top:8px}
.fixture-note{color:var(--muted);margin:6px 0 0}
.fixture-log{margin:10px 0 0;padding-left:18px;color:var(--muted);max-height:8em;overflow:auto}
.fixture-prompt{position:fixed;top:16px;right:16px;z-index:60;width:min(380px,calc(100vw - 32px));border:2px solid var(--hold);border-radius:var(--radius-lg);background:var(--panel);color:var(--text);padding:16px;box-shadow:var(--shadow-lg);font:13px/1.5 var(--font-sans)}
.fixture-prompt[hidden]{display:none}
.fixture-prompt p{margin:0 0 4px}
@media(max-width:680px){.fixture-controls{margin:12px 16px 0}}`;

function renderControls(chain: FixtureChain, wallet: FixtureWallet, state: string | null): void {
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
  const chainSection = chainMode
    ? '<section aria-labelledby="fixture-chain-heading"><h2 id="fixture-chain-heading">Chain</h2><p data-status="chain"></p><div class="fixture-buttons"><button type="button" data-control="mine">Mine a block</button><button type="button" data-replace="repriced">Speed up</button><button type="button" data-replace="cancelled">Cancel</button><button type="button" data-replace="replaced">Replace with another transaction</button></div><label class="fixture-check"><input type="checkbox" data-control="revert"> Revert the next mined transaction</label></section>'
    : '';
  panel.innerHTML = `<details open><summary>UI fixture controls · ${chainMode ? `simulated chain (${state}) and wallet` : 'snapshot fixture and simulated wallet'}</summary>
<p class="fixture-note">${chainMode ? 'The desk below reads this page’s simulated chain and sends to its simulated wallet. No key exists and nothing leaves the tab.' : 'The desk shows fabricated snapshots and never requests a signature.'}</p>
<div class="fixture-grid"><section aria-labelledby="fixture-scenario-heading"><h2 id="fixture-scenario-heading">Scenario</h2>${scenario}</section>
<section aria-labelledby="fixture-wallet-heading"><h2 id="fixture-wallet-heading">Wallet</h2><p data-status="wallet"></p><div class="fixture-buttons"><button type="button" data-control="account"></button><button type="button" data-control="network"></button><button type="button" data-control="disconnect">Disconnect in wallet</button></div></section>${chainSection}</div>
<ol class="fixture-log" aria-label="Fixture activity" aria-live="polite" tabindex="0" data-status="log"></ol></details>
<div class="fixture-prompt" role="dialog" aria-labelledby="fixture-prompt-heading" tabindex="-1" hidden><h2 id="fixture-prompt-heading">Fixture wallet request</h2><p data-status="prompt"></p><div class="fixture-buttons"><button type="button" data-control="approve">Approve in wallet</button><button type="button" data-control="decline">Decline in wallet</button></div><p class="fixture-note">No key exists. Approving passes the unsigned request to the simulated chain.</p></div>`;
  document.body.prepend(panel);

  const find = <T extends Element>(selector: string) => panel.querySelector<T>(selector);
  const walletStatus = find<HTMLElement>('[data-status="wallet"]')!;
  const accountButton = find<HTMLButtonElement>('[data-control="account"]')!;
  const networkButton = find<HTMLButtonElement>('[data-control="network"]')!;
  const disconnectButton = find<HTMLButtonElement>('[data-control="disconnect"]')!;
  const prompt = find<HTMLElement>('.fixture-prompt')!;
  const promptText = find<HTMLElement>('[data-status="prompt"]')!;
  const logList = find<HTMLElement>('[data-status="log"]')!;
  const chainStatus = find<HTMLElement>('[data-status="chain"]');
  const replaceButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-replace]')];
  const revert = find<HTMLInputElement>('[data-control="revert"]');
  const log: string[] = [];
  let replacing = false;

  const update = (message?: string) => {
    if (message) log.unshift(`${new Date().toISOString().slice(11, 19)} UTC · ${message}`);
    log.splice(6);
    const operator = wallet.account === chain.addresses.operator;
    walletStatus.textContent = `${wallet.account} (${operator ? 'facility operator' : 'not the operator'}) · ${wallet.chainName} · ${wallet.connected ? 'connected to this page' : 'not connected'}`;
    accountButton.textContent = operator ? 'Use the other account' : 'Use the operator account';
    networkButton.textContent = wallet.chainId === ARC_CHAIN_ID ? `Move wallet to ${OTHER_CHAIN.name}` : 'Move wallet to Arc Testnet';
    disconnectButton.disabled = !wallet.connected;
    if (chainStatus) chainStatus.textContent = `Block ${chain.head.number} · ${chain.pending.length ? chain.pending.map((t) => `${t.name} pending`).join(', ') : 'no pending transactions'}`;
    for (const button of replaceButtons) button.disabled = replacing || !chain.pending.length;
    if (revert) revert.checked = chain.revertNext;
    const request = wallet.pending[0];
    const appearing = prompt.hidden && Boolean(request);
    prompt.hidden = !request;
    promptText.textContent = request?.summary ?? '';
    if (appearing) prompt.focus();
    logList.replaceChildren(...log.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
  };

  accountButton.addEventListener('click', () => wallet.useAccount(wallet.account === chain.addresses.operator ? OTHER_ACCOUNT : chain.addresses.operator));
  networkButton.addEventListener('click', () => wallet.moveToChain(wallet.chainId === ARC_CHAIN_ID ? OTHER_CHAIN.id : ARC_CHAIN_ID));
  disconnectButton.addEventListener('click', () => wallet.disconnectFromWallet());
  find<HTMLButtonElement>('[data-control="approve"]')!.addEventListener('click', () => wallet.approve());
  find<HTMLButtonElement>('[data-control="decline"]')!.addEventListener('click', () => wallet.decline());
  find<HTMLSelectElement>('[data-control="state"]')?.addEventListener('change', (event) => {
    location.search = `?chain=${(event.target as HTMLSelectElement).value}`;
  });
  find<HTMLButtonElement>('[data-control="mine"]')?.addEventListener('click', () => chain.mine());
  for (const button of replaceButtons) {
    button.addEventListener('click', async () => {
      const target = chain.pending[0];
      if (!target) return;
      replacing = true;
      update(`Waiting for the desk to fetch ${target.name} before replacing it`);
      try {
        await chain.replace(target.hash, button.dataset.replace as ReplacementReason);
      } catch (error) {
        update(error instanceof Error ? error.message : String(error));
      } finally {
        replacing = false;
        update();
      }
    });
  }
  revert?.addEventListener('change', () => {
    chain.revertNext = revert.checked;
    update(revert.checked ? 'The next mined transaction will revert' : 'Mined transactions execute normally');
  });
  wallet.subscribe(update);
  chain.subscribe(update);
  update();
}
