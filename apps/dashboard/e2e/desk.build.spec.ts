import { readdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { answer, chainAddresses, FixtureChain } from '../src/test/chain';
import { accessible } from './support';

// The chain fixture against a local production build. It lives in the test process and
// is injected through the network only, so the shipped bundle exercises its live read
// and simulate paths while containing no fixture code itself. The desk has no wallet
// connector, so this file mocks no wallet — only the chain.

const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../../../deployments/arc-testnet.json', import.meta.url), 'utf8')) as Parameters<typeof chainAddresses>[0];
const A = chainAddresses(manifest);
const LOCAL = new Set(['127.0.0.1', 'localhost']);
const isArc = (url: URL) => url.hostname.endsWith('arc.network');

async function inject(page: Page, state: string) {
  const chain = new FixtureChain(state, A);
  await page.route(isArc, async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: await answer(chain, route.request().postData() ?? '') }));
  // The approver service is not part of this build's network surface at all; leaving it
  // unmocked and unrouted means /api/* genuinely fails, which is exactly the "service
  // not reachable" state the waiver panel is required to report plainly.
  await page.route((url) => !LOCAL.has(url.hostname) && !isArc(url), (route) => route.abort('blockedbyclient'));
  return { chain };
}

test('the built bundle carries no fixture code and serves no fixture entry', async ({ page }) => {
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  const scanned: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(js|css|html)$/.test(entry.name)) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    const source = await readFile(path, 'utf8');
    scanned.push(path);
    for (const token of ['test-ui', 'UI FIXTURE', 'FIXTURE-', 'FixtureChain', 'fixtureSnapshot', 'installHarness', 'isSignaFixture', 'wagmi', 'WagmiProvider']) {
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

test('no wallet connection control ships, and the waiver panel reports the approver service down', async ({ page }) => {
  await inject(page, 'compliant');
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'The covenant permits this draw' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toHaveCount(0);
  await expect(page.getByText(/signa draw send/)).toBeVisible();
  await expect(page.getByText('The approver service is not reachable at')).toBeVisible();
  // The rest of the desk is unaffected by the approver service being down.
  await expect(page.locator('article.metric').filter({ hasText: 'Counted coverage' })).toContainText('100.00%');
});
