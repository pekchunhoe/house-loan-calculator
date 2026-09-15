import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validate, yearlySchedule } from '../src/engine.js';
import { effectiveBalance, moveFlexi } from '../src/flexi.js';
import { compare, extraScenarios, solveTarget, fixedConfig } from '../src/scenarios.js';
import { paymentDate, iso, firstPayment, parseDate, DAY } from '../src/dates.js';
import { scheduleCSV } from '../src/export.js';
const base = { principal: 350000, rate: 4.15, normal: 2000, extra: 0, start: '2026-01-01', paymentDay: 1, method: 'monthly', flexi: 0, offset: true, overdraft: false, variables: [], lumps: [], rates: [], transactions: [] };
const calc = (change = {}, options) => calculate({ ...base, ...change }, options);
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be within ${tolerance} of ${expected}`);
const payments = result => result.rows.filter(r => r.kind === 'Monthly payment');

test('standard monthly mortgage matches closed-form amortization and conservation', () => {
  const r = calc(), rate = base.rate / 1200;
  const count = Math.ceil(-Math.log(1 - base.principal * rate / base.normal) / Math.log(1 + rate));
  assert.equal(r.monthlyCount, count); assert.equal(r.status, 'paid');
  near(r.rows[0].interest, base.principal * rate);
  const beforeFinal = base.principal * (1 + rate) ** (count - 1) - base.normal * ((1 + rate) ** (count - 1) - 1) / rate;
  near(r.finalPayment, beforeFinal * (1 + rate), 1e-5);
  near(r.totalPayments, base.principal + r.interestPaid, 1e-5);
  near(r.rows.reduce((a, row) => a + row.principalPaid, 0), base.principal, 1e-5);
});
test('extra monthly payments reduce both payoff duration and interest', () => {
  const normal = calc(), extra = calc({ extra: 1000 });
  assert.ok(extra.payoff < normal.payoff); assert.ok(extra.monthlyCount < normal.monthlyCount); assert.ok(extra.interestPaid < normal.interestPaid);
});
test('principal lump sums reduce principal immediately after accrued interest', () => {
  const c = { method: 'daily', lumps: [{ date: '2026-01-16', amount: 10000, park: false }] };
  const r = calc(c), lump = r.rows[0];
  const interest = 350000 * .0415 / 365 * 15;
  near(lump.interest, interest); near(lump.ending, 350000 - (10000 - interest));
  assert.ok(r.interestPaid < calc({ method: 'daily' }).interestPaid);
});
test('flexi offset lowers interest without permanently paying principal', () => {
  const r = calc({ flexi: 50000 });
  near(r.rows[0].interest, 300000 * .0415 / 12);
  near(r.rows[0].starting, 350000); near(r.rows[0].ending, 350000 - (2000 - 300000 * .0415 / 12));
  assert.equal(r.flexi, 50000); near(r.principalPaid, 350000);
  assert.ok(r.interestPaid < calc().interestPaid);
});
test('disabled flexi offset does not change interest', () => {
  const r = calc({ flexi: 50000, offset: false }); near(r.interestPaid, calc().interestPaid);
});
test('daily withdrawal updates effective balance on the event date', () => {
  const r = calc({ method: 'daily', flexi: 50000, transactions: [{ date: '2026-01-16', amount: 20000, type: 'withdrawal' }] });
  near(payments(r)[0].interest, (300000 * 15 + 320000 * 16) * .0415 / 365);
  assert.equal(r.flexi, 30000);
});
test('daily deposit updates interest from the transaction date', () => {
  const r = calc({ method: 'daily', transactions: [{ date: '2026-01-16', amount: 50000, type: 'deposit' }] });
  near(payments(r)[0].interest, (350000 * 15 + 300000 * 16) * .0415 / 365);
});
test('future interest rate changes split the daily period', () => {
  const r = calc({ method: 'daily', rates: [{ date: '2026-01-16', rate: 5 }] });
  near(payments(r)[0].interest, (350000 * .0415 * 15 + 350000 * .05 * 16) / 365);
});
test('daily-interest known amount: RM 100,000 at 3.65% for 31 days = RM 310', () => {
  const r = calc({ principal: 100000, rate: 3.65, method: 'daily' }); near(r.rows[0].interest, 310);
});
test('monthly-interest known amount: RM 100,000 at 6% = RM 500 per full month', () => {
  const r = calc({ principal: 100000, rate: 6 }); near(r.rows[0].interest, 500);
});
test('leap year includes 29 interest days using a 365 divisor', () => {
  const r = calc({ principal: 100000, rate: 3.65, method: 'daily', start: '2028-02-01' });
  assert.equal(r.rows[0].date, '2028-03-01'); near(r.rows[0].interest, 290);
});
test('non-leap February has 28 days', () => {
  const r = calc({ principal: 100000, rate: 3.65, method: 'daily', start: '2027-02-01' }); near(r.rows[0].interest, 280);
});
test('payment days clamp to February and return to 31 in March', () => {
  assert.equal(iso(paymentDate(2028, 1, 31)), '2028-02-29'); assert.equal(iso(paymentDate(2027, 1, 31)), '2027-02-28');
  const r = calc({ start: '2028-01-31', paymentDay: 31, method: 'daily' });
  assert.deepEqual(r.rows.slice(0, 3).map(r => r.date), ['2028-02-29', '2028-03-31', '2028-04-30']);
});
test('first payment is strictly after start; exact daily partial first cycle', () => {
  assert.equal(iso(firstPayment(parseDate('2026-01-01'), 1)), '2026-02-01');
  const r = calc({ start: '2026-01-15', method: 'daily', principal: 100000, rate: 3.65 }); near(r.rows[0].interest, 170);
});
test('monthly partial first cycle and intra-cycle rate change are prorated', () => {
  const r = calc({ principal: 100000, rate: 6, start: '2026-01-16', rates: [{ date: '2026-01-24', rate: 12 }] });
  near(payments(r)[0].interest, 100000 * (.06 * 8 / 31 + .12 * 8 / 31) / 12);
});
test('final partial payment does not overpay', () => {
  const r = calc({ principal: 1000, rate: 6, normal: 800, extra: 100 });
  assert.equal(r.rows.length, 2); near(r.finalPayment, 105.525); assert.equal(r.remaining, 0);
  assert.ok(r.rows.every(r => r.ending >= 0));
});
test('zero interest uses all payments for principal', () => {
  const r = calc({ principal: 1000, normal: 300, rate: 0 });
  assert.equal(r.monthlyCount, 4); near(r.finalPayment, 100); near(r.interestPaid, 0); near(r.totalPayments, 1000);
});
test('insufficient and interest-only payments have no fictitious payoff date', () => {
  for (const normal of [0, 100, 500]) {
    const r = calc({ principal: 100000, rate: 6, normal }); assert.equal(r.status, 'unpaid'); assert.equal(r.payoff, null); assert.equal(r.finalPayment, null);
  }
});
test('future lump sum can rescue a currently insufficient payment', () => {
  const r = calc({ normal: 0, lumps: [{ date: '2028-01-01', amount: 500000, park: false }] });
  assert.equal(r.status, 'paid'); assert.equal(r.payoff, '2028-01-01'); near(r.remaining, 0);
});
test('full payoff from a huge lump sum caps payment at exact debt', () => {
  const r = calc({ method: 'daily', lumps: [{ date: '2026-01-11', amount: 1e9, park: false }] });
  near(r.finalPayment, 350000 + 350000 * .0415 / 365 * 10); assert.equal(r.paymentCount, 1); assert.equal(r.payoff, '2026-01-11');
});
test('same-day starting lump sum pays no future interest', () => {
  const r = calc({ lumps: [{ date: base.start, amount: 350000, park: false }] });
  assert.equal(r.months, 0); near(r.totalPayments, 350000); near(r.interestPaid, 0);
});
test('parked lump sum is a flexi deposit, never a loan payment', () => {
  const r = calc({ lumps: [{ date: base.start, amount: 500000, park: true }] });
  near(r.rows[0].payment, 0); near(r.rows[0].ending, 350000); near(r.interestPaid, 0); near(r.totalPayments, 350000); near(r.flexi, 500000);
});
test('flexi interest-bearing balance has a floor of zero', () => {
  assert.equal(effectiveBalance(10000, 20000), 0);
  const r = calc({ flexi: 500000 }); near(r.interestPaid, 0); near(r.principalPaid, 350000);
});
test('withdrawal cannot make flexi negative unless overdraft is enabled', () => {
  assert.deepEqual(moveFlexi(1000, 'withdrawal', 2000), { balance: 0, clipped: true });
  assert.deepEqual(moveFlexi(1000, 'withdrawal', 2000, true), { balance: -1000, clipped: false });
  const r = calc({ flexi: 1000, transactions: [{ date: base.start, type: 'withdrawal', amount: 2000 }] });
  assert.equal(r.flexi, 0); assert.ok(r.warnings.some(w => w.includes('limited')));
  const overdraft = calc({ flexi: 1000, overdraft: true, transactions: [{ date: base.start, type: 'withdrawal', amount: 2000 }] });
  near(payments(overdraft)[0].interest, 351000 * .0415 / 12);
});
test('variable monthly payment overrides both fields, then returns to defaults', () => {
  const r = calc({ variables: [{ month: '2026-02', normal: 2100, extra: 1500 }] });
  near(r.rows[0].normal, 2100); near(r.rows[0].extra, 1500); near(r.rows[1].normal, 2000); near(r.rows[1].extra, 0);
});
test('negative, missing, invalid dates and duplicate overrides are rejected', () => {
  for (const change of [{ principal: -1 }, { principal: '' }, { rate: '' }, { extra: -10 }, { normal: NaN }, { start: '2026-02-30' }, { paymentDay: 0 }, { flexi: -1 }, { rates: [{ date: '2020-01-01', rate: 5 }] }, { lumps: [{ date: base.start, amount: -100 }] }, { transactions: [{ date: base.start, type: 'deposit', amount: '' }] }, { variables: [{ month: '2026-02', normal: 1, extra: 0 }, { month: '2026-02', normal: 2, extra: 0 }] }]) {
    assert.equal(calc(change).status, 'invalid', JSON.stringify(change));
  }
  assert.ok(validate(base).length === 0);
});
test('very small and very large balances settle accurately', () => {
  const tiny = calc({ principal: .01, normal: 2000, rate: 0 }); near(tiny.finalPayment, .01); assert.equal(tiny.monthlyCount, 1);
  const huge = calc({ principal: 1e12, normal: 1e10 }); assert.equal(huge.status, 'paid'); near(huge.totalPayments, 1e12 + huge.interestPaid, .01);
});
test('higher regular payments never pay off later with identical dated events', () => {
  for (const method of ['daily', 'monthly']) {
    let previous;
    for (const extra of [0, 100, 500, 1000, 2000, 5000]) {
      const r = calc({ method, extra, flexi: 10000, transactions: [{ date: '2027-05-13', type: 'withdrawal', amount: 2000 }], rates: [{ date: '2028-01-17', rate: 5 }], lumps: [{ date: '2027-01-01', amount: 10000, park: false }] });
      if (previous) { assert.ok(r.payoff <= previous.payoff); assert.ok(r.interestPaid <= previous.interestPaid); }
      previous = r;
    }
  }
});
test('higher permanent lump reductions do not increase future interest', () => {
  let previous = Infinity;
  for (const amount of [0, 1000, 10000, 100000, 500000]) {
    const r = calc({ method: 'daily', lumps: [{ date: '2027-02-14', amount, park: false }] }); assert.ok(r.interestPaid <= previous); previous = r.interestPaid;
  }
});
test('baseline excludes discretionary principal payments and overrides, keeps flexi and rates', () => {
  const c = { ...base, extra: 1000, flexi: 10000, variables: [{ month: '2026-03', normal: 3000, extra: 2000 }], lumps: [{ date: '2027-01-01', amount: 10000, park: false }, { date: '2027-03-01', amount: 5000, park: true }] };
  const r = compare(c); assert.ok(r.savedMonths > 0); assert.ok(r.savedInterest > 0); assert.equal(r.baseline.flexi, 15000);
  assert.equal(r.baseline.rows.filter(row => row.kind === 'Lump sum').length, 0);
});
test('target solver matches ordinary monthly annuity formula rounded up to cents', () => {
  const date = '2036-01-01', rate = base.rate / 1200, n = 120;
  const expected = base.principal * rate / (1 - (1 + rate) ** -n);
  const r = solveTarget(base, date); near(r.required, Math.ceil(expected * 100) / 100, .00001);
  assert.equal(calculate(fixedConfig(base, r.required), { endDate: date }).status, 'paid');
  assert.equal(calculate(fixedConfig(base, r.required - .01), { endDate: date }).status, 'unpaid');
});
test('target solver respects daily dates, rate changes, flexi and dated payments', () => {
  const c = { ...base, method: 'daily', flexi: 10000, rates: [{ date: '2029-01-15', rate: 4.7 }], lumps: [{ date: '2030-06-10', amount: 20000, park: false }] }, date = '2035-07-17';
  const result = solveTarget(c, date); assert.ok(!result.error);
  assert.equal(calculate(fixedConfig(c, result.required), { endDate: date }).status, 'paid');
  assert.equal(calculate(fixedConfig(c, result.required - .01), { endDate: date }).status, 'unpaid');
});
test('target before first scheduled payment requires a lump sum', () => {
  assert.ok(solveTarget(base, '2026-01-20').error);
  const r = solveTarget({ ...base, lumps: [{ date: '2026-01-10', amount: 400000, park: false }] }, '2026-01-20'); assert.equal(r.required, 0);
});
test('target at zero rate and final payment at target are exact', () => {
  const r = solveTarget({ ...base, rate: 0, principal: 1200 }, '2027-01-01'); near(r.required, 100);
});
test('yearly totals reconcile to full schedule and CSV has every event', () => {
  const r = calc({ extra: 1000 }); const years = yearlySchedule(r.rows);
  near(years.reduce((n, y) => n + y.payment, 0), r.totalPayments, 1e-6);
  near(years.reduce((n, y) => n + y.interest, 0), r.interestPaid, 1e-6);
  assert.equal(years.at(-1).ending, 0);
  const csv = scheduleCSV(r.rows); assert.equal(csv.split('\r\n').length, r.rows.length + 1); assert.ok(csv.includes('Flexi Movement')); assert.ok(csv.includes('"0.00"'));
});
test('scenario ladder includes current extra and adapts to small instalments', () => {
  const r = extraScenarios({ ...base, extra: 777 }); assert.ok(r.some(s => s.extra === 777));
  const small = extraScenarios({ ...base, principal: 1000, normal: 100 }); assert.ok(small.some(s => s.extra === 10));
});
test('same-day events use deterministic ordering regardless of input arrays', () => {
  const r = calc({ method: 'daily', rates: [{ date: base.start, rate: 6 }], transactions: [{ date: base.start, type: 'deposit', amount: 10000 }], lumps: [{ date: base.start, amount: 1000, park: false }, { date: base.start, amount: 5000, park: true }] });
  assert.deepEqual(r.rows.slice(0, 4).map(row => row.kind), ['Rate change', 'Flexi deposit', 'Parked lump sum', 'Lump sum']);
  near(payments(r)[0].interest, (349000 - 15000) * .06 * 31 / 365);
});
test('daily date arithmetic has no daylight-saving or timezone drift', () => {
  assert.equal((parseDate('2028-03-01') - parseDate('2028-02-01')) / DAY, 29);
  assert.equal((parseDate('2026-04-01') - parseDate('2026-03-01')) / DAY, 31);
});
