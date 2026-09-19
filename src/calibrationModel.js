export const CALIBRATION_DISCLAIMER = "Calibration compares this calculator's assumptions against figures entered from your bank statement. A close historical match does not guarantee identical future calculations. Banks may apply internal posting rules, fees, rounding, rate changes or transaction timing not fully visible in the statement.";
export const CALIBRATION_CONVENTIONS = 'Statement dates are inclusive. Actual/365 and fixed 365 are equivalent constant divisors; Actual/366 and fixed 366 are equivalent, including outside leap years. Monthly / 12 is prorated over the actual days in the saved loan payment cycle. Payments cover accrued interest first. Daily and monthly offsets are capped at principal; monthly offset uses the opening calendar-month snapshot. Posting dates label accrued interest in a separate ledger without capitalization or compounding, so posting frequency alone does not change interest. Fees and adjustments affect reconciliation only. The reconciliation closing amount includes interest and fees; principal-only bank balances may therefore leave a residual. No bank rounding is inferred.';
export const CLOSEST_MATCH_NOTE = 'This is the closest result among the assumptions tested. It does not prove that the bank uses this exact calculation method.';
export const DEFAULT_THRESHOLDS = { closeAmount: 2, closePercent: 0.2, smallAmount: 10, smallPercent: 0.5, largeAmount: 100, largePercent: 5 };
export const ASSUMPTION_OPTIONS = {
  dayCount: ['Actual/365','Actual/366','Actual/360','365 fixed','366 fixed','Monthly / 12'],
  basis: ['daily','monthly'], flexi: ['daily','monthly','ignored','capped'],
  paymentTiming: ['actual','scheduled'], timing: ['beginning','end'],
  posting: ['monthly','statement','daily']
};
export function defaultAssumptions(config = {}) { return { dayCount: config.method === 'monthly' ? 'Monthly / 12' : 'Actual/365', basis: config.method || 'daily', flexi: config.offset === false ? 'ignored' : 'daily', paymentTiming: 'actual', timing: 'beginning', posting: 'monthly', ...config.calculationAssumptions }; }
export function validateAssumptions(a) {
  const errors = Object.entries(ASSUMPTION_OPTIONS).filter(([k,v]) => !v.includes(a?.[k])).map(([k]) => `Invalid assumption: ${k}.`);
  if (a && (a.basis === 'monthly') !== (a.dayCount === 'Monthly / 12')) errors.push('Monthly basis requires Monthly / 12; daily basis requires a daily day count.');
  return errors;
}
export function validateThresholds(t) {
  return !t || Object.keys(DEFAULT_THRESHOLDS).some(k => !Number.isFinite(Number(t[k])) || Number(t[k]) < 0) || Number(t.closeAmount) > Number(t.smallAmount) || Number(t.smallAmount) > Number(t.largeAmount) || Number(t.closePercent) > Number(t.smallPercent) || Number(t.smallPercent) > Number(t.largePercent) ? ['Thresholds must be non-negative and increase from close to small to large.'] : [];
}
export function matchQuality(difference, percent, t = DEFAULT_THRESHOLDS) {
  if (difference === null || !Number.isFinite(difference)) return 'Not Calibrated';
  const a = Math.abs(difference), p = percent === null ? Infinity : Math.abs(percent);
  if (a <= t.closeAmount || p <= t.closePercent) return 'Close Match';
  if (a <= t.smallAmount || p <= t.smallPercent) return 'Small Difference';
  return a > t.largeAmount && p > t.largePercent ? 'Large Difference' : 'Needs Review';
}
export const assumptionLabel = a => `${a.dayCount} · ${a.basis} · ${a.timing}-of-day · flexi ${a.flexi} · ${a.paymentTiming} payments · ${a.posting} posting`;
