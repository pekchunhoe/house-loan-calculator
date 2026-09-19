import { calculate } from './engine.js';
import { parseDate, iso, DAY, paymentDate } from './dates.js';
import { defaultAssumptions, validateAssumptions, matchQuality, assumptionLabel, DEFAULT_THRESHOLDS } from './calibrationModel.js';

export const TRANSACTION_TYPES = ['normal','extra','lump','deposit','withdrawal','interest','fee','adjustment','other'];
export const FEE_TYPES = ['service','maintenance','redraw','insurance','late','legal','other'];
const present = v => v !== '' && v !== undefined && v !== null;
const number = v => present(v) && ['string','number'].includes(typeof v) && Number.isFinite(Number(v));
export function validateStatement(s) {
  if (!s || typeof s !== 'object') return ['Invalid statement.'];
  const errors = [];
  const start = parseDate(s.start), end = parseDate(s.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 3660 * DAY) errors.push('Choose a valid statement period of up to ten years.');
  for (const k of ['opening','closing','interest','payment']) if (!number(s[k]) || Number(s[k]) < 0) errors.push(`${k}: enter a non-negative amount.`);
  if (!(Number(s.opening) > 0)) errors.push('Opening principal must be greater than zero.');
  for (const k of ['extra','lump','flexiStart','flexiEnd','rate']) if (present(s[k]) && (!number(s[k]) || Number(s[k]) < 0 || (k === 'rate' && Number(s[k]) > 100))) errors.push(`${k}: enter a valid non-negative value.`);
  for (const k of ['paymentDate','interestDate']) if (present(s[k]) && (!Number.isFinite(parseDate(s[k])) || s[k] < s.start || s[k] > s.end)) errors.push(`${k} must be within the statement period.`);
  for (const key of ['transactions','rates']) {
    if (s[key] !== undefined && !Array.isArray(s[key])) { errors.push(`Invalid ${key}.`); continue; }
    const dates = new Set();
    for (const r of s[key] || []) {
      if (!r || !Number.isFinite(parseDate(r.date)) || r.date < s.start || r.date > s.end) { errors.push(`${key}: dates must fall within the statement period.`); continue; }
      const value = key === 'rates' ? r.rate : r.amount;
      if (!number(value) || (key === 'rates' || r.type !== 'adjustment') && Number(value) < 0 || key === 'rates' && Number(value) > 100) errors.push(`Invalid ${key} amount/rate.`);
      if (key === 'rates' && dates.has(r.date)) errors.push('Use one historical rate per date.');
      dates.add(r.date);
      if (key === 'transactions' && !TRANSACTION_TYPES.includes(r.type)) errors.push('Invalid transaction type.');
    }
  }
  if (s.fees !== undefined && (!s.fees || typeof s.fees !== 'object' || Array.isArray(s.fees))) errors.push('Invalid fees.');
  else for (const [k,v] of Object.entries(s.fees || {})) if (!FEE_TYPES.includes(k) || !number(v) || (k !== 'legal' && Number(v) < 0)) errors.push('Invalid fee or adjustment.');
  if (s.notes !== undefined && typeof s.notes !== 'string') errors.push('Notes must be text.');
  if (s.locked !== undefined && typeof s.locked !== 'boolean') errors.push('Invalid statement lock.');
  return [...new Set(errors)];
}
export function calibrate(loan, statement, assumptions = defaultAssumptions(loan.config), { trace = false, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const errors = [...validateStatement(statement), ...validateAssumptions(assumptions)];
  if (errors.length) throw new Error(errors.join('\n'));
  const s = structuredClone(statement), a = structuredClone(assumptions), config = structuredClone(loan.config);
  const warnings = [], tx = s.transactions || [];
  const rateMap = new Map((config.rates || []).filter(r => r.date <= s.end).map(r => [r.date, r]));
  for (const r of s.rates || []) rateMap.set(r.date,r);
  const rates = [...rateMap.values()].sort((a,b) => a.date.localeCompare(b.date));
  let savedRate = Number(config.rate);
  for (const r of rates.filter(r => r.date <= s.start)) savedRate = Number(r.rate);
  const startRate = present(s.rate) ? Number(s.rate) : savedRate;
  if (!present(s.rate)) warnings.push('Starting rate inferred from saved settings; verify the historical rate.');
  const date = new Date(parseDate(s.start));
  let scheduled = iso(paymentDate(date.getUTCFullYear(), date.getUTCMonth(), Number(config.paymentDay)));
  if (scheduled < s.start || scheduled > s.end) scheduled = s.end;
  const fallback = a.paymentTiming === 'scheduled' ? scheduled : s.paymentDate || s.end;
  const payments = [];
  let missingDates = false;
  for (const [type,key] of [['normal','payment'],['extra','extra'],['lump','lump']]) {
    const exact = tx.filter(t => t.type === type);
    if (exact.length) {
      const total = exact.reduce((n,t) => n + Number(t.amount),0);
      if (Math.abs(total - Number(s[key] || 0)) > 0.005) warnings.push(`${type} dated transactions replace the summary amount; their total differs.`);
      payments.push(...exact.map(t => ({ ...t })));
    } else if (Number(s[key]) > 0) { payments.push({date:fallback,type,amount:Number(s[key])}); if (!s.paymentDate) missingDates = true; }
  }
  if (missingDates) warnings.push(`Missing payment dates: undated summary payments are assumed on ${fallback}. Daily interest may differ.`);
  if (a.paymentTiming === 'scheduled') warnings.push('Scheduled timing places each payment on its month’s scheduled day, clamped within the statement.');
  if (a.paymentTiming === 'scheduled') for (const p of payments) {
    const d = new Date(parseDate(p.date));
    p.date = [s.start,iso(paymentDate(d.getUTCFullYear(),d.getUTCMonth(),Number(config.paymentDay)))].sort().at(-1);
    if (p.date > s.end) p.date = s.end;
  }
  Object.assign(config, { start:s.start, principal:Number(s.opening), rate:startRate, normal:0, extra:0, flexi:Number(s.flexiStart || 0), offset:a.flexi !== 'ignored', method:a.basis, calculationAssumptions:a, variables:[], lumps:[],
    rates:rates.filter(r => r.date > s.start && r.date <= s.end), transactions:tx.filter(t => ['deposit','withdrawal'].includes(t.type)) });
  const postingDates = tx.filter(t=>t.type==='interest').map(t=>t.date);
  if (s.interestDate) postingDates.push(s.interestDate);
  const result = calculate(config, {endDate:iso(parseDate(s.end) + DAY), explicitPayments:payments, trace, postingDates, traceTransactions:tx.filter(t=>['interest','fee','adjustment','other'].includes(t.type)), allowFuturePayments:true});
  if (result.status === 'invalid') throw new Error(result.errors.join('\n'));
  const predicted = result.interestAccrued, difference = predicted - Number(s.interest);
  const percent = Number(s.interest) === 0 ? predicted === 0 ? 0 : null : difference / Number(s.interest) * 100;
  const exactFees = tx.filter(t => ['fee','adjustment'].includes(t.type));
  const fees = exactFees.length ? exactFees.reduce((n,t) => n + Number(t.amount),0) : Object.values(s.fees || {}).reduce((n,v) => n + Number(v),0);
  if (exactFees.length && Object.values(s.fees || {}).some(v => Number(v))) warnings.push('Dated fees/adjustments replace all summary fees to avoid double counting.');
  const actualPayments = payments.reduce((n,p) => n + Number(p.amount),0);
  const posted = tx.filter(t => t.type === 'interest');
  if (posted.length && Math.abs(posted.reduce((n,t) => n + Number(t.amount),0) - Number(s.interest)) > 0.005) warnings.push('Interest Posted transactions differ from Interest Charged; the statement Interest Charged field is used for comparison.');
  if (tx.some(t => t.type === 'other')) warnings.push('Other transactions are annotations only; classify balance movements as a fee, adjustment or payment.');
  if (present(s.flexiEnd) && Math.abs(Number(s.flexiEnd) - result.flexi) > .005) warnings.push('Closing flexi balance differs: enter missing dated flexi movements. No automatic movement was inferred.');
  const reconciliation = Number(s.opening) + Number(s.interest) + fees - actualPayments;
  if (Math.abs(reconciliation - Number(s.closing)) > .005) warnings.push(`Unexplained balance residual: RM ${(reconciliation - Number(s.closing)).toFixed(2)}. Check missing transactions and whether closing principal excludes unpaid interest or fees.`);
  if (fees) warnings.push('Fees/adjustments participate in reconciliation only; they do not earn interest or change the engine principal.');
  if (actualPayments - result.totalPayments > .005) warnings.push('Entered payments exceed the simulated debt; the engine caps repayments at the debt due.');
  return { assumptions:a, label:assumptionLabel(a), predictedInterest:predicted, actualInterest:Number(s.interest), difference, percent, quality:matchQuality(difference,percent,thresholds),
    predictedPrincipal:result.remaining, actualPrincipal:Number(s.closing), principalDifference:result.remaining - Number(s.closing), predictedAccountBalance:result.remaining + result.unpaidInterest + fees,
    reconciliation:{opening:Number(s.opening),interest:Number(s.interest),fees,payments:actualPayments,closing:reconciliation,residual:reconciliation - Number(s.closing)},
    rateMismatch:present(s.rate) && Math.abs(Number(s.rate) - Number(loan.config.rate)) > 1e-9, savedRate:Number(loan.config.rate), historicalRate:savedRate, flexiEnd:result.flexi,
    warnings:[...warnings,...result.warnings], rows:result.rows, dailyRows:result.dailyRows || [], monthlyRows:result.monthlyRows || [], postings:result.postings || [], unpostedInterest:result.unpostedInterest, unpaidInterest:result.unpaidInterest };
}
export function comparePeriods(loan, statements, assumptions, options = {}) {
  const results = statements.map(s => calibrate(loan,s,assumptions,options));
  const percentages = results.filter(r => r.percent !== null);
  return {assumptions,label:assumptionLabel(assumptions),results,periods:results.length, meanAbsolute:results.length ? results.reduce((n,r)=>n+Math.abs(r.difference),0)/results.length : null,
    maximumAbsolute:results.length ? Math.max(...results.map(r=>Math.abs(r.difference))) : null,
    meanPercentage:percentages.length ? percentages.reduce((n,r)=>n+Math.abs(r.percent),0)/percentages.length : null, percentagePeriods:percentages.length};
}
export function assumptionCandidates(base) {
  const sets = [];
  for (const dayCount of ['Actual/365','Actual/366','Actual/360','Monthly / 12']) for (const timing of ['beginning','end']) for (const flexi of ['daily','monthly','ignored']) sets.push({...base,dayCount,basis:dayCount === 'Monthly / 12' ? 'monthly' : 'daily',timing,flexi});
  return sets;
}
export function compareAssumptions(loan, statements, base = defaultAssumptions(loan.config)) {
  return assumptionCandidates(base).map(a=>comparePeriods(loan,statements,a)).sort((a,b)=>a.meanAbsolute-b.meanAbsolute);
}
