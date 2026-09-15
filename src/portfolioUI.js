import { selectLoanState } from './app.js';
import { getPortfolio, getSelectedLoan, commit, replacePortfolio, subscribe, loadedPortfolio } from './session.js';
import { createLoan, activeLoans, clone, uid, COLORS, exportBackup, importBackup } from './storage.js';
import { defaults } from './persistence.js';
import { markup } from './portfolioMarkup.js';
import { mountLoanIdentity, renderLoanIdentity } from './loanUI.js';
import { portfolioChart } from './portfolioCharts.js';
import { money, monthDate, duration, escapeHtml as esc } from './format.js';
import { monthsBetween, parseDate } from './dates.js';
import { STRATEGIES } from './allocationEngine.js';
import { portfolioSummary, portfolioCSV, downloadFile, portfolioPrint, DISCLAIMER } from './portfolioExport.js';

const $ = s => document.querySelector(s), page = $('.page');
const individual = document.createElement('div'); individual.id = 'individual-view';
for (const child of [...page.children]) if (child.tagName !== 'FOOTER') individual.append(child);
page.prepend(individual);
const shell = document.createElement('div'); shell.className = 'portfolio-switcher';
shell.innerHTML = `<button class="text-button" data-paction="home">← My Housing Loans</button><span id="p-selected-label"></span><button class="button secondary" data-paction="add">+ Add Housing Loan</button>`;
page.prepend(shell);
const portfolioView = document.createElement('div'); portfolioView.id = 'portfolio-view'; portfolioView.innerHTML = markup; portfolioView.hidden = true; individual.before(portfolioView);
const dialog = document.createElement('dialog'); dialog.id = 'portfolio-dialog'; dialog.innerHTML = '<h2 id="p-dialog-title"></h2><p id="p-dialog-text"></p><div class="dialog-actions"><button class="button secondary" data-paction="cancel">Cancel</button><button class="button primary" data-paction="confirm">Confirm</button></div>'; document.body.append(dialog);
const print = document.createElement('div'); print.id = 'portfolio-print-report'; print.hidden = true; document.body.append(print);
document.querySelector('footer>p').textContent = DISCLAIMER;
mountLoanIdentity(); renderLoanIdentity();

let overview = null, tab = 'dashboard', revision = 0, job = 0, renderTimer, actionConfirm, comparisons = [], selectedComparison, pendingScenarios = {}, overviewRequest = 0;
const hiddenLines = new Set(), callbacks = new Map();
const worker = new Worker(new URL('./portfolioWorker.js', import.meta.url), { type: 'module' });
worker.onmessage = ({ data }) => { const callback = callbacks.get(data.id); if (!callback) return; callbacks.delete(data.id); data.error ? callback.reject(new Error(data.error)) : callback.resolve(data.result); };
worker.onerror = () => { for (const callback of callbacks.values()) callback.reject(new Error('The calculation worker could not run. Reload the app from its HTTP server.')); callbacks.clear(); };
const run = (type, options = {}) => new Promise((resolve, reject) => { const id = ++job; callbacks.set(id, { resolve, reject }); worker.postMessage({ id, type, portfolio: getPortfolio(), options }); });
const loanLabel = l => `${l.name || 'Unnamed loan'}${l.bank ? ' · ' + l.bank : ''}`;
const dot = l => `<i class="loan-color" style="background:${l.color}"></i>`;
const loanIdentityCell = id => { const loan = getPortfolio().loans.find(l => l.id === id); return loan ? dot(loan) + esc(loan.name) : ''; };
const dateLabel = r => r?.payoff ? monthDate(r.payoff) : r?.status === 'invalid' ? 'Check loan details' : 'Not fully repaid';
const table = (headers, rows) => `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
function status(text, error = false) { $('#portfolio-status').textContent = text; $('#portfolio-status').hidden = !text; $('#portfolio-status').className = error ? 'validation' : 'portfolio-message'; }
function notice(text) { $('#toast').textContent = text; $('#toast').hidden = false; setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function confirmation(title, text, action) { $('#p-dialog-title').textContent = title; $('#p-dialog-text').textContent = text; actionConfirm = action; dialog.showModal(); }
function switchTab(next) {
  $('.skip-link').href = '#portfolio-view';
  tab = next; individual.hidden = true; portfolioView.hidden = false; shell.hidden = true; document.body.classList.add('portfolio-mode');
  document.querySelectorAll('[data-panel]').forEach(el => el.hidden = el.dataset.panel !== tab);
  document.querySelectorAll('[data-tab]').forEach(el => { el.classList.toggle('active', el.dataset.tab === tab); el.setAttribute('aria-current', el.dataset.tab === tab ? 'page' : 'false'); });
  renderControls(); refresh(); window.scrollTo(0, 0);
}
function openLoan(id, edit = false) {
  $('.skip-link').href = '#loan-details';
  const loan = getPortfolio().loans.find(l => l.id === id); if (!loan) return;
  getPortfolio().selectedLoanId = id; commit(); selectLoanState(loan.config); renderLoanIdentity();
  individual.hidden = false; portfolioView.hidden = true; shell.hidden = false; document.body.classList.remove('portfolio-mode');
  $('#p-selected-label').textContent = loanLabel(loan);
  if (edit) { $('#loan-identity').open = true; $('#loan-details').scrollIntoView({ block: 'start' }); } else window.scrollTo(0, 0);
}
function addLoan(source) {
  const p = getPortfolio();
  const loan = source ? { ...clone(source), id: uid(), name: `${source.name} (copy)`, color: COLORS[p.loans.length % COLORS.length], history: [] } : createLoan({ ...defaults(), extra: 0 }, { name: `Housing Loan ${p.loans.length + 1}` }, p.loans.length);
  p.loans.push(loan); openLoan(loan.id, true); notice('Loan added. Edit the demo values for this mortgage.');
}
function renderControls() {
  const p = getPortfolio(), settings = p.settings, loans = activeLoans(p);
  const oldLump = Object.fromEntries([...document.querySelectorAll('[data-lump-custom]')].map(el => [el.dataset.lumpCustom,el.value]));
  const oldRates = Object.fromEntries([...document.querySelectorAll('[data-rate-custom]')].map(el => [el.dataset.rateCustom,el.value]));
  const oldPark = new Set([...document.querySelectorAll('[data-park-id]:checked')].map(el => el.dataset.parkId));
  $('#p-household').value = settings.householdBudget; $('#p-additional').value = settings.additional; $('#p-strategy').value = settings.strategy; $('#p-rollover').checked = settings.rollover; $('#p-target').value = settings.target;
  const options = loans.map(l => `<option value="${esc(l.id)}">${esc(loanLabel(l))}</option>`).join('');
  for (const id of ['p-lump-loan', 'p-flexi-from', 'p-flexi-to']) { const old = $('#' + id).value; $('#' + id).innerHTML = options; if (loans.some(l => l.id === old)) $('#' + id).value = old; }
  if (loans.length > 1 && $('#p-flexi-to').value === $('#p-flexi-from').value) $('#p-flexi-to').value = loans.find(l => l.id !== $('#p-flexi-from').value).id;
  const start = loans.map(l => l.config.start).sort().at(-1) || defaults().start;
  for (const id of ['p-lump-date', 'p-flexi-date']) if (!$('#' + id).value) $('#' + id).value = start;
  $('#p-custom').innerHTML = loans.map(l => `<label class="field">${dot(l)} ${esc(loanLabel(l))} (RM)<input type="number" min="0" step="any" inputmode="decimal" data-custom="${esc(l.id)}" value="${esc(settings.custom[l.id] ?? 0)}"></label>`).join('');
  $('#p-lump-custom').innerHTML = loans.map(l => `<div><label class="field">${esc(loanLabel(l))} (RM)<input type="number" min="0" step="any" inputmode="decimal" data-lump-custom="${esc(l.id)}" value="0"></label><label class="check-field"><input type="checkbox" data-park-id="${esc(l.id)}">Include this flexi account</label></div>`).join('');
  $('#p-rate-custom').innerHTML = loans.map(l => `<label class="field">${esc(loanLabel(l))} — percentage points<input type="number" step="any" inputmode="decimal" data-rate-custom="${esc(l.id)}" value="0"></label>`).join('');
  $('#p-rate-custom').hidden = $('#p-rate-change').value !== 'custom';
  document.querySelectorAll('[data-lump-custom]').forEach(el => { el.value = oldLump[el.dataset.lumpCustom] ?? 0; });
  document.querySelectorAll('[data-rate-custom]').forEach(el => { el.value = oldRates[el.dataset.rateCustom] ?? 0; });
  document.querySelectorAll('[data-park-id]').forEach(el => { el.checked = oldPark.has(el.dataset.parkId); });
  $('#p-properties').innerHTML = p.properties.length ? p.properties.map(prop => `<div class="property-row"><strong>${esc(prop.name)}</strong><span>${esc(prop.type)} · ${p.loans.filter(l => l.propertyId === prop.id).length} loans</span><p>${esc(prop.notes)}</p></div>`).join('') : '<p class="quiet-note">No properties added yet.</p>';
}
async function refresh() {
  if (portfolioView.hidden) return;
  const ticket = ++overviewRequest, rev = revision;
  renderCards(); status('Calculating each loan independently…');
  try {
    const result = await run('overview'); if (ticket !== overviewRequest || rev !== revision) return;
    overview = result; status(loadedPortfolio.warning || ''); renderDashboard(); renderCards(); renderLoanTable(); renderTimeline(); renderYears();
  } catch (error) {
    if (ticket !== overviewRequest) return; overview = null; status(error.message, true);
    $('#p-payoff').textContent = 'Check loan details'; $('#p-metrics').innerHTML = ''; $('#p-count').textContent = '—';
    for (const id of ['p-current','p-cashflow','p-chart','p-interest','p-burden','p-years','p-timeline','p-loan-table']) $('#' + id).innerHTML = '<p class="quiet-note">Correct the loan details to calculate this projection.</p>';
  }
}
function renderDashboard() {
  const r = overview, p = getPortfolio();
  $('#p-payoff').textContent = r.activeCount ? (r.payoff ? monthDate(r.payoff) : 'Review your payments') : 'No active loans';
  $('#p-duration').textContent = r.payoff ? `${duration(r.months)} from the earliest loan start date` : r.activeCount ? 'At least one loan does not fully repay within the projection limit.' : 'Add a loan to start a new projection.';
  $('#p-count').textContent = r.activeCount;
  const metrics = [['Total outstanding principal',money(r.principal)],['Required instalments / month',money(r.normal)],['Extra payments / month',money(r.extra)],['Total mortgage payment / month',money(r.monthly)],['Current flexi balances',money(r.flexi)],['Effective interest-bearing balance',money(r.effective)],['Estimated future interest',money(r.interest)],['Weighted Average Current Rate',`${r.weightedRate.toFixed(2)}%`],['Earliest loan settlement',r.earliest ? monthDate(r.earliest) : '—']];
  $('#p-metrics').innerHTML = metrics.map(([label, value]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('');
  $('#p-current').innerHTML = `<div class="portfolio-facts"><span>Normal mortgage payments</span><strong>${money(r.normal)}/month</strong><span>Existing extra payments</span><strong>${money(r.extra)}/month</strong><span>Total mortgage outflow</span><strong>${money(r.monthly)}/month</strong><span>Expected full settlement</span><strong>${r.payoff ? monthDate(r.payoff) : '—'}</strong><span>Future interest</span><strong>${money(r.interest)}</strong></div><p class="quiet-note">Configured monthly totals exclude dated lump sums and temporary monthly overrides.</p>`;
  renderCashflow();
  $('#p-line-toggles').innerHTML = `<span><i class="loan-color" style="background:#203c35"></i>Combined portfolio</span>${activeLoans(p).map(l => `<label><input type="checkbox" data-line="${esc(l.id)}" ${hiddenLines.has(l.id) ? '' : 'checked'}>${dot(l)}${esc(l.name)}</label>`).join('')}`;
  if (tab === 'dashboard') portfolioChart($('#p-chart'), p, r, hiddenLines);
  const breakdown = (kind, total) => activeLoans(p).map(l => {
    const amount = kind === 'interest' ? r.results[l.id].status === 'paid' ? r.results[l.id].interestPaid : null : Number(l.config.normal) + Number(l.config.extra);
    const percent = amount !== null && total > 0 ? amount / total * 100 : 0;
    return `<div class="breakdown-row"><div>${dot(l)}<span>${esc(loanLabel(l))}</span><strong>${money(amount)}</strong></div><div class="breakdown-track"><span style="width:${percent}%;background:${l.color}"></span></div><small>${total === null ? 'Full future interest unavailable' : percent.toFixed(1) + '% of total'}</small></div>`;
  }).join('');
  $('#p-interest').innerHTML = breakdown('interest',r.interest); $('#p-burden').innerHTML = breakdown('monthly',r.monthly);
}
function renderCashflow() {
  if (!overview) return;
  const raw = getPortfolio().settings.householdBudget, amount = Number(raw) - overview.monthly;
  $('#p-cashflow').innerHTML = `<p class="quiet-note">Configured mortgage payments: ${money(overview.monthly)} / month.</p>${raw === '' ? '<p class="quiet-note">Enter your budget to see the amount remaining.</p>' : !Number.isFinite(Number(raw)) || Number(raw) < 0 ? '<p class="warning-line">Enter a non-negative household budget.</p>' : `<div class="cashflow-result ${amount < 0 ? 'shortfall' : ''}"><small>${amount < 0 ? 'Mortgage budget shortfall' : 'Remaining unallocated mortgage budget'}</small><strong>${money(Math.abs(amount))}</strong></div>`}`;
}
function renderCards() {
  const p = getPortfolio(), visible = p.loans.filter(l => $('#p-show-inactive').checked || l.status === 'active');
  $('#p-loan-cards').innerHTML = visible.length ? visible.map(l => `<article class="card mortgage-loan-card" style="border-top-color:${l.color}"><div class="section-heading"><h3>${dot(l)}${esc(l.name || 'Unnamed loan')}</h3><span class="badge">${l.status}</span></div><p class="loan-bank">${esc(l.bank || 'Bank not set')}${l.propertyId || l.propertyName ? ' · ' + esc(p.properties.find(x => x.id === l.propertyId)?.name || l.propertyName) : ''}</p><strong class="loan-principal">${money(Number(l.config.principal))}</strong><div class="loan-card-facts"><span>Rate</span><strong>${esc(l.config.rate)}% p.a.</strong><span>Normal payment</span><strong>${money(Number(l.config.normal))}</strong><span>Extra payment</span><strong>${money(Number(l.config.extra))}</strong><span>Estimated settlement</span><strong>${l.status === 'active' ? overview?.results[l.id] ? dateLabel(overview.results[l.id]) : 'Calculating…' : l.status === 'settled' ? 'Settled' : 'Archived'}</strong></div><div class="loan-actions"><button class="button primary" data-open="${esc(l.id)}">View Details</button><button class="button secondary" data-edit="${esc(l.id)}">Edit</button><button class="text-button" data-duplicate="${esc(l.id)}">Duplicate</button><button class="text-button" data-archive="${esc(l.id)}">${l.status === 'archived' ? 'Restore' : 'Archive'}</button><button class="text-button danger" data-delete="${esc(l.id)}">Delete</button></div></article>`).join('') : '<div class="card empty-state">No loans to show. Add a mortgage, or show settled and archived loans.</div>';
}
function renderLoanTable() {
  if (!overview) return;
  const key = $('#p-sort').value, direction = $('#p-direction').value === 'asc' ? 1 : -1;
  const value = l => key === 'monthly' ? Number(l.config.normal) + Number(l.config.extra) : key === 'payoff' ? overview.results[l.id].payoff ? Date.parse(overview.results[l.id].payoff) : Infinity : key === 'interest' ? overview.results[l.id].status === 'paid' ? overview.results[l.id].interestPaid : Infinity : Number(l.config[key]);
  const loans = [...activeLoans(getPortfolio())].sort((a,b) => (value(a) - value(b)) * direction);
  $('#p-loan-table').innerHTML = table(['Loan','Bank','Outstanding','Rate','Normal','Extra','Total payment','Flexi','Payoff date','Future interest'],loans.map(l => [ `${dot(l)}${esc(l.name)}`,esc(l.bank),money(Number(l.config.principal)),`${l.config.rate}%`,money(Number(l.config.normal)),money(Number(l.config.extra)),money(Number(l.config.normal)+Number(l.config.extra)),money(Number(l.config.flexi)),dateLabel(overview.results[l.id]),overview.results[l.id].status === 'paid' ? money(overview.results[l.id].interestPaid) : '—']));
}
function renderTimeline() {
  if (!overview) return;
  const loans = [...activeLoans(getPortfolio())].sort((a,b) => (overview.results[a.id].payoff || '9999').localeCompare(overview.results[b.id].payoff || '9999'));
  $('#p-timeline').innerHTML = `<section class="card"><h2>All mortgages fully settled by: ${overview.payoff ? monthDate(overview.payoff) : 'No full payoff estimate'}</h2><p class="section-help">Time until mortgage-free: ${duration(overview.months)}</p><ol class="payoff-timeline">${loans.map(l => `<li style="border-color:${l.color}"><strong>${dateLabel(overview.results[l.id])}</strong><span>${dot(l)}${esc(loanLabel(l))}</span></li>`).join('')}</ol></section>`;
}
function renderYears() {
  if (!overview) return;
  const columns = ['Year / loan','Starting balance','Payments','Interest','Principal paid','Ending balance'];
  const cells = y => [y.year, ...['starting','payment','interest','principalPaid','ending'].map(k => money(y[k]))];
  $('#p-years').innerHTML = overview.years.map(y => `<details class="year-detail"><summary>${y.year} <span>${money(y.ending)} remaining</span></summary><div class="table-scroll">${table(columns,[cells(y),...Object.values(y.loans).map(l => [loanIdentityCell(l.id), ...['starting','payment','interest','principalPaid','ending'].map(k => money(l[k]))])])}</div></details>`).join('') || '<p class="quiet-note">No future payments.</p>';
}
const strategyOptions = () => ({ budget: $('#p-additional').value, strategy: $('#p-strategy').value, rollover: $('#p-rollover').checked, custom: clone(getPortfolio().settings.custom) });
function loanEffects(before, after, extraColumns = null) {
  return table(['Loan','Current payoff','Scenario payoff','Time difference','Interest difference',...(extraColumns ? ['Current first payment interest','Scenario first payment interest'] : [])],activeLoans(getPortfolio()).map(l => {
    const b = before.results[l.id], a = after.results[l.id];
    const earlier = a.payoff && b.payoff ? a.payoff <= b.payoff : null;
    return [esc(loanLabel(l)), dateLabel(b),dateLabel(a),earlier === null ? '—' : `${duration(monthsBetween(parseDate(earlier ? a.payoff : b.payoff),parseDate(earlier ? b.payoff : a.payoff)))} ${earlier ? 'earlier' : 'later'}`, a.status === 'paid' && b.status === 'paid' ? `${money(b.interestPaid - a.interestPaid)} saved` : '—',...(extraColumns ? [money(b.rows.find(r => r.kind === 'Monthly payment')?.interest || 0),money(extraColumns[l.id])] : [])];
  }));
}
function showScenario(kind, outcome, rev, before) {
  pendingScenarios[kind] = { ...outcome, revision: rev };
  const r = outcome.result;
  $(`#p-${kind}-result`).innerHTML = `<div class="scenario-totals"><div><small>Portfolio settlement: before → after</small><strong>${before.payoff ? monthDate(before.payoff) : 'No estimate'} → ${r.payoff ? monthDate(r.payoff) : 'No estimate'}</strong></div><div><small>Future interest: before → after</small><strong>${money(before.interest)} → ${money(r.interest)}</strong></div></div><div class="table-scroll">${loanEffects(before,r,outcome.firstInterest)}</div><p class="quiet-note">Preview only. Saved loan balances and rates have not changed.</p><button class="button primary" data-apply-scenario="${kind}">Apply Scenario</button>`;
}
async function action(kind) {
  const rev = revision; status('Running independent mortgage simulations…');
  try {
    if (!overview) overview = await run('overview');
    if (kind === 'compare') {
      comparisons = await run('compare', strategyOptions());
      if (revision !== rev) { status('Inputs changed. Run the comparison again.'); return; }
      $('#p-comparison').hidden = false;
      $('#p-comparison').innerHTML = table(['Strategy','Portfolio payoff','Time remaining','Future interest','Interest difference'],comparisons.map(c => [`<button class="text-button" data-comparison="${c.key}">${esc(c.name)}</button>`,c.result.payoff ? monthDate(c.result.payoff) : 'Not fully repaid',duration(c.result.months),money(c.result.interest),overview.interest !== null && c.result.interest !== null ? money(overview.interest-c.result.interest) + ' saved' : '—']));
      selectedComparison = comparisons.find(c => c.key === $('#p-strategy').value) || comparisons[0];
      $('#p-effects').innerHTML = `<h3>Loan-by-loan effect: ${esc(selectedComparison.name)}</h3><div class="table-scroll">${loanEffects(overview,selectedComparison.result)}</div>`;
    } else if (kind === 'target') {
      const r = await run('target',{ ...strategyOptions(), strategy: $('#p-target-strategy').value, date: $('#p-target').value });
      if (revision !== rev) { status('Inputs changed. Calculate the target again.'); return; }
      $('#p-target-result').innerHTML = `<div class="scenario-totals"><div><small>Required total monthly mortgage budget</small><strong>${money(r.required)}</strong></div><div><small>Current monthly mortgage budget</small><strong>${money(r.current)}</strong></div><div><small>Additional monthly amount needed</small><strong>${money(r.additional)}</strong></div></div>`;
    } else {
      let options;
      if (kind === 'lump') options = { amount: $('#p-lump-amount').value, date: $('#p-lump-date').value, strategy: $('#p-lump-strategy').value, loanId: $('#p-lump-loan').value, park: $('#p-lump-park').checked, custom: Object.fromEntries([...document.querySelectorAll('[data-lump-custom]')].map(el => [el.dataset.lumpCustom,el.value])), selectedIds: [...document.querySelectorAll('[data-park-id]:checked')].map(el => el.dataset.parkId) };
      else if (kind === 'flexi') options = { from: $('#p-flexi-from').value,to: $('#p-flexi-to').value,amount: $('#p-flexi-amount').value,date: $('#p-flexi-date').value };
      else options = { change: $('#p-rate-change').value, custom: $('#p-rate-change').value === 'custom' ? Object.fromEntries([...document.querySelectorAll('[data-rate-custom]')].map(el => [el.dataset.rateCustom,el.value])) : null };
      const before = overview, result = await run(kind, options);
      if (revision !== rev) { status('Inputs changed. Run the scenario again.'); return; }
      showScenario(kind,result,rev,before);
    }
    status('Simulation complete. Your saved loans are unchanged.');
  } catch (error) { status(error.message,true); }
}
subscribe((portfolio, saved) => {
  if (!saved) notice('Browser storage is unavailable. Export a portfolio backup to keep your changes.');
  revision++; overview = null;
  comparisons = []; selectedComparison = null; pendingScenarios = {};
  $('#p-comparison').hidden = true;
  for (const id of ['p-effects','p-target-result','p-lump-result','p-flexi-result','p-rate-result']) $('#' + id).innerHTML = '';
  $('#p-selected-label').textContent = getSelectedLoan() ? loanLabel(getSelectedLoan()) : '';
  clearTimeout(renderTimer); renderTimer = setTimeout(refresh,180);
});
document.addEventListener('input',event => {
  const el = event.target,p = getPortfolio();
  const previewKind = el.id.startsWith('p-lump-') || el.dataset.lumpCustom || el.dataset.parkId ? 'lump' : el.id.startsWith('p-flexi-') ? 'flexi' : el.id.startsWith('p-rate-') || el.dataset.rateCustom ? 'rate' : null;
  if (previewKind && pendingScenarios[previewKind]) { delete pendingScenarios[previewKind]; $(`#p-${previewKind}-result`).innerHTML = '<p class="quiet-note">Inputs changed. Run the simulation again to refresh the preview.</p>'; }
  if (el.id === 'p-target-strategy') $('#p-target-result').innerHTML = '';
  if (el.id === 'p-household') { p.settings.householdBudget = el.value; const current = overview; commit(); overview = current; renderCashflow(); }
  else if (el.id === 'p-additional') { p.settings.additional = el.value; commit(); }
  else if (el.id === 'p-strategy') { p.settings.strategy = el.value; commit(); }
  else if (el.id === 'p-rollover') { p.settings.rollover = el.checked; commit(); }
  else if (el.id === 'p-target') { p.settings.target = el.value; commit(); }
  else if (el.dataset.custom) { p.settings.custom[el.dataset.custom] = el.value; commit(); }
  else if (el.dataset.line) { el.checked ? hiddenLines.delete(el.dataset.line) : hiddenLines.add(el.dataset.line); if (overview) portfolioChart($('#p-chart'),p,overview,hiddenLines); }
  else if (['p-show-inactive','p-sort','p-direction'].includes(el.id)) { renderCards(); renderLoanTable(); }
  else if (el.id === 'p-rate-change') $('#p-rate-custom').hidden = el.value !== 'custom';
});
document.addEventListener('click', async event => {
  const el = event.target.closest('button'); if (!el) return;
  const p = getPortfolio();
  if (el.dataset.tab) { switchTab(el.dataset.tab); return; }
  if (el.dataset.open || el.dataset.edit) { openLoan(el.dataset.open || el.dataset.edit, !!el.dataset.edit); return; }
  if (el.dataset.duplicate) { addLoan(p.loans.find(l => l.id === el.dataset.duplicate)); return; }
  if (el.dataset.archive) { const l = p.loans.find(l => l.id === el.dataset.archive); l.status = l.status === 'archived' ? Number(l.config.principal) === 0 ? 'settled' : 'active' : 'archived'; delete p.settings.custom[l.id]; commit(); renderCards(); return; }
  if (el.dataset.delete) {
    const loan = p.loans.find(l => l.id === el.dataset.delete);
    confirmation('Delete housing loan?', `Delete ${loan.name} and its saved transactions and history? Export a backup first if you want to retain them.`,() => { p.loans = p.loans.filter(l => l.id !== loan.id); delete p.settings.custom[loan.id]; if (p.selectedLoanId === loan.id) p.selectedLoanId = p.loans[0]?.id || ''; commit(); renderControls(); refresh(); }); return;
  }
  if (el.dataset.comparison) { selectedComparison = comparisons.find(c => c.key === el.dataset.comparison); if (selectedComparison && overview) $('#p-effects').innerHTML = `<h3>Loan-by-loan effect: ${esc(selectedComparison.name)}</h3><div class="table-scroll">${loanEffects(overview,selectedComparison.result)}</div>`; return; }
  if (el.dataset.applyScenario) {
    const scenario = pendingScenarios[el.dataset.applyScenario];
    if (!scenario || scenario.revision !== revision) { status('This preview is out of date. Run the scenario again before applying it.',true); return; }
    replacePortfolio(scenario.portfolio); if (getSelectedLoan()) { selectLoanState(getSelectedLoan().config); renderLoanIdentity(); }
    pendingScenarios = {}; document.querySelectorAll('[data-apply-scenario]').forEach(b => b.disabled = true); notice('Scenario applied to saved loan events.'); refresh(); return;
  }
  try {
    switch(el.dataset.paction) {
      case 'home': switchTab(getPortfolio().loans.length > 1 ? 'dashboard' : 'loans'); break;
      case 'add': addLoan(); break;
      case 'compare': case 'target': case 'lump': case 'flexi': case 'rate': el.disabled = true; await action(el.dataset.paction); el.disabled = false; break;
      case 'cancel': dialog.close(); actionConfirm = null; break;
      case 'confirm': dialog.close(); actionConfirm?.(); actionConfirm = null; break;
      case 'backup': downloadFile('mortgage-portfolio-backup.json',exportBackup(p),'application/json'); notice('Portfolio backup exported.'); break;
      case 'import': $('#p-import-file').click(); break;
      case 'csv': if (!overview) overview = await run('overview'); downloadFile('mortgage-portfolio-yearly.csv',portfolioCSV(overview),'text/csv;charset=utf-8'); break;
      case 'copy': if (!overview) overview = await run('overview'); await navigator.clipboard.writeText(portfolioSummary(p,overview)); notice('Portfolio summary copied.'); break;
      case 'print': if (!overview) overview = await run('overview'); $('#portfolio-print-report').innerHTML = portfolioPrint(p,overview); window.print(); break;
      case 'property': {
        const name = $('#p-property-name').value.trim(); if (!name) throw new Error('Enter a property name.');
        p.properties.push({ id:uid(),name,type:$('#p-property-type').value,notes:$('#p-property-notes').value });
        commit(); renderControls(); renderLoanIdentity(); $('#p-property-name').value = ''; $('#p-property-type').value = ''; $('#p-property-notes').value = ''; break;
      }
    }
  } catch(error) { status(error.message,true); notice(error.message); }
});
$('#p-import-file').addEventListener('change',async event => {
  try {
    const file = event.target.files[0]; if (!file) return; const incoming = importBackup(await file.text());
    confirmation('Replace saved portfolio?', `Import ${incoming.loans.length} housing loan(s) from ${file.name}? This replaces all current loans, properties and strategy settings.`,() => { replacePortfolio(incoming); if (getSelectedLoan()) { selectLoanState(getSelectedLoan().config); renderLoanIdentity(); } switchTab('dashboard'); notice('Portfolio backup restored.'); });
  } catch(error) { status(error.message,true); notice(error.message); }
  finally { event.target.value = ''; }
});
window.addEventListener('beforeprint',() => { if (!portfolioView.hidden && overview) { print.innerHTML = portfolioPrint(getPortfolio(),overview); document.body.classList.add('portfolio-print'); } });
window.addEventListener('afterprint',() => document.body.classList.remove('portfolio-print'));
let resizeTimer; window.addEventListener('resize',() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!portfolioView.hidden && tab === 'dashboard' && overview) portfolioChart($('#p-chart'),getPortfolio(),overview,hiddenLines); },150); });
if (getPortfolio().loans.length === 1 && getSelectedLoan()) { openLoan(getSelectedLoan().id); if (loadedPortfolio.migrated) notice('Your saved mortgage is now Home Loan. Your original saved data has been retained.'); }
else switchTab('dashboard');
