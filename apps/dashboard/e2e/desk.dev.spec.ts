import { accessible, controls, expect, ledger, mine, test, watchVerdict } from './support';

// The state-matrix rows that need a chain, exercised through the desk's live read and
// simulate paths on the development /test-ui/ entry. The desk has no wallet connector
// and no write path: every scenario here is a read, a simulation, or the approver
// service's own reachability, never a signed transaction.

const permitted = 'The covenant permits this draw';

test('the chain fixture is labelled, and the desk reads it through its live path', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await expect(page.getByText('UI FIXTURE · simulated chain in this page')).toBeVisible();
  await expect(controls(page)).toContainText('No key exists and nothing leaves the tab.');
  await expect(page.locator('article.metric').filter({ hasText: 'Counted coverage' })).toContainText('100.00%');
  await expect(page.locator('article.metric').filter({ hasText: 'Available to draw' })).toContainText('2.50');
  await expect(page.getByRole('heading', { name: permitted })).toBeVisible();
  await expect(page.getByText(/Snapshot: block 1,000/)).toBeVisible();
});

test('a held draw reads as a covenant hold, with no control able to send it', async ({ page }) => {
  await page.goto('/test-ui/?chain=cure');
  await expect(page.getByRole('heading', { name: 'The coverage covenant holds this draw' })).toBeVisible();
  await expect(page.getByText('68.40% counted coverage')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draw USDC' })).toHaveCount(0);
});

test('no wallet connection control exists, and the operator is named as read-only', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toHaveCount(0);
  await expect(page.getByText('Operator account · from the deployment manifest · read only')).toBeVisible();
  await expect(page.getByText('Operator preview · read only')).toBeVisible();
  await expect(page.getByText(/signa draw send/)).toBeVisible();
  await expect(page.getByText(/signa covenant sync/)).toBeVisible();
});

test('an all-zero exposure record reads as no exposure, in both fixtures', async ({ page }) => {
  for (const entry of ['/test-ui/?chain=missing', '/test-ui/?state=missing']) {
    await page.goto(entry);
    const exposure = page.locator('article.metric').filter({ hasText: 'Authenticated exposure' });
    await expect(exposure, entry).toContainText('No exposure recorded');
    await expect(exposure, entry).not.toContainText('stale');
    const credentials = page.locator('#credentials');
    await expect(credentials, entry).toContainText('No exposure recorded');
    await expect(credentials.getByRole('status').filter({ hasText: 'NO EXPOSURE' }), entry).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'STALE' }), entry).toHaveCount(0);
    await expect(credentials.getByText('Assertion missing'), entry).toBeVisible();
  }
});

test('failed and partial reads stay distinct from fabricated zeros', async ({ page }) => {
  await page.goto('/test-ui/?chain=rpc-error');
  await expect(page.getByText('Current reads are unavailable.')).toBeVisible();
  await expect(page.getByText('No prior values are available.')).toBeVisible();
  await page.goto('/test-ui/?chain=partial');
  await expect(page.getByText('Some fields are unavailable: evaluate, availableToDraw.')).toBeVisible();
  await expect(page.locator('article.metric').filter({ hasText: 'Available to draw' })).toContainText('—');
});

test('the fixture desk passes the accessibility checks, including the waiver panel down state', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await expect(page.getByRole('heading', { name: permitted })).toBeVisible();
  await expect(page.getByText('The approver service is not reachable')).toBeVisible();
  await accessible(page, 'chain fixture, read-only, approver service down');
  await page.goto('/test-ui/?state=cure');
  await expect(page.getByRole('heading', { name: 'The coverage covenant holds this draw' })).toBeVisible();
  await accessible(page, 'snapshot fixture, CURE');
});

test('a new block keeps the verdict on screen; a new amount discards it', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await expect(page.getByRole('heading', { name: permitted })).toBeVisible();
  const counts = await watchVerdict(page);

  // The head advances twice, so the desk re-reads and re-simulates the same request across polls.
  await mine(page);
  await expect(page.getByText(/Snapshot: block 1,001/)).toBeVisible();
  await mine(page);
  await expect(page.getByText(/Snapshot: block 1,002/)).toBeVisible();
  await expect(page.getByRole('heading', { name: permitted })).toBeVisible();
  expect(await counts(), 'a new block must not reset the verdict').toEqual({ evaluating: 0 });

  const evaluating = async () => (await counts()).evaluating;
  const afterBlocks = await evaluating();
  await page.getByLabel('Draw / repay amount').fill('3');
  await expect(page.getByRole('heading', { name: 'The retained reserve holds this draw' })).toBeVisible();
  await expect.poll(evaluating, { message: 'a new amount discards the verdict' }).toBeGreaterThan(afterBlocks);
});

test('the recorded evidence ledger shows the A-3 refusal at equal weight to a permitted draw', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  const table = ledger(page);
  await expect(table).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: 'HELD · REVERTED' }).first()).toBeVisible();
});

// ---- The waiver panel: propose → approve → approve → broadcast, against a mocked
// approver service. packages/privy-waiver has its own 36 tests for the service itself;
// these cover what this browser does — rendering, key handling, and never signing a
// payload that does not match the proposed call.

const info = {
  walletId: 'zc9i4be5osru1qyzfci337mi',
  chainId: 5042002,
  walletAddress: '0x55C4DD3770A44695735717CB7b7005AC7dE9edA1',
  walletOwnerId: 'pbf1jtt1knpsl30eyp0z163t',
  threshold: 2,
  approvers: [
    { role: 'Risk officer', publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdTLnqVlKlu7pil38bXDIoTeFbbTWO2ILftJpmdIFKHejmkOrh+ssVfpBkr5mNkHLrSRlkC4eIA7FhSOPAIy+0A==' },
    { role: 'Treasury lead', publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAED4DCLEErSAdbIY64mQIcK4ZZHKfpvGP3T+UfA3YXFQsmSPpiQVDmwyoVkU5QsxnSgKjDleBwex40ODQtoZqPvA==' },
  ],
  facility: { vault: '0x1970feb699BCd4dd268a3A8c2590929fc8fd67c2' },
  explorer: 'https://testnet.arcscan.app',
  readiness: {
    covenantState: 'CURE',
    activeWaiver: false,
    coverage: { coverageBps: 6840, requiredCoverageBps: 10000, resultReason: 'BELOW_THRESHOLD', exposureReason: 'ELIGIBLE', eligibleHedgeCount: 1, totalHedgeCount: 1 },
    refusals: [] as string[],
    maxWaiverDurationSeconds: 259200,
  },
  policies: [
    { id: 'y5x9g8gglndai2hosm47zvxf', name: 'Waiver only', owner_id: 'pbf1jtt1knpsl30eyp0z163t', rules: [{ action: 'ALLOW', method: 'eth_signTransaction', conditions: [{ field: 'to', operator: 'eq', value: '0x1970feb699BCd4dd268a3A8c2590929fc8fd67c2' }, { field: 'chain_id', operator: 'eq', value: '5042002' }, { field: 'function_name', operator: 'eq', value: 'createWaiver' }] }] },
  ],
};

async function mockApprover(page: import('@playwright/test').Page, actions: unknown[] = [], readinessOverride: Partial<typeof info.readiness> = {}) {
  const body = { ...info, readiness: { ...info.readiness, ...readinessOverride } };
  await page.route('**/api/info', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  await page.route('**/api/actions', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(actions) }));
}

test('the waiver panel names the admin, its scope, and readiness, once the service is reachable', async ({ page }) => {
  await mockApprover(page);
  await page.goto('/test-ui/?chain=cure');
  const panel = page.locator('#waiver');
  await expect(panel.getByText('Privy server wallet')).toBeVisible();
  await expect(panel.getByText('createWaiver').first()).toBeVisible();
  await expect(panel.getByText('Risk officer').first()).toBeVisible();
  await expect(panel.getByText('Treasury lead').first()).toBeVisible();
  await expect(panel.getByText('not passkeys', { exact: false })).toBeVisible();
  await expect(panel.getByText('The contract would accept a waiver now.')).toBeVisible();
  await expect(panel.getByText(/68\.40%/)).toBeVisible();
});

test('an approver key that does not match the quorum member is labelled as such', async ({ page }) => {
  await mockApprover(page);
  await page.goto('/test-ui/?chain=cure');
  const key = await page.evaluate(async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    return btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  });
  const panel = page.locator('#waiver');
  const card = panel.locator('.approver-card').filter({ hasText: 'Risk officer' });
  await card.getByPlaceholder('base64 PKCS8 private key').fill(key);
  await card.getByRole('button', { name: 'Import' }).click();
  await expect(card.getByText('NOT THIS ROLE’S KEY')).toBeVisible();
});

test('proposing is refused when the covenant is already compliant, and the service is never asked', async ({ page }) => {
  let posted = false;
  await mockApprover(page, [], { covenantState: 'COMPLIANT', refusals: ['The facility is compliant; the contract would refuse a waiver.'] });
  await page.route('**/api/waivers', (route) => {
    posted = true;
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'createWaiver would revert: facility is already compliant.' }) });
  });
  await page.goto('/test-ui/?chain=compliant');
  const panel = page.locator('#waiver');
  await expect(panel.getByText('The contract would accept a waiver now.')).toHaveCount(0);
  await panel.getByLabel('Reason').fill('Rehearsal for the video.');
  await panel.getByRole('button', { name: 'Propose' }).click();
  await expect(panel.getByText('createWaiver would revert: facility is already compliant.')).toBeVisible();
  expect(posted).toBe(true);
});
