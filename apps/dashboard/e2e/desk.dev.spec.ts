import { accessible, approve, connect, controls, decline, dismissToasts, expect, latestDecision, ledger, mine, press, test, walletRequest } from './support';

// The state-matrix rows that need a wallet and a chain, exercised through the desk's
// live paths on the development /test-ui/ entry: connection, chain and account changes,
// the transaction lifecycle, repayment approval, and the reads behind them.

const permitted = 'The covenant permits this draw';

test('the chain fixture is labelled, and the desk reads it through its live path', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await expect(page.getByText('UI FIXTURE · simulated chain and wallet in this page')).toBeVisible();
  await expect(controls(page)).toContainText('No key exists and nothing leaves the tab.');
  await expect(page.locator('article.metric').filter({ hasText: 'Counted coverage' })).toContainText('100.00%');
  await expect(page.locator('article.metric').filter({ hasText: 'Available to draw' })).toContainText('2.50');
  await expect(page.getByRole('heading', { name: permitted })).toBeVisible();
  await expect(page.getByText(/Snapshot: block 1,000/)).toBeVisible();
});

test('a draw confirms once a block is mined, and stays out of the live desk’s storage', async ({ page, context }) => {
  await page.goto('/test-ui/?chain=compliant');
  await connect(page);
  await expect(page.getByRole('heading', { name: permitted })).toBeVisible();
  await press(page, 'Draw USDC');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await approve(page, 'Send draw 1.000000 USDC');
  await expect(latestDecision(page)).toContainText('PENDING');
  await mine(page);
  await expect(latestDecision(page)).toContainText('CONFIRMED');
  await expect(latestDecision(page)).toContainText('Block 1001');
  await expect(page.locator('article.metric').filter({ hasText: 'Available to draw' })).toContainText('1.50');
  const stored = await context.storageState();
  expect(JSON.stringify(stored.origins), 'fixture decisions never reach the live desk’s journal').not.toContain('signa:operations');
});

test('a declined wallet request is recorded as declined, not as an unresolved send', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await connect(page);
  await press(page, 'Draw USDC');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await decline(page);
  await expect(latestDecision(page)).toContainText('DECLINED');
  await dismissToasts(page);
  await latestDecision(page).getByRole('button', { name: 'Details for draw' }).click();
  await expect(page.getByRole('dialog', { name: 'Decision detail' })).toContainText('The wallet request was declined. No transaction was submitted.');
});

test('a sped-up transaction confirms under its replacement hash', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await connect(page);
  await press(page, 'Draw USDC');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await approve(page);
  await expect(latestDecision(page)).toContainText('PENDING');
  const submitted = await latestDecision(page).getByRole('link').textContent();
  await controls(page).getByRole('button', { name: 'Speed up' }).click();
  await expect(latestDecision(page)).toContainText('CONFIRMED');
  expect(await latestDecision(page).getByRole('link').textContent()).not.toEqual(submitted);
  await expect(page.locator('article.metric').filter({ hasText: 'Available to draw' })).toContainText('1.50');
});

test('a cancelled transaction is not reported as a completed draw', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await connect(page);
  await press(page, 'Draw USDC');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await approve(page);
  await expect(latestDecision(page)).toContainText('PENDING');
  await controls(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(latestDecision(page)).toContainText('CANCELLED');
  await expect(page.locator('article.metric').filter({ hasText: 'Available to draw' })).toContainText('2.50');
});

test('a replacement that is a different transaction is not reported as a completed draw', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await connect(page);
  await press(page, 'Draw USDC');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await approve(page);
  await expect(latestDecision(page)).toContainText('PENDING');
  await controls(page).getByRole('button', { name: 'Replace with another transaction' }).click();
  await expect(latestDecision(page)).toContainText('CANCELLED');
  await expect(page.locator('article.metric').filter({ hasText: 'Available to draw' })).toContainText('2.50');
});

test('a transaction that reverts in its block is held, not confirmed', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await connect(page);
  await press(page, 'Draw USDC');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await approve(page);
  await controls(page).getByLabel('Revert the next mined transaction').check();
  await mine(page);
  await expect(latestDecision(page)).toContainText('HELD · REVERTED');
  await expect(page.getByText('The operation did not confirm successfully. Review its receipt before another action.')).toBeVisible();
  await expect(page.locator('article.metric').filter({ hasText: 'Available to draw' })).toContainText('2.50');
});

test('repayment approves first, and a failed repayment leaves the approval standing', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await connect(page);
  await press(page, 'Repay');
  await expect(page.getByRole('dialog', { name: 'Review transaction' })).toContainText('your wallet first approves this exact amount');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await approve(page, 'Send approve 1.000000 USDC for the covenant vault');
  await mine(page);
  await expect(ledger(page).getByRole('row').filter({ hasText: 'approve' }).first()).toContainText('CONFIRMED');
  await approve(page, 'Send repay 1.000000 USDC');
  await controls(page).getByLabel('Revert the next mined transaction').check();
  await mine(page);
  await expect(latestDecision(page)).toContainText('HELD · REVERTED');
  await expect(ledger(page).getByRole('row').filter({ hasText: 'approve' }).first()).toContainText('CONFIRMED');
  await press(page, 'Repay');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await approve(page, 'Send repay 1.000000 USDC');
  await mine(page);
  await expect(latestDecision(page)).toContainText('CONFIRMED');
  await expect(page.locator('dd').filter({ hasText: '1.000000 USDC' }).first()).toBeVisible();
});

test('a wallet on another chain, and an account that is not the operator, cannot draw', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant&wallet=wrong-chain');
  await connect(page);
  const switchChain = page.getByRole('button', { name: 'Switch to Arc Testnet' });
  await expect(switchChain).toBeVisible();
  await press(page, 'Draw USDC');
  await expect(page.getByText('Connect a wallet on Arc Testnet to perform an action.')).toBeVisible();
  await switchChain.click();
  await approve(page, 'Switch the wallet to Arc Testnet');
  await expect(switchChain).toBeHidden();
  await controls(page).getByRole('button', { name: 'Use the other account' }).click();
  await expect(page.getByText('Connected account is not the facility operator.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This account does not hold the required role' })).toBeVisible();
  await press(page, 'Draw USDC');
  await expect(page.getByText('This held simulation is recorded below. No transaction was sent.')).toBeVisible();
  await expect(walletRequest(page)).toBeHidden();
  await controls(page).getByRole('button', { name: 'Use the operator account' }).click();
  await expect(page.getByText('Connected account is not the facility operator.')).toBeHidden();
});

test('a declined connection says so, and a wallet-side disconnect returns the read-only preview', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await decline(page);
  await expect(page.getByText('Wallet connection declined.')).toBeVisible();
  await connect(page);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await controls(page).getByRole('button', { name: 'Disconnect in wallet' }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(page.getByText('Operator preview · read only')).toBeVisible();
});

test('a held draw is recorded as a local simulation with no transaction', async ({ page }) => {
  await page.goto('/test-ui/?chain=cure');
  await connect(page);
  await expect(page.getByRole('heading', { name: 'The coverage covenant holds this draw' })).toBeVisible();
  await expect(page.getByText('68.40% counted coverage')).toBeVisible();
  await press(page, 'Draw USDC');
  await expect(page.getByText('This held simulation is recorded below. No transaction was sent.')).toBeVisible();
  await expect(latestDecision(page)).toContainText('Local simulation · no transaction');
  await expect(latestDecision(page)).toContainText('HELD');
  await expect(walletRequest(page)).toBeHidden();
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

test('the snapshot fixture still refuses to sign', async ({ page }) => {
  await page.goto('/test-ui/?state=compliant');
  await expect(page.getByText('UI FIXTURE · fabricated test state · signing disabled')).toBeVisible();
  await press(page, 'Draw USDC');
  await expect(page.getByText('Labelled UI fixture: live signing and transaction submission are disabled.')).toBeVisible();
  await expect(walletRequest(page)).toBeHidden();
});

test('the fixture desk passes the accessibility checks', async ({ page }) => {
  await page.goto('/test-ui/?chain=compliant');
  await expect(page.getByRole('heading', { name: permitted })).toBeVisible();
  await accessible(page, 'chain fixture, read-only');
  await connect(page);
  await press(page, 'Draw USDC');
  await page.getByRole('dialog', { name: 'Review transaction' }).getByRole('button', { name: 'Continue to wallet' }).click();
  await expect(walletRequest(page)).toBeVisible();
  await accessible(page, 'chain fixture, wallet request open');
  await approve(page);
  await mine(page);
  await expect(latestDecision(page)).toContainText('CONFIRMED');
  await accessible(page, 'chain fixture, after a confirmed draw');
  await page.goto('/test-ui/?state=cure');
  await expect(page.getByRole('heading', { name: 'The coverage covenant holds this draw' })).toBeVisible();
  await accessible(page, 'snapshot fixture, CURE');
});
