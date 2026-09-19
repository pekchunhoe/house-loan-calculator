import { loanSimulation } from './engine.js';
import { activeLoans, validatePortfolio } from './storage.js';
import { aggregate, calculatePortfolio } from './portfolioEngine.js';
import { allocate } from './allocationEngine.js';
import { fixedOptions, validateFixedOptions } from './fixedCommitmentModel.js';
import { parseDate } from './dates.js';

const sum = values => values.reduce((a,b) => a + b, 0);
const nextMonth = month => { const d = new Date(month + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0,7); };
export function allocateFixed(items, amount, options) {
  const { strategy, priority, percentages } = fixedOptions(options);
  if (['earliest-payoff','largest-balance','priority'].includes(strategy)) {
    const rank = id => priority.includes(id) ? priority.indexOf(id) : Infinity;
    const ordered = [...items].sort((a,b) => (strategy === 'largest-balance' ? b.principal - a.principal : strategy === 'earliest-payoff' ? (a.payoff || '9999').localeCompare(b.payoff || '9999') : rank(a.id) - rank(b.id)) || a.id.localeCompare(b.id));
    return Object.fromEntries(ordered.map((l,i) => [l.id, i ? 0 : amount]));
  }
  return allocate(items, amount, strategy === 'percentage' ? 'custom' : strategy, percentages);
}
export function monthlyPayments(result) {
  const months = new Map();
  for (const [id, r] of Object.entries(result.results)) for (const row of r.rows) {
    const month = row.date.slice(0,7), item = months.get(month) || { month, amounts: {}, total: 0, lump: 0 };
    if (row.kind === 'Monthly payment') { item.amounts[id] = (item.amounts[id] || 0) + row.payment; item.total += row.payment; }
    item.lump += row.lump; months.set(month, item);
  }
  return [...months.values()].sort((a,b) => a.month.localeCompare(b.month));
}
export function commitmentDifference(current, fixed) {
  return {
    months: payoffMonthDifference(current.payoff, fixed.payoff),
    interest: current.interest !== null && fixed.interest !== null ? current.interest - fixed.interest : null
  };
}
export function payoffMonthDifference(current, fixed) {
  const index = date => Number(date.slice(0,4))*12 + Number(date.slice(5,7));
  return current && fixed ? index(current)-index(fixed) : null;
}
/** Coordinates the original independent ledgers. No mortgage-interest formula lives here. */
export function simulateFixedCommitment(p, value = {}) {
  const options = fixedOptions(value), errors = [...validatePortfolio(p), ...validateFixedOptions(options)];
  if (errors.length) throw new Error(errors.join('\n'));
  const loans = activeLoans(p), current = calculatePortfolio(p);
  const atStart = loans.filter(l => l.config.start.slice(0,7) <= options.startMonth && (!current.results[l.id].payoff || current.results[l.id].payoff >= options.startMonth + '-01'));
  const commitment = options.mode === 'current' ? sum(atStart.map(l => Number(l.config.normal) + (options.includeExtras ? Number(l.config.extra) : 0))) : Number(options.commitment);
  if (!loans.length) throw new Error('Add an active loan before running a fixed commitment scenario.');
  if (options.startMonth < current.start.slice(0,7)) throw new Error('Strategy start cannot precede the earliest loan snapshot.');
  const simulations = loans.map(loan => { const engine = loanSimulation(loan.config, { allowFuturePayments: true }); return { loan, engine, step: engine.next(), allocation: 0, used: false }; });
  const results = {}, allocations = [], timeline = [{ type: 'start', month: options.startMonth, amount: commitment }];
  let month = '', envelope, begun = false;
  const itemsFor = (eligible, date) => eligible.map(s => {
    let rate = Number(s.loan.config.rate);
    for (const r of [...s.loan.config.rates].sort((a,b) => a.date.localeCompare(b.date))) if (r.date <= date) rate = Number(r.rate);
    return { id:s.loan.id, principal:s.step.value.principal, rate, payoff:current.results[s.loan.id].payoff };
  });
  while (simulations.some(s => !s.step.done)) {
    const pending = simulations.filter(s => !s.step.done).sort((a,b) => a.step.value.time - b.step.value.time || a.loan.id.localeCompare(b.loan.id));
    const s = pending[0], event = s.step.value, currentMonth = event.date.slice(0,7);
    if (currentMonth !== month) {
      month = currentMonth; begun = month >= options.startMonth;
      for (const x of simulations) { x.allocation = 0; x.used = false; x.spent = 0; }
      if (begun) {
        const eligible = pending.filter(x => x.step.value.due.slice(0,7) === month && x.loan.config.start.slice(0,7) <= month);
        const required = sum(eligible.map(x => Number(x.loan.config.variables.find(v => v.month === x.step.value.paymentMonth)?.normal ?? x.loan.config.normal)));
        if (required > commitment + 1e-7) {
          const error = new Error(`Your selected monthly commitment is below the total required instalments of your active loans. Month: ${month}. Required: RM ${required.toFixed(2)}. Selected: RM ${commitment.toFixed(2)}. Shortfall: RM ${(required - commitment).toFixed(2)}. Increase the commitment, use current scheduled payments, or cancel the scenario.`);
          throw error;
        }
        const regularExtras = options.includeExtras ? sum(eligible.map(x => Number(x.loan.config.extra))) : 0;
        const retainExtras = regularExtras <= commitment - required + 1e-7;
        const extra = allocateFixed(itemsFor(eligible, month + '-01'), Math.max(0, commitment - required - (retainExtras ? regularExtras : 0)), options);
        envelope = { month, target: commitment, required, amounts: {}, actual: {}, total: 0, lump: 0 };
        for (const x of eligible) {
          const normal = Number(x.loan.config.variables.find(v => v.month === x.step.value.paymentMonth)?.normal ?? x.loan.config.normal);
          x.allocation = normal + (options.includeExtras && retainExtras ? Number(x.loan.config.extra) : 0) + (extra[x.loan.id] || 0);
          envelope.amounts[x.loan.id] = x.allocation;
        }
        allocations.push(envelope);
        const releases = timeline.filter(t => t.type === 'settled' && t.availableMonth === month);
        if (releases.length) timeline.push({ type:'redirected', month, amount:sum(releases.map(t => t.amount)), amounts:{...envelope.amounts} });
      }
    }
    let instruction = 0;
    if (begun && event.monthly) {
      const c = s.loan.config, override = c.variables.find(v => v.month === event.paymentMonth), normal = Number(override?.normal ?? c.normal);
      // Monthly overrides stay explicit exceptions to the envelope. Excluded
      // extras are additional spending; lump sums remain engine-owned events.
      const separateExtra = options.includeExtras ? Number(override?.extra ?? c.extra) - Number(c.extra) : Number(override?.extra ?? c.extra);
      instruction = { extra:Math.max(0, s.allocation - normal + separateExtra) };
      s.used = true;
    }
    const previousRecurring = event.recurringPayments;
    s.step = s.engine.next(instruction);
    const recurring = s.step.done ? sum(s.step.value.rows.filter(r => r.kind === 'Monthly payment').map(r => r.payment)) : s.step.value.recurringPayments;
    const paid = recurring - previousRecurring;
    s.spent += paid;
    if (begun && paid) { envelope.actual[s.loan.id] = (envelope.actual[s.loan.id] || 0) + paid; envelope.total += paid; }
    if (s.step.done) {
      results[s.loan.id] = s.step.value;
      if (begun && s.step.value.status === 'paid') {
        const released = s.allocation;
        const settlement = { type:'settled', month, date:s.step.value.payoff, loanId:s.loan.id, amount:released, availableMonth:nextMonth(month) };
        timeline.push(settlement);
        // Only UNUSED current-month cash may move to a strictly later scheduled
        // date. A full allocation already spent is released next month, never twice.
        const unused = Math.max(0, released - s.spent);
        const eligible = simulations.filter(x => !x.step.done && !x.used && x.step.value.due.slice(0,7) === month && parseDate(x.step.value.due) > event.time);
        if (options.timing === 'next-payment' && unused > 1e-7 && eligible.length) {
          const transfers = allocateFixed(itemsFor(eligible, event.date), unused, options);
          for (const x of eligible) { x.allocation += transfers[x.loan.id] || 0; envelope.amounts[x.loan.id] = x.allocation; }
          envelope.amounts[s.loan.id] = Math.max(0,released-unused);
          timeline.push({ type:'transfer', month, date:event.date, amount:unused, amounts:transfers, loanId:s.loan.id });
        }
      }
    }
  }
  const result = aggregate(p, results), monthly = monthlyPayments(result);
  for (const a of allocations) a.lump = monthly.find(m => m.month === a.month)?.lump || 0;
  if (result.payoff) timeline.push({ type:'complete', month:result.payoff.slice(0,7), date:result.payoff });
  timeline.sort((a,b) => a.month.localeCompare(b.month));
  return { ...result, options, commitment, current, currentMonthly:monthlyPayments(current), monthly, allocations, timeline, difference:commitmentDifference(current,result) };
}
export function compareFixedCommitments(p, scenarios) {
  const current = calculatePortfolio(p);
  return [{ id:'current', name:'Current Payment Strategy', result:current }, ...scenarios.map(s => {
    try { return { id:s.id, name:s.name, options:s.options, result:simulateFixedCommitment(p,s.options) }; }
    catch(error) { return { id:s.id, name:s.name, options:s.options, error:error.message }; }
  })];
}
