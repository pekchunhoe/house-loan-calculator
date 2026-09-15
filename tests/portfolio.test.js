import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { defaults } from '../src/persistence.js';
import { calculate } from '../src/engine.js';
import { createLoan, createPortfolio, activeLoans, validatePortfolio, migrateLegacy, loadPortfolio, savePortfolio, exportBackup, importBackup, PORTFOLIO_KEY } from '../src/storage.js';
import { calculatePortfolio, simulateStrategy } from '../src/portfolioEngine.js';
import { allocate, validateAllocation } from '../src/allocationEngine.js';
import { compareStrategies, lumpScenario, flexiScenario, rateScenario } from '../src/strategyEngine.js';
import { solvePortfolioTarget } from '../src/targetSolver.js';
import { portfolioCSV, portfolioSummary } from '../src/portfolioExport.js';
const loan = (id, config = {}) => createLoan({ ...defaults('2026-01-01'), extra: 0, ...config }, { id, name: `Loan ${id}`, bank: id === 'a' ? 'Maybank' : 'Public Bank' });
const portfolio = (...loans) => ({ ...createPortfolio(loans[0]), loans });
const near = (a,b,tolerance=1e-6) => assert.ok(Math.abs(a-b)<tolerance,`${a} should equal ${b}`);
const monthly = result => result.rows.filter(r=>r.kind==='Monthly payment');
const pair = () => portfolio(loan('a',{principal:100000,rate:3.65,method:'daily',paymentDay:1}),loan('b',{principal:180000,rate:6,method:'monthly',paymentDay:20}));

test('two loans retain different banks, rates, payment dates and methods',()=>{
  const p=pair(),r=calculatePortfolio(p);
  near(r.results.a.rows[0].interest,310); near(r.results.b.rows[0].interest,180000*.06/12*19/31);
  assert.equal(r.results.a.rows[0].date,'2026-02-01'); assert.equal(r.results.b.rows[0].date,'2026-01-20');
  assert.equal(p.loans[0].bank,'Maybank');assert.equal(p.loans[1].bank,'Public Bank');
});
test('three balances aggregate only after independently calculating each schedule',()=>{
  const p=portfolio(loan('a',{principal:300000,rate:4.05}),loan('b',{principal:180000,rate:4.35}),loan('c',{principal:95000,rate:3.95}));
  const r=calculatePortfolio(p); near(r.principal,575000); near(r.interest,p.loans.reduce((n,l)=>n+calculate(l.config).interestPaid,0));
  assert.equal(r.payoff,p.loans.map(l=>calculate(l.config).payoff).sort().at(-1));
  near(r.weightedRate,(300000*4.05+180000*4.35+95000*3.95)/575000);
});
test('portfolio totals preserve independent flexi offsets and each zero floor',()=>{
  const p=portfolio(loan('a',{principal:10000,flexi:50000,method:'monthly'}),loan('b',{principal:100000,flexi:10000,offset:false,method:'monthly'}));
  const r=calculatePortfolio(p);near(r.flexi,60000);near(r.effective,100000);near(r.results.a.interestPaid,0);near(r.results.b.rows[0].interest,100000*.0415/12);
});
test('independent rate-change histories are never merged',()=>{
  const p=portfolio(loan('a',{principal:100000,rate:3.65,rates:[{date:'2026-01-16',rate:7.3}]}),loan('b',{principal:100000,rate:3.65}));
  const r=calculatePortfolio(p);near(monthly(r.results.a)[0].interest,470);near(monthly(r.results.b)[0].interest,310);
});
test('no-extra no-rollover event orchestration matches original schedules exactly',()=>{
  const p=pair();p.loans[0].config.transactions=[{date:'2026-03-17',type:'deposit',amount:2000}];
  const a=calculatePortfolio(p),b=simulateStrategy(p,{budget:0,rollover:false});
  assert.deepEqual(a.results,b.results); near(a.interest,b.interest);assert.equal(a.payoff,b.payoff);
});
test('highest-rate-first allocation uses the highest current rate',()=>{
  assert.deepEqual(allocate([{id:'a',principal:100,rate:3},{id:'b',principal:200,rate:5}],600,'highest-rate'),{a:0,b:600});
});
test('lowest-balance-first allocation uses the smallest current balance',()=>{
  assert.deepEqual(allocate([{id:'a',principal:100,rate:3},{id:'b',principal:200,rate:5}],600,'lowest-balance'),{a:600,b:0});
});
test('equal allocation conserves the budget',()=>{
  const a=allocate([{id:'a'},{id:'b'},{id:'c'}],100,'equal');near(Object.values(a).reduce((a,b)=>a+b,0),100);near(a.a,100/3);
});
test('proportional allocation follows independent outstanding principal',()=>{
  assert.deepEqual(allocate([{id:'a',principal:300},{id:'b',principal:100}],2000,'proportional'),{a:1500,b:500});
});
test('custom allocation validates spending and preserves unused budget',()=>{
  const p=pair(); const r=simulateStrategy(p,{budget:2000,strategy:'custom',custom:{a:500,b:1000}});
  near(r.allocations[0].budget,1500); // Loan a first payment is in February, so January funds go to b.
  assert.throws(()=>validateAllocation(p.loans,100,{a:101}),/exceeds/);assert.throws(()=>validateAllocation(p.loans,100,{a:-1}),/non-negative/);
  assert.throws(()=>validateAllocation(p.loans,100,{missing:1}),/active/);
});
test('rollover is available next month and preserves different payment days',()=>{
  const p=portfolio(loan('a',{principal:100,rate:0,normal:100,paymentDay:5}),loan('b',{principal:300,rate:0,normal:100,paymentDay:20}));
  const off=simulateStrategy(p,{budget:0,rollover:false}),on=simulateStrategy(p,{budget:0,rollover:true});
  assert.equal(off.payoff,'2026-03-20');assert.equal(on.payoff,'2026-02-20');
  near(monthly(on.results.b)[0].payment,100);near(monthly(on.results.b)[1].payment,200);near(on.totalPayments,400);
  near(on.allocations.find(a=>a.month==='2026-02').released,100);
});
test('multiple settlements release each configured payment exactly once',()=>{
  const p=portfolio(loan('a',{principal:100,rate:0,normal:100,paymentDay:5}),loan('b',{principal:100,rate:0,normal:100,paymentDay:10}),loan('c',{principal:500,rate:0,normal:100,paymentDay:20}));
  const r=simulateStrategy(p,{rollover:true}); near(r.allocations.find(a=>a.month==='2026-02').released,200);assert.equal(r.payoff,'2026-03-20');near(r.totalPayments,700);
});
test('rollover includes fixed extra, excludes allocation to avoid double counting',()=>{
  const p=portfolio(loan('a',{principal:100,rate:0,normal:100,extra:50,paymentDay:5}),loan('b',{principal:1000,rate:0,normal:100,paymentDay:20}));
  const r=simulateStrategy(p,{budget:200,rollover:true,strategy:'lowest-balance'});
  const feb=r.allocations.find(a=>a.month==='2026-02');near(feb.released,150);near(feb.budget,350);
});
test('a low-payment loan can remain open until another loan releases funds',()=>{
  const p=portfolio(loan('a',{principal:3000,rate:0,normal:100}),loan('b',{principal:1000,rate:1,normal:0}));
  const r=simulateStrategy(p,{rollover:true});assert.equal(r.allPaid,true);assert.ok(r.results.b.monthlyCount>30);
});
test('new strategy money adds to monthly variable overrides without replacing them',()=>{
  const p=portfolio(loan('a',{principal:10000,rate:0,normal:100,variables:[{month:'2026-02',normal:200,extra:50}]}));
  const r=simulateStrategy(p,{budget:100});near(monthly(r.results.a)[0].payment,350);near(monthly(r.results.a)[1].payment,200);
});
test('settled and archived loans do not enter future totals or receive allocations',()=>{
  const p=pair();p.loans[0].config.principal=0;p.loans[0].status='settled';p.loans.push({...loan('c'),status:'archived'});
  const r=calculatePortfolio(p);assert.equal(r.activeCount,1);near(r.principal,180000);assert.deepEqual(Object.keys(r.results),['b']);
  assert.throws(()=>simulateStrategy(p,{budget:100,strategy:'custom',custom:{a:100}}),/active/);
});
test('empty portfolio has zero totals and no fabricated settlement',()=>{
  const p=pair();p.loans=[];const r=calculatePortfolio(p);near(r.principal,0);near(r.interest,0);assert.equal(r.payoff,null);assert.equal(r.activeCount,0);
});
test('portfolio graph values equal the sum of balances at every event date',()=>{
  const r=calculatePortfolio(pair());for(const point of r.points)near(point.total,Object.values(point.balances).reduce((n,v)=>n+v,0));
  near(r.points.at(-1).total,0);
});
test('different start dates preserve entered snapshots before their own start',()=>{
  const p=portfolio(loan('a',{principal:1000,normal:100,rate:0}),loan('b',{principal:1000,normal:100,rate:0,start:'2027-01-01'}));
  const r=calculatePortfolio(p); assert.ok(r.points.filter(v=>v.date<'2027-01-01').every(v=>v.balances.b===1000));
});
test('yearly portfolio sums and individual contributions reconcile',()=>{
  const r=calculatePortfolio(pair());near(r.years.reduce((n,y)=>n+y.interest,0),r.interest);
  for(const y of r.years){near(y.starting-y.principalPaid,y.ending);near(y.payment,Object.values(y.loans).reduce((n,l)=>n+l.payment,0));}
});
test('lump sum single/equal/proportional/custom scenarios preserve the saved portfolio',()=>{
  const p=pair(),before=JSON.stringify(p);
  for(const strategy of ['single','equal','proportional','custom','highest-rate','lowest-balance']){
    const r=lumpScenario(p,{amount:50000,date:'2026-01-01',strategy,loanId:'a',custom:{a:10000,b:40000}});
    assert.ok(r.result.interest<calculatePortfolio(p).interest);assert.equal(JSON.stringify(p),before);
  }
  assert.throws(()=>lumpScenario(p,{amount:100,date:'2026-01-01',strategy:'custom',custom:{a:101}}),/exceeds/);
});
test('priority lump sum spills across loans without negative balances',()=>{
  const p=portfolio(loan('a',{principal:100,rate:5}),loan('b',{principal:200,rate:4}));
  const r=lumpScenario(p,{amount:1000,date:'2026-01-01',strategy:'highest-rate'});near(r.amounts.a,100);near(r.amounts.b,200);near(r.result.totalPayments,300);
});
test('parked lump sums stay in selected flexi accounts, never become principal payments',()=>{
  const p=pair();const r=lumpScenario(p,{amount:50000,date:'2026-01-01',strategy:'equal',park:true,selectedIds:['a']});
  near(r.result.results.a.flexi,50000);near(r.result.results.b.flexi,0);near(r.result.results.a.principalPaid,100000);near(r.result.results.a.rows[0].payment,0);
});
test('flexi transfer preserves total cash, independently affects both loans, and is isolated',()=>{
  const p=pair();p.loans[0].config.flexi=50000;const before=JSON.stringify(p),base=calculatePortfolio(p);
  const r=flexiScenario(p,{from:'a',to:'b',amount:20000,date:'2026-01-01'});
  assert.equal(JSON.stringify(p),before);near(r.result.results.a.flexi,30000);near(r.result.results.b.flexi,20000);
  assert.ok(r.result.results.a.interestPaid>base.results.a.interestPaid);assert.ok(r.result.results.b.interestPaid<base.results.b.interestPaid);
  assert.throws(()=>flexiScenario(p,{from:'a',to:'b',amount:60000,date:'2026-01-01'}),/exceeds/);
});
test('flexi transfer cannot spend a parked lump sum posted later on the same day',()=>{
  const p=pair();p.loans[0].config.lumps=[{date:'2026-01-16',amount:10000,park:true}];
  assert.throws(()=>flexiScenario(p,{from:'a',to:'b',amount:10000,date:'2026-01-16'}),/exceeds/);
});
test('rate shocks shift each rate schedule independently without mutating saved rates',()=>{
  const p=pair();p.loans[0].config.rates=[{date:'2027-01-01',rate:4}];const before=JSON.stringify(p);
  const r=rateScenario(p,{change:.5});near(r.portfolio.loans[0].config.rate,4.15);near(r.portfolio.loans[0].config.rates[0].rate,4.5);
  assert.ok(r.result.interest>calculatePortfolio(p).interest);assert.equal(JSON.stringify(p),before);assert.ok(r.firstInterest.a>310);
  const custom=rateScenario(p,{custom:{a:-.25,b:1}});near(custom.portfolio.loans[1].config.rate,7);
  assert.throws(()=>rateScenario(p,{change:-10}),/between/);
});
test('target portfolio solver matches a two-loan zero-interest formula',()=>{
  const p=portfolio(loan('a',{principal:1000,rate:0,normal:100}),loan('b',{principal:1000,rate:0,normal:100}));
  const r=solvePortfolioTarget(p,'2026-06-01',{strategy:'equal',rollover:false});near(r.current,200);near(r.additional,200);near(r.required,400);
  assert.equal(simulateStrategy(p,{budget:r.additional,strategy:'equal',endDate:'2026-06-01'}).allPaid,true);
  assert.equal(simulateStrategy(p,{budget:r.additional-.01,strategy:'equal',endDate:'2026-06-01'}).allPaid,false);
});
test('target portfolio solving handles mixed methods, dates, offsets and rate changes',()=>{
  const p=pair();p.loans[0].config.flexi=20000;p.loans[1].config.rates=[{date:'2028-02-16',rate:6.5}];
  const r=solvePortfolioTarget(p,'2031-07-25',{strategy:'equal',rollover:true});
  assert.equal(simulateStrategy(p,{budget:r.additional,strategy:'equal',rollover:true,endDate:'2031-07-25'}).allPaid,true);
  assert.equal(simulateStrategy(p,{budget:r.additional-.01,strategy:'equal',rollover:true,endDate:'2031-07-25'}).allPaid,false);
});
test('target dates reject impossibilities instead of returning fictional amounts',()=>{
  assert.throws(()=>solvePortfolioTarget(pair(),'2025-01-01'),/Target/);
  assert.throws(()=>solvePortfolioTarget(pair(),'2026-01-10',{strategy:'equal'}),/payment date/);
});
test('legacy migration preserves all calculation fields and original data remains stored',()=>{
  const state={...defaults('2026-09-15'),flexi:40000,variables:[{month:'2027-01',normal:2200,extra:900}],lumps:[{date:'2027-02-01',amount:10000,park:true}],rates:[{date:'2028-01-01',rate:4.35}],transactions:[{date:'2027-03-01',type:'withdrawal',amount:2000}]};
  const raw=JSON.stringify({version:1,state}),map=new Map([['flexi-mortgage-v1',raw]]),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
  const loaded=loadPortfolio(storage);assert.equal(loaded.migrated,true);assert.deepEqual(loaded.portfolio.loans[0].config,state);assert.equal(loaded.portfolio.loans[0].name,'Home Loan');assert.equal(map.get('flexi-mortgage-v1'),raw);assert.ok(map.has(PORTFOLIO_KEY));
  assert.deepEqual(loadPortfolio(storage).portfolio,loaded.portfolio);
});
test('singleLoanState migration and named loans preserve identification',()=>{
  const p=migrateLegacy({singleLoanState:{...defaults(),loanName:'Condo'}});assert.equal(p.loans[0].name,'Condo');
});
test('JSON backup/import preserves all loans, properties, dates and optional details',()=>{
  const p=pair();p.properties=[{id:'property',name:'Family House',type:'House',notes:'Shared security'}];p.loans[0].propertyId='property';p.loans[1].propertyId='property';p.loans[0].accountReference='Nickname only';p.loans[0].original.amount=200000;
  assert.deepEqual(importBackup(exportBackup(p)),p);near(calculatePortfolio(p).principal,280000);
});
test('invalid imported backups, duplicate IDs, missing names and negative values are rejected',()=>{
  for(const modify of [p=>p.loans[1].id='a',p=>p.loans[0].name='',p=>p.loans[0].config.principal=-1,p=>p.loans[0].config.principal='',p=>p.loans[0].config.rate=-1,p=>p.loans[0].config.normal=-1,p=>p.schemaVersion=99,p=>p.loans[0].color='red;bad']){
    const p=pair();modify(p);assert.throws(()=>importBackup(JSON.stringify(p)));
  }
  assert.throws(()=>importBackup('not JSON'),/valid JSON/);
});
test('corrupt or future storage is preserved and blocks automatic overwrites',()=>{
  const raw='{"schemaVersion":99}',map=new Map([[PORTFOLIO_KEY,raw]]),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
  const r=loadPortfolio(storage);assert.equal(r.blocked,true);assert.equal(map.get(PORTFOLIO_KEY),raw);
});
test('old verified single-loan demo amounts and dates are unchanged',()=>{
  const config=defaults('2026-09-15'),r=calculate(config);assert.equal(r.payoff,'2039-03-01');near(r.interestPaid,98078.27714491193);near(r.finalPayment,1078.2771449120157);assert.equal(r.monthlyCount,150);
  const p=portfolio(loan('a',config));assert.deepEqual(calculatePortfolio(p).results.a,r);
});
test('strategy comparisons are factual and isolated',()=>{
  const p=pair(),before=JSON.stringify(p),r=compareStrategies(p,{budget:1000,rollover:true,custom:{a:500,b:500}});
  assert.equal(r.length,6);assert.equal(JSON.stringify(p),before);assert.ok(r.every(v=>!/(best|worst|winner|recommended)/i.test(v.name)));
});
test('portfolio CSV and copy summary include actual aggregate results',()=>{
  const p=pair(),r=calculatePortfolio(p),csv=portfolioCSV(r),text=portfolioSummary(p,r);
  assert.equal(csv.split('\r\n').length,r.years.length+1);assert.match(text,/Active loans: 2/);assert.match(text,/280,000.00/);assert.match(text,/Weighted Average Current Rate/);
});
test('10-loan 30-year-scale strategy comparison completes without sacrificing formulas',()=>{
  const p=portfolio(...Array.from({length:10},(_,i)=>loan(`loan-${i}`,{principal:200000+i*10000,rate:3.5+i*.1,normal:1300,paymentDay:i+1,method:i%2?'monthly':'daily'})));
  const start=performance.now(),r=compareStrategies(p,{budget:2000,rollover:true});
  assert.equal(r.length,5);assert.ok(performance.now()-start<15000);assert.ok(r.every(v=>v.result.activeCount===10));
});
test('highest-rate monthly ranking follows independent effective rate changes',()=>{
  const p=portfolio(loan('a',{principal:10000,normal:100,rate:3,paymentDay:15,rates:[{date:'2026-02-01',rate:9}]}),loan('b',{principal:10000,normal:100,rate:5,paymentDay:20}));
  const r=simulateStrategy(p,{budget:100,strategy:'highest-rate'});
  near(r.allocations[0].amounts.b,100);near(r.allocations[1].amounts.a,100);
});
test('monthly allocations and released cash never exceed the initial recurring budget',()=>{
  const p=portfolio(loan('a',{principal:6000,normal:300,extra:100,rate:3,paymentDay:5}),loan('b',{principal:12000,normal:400,extra:50,rate:4,paymentDay:20}));
  for(const strategy of ['highest-rate','lowest-balance','equal','proportional','custom']){
    const r=simulateStrategy(p,{budget:200,rollover:true,strategy,custom:{a:70,b:130}}),cash={};
    for(const result of Object.values(r.results)) for(const row of result.rows)cash[row.date.slice(0,7)]=(cash[row.date.slice(0,7)]||0)+row.payment;
    assert.ok(Object.values(cash).every(v=>v<=1050+1e-7));
    for(const row of r.allocations)near(Object.values(row.amounts).reduce((n,v)=>n+v,0),row.budget);
  }
});
test('unsettled portfolio reports continue scheduled cashflow through the projection horizon',()=>{
  const p=portfolio(loan('a',{principal:100000,rate:6,normal:100,method:'monthly'}),loan('b',{principal:10000,rate:0,normal:100}));
  const r=calculatePortfolio(p);assert.equal(r.interest,null);assert.equal(r.payoff,null);assert.equal(r.results.a.monthlyCount,1200);near(r.years.find(y=>y.year===2040).loans.a.payment,1200);
});
test('a single-loan lump sum does not require unrelated loans to have started',()=>{
  const p=portfolio(loan('a',{principal:10000}),loan('b',{principal:10000,start:'2027-01-01'}));
  const r=lumpScenario(p,{amount:1000,date:'2026-01-15',strategy:'single',loanId:'a'});assert.equal(r.portfolio.loans[0].config.lumps.length,1);assert.equal(r.portfolio.loans[1].config.lumps.length,0);
});
test('missing financial values and malformed loan history are rejected in imports',()=>{
  for(const mutate of [p=>p.loans[0].config.principal=null,p=>p.loans[0].config.rate=null,p=>p.loans[0].history=[null],p=>p.loans[0].id='__proto__',p=>p.settings.custom=null]){
    const p=pair();mutate(p);assert.throws(()=>importBackup(JSON.stringify(p)));
  }
});
