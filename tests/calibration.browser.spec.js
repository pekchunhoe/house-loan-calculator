import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { createLoan, createPortfolio, PORTFOLIO_KEY } from '../src/storage.js';
import { defaults } from '../src/persistence.js';
import { CSV_FIELDS } from '../src/calibrationExport.js';
const action=(page,name)=>page.locator(`[data-caction="${name}"]`);
async function enter(page) {
  await page.goto('/');await page.locator('[data-calibrate-current]').click();
  for(const [key,value] of Object.entries({start:'2026-08-01',end:'2026-08-31',opening:'100000',closing:'99000',interest:'310',payment:'1310',rate:'3.65'}))await page.locator(`#cal-${key}`).fill(value);
}
async function advanced(page) {await page.locator('#cal-advanced').check();await page.locator('#cal-paymentDate').fill('2026-08-31');await page.locator('#cal-timing').selectOption('end');}
async function saved(page) {await enter(page);await advanced(page);await action(page,'save').click();await expect(page.locator('#cal-message')).toHaveText('Statement saved locally.');}
const sizes=[[320,740],[360,800],[375,812],[390,844],[412,915],[430,932],[844,390],[768,1024],[1024,768],[1440,1000]];
for(const [width,height] of sizes)test(`calibration complete phone/tablet/desktop workflow ${width}x${height}`,async({page})=>{
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5173')&&!r.url().startsWith('data:'))external.push(r.url());});
  await page.setViewportSize({width,height});await enter(page);
  await action(page,'run').click();await expect(page.locator('#cal-result')).toContainText('Missing payment dates');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await advanced(page);await action(page,'save').click();await expect(page.locator('#cal-result')).toContainText('Unexplained Residual: RM 0.00');
  await page.locator('#cal-trace summary').click();await expect(page.locator('#cal-trace-body tbody tr')).toHaveCount(31);
  await action(page,'compare').click();await expect(page.locator('#cal-comparisons')).toContainText('Closest Tested Match');await expect(page.locator('#cal-comparisons')).toContainText('It does not prove');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await action(page,'add-transaction').click();await expect(page.locator('[data-crow="transactions"]')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(width<600)expect(await page.locator('#cal-opening').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await mkdir('artifacts/calibration',{recursive:true});await page.screenshot({path:`artifacts/calibration/workflow-${width}.png`,fullPage:width===1440});
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
test('calibration locked statements survive reload and allow comparison and explicit unlock',async({page})=>{
  await saved(page);await action(page,'lock').click();await expect(page.locator('#cal-opening')).toBeDisabled();await action(page,'run').click();await expect(page.locator('#cal-result')).toContainText('RM 310.00');
  await page.reload();await page.locator('[data-calibrate-current]').click();await action(page,'view').click();await expect(page.locator('#cal-opening')).toBeDisabled();
  await action(page,'lock').click();await expect(page.locator('#cal-opening')).toBeEnabled();await expect(page.locator('#cal-opening')).toHaveValue('100000');
});
test('calibration multiple periods, assumptions, monthly trace, profiles and explicit apply dialog',async({page})=>{
  await saved(page);await action(page,'new').click();
  for(const [k,v] of Object.entries({start:'2026-09-01',end:'2026-09-30',opening:'99000',closing:'99000',interest:'297',payment:'0',rate:'3.65'}))await page.locator(`#cal-${k}`).fill(v);
  await action(page,'save').click();await action(page,'periods').click();await expect(page.locator('#cal-comparisons tbody tr')).toHaveCount(1);await expect(page.locator('#cal-comparisons tbody tr td').nth(1)).toHaveText('2');
  await page.locator('#cal-basis').selectOption('monthly');await page.locator('#cal-rate').fill('6');await action(page,'run').click();await page.locator('#cal-trace summary').click();await expect(page.locator('#cal-trace')).toContainText('Monthly breakdown');await expect(page.locator('#cal-trace-body')).toContainText('Segment Interest');
  await page.locator('#cal-profile-name').fill('Monthly tested');await action(page,'profile-save').click();await action(page,'profile-duplicate').click();await action(page,'profile-revert').click();await expect(page.locator('#cal-profile option')).toHaveCount(3);
  const original=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).loans[0].config,PORTFOLIO_KEY);expect(original.method).toBe('daily');
  await action(page,'profile-apply').click();await expect(page.locator('#calibration-dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#calibration-dialog')).toBeHidden();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).loans[0].config.method,PORTFOLIO_KEY)).toBe('daily');
  await action(page,'profile-apply').click();await page.locator('[data-cconfirm]').click();await expect(page.locator('#cal-message')).toHaveText('Profile applied to the saved loan.');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).loans[0].config.method,PORTFOLIO_KEY)).toBe('monthly');
});
test('calibration CSV/JSON preview imports, copy summary and print report are usable',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await saved(page);
  const download=async type=>{const waiting=page.waitForEvent('download');await action(page,type).click();return readFile(await (await waiting).path(),'utf8');};
  const csv=await download('csv'),json=await download('json');expect(csv).toContain('reconciliation_residual');expect(JSON.parse(json).loans[0].calibrationRecords).toHaveLength(1);
  await action(page,'copy').click();await expect(page.locator('#cal-message')).toHaveText('Calibration summary copied.');expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('Actual Interest: RM 310.00');
  await page.locator('#cal-import').setInputFiles({name:'statements.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await expect(page.locator('#cal-preview')).toContainText('All rows validated');await expect(page.locator('.cal-record')).toHaveCount(1);await action(page,'import-confirm').click();await expect(page.locator('.cal-record')).toHaveCount(2);
  await page.locator('#cal-import').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(json)});await expect(page.locator('#cal-preview')).toContainText('will be replaced');await action(page,'import-confirm').click();await expect(page.locator('.cal-record')).toHaveCount(1);
  await action(page,'view').click();await page.evaluate(()=>{window.print=()=>window.dispatchEvent(new Event('beforeprint'));});await action(page,'print').click();await page.emulateMedia({media:'print'});
  await expect(page.locator('.page')).toBeHidden();await expect(page.locator('#calibration-print-report')).toBeVisible();await expect(page.locator('#calibration-print-report')).toContainText('Balance Reconciliation');await expect(page.locator('#calibration-print-report')).toContainText('inclusive');
  await mkdir('artifacts/calibration',{recursive:true});await page.screenshot({path:'artifacts/calibration/print.png'});await page.pdf({path:'artifacts/calibration/report.pdf',format:'A4',printBackground:true});expect((await readFile('artifacts/calibration/report.pdf')).length).toBeGreaterThan(10000);
});
test('calibration CSV rejects every row when one is invalid and leaves saved statements intact',async({page})=>{
  await saved(page);const id=await page.locator('#cal-loan').inputValue();const row=[id,'2026-08-01','2026-08-31',100000,100000,310,0,0,0,0,3.65,''].join(',');const bad=[CSV_FIELDS.join(','),row,row.replace('100000','-1')].join('\n');
  await page.locator('#cal-import').setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from(bad)});await expect(page.locator('#cal-message')).toContainText('Row 3');await expect(page.locator('.cal-record')).toHaveCount(1);await expect(action(page,'import-confirm')).toHaveCount(0);
});
test('calibration per-loan entry, dashboard filter and independent records',async({page})=>{
  const l=createLoan({...defaults(),principal:100000},{id:'first',name:'First Loan'}),p=createPortfolio(l);p.loans.push(createLoan(defaults(),{id:'second',name:'Second Loan'}));
  await page.addInitScript(({p,key})=>localStorage.setItem(key,JSON.stringify(p)),{p,key:PORTFOLIO_KEY});await page.goto('/');await page.locator('[data-tab="loans"]').click();await expect(page.locator('[data-calibrate]')).toHaveCount(2);await page.locator('[data-calibrate="second"]').click();await expect(page.locator('#cal-loan')).toHaveValue('second');
  for(const [k,v] of Object.entries({start:'2026-08-01',end:'2026-08-31',opening:'100000',closing:'100000',interest:'310',payment:'0',rate:'3.65'}))await page.locator(`#cal-${k}`).fill(v);await action(page,'save').click();await page.locator('#cal-filter').check();
  await expect(action(page,'choose')).toHaveCount(1);await expect(action(page,'choose')).toHaveText('First Loan');await page.locator('#cal-loan').selectOption('first');await expect(page.locator('.cal-record')).toHaveCount(0);
});
test('calibration advanced transaction types and rate rows persist, with threshold updates',async({page})=>{
  await enter(page);await advanced(page);
  const rows=[['normal',1310],['extra',100],['lump',200],['deposit',5000],['withdrawal',2000],['interest',310],['fee',10],['adjustment',-5],['other',1]];
  for(const [i,[type,amount]] of rows.entries()){
    await action(page,'add-transaction').click();const row=page.locator('[data-crow="transactions"]').nth(i);
    await row.locator('[data-cprop="date"]').fill('2026-08-16');await row.locator('[data-cprop="type"]').selectOption(type);await row.locator('[data-cprop="amount"]').fill(String(amount));
  }
  await action(page,'add-rate').click();await page.locator('[data-crow="rates"] [data-cprop="date"]').fill('2026-08-20');await page.locator('[data-crow="rates"] [data-cprop="rate"]').fill('4.25');
  await action(page,'save').click();await expect(page.locator('#cal-result')).toContainText('their total differs');await expect(page.locator('#cal-result')).toContainText('fees/adjustments');
  await page.locator('[data-cthreshold="closeAmount"]').fill('3');await action(page,'thresholds').click();await expect(page.locator('#cal-message')).toHaveText('Match thresholds saved.');
  await page.reload();await page.locator('[data-calibrate-current]').click();await action(page,'view').click();await page.locator('#cal-advanced').check();
  await expect(page.locator('[data-crow="transactions"]')).toHaveCount(9);await expect(page.locator('[data-crow="rates"] [data-cprop="rate"]')).toHaveValue('4.25');await expect(page.locator('[data-cthreshold="closeAmount"]')).toHaveValue('3');
});
test('production build serves calibration and engine modules without missing resources',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto('/dist/index.html');await expect(page.locator('#balance-chart svg')).toBeVisible();await page.locator('[data-calibrate-current]').click();await expect(page.locator('#cal-opening')).toBeVisible();
  for(const [k,v] of Object.entries({start:'2026-08-01',end:'2026-08-31',opening:'100000',closing:'100000',interest:'310',payment:'0',rate:'3.65'}))await page.locator(`#cal-${k}`).fill(v);
  await action(page,'run').click();await expect(page.locator('#cal-result')).toContainText('RM 310.00');expect(errors).toEqual([]);
});
