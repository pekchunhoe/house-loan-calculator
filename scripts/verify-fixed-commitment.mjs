import assert from 'node:assert/strict';
import { defaults } from '../src/persistence.js';
import { createLoan, createPortfolio } from '../src/storage.js';
import { simulateFixedCommitment } from '../src/fixedCommitmentEngine.js';
import { calculate } from '../src/engine.js';
const definitions=[['a',8000,2000],['b',3000,1500],['c',25000,2500],['d',24000,2000]];
const loans=definitions.map(([id,principal,normal])=>createLoan({...defaults('2026-01-01'),principal,normal,extra:0,rate:0,flexi:0,paymentDay:5},{id,name:'Loan '+id.toUpperCase()}));
const portfolio={...createPortfolio(loans[0]),loans};
const result=simulateFixedCommitment(portfolio,{startMonth:'2026-01',strategy:'priority',priority:['c','a','d','b']});
const expected=[
  [2000,1500,2500,2000],[2000,1500,2500,2000],[2000,0,4000,2000],[2000,0,4000,2000],
  [0,0,6000,2000],[0,0,6000,2000],[0,0,0,8000],[0,0,0,4000]
];
assert.deepEqual(result.monthly.map(m=>loans.map(l=>m.amounts[l.id]||0)),expected);
assert.equal(result.current.payoff,'2026-12-05');assert.equal(result.payoff,'2026-08-05');
assert.equal(result.totalPayments,60000);assert.equal(result.interest,0);
for(const m of result.monthly.slice(0,-1))assert.equal(m.total,8000);
assert.equal(result.monthly.at(-1).total,4000);
console.log(JSON.stringify({example:'Independent arithmetic: RM60,000 / RM8,000 with cascading allocations',currentPayoff:result.current.payoff,fixedPayoff:result.payoff,interest:result.interest,monthly:result.monthly,timeline:result.timeline},null,2));
// Nonzero-interest example: replay every allocated amount independently through
// calculate(), without the coordinator, and reconcile the resulting loan ledgers.
const interestPortfolio=structuredClone(portfolio);
interestPortfolio.loans.forEach((l,i)=>{l.config.principal*=10;l.config.rate=4+i*.2;l.config.method=i%2?'monthly':'daily';l.config.paymentDay=[1,5,15,28][i];});
const mixed=simulateFixedCommitment(interestPortfolio,{startMonth:'2026-01',strategy:'highest-rate'});
for(const l of interestPortfolio.loans){
  const variables=mixed.allocations.filter(a=>a.amounts[l.id]!==undefined).map(a=>({month:a.month,normal:l.config.normal,extra:a.amounts[l.id]-l.config.normal}));
  const independent=calculate({...l.config,variables},{allowFuturePayments:true});
  assert.deepEqual(independent,mixed.results[l.id]);
}
assert.ok(Math.abs(mixed.totalPayments-mixed.principal-mixed.interest)<1e-6);
console.log(JSON.stringify({example:'Mixed daily/monthly nonzero interest, independently replayed',currentPayoff:mixed.current.payoff,fixedPayoff:mixed.payoff,currentInterest:mixed.current.interest,fixedInterest:mixed.interest,difference:mixed.difference,finalPayment:mixed.monthly.at(-1).total},null,2));
