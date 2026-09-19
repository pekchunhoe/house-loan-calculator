import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/persistence.js';
import { createLoan, createPortfolio, exportBackup, importBackup, savePortfolio, loadPortfolio } from '../src/storage.js';
import { calculate } from '../src/engine.js';
import { simulateFixedCommitment as simulate, allocateFixed, compareFixedCommitments } from '../src/fixedCommitmentEngine.js';
import { fixedOptions } from '../src/fixedCommitmentModel.js';
import { defaultAssumptions } from '../src/calibrationModel.js';
import { saveStatement, saveProfile, lockStatement } from '../src/calibrationStore.js';
const loan=(id,config={})=>createLoan({...defaults('2026-01-01'),principal:10000,normal:1000,extra:0,rate:0,flexi:0,paymentDay:5,...config},{id,name:'Loan '+id});
const portfolio=(...loans)=>({...createPortfolio(loans[0]),loans});
const options=overrides=>fixedOptions({startMonth:'2026-01',...overrides});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const monthly=r=>r.rows.filter(row=>row.kind==='Monthly payment');
const run=(p,o={})=>simulate(p,options(o));
const cascade=()=>portfolio(loan('a',{principal:2000}),loan('b',{principal:6000}),loan('c',{principal:25000}));

test('fixed: constant total monthly commitment until final capped month',()=>{
  const r=run(portfolio(loan('a',{principal:2000}),loan('b',{principal:10200})));near(r.commitment,2000);
  for(const m of r.monthly.slice(0,-1))near(m.total,2000);near(r.monthly.at(-1).total,200);
});
test('fixed: first settlement rolls into next month',()=>{
  const r=run(cascade());near(r.allocations[2].amounts.b,2000);near(r.allocations[2].amounts.c,1000);
  assert.equal(r.results.a.payoff,'2026-02-05');
});
test('fixed: cascading release includes previously assigned rollover',()=>{
  const r=run(cascade());assert.equal(r.results.b.payoff,'2026-04-05');
  near(r.timeline.find(t=>t.type==='settled'&&t.loanId==='b').amount,2000);
  near(r.allocations.find(m=>m.month==='2026-05').amounts.c,3000);
});
test('fixed: final remaining loan receives full commitment',()=>{
  const r=run(cascade());for(const m of r.allocations.filter(m=>m.month>='2026-05'))near(m.amounts.c,3000);
});
test('fixed: final payment cap prevents negative balances and conserves principal',()=>{
  const r=run(portfolio(loan('a',{principal:3421.18})),{mode:'custom',commitment:8000});near(r.totalPayments,3421.18);near(r.results.a.finalPayment,3421.18);assert.ok(r.points.every(p=>p.total>=0));
});
test('fixed: start month and every earlier event are unchanged',()=>{
  const p=portfolio(loan('a',{rate:4,lumps:[{date:'2026-02-10',amount:100}]}),loan('b',{rate:5,paymentDay:20}));
  const r=run(p,{startMonth:'2026-05',mode:'custom',commitment:4000});
  for(const l of p.loans)assert.deepEqual(r.results[l.id].rows.filter(v=>v.date<'2026-05-01'),calculate(l.config).rows.filter(v=>v.date<'2026-05-01'));
  assert.equal(r.allocations[0].month,'2026-05');
});
test('fixed: loans settled before start are excluded from current commitment',()=>{
  const r=run(portfolio(loan('a',{principal:1000}),loan('b')),{startMonth:'2026-03'});near(r.commitment,1000);assert.equal(r.allocations[0].amounts.a,undefined);
});
test('fixed: following-month timing leaves partial payoff cash unspent',()=>{
  const r=run(portfolio(loan('a',{principal:500}),loan('b',{paymentDay:20})));
  near(r.monthly[0].total,1500);near(monthly(r.results.b)[0].payment,1000);near(monthly(r.results.b)[1].payment,2000);
});
test('fixed: next eligible payment date receives unused payoff cash',()=>{
  const r=run(portfolio(loan('a',{principal:500}),loan('b',{paymentDay:20})),{timing:'next-payment'});
  near(r.monthly[0].total,2000);near(monthly(r.results.b)[0].payment,1500);near(monthly(r.results.b)[1].payment,2000);
});
test('fixed: next-date transfers never reuse already-spent funds after a later lump',()=>{
  const r=run(portfolio(loan('a',{principal:2000,lumps:[{date:'2026-01-10',amount:1000}]}),loan('b',{paymentDay:20})),{timing:'next-payment'});
  near(r.monthly[0].total,2000);near(monthly(r.results.b)[0].payment,1000);
});
test('fixed: same-day bank payments do not fabricate later payment dates',()=>{
  const r=run(portfolio(loan('a',{principal:500}),loan('b')),{timing:'next-payment'});near(r.monthly[0].total,1500);assert.equal(r.timeline.some(t=>t.type==='transfer'),false);
});
const items=[{id:'a',rate:3,principal:200,payoff:'2028-01-01'},{id:'b',rate:5,principal:100,payoff:'2030-01-01'}];
for(const [strategy,expected,extra] of [
  ['highest-rate',{a:0,b:600}],['lowest-balance',{a:0,b:600}],['equal',{a:300,b:300}],['proportional',{a:400,b:200}],
  ['priority',{a:600,b:0},{priority:['a','b']}],['percentage',{a:450,b:150},{percentages:{a:75,b:25}}],
  ['earliest-payoff',{a:600,b:0}],['largest-balance',{a:600,b:0}]
])test(`fixed: ${strategy} allocation`,()=>assert.deepEqual(allocateFixed(items,600,{strategy,...extra}),expected));
test('fixed: custom percentage shares renormalize after settlement',()=>{
  const r=run(portfolio(loan('a',{principal:1000}),loan('b'),loan('c')),{mode:'custom',commitment:6000,strategy:'percentage',percentages:{a:50,b:30,c:20}});
  near(r.allocations[1].amounts.b,3400);near(r.allocations[1].amounts.c,2600);
});
test('fixed: rate changes update highest-rate priority next allocation period',()=>{
  const r=run(portfolio(loan('a',{rate:3,rates:[{date:'2026-01-15',rate:6}]}),loan('b',{rate:5})),{mode:'custom',commitment:3000});
  near(r.allocations[0].amounts.b,2000);near(r.allocations[1].amounts.a,2000);
});
test('fixed: multiple loans settling together release all allocations once',()=>{
  const r=run(portfolio(loan('a',{principal:1000}),loan('b',{principal:1000}),loan('c')));near(r.allocations[1].amounts.c,3000);near(r.totalPayments,12000);
});
test('fixed: different payment dates remain on each loan schedule',()=>{
  const r=run(portfolio(loan('a',{paymentDay:5}),loan('b',{paymentDay:28})));assert.ok(monthly(r.results.a).every(m=>m.date.endsWith('-05')));assert.ok(monthly(r.results.b).every(m=>m.date.endsWith('-28')));
});
test('fixed: mixed daily/monthly loans equal original independent engines with unchanged payments',()=>{
  const p=portfolio(loan('a',{principal:20000,rate:4.1,method:'daily',paymentDay:5}),loan('b',{principal:20000,rate:4.1,method:'monthly',paymentDay:20}));
  const r=run(p,{startMonth:'2027-01'});
  for(const l of p.loans)assert.deepEqual(r.results[l.id].rows.slice(0,12),calculate(l.config).rows.slice(0,12));
  near(r.interest,Object.values(r.results).reduce((s,l)=>s+l.interestPaid,0));
});
test('fixed: flexi balances, deposits, withdrawals and non-flexi rules remain engine-owned',()=>{
  for(const offset of [true,false]){
    const l=loan('a',{rate:4,extra:100,flexi:3000,offset,transactions:[{date:'2026-02-10',type:'deposit',amount:1000},{date:'2026-03-10',type:'withdrawal',amount:500}]});
    const r=run(portfolio(l));assert.deepEqual(r.results.a,calculate(l.config,{allowFuturePayments:true}));near(r.commitment,1100);
  }
});
test('fixed: one-off lumps remain outside recurring commitment',()=>{
  const r=run(portfolio(loan('a',{principal:50000,lumps:[{date:'2026-03-10',amount:5000}]}),loan('b',{principal:50000})));
  const march=r.monthly.find(m=>m.month==='2026-03');near(march.total,2000);near(march.lump,5000);
});
test('fixed: existing recurring extras are included and preserved by default',()=>{
  const r=run(portfolio(loan('a',{extra:200}),loan('b',{extra:300})));near(r.commitment,2500);near(r.monthly[0].amounts.a,1200);near(r.monthly[0].amounts.b,1300);
});
test('fixed: excluded extras are additional spending and not released into budget',()=>{
  const r=run(portfolio(loan('a',{principal:1200,extra:200}),loan('b',{extra:300})),{includeExtras:false});near(r.commitment,2000);near(r.monthly[0].total,2500);near(r.monthly[1].amounts.b,2300);
});
test('fixed: insufficient commitment rejects with required, selected and shortfall',()=>{
  assert.throws(()=>run(portfolio(loan('a'),loan('b')),{mode:'custom',commitment:1500}),/Required: RM 2000.00.*Selected: RM 1500.00.*Shortfall: RM 500.00/);
});
test('fixed: zero extra allocation protects all required instalments',()=>{
  const r=run(portfolio(loan('a',{extra:500}),loan('b',{extra:500})),{mode:'custom',commitment:2000});near(r.monthly[0].amounts.a,1000);near(r.monthly[0].amounts.b,1000);
});
test('fixed: monthly one-off overrides remain exceptions without retroactive edits',()=>{
  const l=loan('a',{extra:100,variables:[{month:'2026-02',normal:1000,extra:500}]});const r=run(portfolio(l));near(r.monthly[0].total,1100);near(r.monthly[1].total,1500);near(r.monthly[2].total,1100);
});
test('fixed: hypothetical simulation never mutates loan or calibration state',()=>{
  const p=cascade();p.loans[0].notes='Keep this';const before=JSON.stringify(p);run(p);compareFixedCommitments(p,[{id:'s',name:'Test',options:options()}]);assert.equal(JSON.stringify(p),before);
});
test('fixed: scenario configuration save/reload and JSON backup preserve legacy state',()=>{
  const p=cascade();p.fixedCommitmentScenarios=[{id:'s',name:'Maintain budget',options:options({commitment:3000,mode:'custom'})}];
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};assert.ok(savePortfolio(p,storage));assert.deepEqual(loadPortfolio(storage).portfolio,p);assert.deepEqual(importBackup(exportBackup(p)),p);
});
test('fixed: scenario comparison includes baseline, multiple results and independent errors',()=>{
  const p=cascade(),scenarios=[{id:'s1',name:'First',options:options()},{id:'s2',name:'Second',options:options({mode:'custom',commitment:4000})},{id:'s3',name:'Invalid',options:options({mode:'custom',commitment:1})}];
  const r=compareFixedCommitments(p,scenarios);assert.equal(r.length,4);assert.equal(r[0].id,'current');assert.ok(r[2].result.payoff<r[1].result.payoff);assert.match(r[3].error,/below/);
});
test('fixed: deterministic portfolio payoff and interest reconcile across independent loans',()=>{
  const p=portfolio(loan('a',{principal:20000,rate:4}),loan('b',{principal:60000,rate:5,method:'monthly'}));const r=run(p);
  assert.equal(r.payoff,Object.values(r.results).map(l=>l.payoff).sort().at(-1));assert.ok(r.payoff<r.current.payoff);assert.ok(r.difference.interest>0);near(r.totalPayments,r.principal+r.interest);near(r.interest,Object.values(r.results).reduce((s,l)=>s+l.interestPaid,0));
});
test('fixed: ten mortgages cascade without reallocating to settled loans',()=>{
  const r=run(portfolio(...Array.from({length:10},(_,i)=>loan(String(i),{principal:(i+1)*1000}))));
  for(const a of r.allocations)for(const [id,n] of Object.entries(a.amounts))if(n>0)assert.ok(r.results[id].payoff.slice(0,7)>=a.month);near(r.totalPayments,55000);
});
test('fixed: future loan required payments cannot silently underfund a locked commitment',()=>{
  const p=portfolio(loan('a'),loan('b',{start:'2026-03-01'}));assert.throws(()=>run(p),/Month: 2026-03.*below|below.*Month: 2026-03/);
});
test('fixed: invalid scenario backups reject safely',()=>{
  const p=cascade();p.fixedCommitmentScenarios=[{id:'s',name:'Bad',options:options({timing:'today'})}];assert.throws(()=>importBackup(JSON.stringify(p)),/timing/);
});
test('fixed: historical statements, locked results, profiles and bank assumptions remain unchanged',()=>{
  const p=cascade(),l=p.loans[0],a=defaultAssumptions(l.config);
  saveProfile(l,'Original assumptions',a);
  const record=saveStatement(l,{start:'2026-01-01',end:'2026-01-31',opening:2000,closing:1000,interest:0,payment:1000,paymentDate:'2026-01-05',rate:0,transactions:[],rates:[]},a);
  lockStatement(l,record.id,true);const before=structuredClone(p);run(p);assert.deepEqual(p,before);
});
test('fixed: calibrated end-of-day month-boundary payments retain engine convention',()=>{
  const c={rate:4,paymentDay:31,extra:100,calculationAssumptions:{...defaultAssumptions(),timing:'end',dayCount:'Actual/360'}};
  const l=loan('a',c),r=run(portfolio(l));assert.deepEqual(r.results.a,calculate(l.config,{allowFuturePayments:true}));assert.equal(monthly(r.results.a)[0].date,'2026-02-01');
});
test('fixed: next-date unused cash cascades across several later payment dates',()=>{
  const r=run(portfolio(loan('a',{principal:100,paymentDay:5}),loan('b',{principal:200,paymentDay:10}),loan('c',{paymentDay:20})),{timing:'next-payment'});
  near(r.monthly[0].amounts.c,2700);near(r.monthly[0].total,3000);assert.equal(r.timeline.filter(t=>t.type==='transfer').length,2);
});
test('fixed: malformed percentages, dates and amounts reject before simulation',()=>{
  const p=cascade();for(const o of [{startMonth:'2026-13'},{commitment:''},{commitment:-1},{strategy:'percentage',percentages:{a:50}}])assert.throws(()=>run(p,o));
});
