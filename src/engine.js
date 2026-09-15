import { DAY, parseDate, iso, firstPayment, nextPayment, previousPayment, monthsBetween } from './dates.js';
import { effectiveBalance, moveFlexi } from './flexi.js';

const EPS = 1e-8;
export function validate(c) {
  const errors = [];
  for (const [key, label] of [['principal', 'Outstanding principal'], ['rate', 'Annual interest rate'], ['normal', 'Monthly instalment'], ['extra', 'Extra monthly payment'], ['flexi', 'Flexi balance']]) {
    if (c[key] === '' || !Number.isFinite(Number(c[key])) || Number(c[key]) < 0) errors.push(`${label} must be a number of zero or greater.`);
  }
  if (!(Number(c.principal) > 0)) errors.push('Outstanding principal must be greater than zero.');
  if (Number(c.rate) > 100) errors.push('Annual interest rate must be at most 100%.');
  if (!Number.isFinite(parseDate(c.start))) errors.push('Choose a valid calculation start date.');
  if (!Number.isInteger(Number(c.paymentDay)) || c.paymentDay < 1 || c.paymentDay > 31) errors.push('Payment day must be between 1 and 31.');
  if (!['daily', 'monthly'].includes(c.method)) errors.push('Choose a supported interest calculation method.');
  for (const key of ['lumps', 'transactions', 'rates']) {
    const seen = new Set();
    for (const row of c[key] || []) {
      if (!Number.isFinite(parseDate(row.date)) || row.date < c.start) errors.push(`${key}: dates must be on or after the start date.`);
      const value = key === 'rates' ? row.rate : row.amount;
      if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || (key === 'rates' && Number(value) > 100)) errors.push(`${key}: enter a valid non-negative ${key === 'rates' ? 'rate (up to 100%)' : 'amount'}.`);
      if (key === 'rates' && seen.has(row.date)) errors.push('Use only one interest rate change per date.');
      seen.add(row.date);
      if (key === 'transactions' && !['deposit', 'withdrawal'].includes(row.type)) errors.push('Choose deposit or withdrawal.');
    }
  }
  const seen = new Set();
  for (const row of c.variables || []) {
    if (!/^\d{4}-\d{2}$/.test(row.month) || !Number.isFinite(parseDate(row.month + '-01')) || row.month < c.start.slice(0, 7)) errors.push('Variable payments need a valid month on or after the start month.');
    if (seen.has(row.month)) errors.push('Use only one variable payment row per month.');
    seen.add(row.month);
    for (const key of ['normal', 'extra']) if (row[key] === '' || !Number.isFinite(Number(row[key])) || Number(row[key]) < 0) errors.push('Variable payments must be non-negative numbers.');
  }
  return [...new Set(errors)];
}

/** Event-based reducing balance simulation. Date math is UTC and day count is Actual/365.
 * Interest stays in its own ledger until paid; unpaid interest is not compounded.
 * Monthly mode prorates annualRate/12 across actual days in each payment cycle.
 * Thus a full unchanged cycle earns exactly balance * annualRate/12.
 */
export function calculate(config, { maxMonths = 1200, endDate, includeRows = true } = {}) {
  const errors = validate(config);
  if (errors.length) return { status: 'invalid', errors, rows: [], warnings: [] };
  const c = config, start = parseDate(c.start), day = Number(c.paymentDay);
  let principal = Number(c.principal), flexi = Number(c.flexi), rate = Number(c.rate) / 100;
  let accrued = 0, interestPaid = 0, interestAccrued = 0, totalPayments = 0, paymentCount = 0, monthlyCount = 0, finalPayment = 0;
  let current = start, due = firstPayment(start, day), cycleStart = previousPayment(due, day);
  const limit = endDate ? parseDate(endDate) : Infinity;
  const warnings = new Set(), rows = [];
  const events = [
    ...(c.rates || []).map(r => ({ ...r, kind: 'rate', order: 0 })),
    ...(c.transactions || []).map(r => ({ ...r, kind: 'flexi', order: 1 })),
    ...(c.lumps || []).map(r => ({ ...r, kind: r.park ? 'park' : 'lump', order: r.park ? 2 : 3 }))
  ].map(r => ({ ...r, time: parseDate(r.date) })).sort((a, b) => a.time - b.time || a.order - b.order);
  const variables = new Map((c.variables || []).map(r => [r.month, r]));
  let index = 0, stagnant = 0, previousDebt = principal;
  const lastVariable = [...variables.keys()].sort().at(-1) || '';
  const push = row => { if (includeRows) rows.push({ no: rows.length + 1, ...row }); };
  function accrue(to) {
    const fraction = c.method === 'daily' ? (to - current) / DAY / 365 : (to - current) / (due - cycleStart) / 12;
    const interest = effectiveBalance(principal, flexi, c.offset) * rate * fraction;
    accrued += interest; interestAccrued += interest; current = to;
  }
  function record(kind, normal = 0, extra = 0, lump = 0, movement = 0) {
    const starting = principal;
    const requested = normal + extra + lump;
    const payment = Math.min(requested, principal + accrued);
    const interest = Math.min(payment, accrued);
    const principalPaid = Math.min(principal, Math.max(0, payment - interest));
    accrued = Math.max(0, accrued - interest); principal = Math.max(0, principal - principalPaid);
    const actualNormal = Math.min(normal, payment), actualExtra = Math.min(extra, Math.max(0, payment - actualNormal));
    totalPayments += payment; interestPaid += interest;
    if (payment > 0) { paymentCount++; finalPayment = payment; }
    push({ date: iso(current), kind, starting, interest, normal: actualNormal, extra: actualExtra, lump: Math.max(0, payment - actualNormal - actualExtra), principalPaid, ending: principal, flexi, effective: effectiveBalance(principal, flexi, c.offset), payment, movement, accruedInterest: accrued, rate: rate * 100 });
  }
  while ((principal > EPS || accrued > EPS) && monthlyCount < maxMonths) {
    const nextEvent = events[index]?.time ?? Infinity;
    const at = Math.min(due, nextEvent, limit);
    if (at < current || !Number.isFinite(at)) break;
    accrue(at);
    while (events[index]?.time === at && (principal > EPS || accrued > EPS)) {
      const event = events[index++];
      if (event.kind === 'rate') { rate = Number(event.rate) / 100; record('Rate change'); }
      else if (event.kind === 'flexi' || event.kind === 'park') {
        const before = flexi;
        const move = moveFlexi(flexi, event.kind === 'park' ? 'deposit' : event.type, Number(event.amount), c.overdraft);
        flexi = move.balance;
        if (move.clipped) warnings.add(`Withdrawal on ${event.date} was limited to available flexi funds.`);
        record(event.kind === 'park' ? 'Parked lump sum' : `Flexi ${event.type}`, 0, 0, 0, flexi - before);
      } else record('Lump sum', 0, 0, Number(event.amount));
    }
    if (at === due && (principal > EPS || accrued > EPS)) {
      const override = variables.get(iso(due).slice(0, 7));
      record('Monthly payment', Number(override?.normal ?? c.normal), Number(override?.extra ?? c.extra));
      monthlyCount++;
      const debt = principal + accrued;
      stagnant = debt >= previousDebt - EPS ? stagnant + 1 : 0;
      previousDebt = debt;
      if (accrued > EPS) warnings.add('Some payments do not cover accrued interest. Unpaid interest is carried separately without compounding.');
      cycleStart = due; due = nextPayment(due, day);
      if (stagnant >= 12 && index >= events.length && iso(current).slice(0, 7) >= lastVariable) break;
    }
    if (at === limit) break;
  }
  const settled = principal <= EPS && accrued <= EPS;
  if (!settled && !endDate) warnings.add('Your current payment may not be sufficient to fully repay the loan. No settlement found within the 100-year projection limit.');
  return { status: settled ? 'paid' : 'unpaid', errors: [], warnings: [...warnings], rows, payoff: settled ? iso(current) : null, months: settled ? monthsBetween(start, current) : null, monthlyCount, paymentCount, finalPayment: settled ? finalPayment : null, totalPayments, interestPaid, interestAccrued, principalPaid: Number(c.principal) - principal, remaining: principal, unpaidInterest: accrued, flexi, start: c.start, initialPrincipal: Number(c.principal) };
}

export function yearlySchedule(rows) {
  const groups = new Map();
  for (const row of rows) {
    const year = row.date.slice(0, 4);
    const item = groups.get(year) || { year, starting: row.starting, payment: 0, interest: 0, principalPaid: 0, ending: 0 };
    item.payment += row.payment; item.interest += row.interest; item.principalPaid += row.principalPaid; item.ending = row.ending;
    groups.set(year, item);
  }
  return [...groups.values()];
}
