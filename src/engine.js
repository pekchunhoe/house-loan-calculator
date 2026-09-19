import { DAY, parseDate, iso, firstPayment, nextPayment, previousPayment, monthsBetween } from './dates.js';
import { validateAssumptions } from './calibrationModel.js';
import { effectiveBalance, moveFlexi } from './flexi.js';

const EPS = 1e-8;
export function validate(c) {
  const errors = [];
  if (c.calculationAssumptions) errors.push(...validateAssumptions(c.calculationAssumptions));
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
export function calculate(config, options = {}) {
  const simulation = loanSimulation(config, options);
  let step = simulation.next();
  while (!step.done) step = simulation.next(0);
  return step.value;
}

// A resumable version of the SAME ledger. Portfolio orchestration supplies only
// extra cash at monthly events; all interest, timing and allocation formulas stay here.
export function* loanSimulation(config, { maxMonths = 1200, endDate, includeRows = true, allowFuturePayments = false, explicitPayments = [], trace = false, postingDates = [], traceTransactions = [] } = {}) {
  const errors = validate(config);
  if (errors.length) return { status: 'invalid', errors, rows: [], warnings: [] };
  const a = config.calculationAssumptions;
  const delay = a?.timing === 'end' ? DAY : 0;
  const dailyRows = [], monthlyRows = [], postings = [];
  let postingAccrued = 0;
  const c = config, start = parseDate(c.start), day = Number(c.paymentDay);
  let principal = Number(c.principal), flexi = Number(c.flexi), rate = Number(c.rate) / 100;
  let accrued = 0, interestPaid = 0, interestAccrued = 0, totalPayments = 0, paymentCount = 0, monthlyCount = 0, finalPayment = 0;
  let current = start, due = firstPayment(start, day), cycleStart = previousPayment(due, day);
  const limit = endDate ? parseDate(endDate) : Infinity;
  const warnings = new Set(), rows = [];
  let offsetSnapshot = flexi, offsetMonth = iso(start).slice(0,7);
  const events = [
    ...explicitPayments.map(r => ({ ...r, kind: 'explicit', order: 3 })),
    ...(c.rates || []).map(r => ({ ...r, kind: 'rate', order: 0 })),
    ...(c.transactions || []).map(r => ({ ...r, kind: 'flexi', order: 1 })),
    ...(c.lumps || []).map(r => ({ ...r, kind: r.park ? 'park' : 'lump', order: r.park ? 2 : 3 }))
  ].map(r => ({ ...r, time: parseDate(r.date) + (r.kind === 'rate' ? 0 : delay) })).sort((a, b) => a.time - b.time || a.order - b.order);
  const variables = new Map((c.variables || []).map(r => [r.month, r]));
  let index = 0, stagnant = 0, previousDebt = principal;
  const lastVariable = [...variables.keys()].sort().at(-1) || '';
  const push = row => { if (includeRows) rows.push({ no: rows.length + 1, ...row }); };
  function accrue(to) {
    function segment(end) {
      if (end <= current) return;
      const month = iso(current).slice(0,7);
      if (month !== offsetMonth) { offsetSnapshot = flexi; offsetMonth = month; }
      const denominator = a?.dayCount?.includes('366') ? 366 : a?.dayCount === 'Actual/360' ? 360 : 365;
      const cycleEnd = a ? firstPayment(current, day) : due;
      const cycleBeginning = a ? previousPayment(cycleEnd, day) : cycleStart;
      const fraction = c.method === 'daily' ? (end - current) / DAY / denominator : (end - current) / (cycleEnd - cycleBeginning) / 12;
      const appliedFlexi = a?.flexi === 'monthly' ? offsetSnapshot : flexi;
      const effective = effectiveBalance(principal, appliedFlexi, a?.flexi === 'ignored' ? false : c.offset);
      const interest = effective * rate * fraction;
      const transactions = trace ? [...events,...traceTransactions].filter(e => e.date === iso(current)).map(e => e.kind === 'rate' ? `Rate ${e.rate}%` : `${e.type || e.kind}: ${e.amount}`) : [];
      if (trace && c.method === 'daily') dailyRows.push({ date: iso(current), principal, flexi, effective, rate: rate * 100, interest, transactions });
      if (trace && c.method === 'monthly') {
        const previous = monthlyRows.at(-1), cycle = iso(cycleEnd);
        if (previous && previous.cycle === cycle && previous.principal === principal && previous.flexi === appliedFlexi && previous.rate === rate * 100 && !transactions.length) { previous.end = iso(end - DAY); previous.interest += interest; }
        else monthlyRows.push({ date:iso(current),end:iso(end-DAY),cycle,principal,flexi:appliedFlexi,effective,rate:rate*100,interest,transactions });
      }
      postingAccrued += interest;
      if (a && (postingDates.length ? postingDates.includes(iso(end-DAY)) : a.posting === 'daily' || a.posting === 'monthly' && iso(end).slice(0,7) !== month || a.posting === 'statement' && end === limit)) {
        postings.push({date:iso(end-DAY),interest:postingAccrued}); postingAccrued = 0;
      }
      accrued += interest; interestAccrued += interest; current = end;
    }
    if (trace || a) while (current < to) segment(Math.min(current + DAY, to));
    else segment(to);
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
    const at = Math.min(due + delay, nextEvent, limit);
    if (at < current || !Number.isFinite(at)) break;
    const addedPayment = Number((yield { date: iso(at), time: at, monthly: at === due + delay, due: iso(due + delay), principal, accrued, flexi, rate: rate * 100 }) ?? 0);
    if (!Number.isFinite(addedPayment) || addedPayment < 0) throw new Error('Additional payment must be non-negative.');
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
      } else if (event.kind === 'explicit') record(event.label || 'Dated payment', event.type === 'normal' ? Number(event.amount) : 0, event.type === 'extra' ? Number(event.amount) : 0, event.type === 'lump' ? Number(event.amount) : 0);
      else record('Lump sum', 0, 0, Number(event.amount));
    }
    if (at === due + delay && (principal > EPS || accrued > EPS)) {
      const override = variables.get(iso(due).slice(0, 7));
      record('Monthly payment', Number(override?.normal ?? c.normal), Number(override?.extra ?? c.extra) + addedPayment);
      monthlyCount++;
      const debt = principal + accrued;
      stagnant = debt >= previousDebt - EPS ? stagnant + 1 : 0;
      previousDebt = debt;
      if (accrued > EPS) warnings.add('Some payments do not cover accrued interest. Unpaid interest is carried separately without compounding.');
      cycleStart = due; due = nextPayment(due, day);
      if (!allowFuturePayments && stagnant >= 12 && index >= events.length && iso(current).slice(0, 7) >= lastVariable) break;
    }
    if (at === limit) break;
  }
  const settled = principal <= EPS && accrued <= EPS;
  if (!settled && !endDate) warnings.add('Your current payment may not be sufficient to fully repay the loan. No settlement found within the 100-year projection limit.');
  return { status: settled ? 'paid' : 'unpaid', errors: [], warnings: [...warnings], rows, ...(trace ? { dailyRows, monthlyRows } : {}), ...(a ? {postings, unpostedInterest:postingAccrued} : {}), payoff: settled ? iso(current) : null, months: settled ? monthsBetween(start, current) : null, monthlyCount, paymentCount, finalPayment: settled ? finalPayment : null, totalPayments, interestPaid, interestAccrued, principalPaid: Number(c.principal) - principal, remaining: principal, unpaidInterest: accrued, flexi, start: c.start, initialPrincipal: Number(c.principal) };
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
