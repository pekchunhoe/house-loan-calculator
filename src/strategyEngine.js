import { activeLoans, clone } from './storage.js';
import { calculatePortfolio, simulateStrategy } from './portfolioEngine.js';
import { allocate, STRATEGIES, validateAllocation } from './allocationEngine.js';
import { calculate } from './engine.js';
import { parseDate } from './dates.js';
export function compareStrategies(p, options) {
  const current = calculatePortfolio(p);
  const strategies = Object.keys(STRATEGIES).filter(s => s !== 'custom' || Object.values(options.custom || {}).some(n => Number(n) > 0));
  return [{ name: 'Current allocation', key: 'current', result: current }, ...strategies.map(strategy => ({ name: STRATEGIES[strategy], key: strategy, result: simulateStrategy(p, { ...options, strategy }) }))];
}
function checkDate(loans, date) {
  if (!Number.isFinite(parseDate(date)) || loans.some(l => date < l.config.start)) throw new Error('Scenario date must be on or after every affected loan’s calculation start date.');
}
function snapshots(p, loans, date) {
  return loans.map(l => {
    const result = date === l.config.start ? null : calculate(l.config, { endDate: date, includeRows: false });
    if (result?.status === 'paid') throw new Error(`${l.name} is projected to settle before the scenario date.`);
    let rate = Number(l.config.rate);
    for (const r of [...l.config.rates].sort((a,b) => a.date.localeCompare(b.date))) if (r.date <= date) rate = Number(r.rate);
    return { id: l.id, principal: result?.remaining ?? Number(l.config.principal), rate };
  });
}
export function lumpScenario(p, { amount, date, strategy = 'equal', loanId, custom = {}, park = false, selectedIds = [] }) {
  const copy = clone(p), loans = activeLoans(copy).filter(l => (!park || !selectedIds.length || selectedIds.includes(l.id)) && (strategy !== 'single' || l.id === loanId));
  validateAllocation(loans, amount, strategy === 'custom' ? custom : {}); checkDate(loans, date);
  if (!loans.length) throw new Error('Select an active loan.');
  let amounts;
  if (strategy === 'single') {
    if (!loans.some(l => l.id === loanId)) throw new Error('Choose an active loan for the lump sum.');
    amounts = { [loanId]: Number(amount) };
  } else if (strategy === 'custom') amounts = custom;
  else if (!park && ['highest-rate', 'lowest-balance'].includes(strategy)) {
    // A one-off priority payment fills each debt, then spills to the next debt.
    const items = snapshots(copy, loans, date).sort((a, b) => strategy === 'highest-rate' ? b.rate - a.rate : a.principal - b.principal);
    let remaining = Number(amount); amounts = {};
    for (const item of items) {
      const loan = loans.find(l => l.id === item.id), r = calculate(loan.config, { endDate: date, includeRows: false });
      const debt = r.remaining + r.unpaidInterest;
      amounts[item.id] = Math.min(remaining, debt); remaining -= amounts[item.id];
    }
  } else amounts = allocate(snapshots(copy, loans, date), Number(amount), strategy, custom);
  for (const loan of loans) if (Number(amounts[loan.id]) > 0) loan.config.lumps.push({ date, amount: Number(amounts[loan.id]), park: !!park });
  return { portfolio: copy, result: calculatePortfolio(copy), amounts };
}
export function flexiScenario(p, { from, to, amount, date }) {
  if (from === to) throw new Error('Choose two different loans.');
  const copy = clone(p), loans = activeLoans(copy), source = loans.find(l => l.id === from), destination = loans.find(l => l.id === to);
  if (!source || !destination) throw new Error('Select active source and destination loans.');
  validateAllocation(loans, amount); checkDate([source, destination], date);
  // New transfers run with flexi transactions, BEFORE same-day parked lump sums.
  const r = calculate({ ...source.config, lumps: source.config.lumps.filter(l => !(l.park && l.date === date)) }, { endDate: date, includeRows: false });
  const destinationResult = calculate(destination.config, { endDate: date, includeRows: false });
  if (r.status === 'paid' || destinationResult.status === 'paid') throw new Error('Both loans must still be active on the transfer date.');
  if (Number(amount) > r.flexi + 1e-8) throw new Error('Transfer exceeds the source loan’s available flexi funds.');
  source.config.transactions.push({ date, type: 'withdrawal', amount: Number(amount) });
  destination.config.transactions.push({ date, type: 'deposit', amount: Number(amount) });
  return { portfolio: copy, result: calculatePortfolio(copy) };
}
export function rateScenario(p, { change = 0, custom = null }) {
  const copy = clone(p);
  for (const loan of activeLoans(copy)) {
    const delta = Number(custom ? custom[loan.id] ?? 0 : change);
    if (!Number.isFinite(delta)) throw new Error('Rate changes must be finite percentage-point amounts.');
    const rates = [Number(loan.config.rate), ...loan.config.rates.map(r => Number(r.rate))].map(r => r + delta);
    if (rates.some(r => r < 0 || r > 100)) throw new Error(`${loan.name}: shocked rates must stay between 0% and 100%.`);
    loan.config.rate = rates[0]; loan.config.rates.forEach((r, i) => { r.rate = rates[i + 1]; });
  }
  const result = calculatePortfolio(copy);
  const firstInterest = Object.fromEntries(activeLoans(copy).map(l => [l.id, result.results[l.id].rows.find(r => r.kind === 'Monthly payment')?.interest ?? 0]));
  return { portfolio: copy, result, firstInterest };
}
