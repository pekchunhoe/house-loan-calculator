import { calculate, validate, yearlySchedule } from './engine.js';
import { effectiveBalance } from './flexi.js';
import { compare, extraScenarios, solveTarget, fixedConfig } from './scenarios.js';
import { defaults } from './persistence.js';
import { money, monthDate, fullDate, duration, escapeHtml as esc } from './format.js';
import { firstPayment, nextPayment, parseDate, iso, monthsBetween } from './dates.js';
import { summary, downloadSchedule } from './export.js';
import { renderBalance, renderComposition, renderSavings } from './charts.js';
import { getSelectedLoan, saveSelected, loadedPortfolio } from './session.js';
import { assumptionLabel, CALIBRATION_CONVENTIONS } from './calibrationModel.js';

const $ = selector => document.querySelector(selector);
const loaded = { state: structuredClone(getSelectedLoan()?.config || defaults()), restored: loadedPortfolio.restored, warning: loadedPortfolio.warning };
let state = loaded.state, comparison, scenarios, targetResult, budgetResult, summaryText = '', scheduleView = 'monthly', rowLimit = 24, printMode = false, updateTimer, toastTimer, assumptionsWereOpen = false;
const formFields = ['principal', 'rate', 'normal', 'extra', 'start', 'paymentDay', 'method', 'flexi', 'offset'];
$('#paymentDay').innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}${i === 0 || i === 20 || i === 30 ? 'st' : i === 1 || i === 21 ? 'nd' : i === 2 || i === 22 ? 'rd' : 'th'} of the month</option>`).join('');
function syncFields() {
  for (const key of [...formFields, 'budget', 'target']) $('#' + key).value = state[key];
  $('#overdraft').checked = state.overdraft;
  renderEditors();
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function persist() {
  const ok = saveSelected(state);
  $('#save-status').textContent = ok ? 'Saved on this device' : 'Browser storage unavailable — keep this page open or export your plan.';
}
function changed() {
  state.demo = false; persist(); clearTimeout(updateTimer); updateTimer = setTimeout(() => { updateTimer = null; update(); }, 120);
}
function renderFlexi() {
  $('#monthly-total').textContent = money(Number(state.normal) + Number(state.extra));
  $('#flexi-breakdown').innerHTML = [['Loan principal', Number(state.principal)], ['Flexi money', Number(state.flexi)], ['Interest-bearing balance', effectiveBalance(Number(state.principal), Number(state.flexi), state.offset)]].map(([label, value]) => `<div><span>${label}</span><strong>${money(value)}</strong></div>`).join('');
  $('#demo-label').textContent = state.demo ? 'Demo values' : 'Your values';
  document.querySelectorAll('[data-extra]').forEach(el => { el.classList.toggle('active', Number(el.dataset.extra) === Number(state.extra)); el.setAttribute('aria-pressed', Number(el.dataset.extra) === Number(state.extra)); });
  $('#method-note').textContent = state.method === 'daily' ? 'Actual days × annual rate ÷ 365, including leap days. Your bank’s calculation may differ.' : 'Annual rate ÷ 12 for a full payment cycle. Partial cycles and dated changes are prorated by days.';
  if (state.calculationAssumptions) $('#method-note').textContent = `Applied calibration assumptions: ${assumptionLabel(state.calculationAssumptions)}. Unpaid interest remains separate without compounding.`;
}
function update() {
  renderFlexi();
  if (state.principal !== '' && Number(state.principal) === 0) {
    comparison = null; $('#validation').hidden = false; $('#validation').textContent = 'Settled — this loan has zero outstanding principal. Its history is retained in your portfolio.';
    $('#result-content').hidden = true; $('#lower-results').hidden = true;
    $('#schedule-table').innerHTML = '<p class="empty-editor">No future payments for this settled loan.</p>';
    document.querySelectorAll('[data-action="csv"], [data-action="copy"], [data-action="print"]').forEach(b => b.disabled = true);
    return;
  }
  const errors = validate(state);
  $('#validation').hidden = errors.length === 0;
  $('#result-content').hidden = errors.length > 0; $('#lower-results').hidden = errors.length > 0;
  document.querySelectorAll('[data-action="csv"], [data-action="copy"], [data-action="print"]').forEach(b => b.disabled = errors.length > 0);
  if (errors.length) {
    $('#validation').innerHTML = `<strong>Check your loan details</strong><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
    comparison = null; $('#schedule-table').innerHTML = '<p class="empty-editor">Correct the highlighted loan details to calculate a schedule.</p>'; $('#schedule-info').textContent = ''; $('[data-action="more"]').hidden = true; return;
  }
  comparison = compare(state); scenarios = extraScenarios(state);
  const { baseline: b, strategy: s, savedInterest, savedMonths } = comparison;
  $('#payoff-date').textContent = s.status === 'paid' ? monthDate(s.payoff) : 'Review your payment';
  $('#payoff-duration').textContent = s.status === 'paid' ? `${duration(s.months)} remaining · ${fullDate(s.payoff)}` : 'Your current payment may not be sufficient to fully repay the loan.';
  $('#metrics').innerHTML = [
    ['Total remaining payments', s.status === 'paid' ? money(s.totalPayments) : 'No payoff estimate', 'Principal + future interest'],
    ['Interest from start date', s.status === 'paid' ? money(s.interestPaid) : 'No payoff estimate', 'Based on your current strategy'],
    ['Principal remaining', money(Number(state.principal)), 'Your starting loan balance'],
    ['Estimated final payment', money(s.finalPayment), 'Automatically adjusted to settle'],
    ['Payments remaining', s.status === 'paid' ? `${s.paymentCount} payment${s.paymentCount === 1 ? '' : 's'}` : '—', `${s.monthlyCount} monthly instalment${s.monthlyCount === 1 ? '' : 's'} projected`],
    ['Flexi money at settlement', s.status === 'paid' ? money(s.flexi) : '—', 'Tracked separately from principal']
  ].map(([label, value, sub]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-sub">${sub}</div></div>`).join('');
  const plan = (r, name, current) => `<div class="compare-plan ${current ? 'current' : ''}"><div class="compare-label">${name}</div><div class="compare-date">${monthDate(r.payoff)}</div><div class="compare-duration">${duration(r.months)}${r.months !== null ? ` · ${r.months} months` : ''}</div><div class="compare-stat"><span>Total interest</span><strong>${r.status === 'paid' ? money(r.interestPaid) : 'No payoff estimate'}</strong></div><div class="compare-stat"><span>Total payments</span><strong>${r.status === 'paid' ? money(r.totalPayments) : 'No payoff estimate'}</strong></div></div>`;
  $('#comparison').innerHTML = `<div class="compare-grid">${plan(b, 'Normal payments', false)}${plan(s, 'Your current strategy', true)}</div>`;
  $('#savings').innerHTML = savedInterest !== null ? `<span class="savings-symbol" aria-hidden="true">↗</span><div class="saving"><small>${savedInterest >= 0 ? 'Interest you save' : 'Additional interest'}</small><strong>${money(Math.abs(savedInterest))}</strong></div><div class="saving"><small>${b.payoff >= s.payoff ? 'Time you get back' : 'Additional time'}</small><strong>${duration(b.payoff >= s.payoff ? savedMonths : monthsBetween(parseDate(b.payoff), parseDate(s.payoff)))}</strong></div>` : '<p class="quiet-note">Savings need two fully repaid projections. Increase the normal instalment or adjust your plan to compare.</p>';
  const warnings = [...new Set(s.warnings)];
  if (warnings.length) { $('#validation').hidden = false; $('#validation').innerHTML = warnings.map(w => `<p>${esc(w)}</p>`).join(''); }
  $('#chart-caption').textContent = savedMonths !== null ? `Your strategy ${b.payoff >= s.payoff ? 'brings settlement forward' : 'extends settlement'} by approximately ${duration(b.payoff >= s.payoff ? savedMonths : monthsBetween(parseDate(b.payoff), parseDate(s.payoff)))}.` : 'Unsettled projections show remaining principal only; any unpaid interest is additional.';
  summaryText = summary(state, comparison); $('#smart-summary').textContent = summaryText;
  renderScenarioTable(); renderSchedule(); renderAssumptions(); updateBudget(); updateTarget(); drawCharts();
}
function drawCharts() {
  if (!comparison) return;
  renderBalance($('#balance-chart'), comparison.baseline, comparison.strategy);
  renderComposition($('#composition-chart'), comparison.strategy);
  renderSavings($('#scenario-chart'), scenarios);
}
function renderScenarioTable() {
  const base = scenarios.find(s => s.extra === 0).result;
  $('#scenario-table tbody').innerHTML = scenarios.map(({ extra, total, result: r }) => {
    const selected = extra === Number(state.extra) && !state.variables.length;
    return `<tr class="scenario-row ${selected ? 'selected' : ''}" data-scenario="${extra}"><td><button class="scenario-choice" data-scenario="${extra}" aria-label="Use ${money(extra)} extra monthly" aria-pressed="${selected}">${money(extra)}${selected ? '<span class="selected-label">Your plan</span>' : ''}</button></td><td>${money(total)}</td><td>${monthDate(r.payoff)}</td><td>${duration(r.months)}</td><td>${r.status === 'paid' ? money(r.interestPaid) : '—'}</td><td>${r.status === 'paid' && base.status === 'paid' ? money(base.interestPaid - r.interestPaid) : '—'}</td></tr>`;
  }).join('') + (state.variables.length ? `<tr class="selected"><td>Current variable strategy</td><td>Varies by month</td><td>${monthDate(comparison.strategy.payoff)}</td><td>${duration(comparison.strategy.months)}</td><td>${comparison.strategy.status === 'paid' ? money(comparison.strategy.interestPaid) : '—'}</td><td>${comparison.strategy.status === 'paid' && base.status === 'paid' ? money(base.interestPaid - comparison.strategy.interestPaid) : '—'}</td></tr>` : '');
}
function updateBudget() {
  if (!comparison) return;
  const value = state.budget === '' ? NaN : Number(state.budget);
  const max = Math.max(1000, Number(state.normal) * 6, value || 0);
  $('#budget-range').max = max; $('#budget-range').value = Number.isFinite(value) ? value : 0; $('#range-max').textContent = money(max);
  $('[data-action="apply-budget"]').disabled = !Number.isFinite(value) || value < 0;
  if (!Number.isFinite(value) || value < 0) { $('#budget-result').innerHTML = '<p class="warning-line">Enter a monthly amount of zero or greater.</p>'; return; }
  budgetResult = calculate(fixedConfig(state, value), { includeRows: false });
  const r = budgetResult, b = comparison.baseline;
  if (r.status !== 'paid') { $('#budget-result').innerHTML = '<p class="warning-line">Your current payment may not be sufficient to fully repay the loan.</p>'; return; }
  $('#budget-result').innerHTML = `<div><small>Mortgage-free by</small><strong>${monthDate(r.payoff)}</strong></div><div><small>Future interest</small><strong>${money(r.interestPaid)}</strong></div><p>${duration(r.months)} remaining${b.status === 'paid' ? ` · ${money(b.interestPaid - r.interestPaid)} interest saved · ${Math.max(0, monthsBetween(parseDate(r.payoff), parseDate(b.payoff)))} months saved` : ''}</p>`;
}
function updateTarget() {
  if (!comparison) return;
  targetResult = solveTarget(state, state.target);
  $('[data-action="apply-target"]').disabled = !!targetResult.error;
  $('#target-result').innerHTML = targetResult.error ? `<p class="warning-line">${esc(targetResult.error)}</p>` : `<small>Required monthly payment</small><div class="required">${money(targetResult.required)}</div><p>That's <strong>${money(targetResult.additional)} extra</strong> per month.</p><p class="quiet-note">Calculated to repay on or before ${fullDate(state.target)}.</p>`;
}
function renderSchedule() {
  if (!comparison) return;
  const flexi = $('#show-flexi').checked;
  const all = scheduleView === 'yearly' ? yearlySchedule(comparison.strategy.rows) : comparison.strategy.rows;
  const visible = printMode ? all : all.slice(0, rowLimit);
  const head = scheduleView === 'yearly' ? ['Year', 'Starting principal', 'Total payments', 'Interest paid', 'Principal paid', 'Ending principal'] : ['No.', 'Date', 'Starting balance', 'Interest paid', 'Normal payment', 'Extra payment', 'Lump sum', 'Principal paid', 'Ending balance', ...(flexi ? ['Flexi balance', 'Interest-bearing balance'] : [])];
  $('#schedule-table').innerHTML = `<table><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${visible.map(r => {
    const cells = scheduleView === 'yearly' ? [r.year, ...['starting', 'payment', 'interest', 'principalPaid', 'ending'].map(k => money(r[k]))] : [r.no, `${fullDate(r.date)}${r.kind !== 'Monthly payment' ? `<span class="event-note">${esc(r.kind)}${r.movement ? `: ${money(r.movement)}` : ''}</span>` : ''}${r.accruedInterest > 0.005 ? `<span class="event-note">Unpaid interest: ${money(r.accruedInterest)}</span>` : ''}`, ...['starting', 'interest', 'normal', 'extra', 'lump', 'principalPaid', 'ending', ...(flexi ? ['flexi', 'effective'] : [])].map(k => money(r[k]))];
    return `<tr>${cells.map(v => `<td>${v}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table>`;
  $('#schedule-info').textContent = `Showing ${visible.length} of ${all.length} ${scheduleView === 'yearly' ? 'years' : 'events'} · amounts in RM`;
  $('[data-action="more"]').hidden = visible.length >= all.length;
}
function renderAssumptions() {
  const first = iso(firstPayment(parseDate(state.start), Number(state.paymentDay)));
  $('#assumptions').innerHTML = `<ul><li>${state.calculationAssumptions ? esc(assumptionLabel(state.calculationAssumptions)) + '. ' + CALIBRATION_CONVENTIONS : state.method === 'daily' ? 'Daily: effective balance × annual rate ÷ 365 × actual elapsed days. Leap days accrue interest using the same 365 divisor.' : 'Monthly: effective balance × annual rate ÷ 12 per complete payment cycle. A partial first cycle and changes within a cycle are prorated by elapsed days in that cycle.'}</li><li>First regular payment: ${fullDate(first)}. Payments start strictly after the calculation start date. Days 29–31 are clamped to the last valid day of shorter months.</li><li>${state.calculationAssumptions?.timing === 'end' ? 'Transactions take effect after their dated day; rates take effect at the beginning of their dated day.' : 'Interest accrues up to, but excluding, each event date.'} Same-day order: rate changes, flexi movements, parked lump sums, principal lump sums, then monthly payment.</li><li>All loan payments cover accrued interest first. Remaining money reduces principal. Unpaid interest is carried separately without interest-on-interest.</li><li>Flexi offsets ${state.offset ? 'are enabled, with no offset cap' : 'are disabled'}. Funds remain parked until a dated withdrawal; repayments come from separate funds. ${state.overdraft ? 'Negative flexi funds increase the interest-bearing balance at the loan rate.' : 'Withdrawals are capped at available funds.'}</li><li>Variable rows replace both normal and extra payments for that month. The last payment is capped at the outstanding debt. Unused lump sums are not paid.</li><li>No fees, penalties, insurance, taxes, opening unpaid interest, or bank rounding are modeled. Projection limit: 100 years. Durations round up partial months.</li></ul><p class="quiet-note source-links">Background: <a href="https://www.consumerfinance.gov/ask-cfpb/how-does-paying-down-a-mortgage-work-en-1943/" target="_blank" rel="noreferrer">CFPB: mortgage amortization</a>; <a href="https://www.hlb.com.my/en/personal-banking/loans/property-loan/mortgage-plus.html" target="_blank" rel="noreferrer">HLB: an example of a flexi offset</a>. Check your own bank's terms.</p>`;
}
function renderEditors() {
  const defs = {
    variables: [['Month', 'month', 'month'], ['Normal payment (RM)', 'normal', 'number'], ['Extra payment (RM)', 'extra', 'number']],
    lumps: [['Date', 'date', 'date'], ['Amount (RM)', 'amount', 'number'], ['Treatment', 'park', 'park']],
    transactions: [['Date', 'date', 'date'], ['Transaction', 'type', 'type'], ['Amount (RM)', 'amount', 'number']],
    rates: [['Effective date', 'date', 'date'], ['Annual rate (%)', 'rate', 'number']]
  };
  for (const [key, fields] of Object.entries(defs)) {
    const rows = state[key];
    $('#' + key + '-editor').innerHTML = !rows.length ? '<p class="empty-editor">No entries yet. Add one to include it in your plan.</p>' : `<table><thead><tr>${fields.map(([label]) => `<th>${label}</th>`).join('')}<th>Remove</th></tr></thead><tbody>${rows.map((row, index) => `<tr>${fields.map(([label, prop, type]) => {
      const attrs = `data-list="${key}" data-index="${index}" data-prop="${prop}" aria-label="${label}, row ${index + 1}"`;
      const input = type === 'park' ? `<label><input type="checkbox" ${attrs} ${row[prop] ? 'checked' : ''}>Park in flexi account instead</label>` : type === 'type' ? `<select ${attrs}><option value="deposit" ${row[prop] === 'deposit' ? 'selected' : ''}>Deposit</option><option value="withdrawal" ${row[prop] === 'withdrawal' ? 'selected' : ''}>Withdrawal</option></select>` : `<input type="${type}" ${attrs} value="${esc(row[prop])}" ${type === 'number' ? 'min="0" step="any" inputmode="decimal"' : ''}>`;
      return `<td>${input}</td>`;
    }).join('')}<td><button class="remove-row" data-remove="${key}" data-index="${index}" aria-label="Remove ${key} row ${index + 1}">×</button></td></tr>`).join('')}</tbody></table>`;
  }
}
function applyTotal(total) {
  const amount = Number(total);
  if (!Number.isFinite(amount) || amount < 0) return;
  state.normal = Math.min(Number(state.normal), amount); state.extra = Math.max(0, amount - Number(state.normal)); state.variables = []; state.budget = amount;
  state.demo = false; syncFields(); persist(); update(); toast('Monthly payment applied to your plan.');
}
$('#loan-form').addEventListener('submit', event => event.preventDefault());
document.addEventListener('input', event => {
  const el = event.target;
  if (formFields.includes(el.id)) {
    state[el.id] = el.id === 'offset' ? el.value === 'true' : el.value;
    if(state.calculationAssumptions){
      const a=state.calculationAssumptions;
      if(el.id==='method'){a.basis=el.value;a.dayCount=el.value==='monthly'?'Monthly / 12':a.dayCount==='Monthly / 12'?'Actual/365':a.dayCount;}
      if(el.id==='offset')a.flexi=state.offset?'daily':'ignored';
    }
    changed();
  }
  else if (el.dataset.list) {
    state[el.dataset.list][Number(el.dataset.index)][el.dataset.prop] = el.type === 'checkbox' ? el.checked : el.value; changed();
  } else if (el.id === 'overdraft') { state.overdraft = el.checked; changed(); }
  else if (el.id === 'budget' || el.id === 'budget-range') { state.budget = el.value; $('#budget').value = el.value; persist(); updateBudget(); }
  else if (el.id === 'target') { state.target = el.value; persist(); updateTarget(); }
  else if (el.id === 'show-flexi') renderSchedule();
});
document.addEventListener('click', async event => {
  const el = event.target.closest('button, [data-scenario]'); if (!el) return;
  if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; update(); }
  if (el.dataset.extra !== undefined || el.dataset.scenario !== undefined) {
    state.extra = Number(el.dataset.extra ?? el.dataset.scenario);
    if (el.dataset.scenario !== undefined) { state.variables = []; renderEditors(); }
    $('#extra').value = state.extra; changed(); return;
  }
  if (el.dataset.view) {
    scheduleView = el.dataset.view; rowLimit = 24;
    document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === scheduleView); b.setAttribute('aria-pressed', b.dataset.view === scheduleView); }); renderSchedule(); return;
  }
  if (el.dataset.add) {
    const key = el.dataset.add; const start = Number.isFinite(parseDate(state.start)) ? state.start : defaults().start;
    let date = iso(firstPayment(parseDate(start), Number(state.paymentDay) || 1));
    if (key === 'variables') {
      while (state.variables.some(r => r.month === date.slice(0, 7))) date = iso(nextPayment(parseDate(date), Number(state.paymentDay) || 1));
      state.variables.push({ month: date.slice(0, 7), normal: state.normal, extra: state.extra });
    } else if (key === 'rates') {
      while (state.rates.some(r => r.date === date)) date = iso(nextPayment(parseDate(date), Number(state.paymentDay) || 1));
      state.rates.push({ date, rate: state.rate });
    } else if (key === 'lumps') state.lumps.push({ date, amount: 0, park: false });
    else state.transactions.push({ date, type: 'deposit', amount: 0 });
    renderEditors(); changed(); const inputs = document.querySelectorAll(`#${key}-editor input`); inputs[inputs.length - (key === 'variables' || key === 'lumps' ? 3 : key === 'transactions' ? 2 : 2)]?.focus(); return;
  }
  if (el.dataset.remove) { state[el.dataset.remove].splice(Number(el.dataset.index), 1); renderEditors(); changed(); return; }
  switch (el.dataset.action) {
    case 'more': rowLimit += 60; renderSchedule(); break;
    case 'apply-budget': applyTotal(state.budget); break;
    case 'apply-target': if (!targetResult.error) applyTotal(targetResult.required); break;
    case 'copy':
      try { await navigator.clipboard.writeText(summaryText); toast('Mortgage summary copied.'); }
      catch { toast('Clipboard access was blocked by your browser. Select and copy the plain-language summary.'); } break;
    case 'csv': if (comparison) { downloadSchedule(comparison.strategy.rows); toast('Payment schedule exported.'); } break;
    case 'print': window.print(); break;
    case 'reset': $('#reset-dialog').showModal(); break;
    case 'cancel-reset': $('#reset-dialog').close(); break;
    case 'confirm-reset': state = defaults(); rowLimit = 24; $('#reset-dialog').close(); syncFields(); persist(); update(); toast('Demo values restored.'); break;
  }
});
window.addEventListener('beforeprint', () => {
  if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; update(); }
  if (!printMode) assumptionsWereOpen = $('.assumptions-card details').open;
  printMode = true; $('.assumptions-card details').open = true; renderSchedule(); drawCharts();
});
window.addEventListener('afterprint', () => { printMode = false; $('.assumptions-card details').open = assumptionsWereOpen; renderSchedule(); drawCharts(); });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 120); });
syncFields(); update();
export function selectLoanState(config) {
  clearTimeout(updateTimer); updateTimer = null; state = structuredClone(config); rowLimit = 24;
  syncFields(); update();
}
if (loaded.warning) toast(loaded.warning);
else $('#save-status').textContent = loaded.restored ? 'Your saved plan has been restored' : 'Demo values — edit any field to make this your plan';
