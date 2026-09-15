import { calculate } from './engine.js';
import { parseDate, firstPayment, monthsBetween } from './dates.js';
export function baselineConfig(c) {
  return { ...c, extra: 0, variables: [], lumps: (c.lumps || []).filter(r => r.park) };
}
// Fixed-payment comparisons preserve dated lump sums, flexi movements and rate changes.
// Variable monthly overrides are excluded so the proposed fixed amount applies every month.
export function fixedConfig(c, total) { return { ...c, normal: total, extra: 0, variables: [] }; }
export function compare(c) {
  const baseline = calculate(baselineConfig(c));
  const strategy = calculate(c);
  return { baseline, strategy, savedInterest: baseline.status === 'paid' && strategy.status === 'paid' ? baseline.interestPaid - strategy.interestPaid : null, savedMonths: baseline.status === 'paid' && strategy.status === 'paid' ? Math.max(0, monthsBetween(parseDate(strategy.payoff), parseDate(baseline.payoff))) : null };
}
export function extraScenarios(c) {
  const scale = Number(c.normal) > 10000 ? Math.ceil(Number(c.normal) / 2000) : Number(c.normal) < 500 ? 0.1 : 1;
  const extras = [...new Set([0, ...[100, 300, 500, 1000, 1500, 2000, 3000, 5000].map(n => n * scale), Number(c.extra)])].sort((a, b) => a - b);
  return extras.map(extra => ({ extra, total: Number(c.normal) + extra, result: calculate({ ...c, extra, variables: [] }, { includeRows: false }) }));
}
export function solveTarget(c, date) {
  const target = parseDate(date), start = parseDate(c.start);
  if (!Number.isFinite(target) || target <= start) return { error: 'Choose a target date after the calculation start date.' };
  if (monthsBetween(start, target) > 1200) return { error: 'Choose a target within 100 years.' };
  const works = amount => calculate(fixedConfig(c, amount), { endDate: date, includeRows: false }).status === 'paid';
  if (works(0)) return { required: 0, additional: 0 };
  if (firstPayment(start, Number(c.paymentDay)) > target) return { error: 'No monthly payment falls before this target. Choose a later date or add a principal lump sum.' };
  let low = 0, high = Math.max(Number(c.principal), Number(c.normal), 1);
  for (let i = 0; i < 30 && !works(high); i++) high *= 2;
  if (!works(high)) return { error: 'Unable to find a payment for this target.' };
  for (let i = 0; i < 55; i++) { const mid = (low + high) / 2; if (works(mid)) high = mid; else low = mid; }
  const required = Math.ceil(high * 100) / 100;
  return { required, additional: Math.max(0, required - Number(c.normal)) };
}
