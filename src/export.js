import { money, monthDate, duration } from './format.js';
import { monthsBetween, parseDate } from './dates.js';
export function summary(c, comparison) {
  const { baseline: b, strategy: s, savedMonths, savedInterest } = comparison;
  if (s.status !== 'paid') return 'Your current payment may not be sufficient to fully repay the loan. Adjust the payment or review your strategy.';
  const normal = b.status === 'paid' ? `Normal payments of ${money(Number(c.normal))} would settle the loan in ${monthDate(b.payoff)}, with ${money(b.interestPaid)} in interest.` : 'The normal instalment does not repay the loan within the projection limit.';
  const timing = savedInterest !== null && s.payoff > b.payoff ? `adds approximately ${duration(monthsBetween(parseDate(b.payoff), parseDate(s.payoff)))}` : `saves approximately ${duration(savedMonths)}`;
  const savings = savedInterest !== null ? ` This ${savedInterest >= 0 ? 'saves' : 'adds'} ${money(Math.abs(savedInterest))} in future interest and ${timing}.` : '';
  return `Starting balance: ${money(Number(c.principal))} at ${Number(c.rate)}% p.a. on ${c.start}. ${normal} Your current strategy (${money(Number(c.normal) + Number(c.extra))} per month${c.variables.length ? ', with monthly overrides' : ''}${c.lumps.length ? ' and scheduled lump sums' : ''}) settles the mortgage in ${monthDate(s.payoff)}, with ${money(s.interestPaid)} in interest.${savings} Estimates use ${c.method} reducing balance and your scheduled flexi movements and rate changes.`;
}
export function scheduleCSV(rows) {
  const columns = [['No.', 'no'], ['Date', 'date'], ['Event', 'kind'], ['Starting Balance (RM)', 'starting'], ['Interest Paid (RM)', 'interest'], ['Normal Payment (RM)', 'normal'], ['Extra Payment (RM)', 'extra'], ['Lump Sum (RM)', 'lump'], ['Principal Paid (RM)', 'principalPaid'], ['Ending Balance (RM)', 'ending'], ['Flexi Balance (RM)', 'flexi'], ['Effective Interest Balance (RM)', 'effective'], ['Flexi Movement (RM)', 'movement'], ['Unpaid Interest (RM)', 'accruedInterest'], ['Annual Rate (%)', 'rate']];
  const cell = value => `"${String(value).replaceAll('"', '""')}"`;
  return '\uFEFF' + [columns.map(([title]) => cell(title)).join(','), ...rows.map(row => columns.map(([, key]) => cell(typeof row[key] === 'number' && key !== 'no' ? row[key].toFixed(2) : row[key])).join(','))].join('\r\n');
}
export function downloadSchedule(rows) {
  const url = URL.createObjectURL(new Blob([scheduleCSV(rows)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = 'flexi-mortgage-payment-schedule.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
