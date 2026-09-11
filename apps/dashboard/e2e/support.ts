import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Locator, type Page } from '@playwright/test';

// Shared browser-test helpers. `offNetwork` fails any attempt to leave the machine, so
// a fixture run that quietly reached Arc would be visible rather than green.

const LOCAL = new Set(['127.0.0.1', 'localhost']);

export const test = base.extend<{ offNetwork: string[] }>({
  offNetwork: [
    async ({ context }, use) => {
      const attempted: string[] = [];
      await context.route(
        (url) => !LOCAL.has(url.hostname),
        async (route) => {
          attempted.push(route.request().url());
          await route.abort('blockedbyclient');
        },
      );
      await use(attempted);
      expect(attempted, 'the page attempted a request off this machine').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function accessible(page: Page, context?: string): Promise<void> {
  // Contrast is measured on settled pixels: a toast still fading in blends with the page behind it.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'), null, { timeout: 2_000 }).catch(() => {});
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const found = violations.flatMap((v) => v.nodes.map((node) => `${v.id} (${v.impact}) ${node.target.join(' ')} — ${node.failureSummary?.replace(/\s+/g, ' ')}`));
  expect(found, context).toEqual([]);
}

/** Refused controls keep aria-disabled with guarded handlers, so a gated click must still be delivered. */
export const press = (page: Page, name: string): Promise<void> => page.getByRole('button', { name, exact: true }).click({ force: true });

/** Counts every fallback of the verdict panel to "Evaluating the draw", and every time Draw goes aria-disabled. */
export async function watchVerdict(page: Page): Promise<() => Promise<{ evaluating: number; disabled: number }>> {
  await page.evaluate(() => {
    const counts = { evaluating: 0, disabled: 0 };
    (window as unknown as { __verdictWatch: typeof counts }).__verdictWatch = counts;
    const evaluating = () => (document.querySelector('.verdict')?.textContent ?? '').includes('Evaluating the draw');
    const disabled = () => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Draw USDC' && b.getAttribute('aria-disabled') === 'true');
    let wasEvaluating = evaluating();
    let wasDisabled = disabled();
    new MutationObserver(() => {
      const isEvaluating = evaluating();
      if (isEvaluating && !wasEvaluating) counts.evaluating += 1;
      wasEvaluating = isEvaluating;
      const isDisabled = disabled();
      if (isDisabled && !wasDisabled) counts.disabled += 1;
      wasDisabled = isDisabled;
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-disabled'] });
  });
  return () => page.evaluate(() => (window as unknown as { __verdictWatch: { evaluating: number; disabled: number } }).__verdictWatch);
}

export const controls = (page: Page): Locator => page.getByRole('complementary', { name: 'UI fixture controls' });
export const walletRequest = (page: Page): Locator => page.getByRole('dialog', { name: 'Fixture wallet request' });
export const ledger = (page: Page): Locator => page.getByRole('table', { name: 'Source-labelled decisions and receipts' });
/** The newest decision this browser recorded; the ledger sorts newest first. */
export const latestDecision = (page: Page): Locator => ledger(page).getByRole('row').filter({ hasText: /This browser|Local simulation/ }).first();

export async function approve(page: Page, summary?: string | RegExp): Promise<void> {
  const request = walletRequest(page);
  await expect(request).toBeVisible();
  if (summary) await expect(request).toContainText(summary);
  await request.getByRole('button', { name: 'Approve in wallet' }).click();
}

export async function decline(page: Page): Promise<void> {
  await expect(walletRequest(page)).toBeVisible();
  await walletRequest(page).getByRole('button', { name: 'Decline in wallet' }).click();
}

export async function connect(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await approve(page, 'Connect this page');
}

export async function mine(page: Page): Promise<void> {
  await controls(page).getByRole('button', { name: 'Mine a block' }).click();
}

/** Sonner keeps a pending toast open, which can sit over the ledger's controls. */
export async function dismissToasts(page: Page): Promise<void> {
  for (const close of await page.getByRole('button', { name: 'Close toast' }).all()) await close.click({ timeout: 5_000 }).catch(() => {});
}
