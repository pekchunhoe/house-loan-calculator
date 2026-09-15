import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { createLoan, createPortfolio, PORTFOLIO_KEY } from '../src/storage.js';
import { defaults } from '../src/persistence.js';
const makePortfolio = () => {
  const a=createLoan({...defaults('2026-01-01'),principal:10000,normal:200,extra:0,flexi:5000,paymentDay:5},{id:'loan-a',name:'Family House',bank:'Maybank'});
  const b=createLoan({...defaults('2026-01-01'),principal:20000,normal:300,extra:0,rate:4.5,method:'monthly',paymentDay:20},{id:'loan-b',name:'City Apartment',bank:'Public Bank'},1);
  return {...createPortfolio(a),loans:[a,b]};
};
async function seed(page,p=makePortfolio()) {
  await page.addInitScript(({key,p})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(p));},{key:PORTFOLIO_KEY,p});
  await page.goto('/');await expect(page.locator('#p-count')).toHaveText('2');
}
const tab = (page,name) => page.locator(`[data-tab="${name}"]`).click();
const options = [[320,740],[360,800],[375,812],[390,844],[412,915],[430,932],[844,390],[768,1024],[1024,768],[1440,1000]];
for(const [width,height] of options) test(`portfolio layout ${width}×${height}`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setViewportSize({width,height});await seed(page);
  await expect(page.locator('#p-chart svg')).toBeVisible();
  await expect(page.locator('#p-metrics')).toContainText('RM 30,000.00');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await mkdir('artifacts/portfolio',{recursive:true});await page.screenshot({path:`artifacts/portfolio/dashboard-${width}.png`,fullPage:width===1440});
  await tab(page,'loans');await expect(page.locator('.mortgage-loan-card')).toHaveCount(2);
  if(width<600){const boxes=await page.locator('.mortgage-loan-card').evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));expect(boxes[1].y).toBeGreaterThan(boxes[0].y);expect(boxes[0].x).toBe(boxes[1].x);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await tab(page,'strategies');for(const s of await page.locator('.portfolio-simulator>summary').all())await s.click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#p-additional').fill('1000');await page.locator('[data-paction="compare"]').click();await expect(page.locator('#p-comparison')).toContainText('Highest-rate-first');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('individual loan edits preserve separate banks, methods, dates and saved state',async({page})=>{
  await seed(page);await tab(page,'loans');await page.locator('[data-edit="loan-a"]').click();
  await expect(page.locator('#loan-bank')).toHaveValue('Maybank');await page.locator('#principal').fill('12000');await page.locator('#loan-name').fill('Family Home');
  await page.locator('[data-paction="home"]').click();await tab(page,'loans');await page.locator('[data-edit="loan-b"]').click();
  await expect(page.locator('#principal')).toHaveValue('20000');await expect(page.locator('#method')).toHaveValue('monthly');await expect(page.locator('#paymentDay')).toHaveValue('20');await expect(page.locator('#loan-bank')).toHaveValue('Public Bank');
  await page.reload();await expect(page.locator('#p-count')).toHaveText('2');await tab(page,'loans');await page.locator('[data-edit="loan-a"]').click();
  await expect(page.locator('#principal')).toHaveValue('12000');await expect(page.locator('#loan-name')).toHaveValue('Family Home');
});
test('loan add, duplicate, archive, restore and confirmed delete',async({page})=>{
  await seed(page);await tab(page,'loans');await page.locator('[data-duplicate="loan-a"]').click();
  await expect(page.locator('#loan-name')).toHaveValue('Family House (copy)');await page.locator('#principal').fill('15000');
  await page.locator('[data-paction="home"]').click();await expect(page.locator('#p-count')).toHaveText('3');
  await tab(page,'loans');await page.locator('[data-archive="loan-a"]').click();await expect(page.locator('.mortgage-loan-card')).toHaveCount(2);
  await page.locator('#p-show-inactive').check();await expect(page.locator('.mortgage-loan-card')).toHaveCount(3);await page.locator('[data-archive="loan-a"]').click();
  await page.locator('[data-delete="loan-b"]').click();await expect(page.locator('#portfolio-dialog')).toBeVisible();await page.locator('[data-paction="cancel"]').click();await expect(page.locator('.mortgage-loan-card')).toHaveCount(3);
  await page.locator('[data-delete="loan-b"]').click();await page.locator('[data-paction="confirm"]').click();await expect(page.locator('.mortgage-loan-card')).toHaveCount(2);
  await page.locator('#portfolio-view [data-paction="add"]').click();await expect(page.locator('#loan-name')).toHaveValue('Housing Loan 3');
});
test('zero principal marks a loan settled, retains history, and excludes totals',async({page})=>{
  const p=makePortfolio();p.settings.custom={'loan-a':500,'loan-b':500};await seed(page,p);await tab(page,'loans');await page.locator('[data-edit="loan-a"]').click();await page.locator('#principal').fill('0');
  await expect(page.locator('#validation')).toContainText('Settled');await page.locator('[data-paction="home"]').click();await expect(page.locator('#p-count')).toHaveText('1');
  await expect(page.locator('#p-metrics')).toContainText('RM 20,000.00');await tab(page,'loans');await page.locator('#p-show-inactive').check();
  await page.locator('[data-edit="loan-a"]').click();await expect(page.locator('#loan-status')).toHaveValue('settled');await expect(page.locator('#loan-history')).toContainText('Retained loan history (1)');
  await page.locator('[data-paction="home"]').click();await tab(page,'strategies');await page.locator('[data-paction="compare"]').click();await expect(page.locator('#portfolio-status')).toContainText('Simulation complete');
});
test('legacy saved data migrates transparently and keeps single-loan experience',async({page})=>{
  const state={...defaults('2026-09-15'),principal:123456,flexi:17000,extra:777,paymentDay:28,rates:[{date:'2027-01-01',rate:4.5}]};
  const raw=JSON.stringify({version:1,state});
  await page.addInitScript(raw=>{if(!localStorage.getItem('flexi-mortgage-v1'))localStorage.setItem('flexi-mortgage-v1',raw);},raw);
  await page.goto('/');await expect(page.locator('#individual-view')).toBeVisible();await expect(page.locator('#portfolio-view')).toBeHidden();
  await expect(page.locator('#principal')).toHaveValue('123456');await expect(page.locator('#flexi')).toHaveValue('17000');await expect(page.locator('#extra')).toHaveValue('777');await expect(page.locator('#paymentDay')).toHaveValue('28');
  expect(await page.evaluate(()=>localStorage.getItem('flexi-mortgage-v1'))).toBe(raw);
  await page.locator('#extra').fill('800');await page.reload();await expect(page.locator('#extra')).toHaveValue('800');
});
test('all allocation strategies, rollover and target budget are interactive',async({page})=>{
  await seed(page);await tab(page,'strategies');await page.locator('#p-additional').fill('1000');
  await page.locator('#p-custom').locator('..').locator('summary').click();await page.locator('[data-custom="loan-a"]').fill('300');await page.locator('[data-custom="loan-b"]').fill('700');
  await page.locator('[data-paction="compare"]').click();await expect(page.locator('#p-comparison tbody tr')).toHaveCount(6);
  for(const key of ['highest-rate','lowest-balance','equal','proportional','custom']){await page.locator(`[data-comparison="${key}"]`).click();await expect(page.locator('#p-effects')).toContainText('Family House');await expect(page.locator('#p-effects')).toContainText('City Apartment');}
  await page.locator('#p-rollover').uncheck();await page.locator('[data-paction="compare"]').click();await expect(page.locator('#portfolio-status')).toContainText('Simulation complete');
  await page.locator('#p-target').fill('2028-12-31');await page.locator('#p-target-strategy').selectOption('equal');await page.locator('[data-paction="target"]').click();await expect(page.locator('#p-target-result')).toContainText('Required total monthly mortgage budget');
  await page.locator('[data-custom="loan-a"]').fill('2000');await page.locator('[data-paction="compare"]').click();await expect(page.locator('#portfolio-status')).toContainText('exceeds');
});
test('lump sum and rate previews are isolated until Apply Scenario',async({page})=>{
  await seed(page);await tab(page,'strategies');
  const before=await page.evaluate(key=>localStorage.getItem(key),PORTFOLIO_KEY);
  await page.locator('.portfolio-simulator:has(#p-lump-amount)>summary').click();await page.locator('#p-lump-amount').fill('1000');await page.locator('[data-paction="lump"]').click();
  await expect(page.locator('#p-lump-result')).toContainText('Preview only');expect(await page.evaluate(key=>localStorage.getItem(key),PORTFOLIO_KEY)).toBe(before);
  await page.locator('[data-apply-scenario="lump"]').click();await expect(page.locator('#toast')).toContainText('Scenario applied');
  const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),PORTFOLIO_KEY);expect(after.loans[0].config.lumps).toHaveLength(1);expect(after.loans[0].config.principal).toBe(10000);
  await page.locator('.portfolio-simulator:has(#p-rate-change)>summary').click();await page.locator('[data-paction="rate"]').click();await expect(page.locator('#p-rate-result')).toContainText('Scenario first payment interest');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).loans[0].config.rate,PORTFOLIO_KEY)).toBe(4.15);
  await page.locator('[data-apply-scenario="rate"]').click();expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).loans[0].config.rate,PORTFOLIO_KEY)).toBe(4.4);
});
test('flexi cash movement previews both loans and rejects unavailable funds',async({page})=>{
  await seed(page);await tab(page,'strategies');await page.locator('.portfolio-simulator:has(#p-flexi-from)>summary').click();
  await page.locator('#p-flexi-amount').fill('2000');await page.locator('[data-paction="flexi"]').click();await expect(page.locator('#p-flexi-result')).toContainText('Family House');await expect(page.locator('#p-flexi-result')).toContainText('City Apartment');
  await page.locator('#p-flexi-amount').fill('999999');await page.locator('[data-paction="flexi"]').click();await expect(page.locator('#portfolio-status')).toContainText('exceeds');
});
test('JSON backup restore requires confirmation and invalid files do not replace data',async({page})=>{
  await seed(page);await tab(page,'settings');const waiting=page.waitForEvent('download');await page.locator('[data-paction="backup"]').click();const download=await waiting;
  const raw=await readFile(await download.path(),'utf8');expect(JSON.parse(raw).loans).toHaveLength(2);
  const p=JSON.parse(raw);p.loans[0].name='Imported family loan';
  await page.locator('#p-import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await expect(page.locator('#portfolio-dialog')).toBeVisible();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).loans[0].name,PORTFOLIO_KEY)).toBe('Family House');await page.locator('[data-paction="confirm"]').click();await expect(page.locator('#p-count')).toHaveText('2');
  await tab(page,'loans');await expect(page.locator('#p-loan-cards')).toContainText('Imported family loan');await tab(page,'settings');
  await page.locator('#p-import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":99}')});await expect(page.locator('#portfolio-status')).toContainText('Unsupported');await expect(page.locator('#portfolio-dialog')).toBeHidden();
});
test('portfolio sorting, line toggles, yearly expansion, cashflow and property association',async({page})=>{
  await seed(page);await page.locator('[data-line="loan-a"]').uncheck();await expect(page.locator('#p-chart svg')).toBeVisible();await page.locator('#p-household').fill('100');await expect(page.locator('#p-cashflow')).toContainText('shortfall');
  await tab(page,'loans');await page.locator('#p-sort').selectOption('principal');await page.locator('#p-direction').selectOption('desc');await expect(page.locator('#p-loan-table tbody tr').first()).toContainText('City Apartment');
  await tab(page,'reports');await page.locator('.year-detail summary').first().click();await expect(page.locator('.year-detail').first()).toContainText('Family House');
  await tab(page,'settings');await page.locator('#p-property-name').fill('Shared Property');await page.locator('#p-property-type').fill('House');await page.locator('[data-paction="property"]').click();await expect(page.locator('#p-properties')).toContainText('Shared Property');
  await tab(page,'loans');await page.locator('[data-edit="loan-a"]').click();await page.locator('#loan-property').selectOption({label:'Shared Property'});
  await page.locator('.original-details summary').click();await page.locator('[data-original="amount"]').fill('999999');await expect(page.locator('#principal')).toHaveValue('10000');
});
test('portfolio CSV, copy summary and print report include individual details',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await seed(page);await tab(page,'reports');
  const waiting=page.waitForEvent('download');await page.locator('[data-paction="csv"]').click();const download=await waiting;expect(await readFile(await download.path(),'utf8')).toContain('Starting Portfolio Balance');
  await page.locator('[data-paction="copy"]').click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('Active loans: 2');
  await page.evaluate(()=>{window.print=()=>window.dispatchEvent(new Event('beforeprint'));});await page.locator('[data-paction="print"]').click();await page.emulateMedia({media:'print'});
  await expect(page.locator('#portfolio-print-report')).toBeVisible();await expect(page.locator('#portfolio-print-report')).toContainText('Individual Loan Details');await expect(page.locator('#portfolio-print-report')).toContainText('Maybank');await expect(page.locator('.portfolio-nav')).toBeHidden();
  await mkdir('artifacts/portfolio',{recursive:true});await page.pdf({path:'artifacts/portfolio/portfolio-report.pdf',format:'A4',printBackground:true});
});
test('changing scenario inputs invalidates a preview before it can be applied',async({page})=>{
  await seed(page);await tab(page,'strategies');await page.locator('.portfolio-simulator:has(#p-lump-amount)>summary').click();
  await page.locator('#p-lump-amount').fill('1000');await page.locator('[data-paction="lump"]').click();await expect(page.locator('[data-apply-scenario="lump"]')).toBeVisible();
  await page.locator('#p-lump-amount').fill('2000');await expect(page.locator('[data-apply-scenario="lump"]')).toHaveCount(0);await expect(page.locator('#p-lump-result')).toContainText('Inputs changed');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).loans[0].config.lumps.length,PORTFOLIO_KEY)).toBe(0);
});
