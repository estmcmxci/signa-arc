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

/** Counts every fallback of the verdict panel to "Evaluating the draw" — a re-simulate in flight. */
export async function watchVerdict(page: Page): Promise<() => Promise<{ evaluating: number }>> {
  await page.evaluate(() => {
    const counts = { evaluating: 0 };
    (window as unknown as { __verdictWatch: typeof counts }).__verdictWatch = counts;
    const evaluating = () => (document.querySelector('.verdict')?.textContent ?? '').includes('Evaluating the draw');
    let wasEvaluating = evaluating();
    new MutationObserver(() => {
      const isEvaluating = evaluating();
      if (isEvaluating && !wasEvaluating) counts.evaluating += 1;
      wasEvaluating = isEvaluating;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __verdictWatch: { evaluating: number } }).__verdictWatch);
}

export const controls = (page: Page): Locator => page.getByRole('complementary', { name: 'UI fixture controls' });
export const ledger = (page: Page): Locator => page.getByRole('table', { name: 'Source-labelled decisions and receipts' });

export async function mine(page: Page): Promise<void> {
  await controls(page).getByRole('button', { name: 'Mine a block' }).click();
}

/** Sonner keeps a pending toast open, which can sit over a panel's controls. */
export async function dismissToasts(page: Page): Promise<void> {
  for (const close of await page.getByRole('button', { name: 'Close toast' }).all()) await close.click({ timeout: 5_000 }).catch(() => {});
}
