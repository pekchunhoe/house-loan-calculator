import { activeLoans } from './storage.js';
import { simulateStrategy } from './portfolioEngine.js';
import { parseDate, monthsBetween, firstPayment } from './dates.js';
import { validateAllocation } from './allocationEngine.js';
export function solvePortfolioTarget(p, date, { strategy = 'highest-rate', rollover = true, custom = {} } = {}) {
  const loans = activeLoans(p), target = parseDate(date);
  if (!loans.length) return { required: 0, current: 0, additional: 0 };
  if (strategy === 'custom' && !Object.values(custom).some(v => Number(v) > 0)) throw new Error('Enter custom allocations to establish the target solver’s proportions.');
  if (strategy === 'custom') validateAllocation(loans, Object.values(custom).reduce((n,v) => n + Number(v),0), custom);
  const start = Math.min(...loans.map(l => parseDate(l.config.start)));
  if (!Number.isFinite(target) || loans.some(l => target <= parseDate(l.config.start)) || monthsBetween(start, target) > 1200) throw new Error('Target must follow every loan’s start date and be within 100 years.');
  const current = loans.reduce((n, l) => n + Number(l.config.normal) + Number(l.config.extra), 0);
  const works = budget => simulateStrategy(p, { budget, strategy, rollover, custom, endDate: date, includeRows: false, scaledCustom: true }).allPaid;
  if (works(0)) return { required: current, current, additional: 0 };
  if (loans.some(l => firstPayment(parseDate(l.config.start), Number(l.config.paymentDay)) > target && !l.config.lumps.some(r => !r.park && r.date <= date))) throw new Error('A loan has no payment date before this target. Choose a later target.');
  let low = 0, high = Math.max(1, loans.reduce((n, l) => n + Number(l.config.principal), 0));
  let feasible = works(high);
  for (let i = 0; i < 20 && !feasible; i++) { high *= 2; feasible = works(high); }
  if (!feasible) throw new Error('This allocation strategy cannot settle all loans by that date under monthly allocation timing. Try a later date or another allocation.');
  for (let i = 0; i < 48; i++) { const mid = (low + high) / 2; if (works(mid)) high = mid; else low = mid; }
  let additional = Math.ceil(high * 100) / 100;
  if (!works(additional)) additional += .01;
  return { current, additional, required: current + additional };
}
