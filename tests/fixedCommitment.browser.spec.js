import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createLoan, createPortfolio, PORTFOLIO_KEY } from '../src/storage.js';
import { defaults } from '../src/persistence.js';
const fixture=()=>{
  const loans=[['a',2000],['b',6000],['c',25123]].map(([id,principal])=>createLoan({...defaults('2026-01-01'),principal,normal:1000,extra:0,rate:0,flexi:0,paymentDay:5},{id,name:'Loan '+id.toUpperCase()}));
  return {...createPortfolio(loans[0]),loans};
};
async function seed(page,url='/') {
  await page.addInitScript(({key,p})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(p));},{key:PORTFOLIO_KEY,p:fixture()});
  await page.goto(url);await page.locator('[data-tab="strategies"]').click();
}
async function run(page){await page.locator('#fc-run').click();await expect(page.locator('#fc-status')).toContainText('Simulation complete');}
const dimensions=[[320,740],[360,800],[375,812],[390,844],[412,915],[430,932],[844,390],[768,1024],[1024,768],[1440,1000]];
for(const [width,height] of dimensions)test(`fixed commitment layout and workflow ${width}x${height}`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setViewportSize({width,height});await seed(page);
  await page.locator('#fc-start').fill('2026-01');await run(page);
  await expect(page.locator('#fc-results')).toContainText('December 2026');
  await expect(page.locator('#fc-results')).toContainText('RM 3,000.00/month');
  await expect(page.locator('#fc-results')).toContainText('RM 123.00');
  await expect(page.locator('#fc-payment-chart svg')).toBeVisible();await expect(page.locator('#fc-balance-chart svg')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#fc-strategy').selectOption('priority');await expect(page.locator('#fc-priorities')).toBeVisible();
  await page.locator('[data-fc-priority="a"]').fill('3');await page.locator('[data-fc-priority="c"]').fill('1');await run(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#fc-strategy').selectOption('percentage');await expect(page.locator('#fc-percentages')).toBeVisible();await run(page);
  await mkdir('artifacts/fixed-commitment',{recursive:true});
  await page.locator('#fixed-commitment').scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/fixed-commitment/config-${width}.png`});
  await page.locator('#fc-results').scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/fixed-commitment/results-${width}.png`});
  expect(errors).toEqual([]);
});
test('fixed commitment save/reload, comparison and export preserve actual records',async({page})=>{
  await seed(page);const original=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).loans,PORTFOLIO_KEY);
  await run(page);await page.locator('#fc-name').fill('Maintain RM3,000');await page.locator('#fc-save').click();await expect(page.locator('#fc-status')).toContainText('configuration saved');
  await page.locator('#fc-mode').selectOption('custom');await page.locator('#fc-amount').fill('4000');await run(page);await page.locator('#fc-name').fill('Maintain RM4,000');await page.locator('#fc-save').click();
  await expect(page.locator('[data-fc-select]')).toHaveCount(2);for(const box of await page.locator('[data-fc-select]').all())await box.check();
  await page.locator('#fc-compare').click();await expect(page.locator('#fc-comparison tbody tr')).toHaveCount(3);await expect(page.locator('#fc-comparison')).toContainText('Current Payment Strategy');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).loans,PORTFOLIO_KEY)).toEqual(original);
  const download=page.waitForEvent('download');await page.locator('#fc-csv').click();expect((await download).suggestedFilename()).toBe('fixed-commitment-monthly.csv');
  await page.reload();await page.locator('[data-tab="strategies"]').click();await page.locator('#fc-saved-section>summary').click();await expect(page.locator('[data-fc-load]')).toHaveCount(2);
  await page.locator('[data-fc-load]').first().click();await expect(page.locator('#fc-amount')).toHaveValue('3000');await run(page);
  await page.locator('[data-fc-delete]').last().click();await expect(page.locator('[data-fc-select]')).toHaveCount(1);
});
test('fixed commitment validation protects required payments and clears stale results',async({page})=>{
  await seed(page);await run(page);await page.locator('#fc-mode').selectOption('custom');await expect(page.locator('#fc-results')).toBeEmpty();await page.locator('#fc-amount').fill('2000');await page.locator('#fc-run').click();
  await expect(page.locator('#fc-status')).toContainText('below the total required instalments');await expect(page.locator('#fc-status')).toContainText('Shortfall: RM 1000.00');await expect(page.locator('#fc-save-area')).toBeHidden();
  await page.locator('#fc-mode').selectOption('current');await run(page);await page.locator('#fc-cancel').click();await expect(page.locator('#fc-results')).toBeEmpty();await expect(page.locator('#fc-status')).toContainText('cancelled');
});
test('fixed commitment all strategy controls, dates and extras can be configured',async({page})=>{
  await seed(page);await page.locator('#fc-start').fill('2026-03');
  await page.locator('details:has(> summary:text("Rollover timing and existing extras"))>summary').click();await page.locator('#fc-timing').selectOption('next-payment');await page.locator('#fc-extras').uncheck();
  for(const strategy of ['highest-rate','lowest-balance','earliest-payoff','largest-balance','equal','proportional','priority','percentage']) {await page.locator('#fc-strategy').selectOption(strategy);await run(page);}
  await expect(page.locator('#fc-results')).toContainText('Existing regular extras paid in addition');await expect(page.locator('#fc-results')).toContainText('March 2026');
  await page.locator('[data-fc-percent="a"]').fill('1');await page.locator('#fc-run').click();await expect(page.locator('#fc-status')).toContainText('must total 100');
});
test('fixed commitment production assets and scenario worker run without console errors',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await seed(page,'/dist/index.html');await run(page);expect(errors).toEqual([]);
});
