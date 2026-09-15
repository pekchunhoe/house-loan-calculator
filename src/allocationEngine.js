export const STRATEGIES = { 'highest-rate': 'Highest-rate-first', 'lowest-balance': 'Lowest-balance-first', equal: 'Equal allocation', proportional: 'Proportional allocation', custom: 'Custom allocation' };
export function validateAllocation(loans, budget, custom = {}) {
  if (budget === '' || !Number.isFinite(Number(budget)) || Number(budget) < 0) throw new Error('Enter a non-negative additional budget.');
  let total = 0;
  for (const [id, amount] of Object.entries(custom)) {
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0 || amount === '') throw new Error('Allocations must be non-negative numbers.');
    if (Number(amount) > 0 && !loans.some(l => l.id === id)) throw new Error('Only active loans may receive allocations.');
    total += Number(amount);
  }
  if (total > Number(budget) + 1e-7) throw new Error('Custom allocation exceeds the available budget.');
  return total;
}
/** Allocation only: never computes mortgage interest. Inputs are independent loan snapshots. */
export function allocate(loans, budget, strategy, custom = {}) {
  const out = Object.fromEntries(loans.map(l => [l.id, 0]));
  if (!loans.length || budget <= 0) return out;
  if (!(strategy in STRATEGIES)) throw new Error('Choose an allocation strategy.');
  if (strategy === 'highest-rate' || strategy === 'lowest-balance') {
    const sorted = [...loans].sort((a, b) => (strategy === 'highest-rate' ? b.rate - a.rate : a.principal - b.principal) || a.id.localeCompare(b.id));
    out[sorted[0].id] = budget; return out;
  }
  let weights = loans.map(l => strategy === 'equal' ? 1 : strategy === 'custom' ? Number(custom[l.id] || 0) : l.principal);
  let total = weights.reduce((a, b) => a + b, 0);
  if (!total) { weights = loans.map(() => 1); total = loans.length; }
  let used = 0;
  loans.forEach((l, i) => { const share = i === loans.length - 1 ? Math.max(0, budget - used) : budget * weights[i] / total; out[l.id] = share; used += share; });
  return out;
}
