export function effectiveBalance(principal, flexi, offset = true) {
  return Math.max(0, principal - (offset ? flexi : 0));
}
export function moveFlexi(balance, type, amount, allowOverdraft = false) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Flexi transaction amounts must be zero or greater.');
  const next = balance + (type === 'withdrawal' ? -amount : amount);
  return { balance: allowOverdraft ? next : Math.max(0, next), clipped: !allowOverdraft && next < 0 };
}
