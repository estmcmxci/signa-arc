import { readdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { answer, chainAddresses, FixtureChain } from '../src/test/chain';
import { FixtureWallet } from '../src/test/wallet';
import { accessible, press } from './support';

// The same chain and wallet fixtures against a local production build. Here they live
// in the test process and are injected through the network and window.ethereum, so the
// shipped bundle exercises its live paths while containing no fixture code itself.

const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../../../deployments/arc-testnet.json', import.meta.url), 'utf8')) as Parameters<typeof chainAddresses>[0];
const A = chainAddresses(manifest);
const LOCAL = new Set(['127.0.0.1', 'localhost']);
const isArc = (url: URL) => url.hostname.endsWith('arc.network');

async function inject(page: Page, state: string) {
  const chain = new FixtureChain(state, A);
  const wallet = new FixtureWallet(chain);
  await page.route(isArc, async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: await answer(chain, route.request().postData() ?? '') }));
  await page.route((url) => !LOCAL.has(url.hostname) && !isArc(url), (route) => route.abort('blockedbyclient'));
  await page.exposeFunction('__fixtureWallet', async (call: string) => {
    try {
      return JSON.stringify({ result: (await wallet.request(JSON.parse(call) as { method: string; params?: unknown[] })) ?? null });
    } catch (e) {
      const error = e as { code?: number; message?: string };
      return JSON.stringify({ error: { code: error.code ?? -32603, message: error.message ?? 'The fixture wallet failed.' } });
    }
  });
  await page.addInitScript(() => {
    type Listener = (...args: unknown[]) => void;
    const listeners: Record<string, Set<Listener>> = {};
    const bridge = window as unknown as { __fixtureWallet: (call: string) => Promise<string>; __fixtureEmit: Listener };
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        isSignaFixture: true,
        async request(args: { method: string; params?: unknown }) {
          const reply = JSON.parse(await bridge.__fixtureWallet(JSON.stringify(args))) as { result?: unknown; error?: { code: number; message: string } };
          if (reply.error) throw Object.assign(new Error(reply.error.message), reply.error);
          return reply.result;
        },
        on(event: string, listener: Listener) {
          (listeners[event] ??= new Set()).add(listener);
        },
        removeListener(event: string, listener: Listener) {
          listeners[event]?.delete(listener);
        },
      },
    });
    bridge.__fixtureEmit = (event: unknown, ...args: unknown[]) => listeners[String(event)]?.forEach((listener) => listener(...args));
  });
  for (const event of ['accountsChanged', 'chainChanged']) {
    wallet.on(event, (...args: unknown[]) => void page.evaluate(([name, payload]) => (window as unknown as { __fixtureEmit: (...a: unknown[]) => void }).__fixtureEmit(name, ...(payload as unknown[])), [event, args] as const).catch(() => {}));
  }
  return { chain, wallet };
}

async function approve(wallet: FixtureWallet, summary?: string) {
  await expect.poll(() => wallet.pending[0]?.summary ?? '', { timeout: 15_000 }).toContain(summary ?? '');
  wallet.approve();
}

test('the built bundle carries no fixture code and serves no fixture entry', async ({ page }) => {
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  const scanned: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(js|css|html)$/.test(entry.name)) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    const source = await readFile(path, 'utf8');
    scanned.push(path);
    for (const token of ['test-ui', 'UI FIXTURE', 'FIXTURE-', 'FixtureChain', 'fixtureSnapshot', 'Fixture wallet request', 'installHarness']) {
      expect(source, `${path} contains ${token}`).not.toContain(token);
    }
  }
  expect(scanned.length, 'the build was scanned').toBeGreaterThan(3);
  expect(entries.some((entry) => entry.name === 'test-ui' || entry.parentPath.includes('test-ui'))).toBe(false);
  const response = await page.goto('/test-ui/?chain=compliant');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Coverage before capital/);
  await expect(page.getByText('UI FIXTURE')).toHaveCount(0);
});

test('the built routes load, survive a direct refresh, and pass the accessibility checks', async ({ page }) => {
  await inject(page, 'compliant');
  await page.goto('/');
  await expect(page).toHaveTitle(/Signa Covenant/);
  await accessible(page, 'landing');
  await page.goto('/security/');
  await expect(page.getByRole('heading', { name: 'Know what the control proves.' })).toBeVisible();
  await accessible(page, 'security');
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'EUR / USD facility' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The covenant permits this draw' })).toBeVisible();
  await expect(page.getByText('Arc Testnet · fictional facility')).toBeVisible();
  await accessible(page, 'operator desk');
});

test('the built desk explains a covenant refusal from the chain’s own revert', async ({ page }) => {
  await inject(page, 'cure');
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'The coverage covenant holds this draw' })).toBeVisible();
  await expect(page.getByText('68.40% counted coverage')).toBeVisible();
  await expect(page.getByText('DrawNotAllowed · BELOW_THRESHOLD')).toBeVisible();
});

test('the built desk completes a draw through an injected wallet', async ({ page }) => {
  const { chain, wallet } = await inject(page, 'compliant');
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await approve(wallet, 'Connect');
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  await press(page, 'Draw USDC');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await approve(wallet, 'Send draw 1.000000 USDC');
  const decision = page.getByRole('table', { name: 'Source-labelled decisions and receipts' }).getByRole('row').filter({ hasText: 'This browser' }).first();
  await expect(decision).toContainText('PENDING');
  chain.mine();
  await expect(decision).toContainText('CONFIRMED');
  await expect(page.locator('article.metric').filter({ hasText: 'Available to draw' })).toContainText('1.50');
});
