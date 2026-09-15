import { calculate, loanSimulation } from './engine.js';
import { activeLoans, validatePortfolio } from './storage.js';
import { effectiveBalance } from './flexi.js';
import { parseDate, monthsBetween } from './dates.js';
import { allocate, validateAllocation } from './allocationEngine.js';
const cache = new Map();
export function independentResult(loan) {
  const key = JSON.stringify(loan.config);
  if (!cache.has(key)) { if (cache.size > 100) cache.delete(cache.keys().next().value); cache.set(key, calculate(loan.config, { allowFuturePayments: true })); }
  return cache.get(key);
}
export function aggregate(p, results, { schedules = true } = {}) {
  const loans = activeLoans(p), values = loans.map(l => ({ loan: l, result: results[l.id] }));
  const sum = field => loans.reduce((n, l) => n + Number(l.config[field]), 0);
  const principal = sum('principal'), normal = sum('normal'), extra = sum('extra');
  const paid = values.filter(v => v.result.status === 'paid'), allPaid = paid.length === loans.length;
  const dates = paid.map(v => v.result.payoff).sort();
  const start = loans.map(l => l.config.start).sort()[0] || null;
  const payoff = loans.length && allPaid ? dates.at(-1) : null;
  const summary = { principal, normal, extra, monthly: normal + extra, flexi: sum('flexi'), effective: loans.reduce((n, l) => n + effectiveBalance(Number(l.config.principal), Number(l.config.flexi), l.config.offset), 0), weightedRate: principal ? loans.reduce((n, l) => n + Number(l.config.principal) * Number(l.config.rate), 0) / principal : 0, interest: allPaid ? values.reduce((n, v) => n + v.result.interestPaid, 0) : null, totalPayments: allPaid ? values.reduce((n, v) => n + v.result.totalPayments, 0) : null, activeCount: loans.length, earliest: dates[0] || null, payoff, start, months: payoff ? monthsBetween(parseDate(start), parseDate(payoff)) : null, allPaid, results };
  if (!schedules) return summary;
  const events = values.flatMap(({ loan, result }) => result.rows.map(row => ({ ...row, loanId: loan.id }))).sort((a, b) => a.date.localeCompare(b.date));
  const balances = Object.fromEntries(loans.map(l => [l.id, Number(l.config.principal)]));
  const points = start ? [{ date: start, total: principal, balances: { ...balances } }] : [];
  const years = [];
  if (events.length) {
    let index = 0;
    for (let year = Number(start.slice(0, 4)); year <= Number(events.at(-1).date.slice(0, 4)); year++) {
      const detail = Object.fromEntries(loans.map(l => [l.id, { id: l.id, starting: balances[l.id], payment: 0, interest: 0, principalPaid: 0, ending: balances[l.id] }]));
      const row = { year, starting: Object.values(balances).reduce((a, b) => a + b, 0), payment: 0, interest: 0, principalPaid: 0, ending: 0, loans: detail };
      while (index < events.length && Number(events[index].date.slice(0, 4)) === year) {
        const e = events[index++]; balances[e.loanId] = e.ending;
        for (const k of ['payment', 'interest', 'principalPaid']) { row[k] += e[k]; detail[e.loanId][k] += e[k]; }
        detail[e.loanId].ending = e.ending;
        const point = { date: e.date, total: Object.values(balances).reduce((a, b) => a + b, 0), balances: { ...balances } };
        if (points.at(-1)?.date === e.date) points[points.length - 1] = point; else points.push(point);
      }
      row.ending = Object.values(balances).reduce((a, b) => a + b, 0); years.push(row);
    }
  }
  return { ...summary, points, years };
}
export function calculatePortfolio(p) {
  const errors = validatePortfolio(p);
  if (errors.length) throw new Error(errors.join('\n'));
  return aggregate(p, Object.fromEntries(activeLoans(p).map(l => [l.id, independentResult(l)])));
}
/** Chronological coordination of the original engine's independent event streams.
 * Monthly envelopes are assigned before the first event in each calendar month.
 * Paid loans release configured normal+extra cash from the NEXT calendar month.
 * Unused final-payment cash is not double-spent in the same month.
 */
export function simulateStrategy(p, { budget = 0, strategy = 'highest-rate', rollover = false, custom = {}, endDate, includeRows = true, scaledCustom = false } = {}) {
  const errors = validatePortfolio(p); if (errors.length) throw new Error(errors.join('\n'));
  const loans = activeLoans(p);
  const assigned = strategy === 'custom' && !scaledCustom ? validateAllocation(loans, budget, custom) : (validateAllocation(loans, budget), Number(budget));
  const simulations = loans.map(loan => { const engine = loanSimulation(loan.config, { endDate, includeRows, allowFuturePayments: true }); return { loan, engine, step: engine.next(), settledMonth: null }; });
  const results = {}, allocations = []; let month = '', envelope = {};
  for (const s of simulations) if (s.step.done) results[s.loan.id] = s.step.value;
  while (simulations.some(s => !s.step.done)) {
    const pending = simulations.filter(s => !s.step.done).sort((a, b) => a.step.value.time - b.step.value.time || a.loan.id.localeCompare(b.loan.id));
    const s = pending[0], event = s.step.value, currentMonth = event.date.slice(0, 7);
    if (currentMonth !== month) {
      month = currentMonth;
      const released = rollover ? simulations.filter(x => x.settledMonth && x.settledMonth < month).reduce((n, x) => n + Number(x.loan.config.normal) + Number(x.loan.config.extra), 0) : 0;
      const eligible = pending.filter(x => x.step.value.due.slice(0, 7) <= month && x.loan.config.start.slice(0, 7) <= month).map(x => {
        let rate = Number(x.loan.config.rate);
        for (const r of [...x.loan.config.rates].sort((a, b) => a.date.localeCompare(b.date))) if (r.date <= month + '-01') rate = Number(r.rate);
        return { id: x.loan.id, principal: x.step.value.principal, rate };
      });
      envelope = allocate(eligible, assigned + released, strategy, custom);
      if (includeRows) allocations.push({ month, budget: assigned + released, released, amounts: { ...envelope } });
    }
    const additional = event.monthly ? envelope[s.loan.id] || 0 : 0;
    s.step = s.engine.next(additional);
    if (event.monthly) envelope[s.loan.id] = 0;
    if (s.step.done) { results[s.loan.id] = s.step.value; if (s.step.value.status === 'paid') s.settledMonth = s.step.value.payoff.slice(0, 7); }
  }
  return { ...aggregate(p, results, { schedules: includeRows }), allocations, budget: Number(budget), strategy, rollover };
}
