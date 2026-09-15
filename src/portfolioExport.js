import { money, monthDate, escapeHtml as esc } from './format.js';
import { activeLoans } from './storage.js';
export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function portfolioSummary(p, r) {
  return `Mortgage Portfolio\nActive loans: ${r.activeCount}\nTotal outstanding: ${money(r.principal)}\nTotal normal monthly instalments: ${money(r.normal)}\nCurrent extra payments: ${money(r.extra)}\nTotal monthly mortgage payments: ${money(r.monthly)}\nWeighted Average Current Rate: ${r.weightedRate.toFixed(2)}% (summary only)\nCurrent strategy estimated portfolio settlement: ${r.activeCount ? monthDate(r.payoff) : 'No active loans'}\nEstimated future interest: ${money(r.interest)}\nTotal flexi funds: ${money(r.flexi)}\nEffective interest-bearing balance: ${money(r.effective)}\nEach loan is calculated separately from its own start date. Estimates only.`;
}
export function portfolioCSV(r) {
  const header = ['Year', 'Starting Portfolio Balance (RM)', 'Payments (RM)', 'Interest (RM)', 'Principal Paid (RM)', 'Ending Balance (RM)'];
  return '\uFEFF' + [header, ...r.years.map(y => [y.year, ...['starting', 'payment', 'interest', 'principalPaid', 'ending'].map(k => y[k].toFixed(2))])].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
export const DISCLAIMER = 'This calculator provides estimates only. Different banks and loan products may use different interest-calculation conventions, posting dates, flexi-offset rules, redraw conditions, fees and payment allocation rules. Portfolio comparisons are simulations based on the assumptions entered. Verify important figures against your bank statements and loan agreements.';
function originalInfo(original) {
  const parts = [];
  if (original.amount !== '') parts.push(`Original amount: ${money(Number(original.amount))}`);
  if (original.start) parts.push(`Started: ${esc(original.start)}`);
  if (original.tenure !== '') parts.push(`Tenure: ${esc(original.tenure)} years`);
  if (original.rate !== '') parts.push(`Original rate: ${esc(original.rate)}% p.a.`);
  if (original.normal !== '') parts.push(`Original instalment: ${money(Number(original.normal))}`);
  return parts.join('; ') || 'Not entered';
}
function eventsReport(config) {
  const tables = [
    ['Future interest rate changes',['Effective date','Annual interest rate'],config.rates.map(r=>[esc(r.date),`${esc(r.rate)}% p.a.`])],
    ['Variable monthly payments',['Month','Normal payment','Extra payment'],config.variables.map(r=>[esc(r.month),money(Number(r.normal)),money(Number(r.extra))])],
    ['Lump sums',['Date','Amount','Treatment'],config.lumps.map(r=>[esc(r.date),money(Number(r.amount)),r.park?'Park in flexi':'Pay loan'])],
    ['Flexi transactions',['Date','Transaction','Amount'],config.transactions.map(r=>[esc(r.date),esc(r.type),money(Number(r.amount))])]
  ];
  return tables.filter(([, ,rows])=>rows.length).map(([title,columns,rows])=>`<h4>${title}</h4><table><thead><tr>${columns.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('');
}
export function portfolioPrint(p, r) {
  const loans = activeLoans(p), label = l => `${esc(l.name)}${l.bank ? ` · ${esc(l.bank)}` : ''}`;
  return `<h1>Mortgage Portfolio</h1><p>Prepared ${new Date().toLocaleDateString('en-MY')} · ${esc(p.name)}</p><pre>${esc(portfolioSummary(p, r))}</pre><h2>Loan Summary</h2><table><thead><tr><th>Loan / Bank</th><th>Outstanding</th><th>Rate</th><th>Monthly total</th><th>Future interest</th><th>Payoff</th></tr></thead><tbody>${loans.map(l => `<tr><td>${label(l)}</td><td>${money(Number(l.config.principal))}</td><td>${l.config.rate}%</td><td>${money(Number(l.config.normal) + Number(l.config.extra))}</td><td>${r.results[l.id].status === 'paid' ? money(r.results[l.id].interestPaid) : 'Unsettled'}</td><td>${monthDate(r.results[l.id].payoff)}</td></tr>`).join('')}</tbody></table><h2>Payoff Timeline</h2><ol>${[...loans].sort((a, b) => (r.results[a.id].payoff || '9999').localeCompare(r.results[b.id].payoff || '9999')).map(l => `<li>${monthDate(r.results[l.id].payoff)} — ${label(l)}</li>`).join('')}</ol><h2>Future Interest Breakdown</h2><ul>${loans.map(l => `<li>${label(l)}: ${r.results[l.id].status === 'paid' ? money(r.results[l.id].interestPaid) : 'Not fully repaid'}${r.interest > 0 ? ` (${(r.results[l.id].interestPaid / r.interest * 100).toFixed(1)}%)` : ''}</li>`).join('')}</ul><h2>Payment Strategy</h2><p>Current saved loan payments: ${money(r.monthly)} per month. Exploratory additional budget: ${money(Number(p.settings.additional))}; ${esc(p.settings.strategy)}; rollover ${p.settings.rollover ? 'on' : 'off'}. Exploratory simulations do not change this report’s saved-loan projections.</p><h2>Individual Loan Details</h2>${p.loans.map(l => `<section class="print-loan"><h3>${label(l)} (${l.status})</h3><p>Property: ${esc(p.properties.find(x => x.id === l.propertyId)?.name || l.propertyName || '—')} · Reference: ${esc(l.accountReference || '—')}</p><p>Principal ${money(Number(l.config.principal))}; normal ${money(Number(l.config.normal))}; extra ${money(Number(l.config.extra))}; flexi ${money(Number(l.config.flexi))}; offset ${l.config.offset ? 'enabled' : 'disabled'}.</p><p>Start ${l.config.start}; payment day ${l.config.paymentDay}; ${l.config.method} reducing balance at ${l.config.rate}% p.a.</p><p>Original information (informational only): ${originalInfo(l.original)}</p><p>Bank assumptions: ${esc(l.assumptions || 'Standard calculator assumptions. Verify with bank.')}</p><p>Notes: ${esc(l.notes)}</p>${eventsReport(l.config)}</section>`).join('')}<h2>Assumptions</h2><p>Daily Actual/365; monthly rate/12 with cycle-day proration. Interest is paid first and unpaid interest is not compounded. Flexi funds remain separate. Future projected settlements do not automatically change a saved loan’s status. Different starting dates are independent snapshots; balances are held at the entered amount before their start dates. Strategy envelopes are assigned monthly; released configured payments roll from the following calendar month.</p><p>${DISCLAIMER}</p>`;
}
