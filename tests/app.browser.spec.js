import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

const sizes = [[320, 740], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932], [844, 390], [768, 1024], [1024, 768], [1440, 1000]];
for (const [width, height] of sizes) {
  test(`layout ${width}×${height}: no page overflow, legible inputs and working charts`, async ({ page }) => {
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:5173') && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.setViewportSize({ width, height }); await page.goto('/');
    await expect(page.locator('#balance-chart svg')).toBeVisible();
    await expect(page.locator('#payoff-date')).not.toHaveText('—');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#principal').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(42);
    if (width < 600) expect(await page.locator('#principal').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    for (const id of ['variables', 'lumps', 'transactions', 'rates']) {
      const details = page.locator(`details:has(#${id}-editor)`);
      await details.locator('summary').click(); await details.locator(`[data-add="${id}"]`).click();
      await expect(details.locator('input').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.locator('#principal').fill('999999999999');
    await page.locator('#normal').fill('10000000000');
    await expect(page.locator('#metrics')).toContainText('RM 999,999,999,999.00');
    await expect(page.locator('#result-content')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]); expect(external).toEqual([]);
    await page.locator('#principal').fill('350000'); await page.locator('#normal').fill('2000');
    await expect(page.locator('#monthly-total')).toHaveText('RM 3,000.00');
    await page.evaluate(() => window.scrollTo(0, 0));
    await mkdir('artifacts/viewports', { recursive: true });
    await page.screenshot({ path: `artifacts/viewports/${width}x${height}.png` });
  });
}

test('loan edits, strategy comparison and local restoration include all advanced data', async ({ page }) => {
  await page.goto('/');
  await page.locator('#principal').fill('100000'); await page.locator('#rate').fill('3.65'); await page.locator('#start').fill('2028-02-01');
  await page.locator('#normal').fill('2000'); await page.locator('#extra').fill('500'); await page.locator('#flexi').fill('10000');
  await expect(page.locator('#flexi-breakdown')).toContainText('RM 90,000.00');
  const before = await page.locator('#payoff-date').textContent();
  await page.locator('details:has(#lumps-editor) summary').click(); await page.locator('[data-add="lumps"]').click();
  await page.locator('[data-list="lumps"][data-prop="date"]').fill('2028-02-15'); await page.locator('[data-list="lumps"][data-prop="amount"]').fill('10000');
  await page.locator('details:has(#transactions-editor) summary').click(); await page.locator('[data-add="transactions"]').click();
  await page.locator('[data-list="transactions"][data-prop="date"]').fill('2028-02-10'); await page.locator('[data-list="transactions"][data-prop="amount"]').fill('5000');
  await page.locator('[data-add="transactions"]').click();
  await page.locator('[data-list="transactions"][data-prop="date"]').nth(1).fill('2028-02-20'); await page.locator('[data-list="transactions"][data-prop="type"]').nth(1).selectOption('withdrawal'); await page.locator('[data-list="transactions"][data-prop="amount"]').nth(1).fill('2000');
  await page.locator('details:has(#rates-editor) summary').click(); await page.locator('[data-add="rates"]').click();
  await page.locator('[data-list="rates"][data-prop="date"]').fill('2028-02-18'); await page.locator('[data-list="rates"][data-prop="rate"]').fill('4.15');
  await page.locator('details:has(#variables-editor) summary').click(); await page.locator('[data-add="variables"]').click();
  await page.locator('[data-list="variables"][data-prop="extra"]').fill('800');
  await expect(page.locator('#validation')).toBeHidden();
  await expect(page.locator('#schedule-table')).toContainText('Flexi withdrawal');
  await expect(page.locator('#schedule-table')).toContainText('Rate change');
  await expect(page.locator('#scenario-table')).toContainText('Current variable strategy');
  const payoff = await page.locator('#payoff-date').textContent(); expect(payoff).not.toEqual(before);
  await page.reload(); await expect(page.locator('#save-status')).toContainText('restored');
  await expect(page.locator('#principal')).toHaveValue('100000'); await expect(page.locator('#extra')).toHaveValue('500'); await expect(page.locator('#flexi')).toHaveValue('10000');
  await expect(page.locator('#start')).toHaveValue('2028-02-01'); await expect(page.locator('#payoff-date')).toHaveText(payoff);
  expect(await page.locator('[data-list="transactions"][data-prop="date"]').count()).toBe(2);
  await expect(page.locator('[data-list="variables"][data-prop="extra"]')).toHaveValue('800');
  await expect(page.locator('[data-list="rates"][data-prop="rate"]')).toHaveValue('4.15');
  await expect(page.locator('[data-list="lumps"][data-prop="amount"]')).toHaveValue('10000');
});

test('what-if and target solvers can apply payments and scenario selection updates immediately', async ({ page }) => {
  await page.goto('/');
  await page.locator('#budget').fill('4000'); await expect(page.locator('#budget-result')).toContainText('Mortgage-free by');
  const budgetDate = await page.locator('#budget-result strong').first().textContent();
  await page.locator('[data-action="apply-budget"]').click(); await expect(page.locator('#monthly-total')).toHaveText('RM 4,000.00'); await expect(page.locator('#payoff-date')).toHaveText(budgetDate);
  await page.locator('#start').fill('2026-01-01'); await page.locator('#target').fill('2036-01-01');
  await expect(page.locator('#target-result')).toContainText('Required monthly payment');
  await page.locator('[data-action="apply-target"]').click();
  const payoff = await page.locator('#payoff-date').textContent(); expect(payoff).toBe('January 2036');
  await page.locator('button[data-scenario="500"]').click(); await expect(page.locator('#extra')).toHaveValue('500');
  await expect(page.locator('tr[data-scenario="500"]')).toHaveClass(/selected/);
  await page.locator('#target').fill('2025-01-01'); await expect(page.locator('#target-result')).toContainText('after the calculation start'); await expect(page.locator('[data-action="apply-target"]')).toBeDisabled();
});

test('invalid and insufficient payments do not leave stale payoff results', async ({ page }) => {
  await page.goto('/'); await page.locator('#principal').fill('');
  await expect(page.locator('#validation')).toContainText('Check your loan details'); await expect(page.locator('#result-content')).toBeHidden();
  await expect(page.locator('[data-action="csv"]').first()).toBeDisabled();
  await page.locator('#principal').fill('-1'); await expect(page.locator('#validation')).toContainText('greater than zero');
  await page.locator('#principal').fill('100000'); await page.locator('#normal').fill('10'); await page.locator('#extra').fill('0');
  await expect(page.locator('#payoff-date')).toHaveText('Review your payment'); await expect(page.locator('#validation')).toContainText('may not be sufficient');
  await page.locator('#rate').fill('0'); await page.locator('#normal').fill('100000');
  await expect(page.locator('#validation')).toBeHidden(); await expect(page.locator('#metrics')).toContainText('RM 100,000.00'); await expect(page.locator('#metrics')).toContainText('1 payment');
});

test('monthly/yearly schedule, full CSV export, clipboard summary and print layout', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/'); await expect(page.locator('#balance-chart svg')).toBeVisible();
  const totalEvents = Number((await page.locator('#schedule-info').textContent()).match(/of (\d+)/)[1]);
  await page.locator('[data-view="yearly"]').click(); await expect(page.locator('#schedule-table')).toContainText('Starting principal');
  await page.locator('[data-view="monthly"]').click(); await page.locator('#show-flexi').check(); await expect(page.locator('#schedule-table')).toContainText('Flexi balance');
  const downloading = page.waitForEvent('download'); await page.locator('[data-action="csv"]').first().click(); const download = await downloading;
  expect(download.suggestedFilename()).toBe('flexi-mortgage-payment-schedule.csv');
  const csv = await readFile(await download.path(), 'utf8'); expect(csv.split('\r\n').length).toBe(totalEvents + 1); expect(csv).toContain('Effective Interest Balance (RM)');
  await page.locator('[data-action="copy"]').first().click(); await expect(page.locator('#toast')).toHaveText('Mortgage summary copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Your current strategy');
  await page.evaluate(() => { window.print = () => { window.dispatchEvent(new Event('beforeprint')); document.body.dataset.printRows = String(document.querySelectorAll('#schedule-table tbody tr').length); window.dispatchEvent(new Event('afterprint')); }; });
  await page.locator('[data-action="print"]').first().click(); expect(await page.locator('body').getAttribute('data-print-rows')).toBe(String(totalEvents));
  expect(await page.locator('#schedule-table tbody tr').count()).toBe(24);
  await page.emulateMedia({ media: 'print' }); await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('#loan-details')).toBeHidden(); await expect(page.locator('.export-bar')).toBeHidden();
  await expect(page.locator('#assumptions')).toBeVisible();
  expect(await page.locator('#schedule-table tbody tr').count()).toBe(totalEvents);
  await mkdir('artifacts', { recursive: true }); await page.pdf({ path: 'artifacts/print-preview.pdf', format: 'A4', printBackground: true });
  expect((await readFile('artifacts/print-preview.pdf')).length).toBeGreaterThan(10000);
  await page.screenshot({ path: 'artifacts/print-layout.png' });
});

test('reset confirmation preserves values when cancelled and restores demo when confirmed', async ({ page }) => {
  await page.goto('/'); await page.locator('#principal').fill('123456');
  await page.locator('[data-action="reset"]').click(); await expect(page.locator('#reset-dialog')).toBeVisible(); await page.locator('[data-action="cancel-reset"]').click();
  await expect(page.locator('#principal')).toHaveValue('123456');
  await page.locator('[data-action="reset"]').click(); await page.locator('[data-action="confirm-reset"]').click(); await expect(page.locator('#principal')).toHaveValue('350000');
  await page.reload(); await expect(page.locator('#principal')).toHaveValue('350000'); await expect(page.locator('#demo-label')).toHaveText('Demo values');
});
