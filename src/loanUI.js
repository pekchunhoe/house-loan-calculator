import { getPortfolio, getSelectedLoan, commit } from './session.js';
import { selectLoanState } from './app.js';
import { escapeHtml as esc, money } from './format.js';
import { clone } from './storage.js';
export function mountLoanIdentity() {
  const wrapper = document.createElement('details'); wrapper.className = 'loan-identity'; wrapper.id = 'loan-identity';
  wrapper.innerHTML = `<summary><span id="selected-loan-name">Home Loan</span><span class="optional">Loan identity & original information</span></summary><div class="field-row"><label class="field">Loan Name<input id="loan-name" data-meta="name" required></label><label class="field">Bank<input id="loan-bank" data-meta="bank" list="malaysian-banks"></label></div><datalist id="malaysian-banks">${['Maybank','CIMB','Public Bank','RHB','Hong Leong Bank','AmBank','Alliance Bank','Bank Islam','Bank Rakyat','OCBC','UOB','HSBC','Standard Chartered','Other'].map(b => `<option value="${b}">`).join('')}</datalist><div class="field-row"><label class="field">Property name (optional)<input data-meta="propertyName"></label><label class="field">Linked property<select data-meta="propertyId" id="loan-property"></select></label></div><div class="field-row"><label class="field">Account reference (optional)<input data-meta="accountReference" placeholder="A nickname is enough"></label><label class="field">Loan status<select id="loan-status" data-meta="status"><option value="active">Active</option><option value="settled">Settled — set principal to RM 0</option><option value="archived">Archived</option></select></label></div><label class="field">Loan color<input data-meta="color" type="color"></label><label class="field">Bank-specific assumptions / notes<textarea data-meta="assumptions" rows="3" placeholder="Posting convention, offset limits, fees or redraw terms to verify…"></textarea></label><label class="field">Loan notes<textarea data-meta="notes" rows="2"></textarea></label><details class="original-details"><summary>Original loan information (optional)</summary><p class="quiet-note">Informational only. Payoff calculations use current outstanding principal.</p><div class="field-row"><label class="field">Original amount (RM)<input data-original="amount" type="number" min="0" step="any" inputmode="decimal"></label><label class="field">Original start date<input data-original="start" type="date"></label><label class="field">Original tenure (years)<input data-original="tenure" type="number" min="0" step="any" inputmode="decimal"></label><label class="field">Original annual rate (%)<input data-original="rate" type="number" min="0" step="any" inputmode="decimal"></label><label class="field">Original monthly instalment (RM)<input data-original="normal" type="number" min="0" step="any" inputmode="decimal"></label></div></details><div id="loan-history"></div>`;
  document.querySelector('.loan-card').prepend(wrapper);
  wrapper.addEventListener('input', event => {
    const el = event.target, loan = getSelectedLoan(); if (!loan) return;
    if (el.dataset.meta) {
      if (el.dataset.meta === 'status') {
        if (el.value === 'settled' && Number(loan.config.principal) !== 0) { loan.history.push({ recordedAt: new Date().toISOString(), config: clone(loan.config) }); loan.config.principal = 0; }
        if (el.value === 'active' && Number(loan.config.principal) === 0) { el.value = 'settled'; }
        loan.status = el.value; if (loan.status !== 'active') delete getPortfolio().settings.custom[loan.id]; selectLoanState(loan.config);
      } else loan[el.dataset.meta] = el.value;
    } else if (el.dataset.original) loan.original[el.dataset.original] = el.value;
    document.querySelector('#selected-loan-name').textContent = loan.name || 'Unnamed loan'; commit();
  });
}
export function renderLoanIdentity() {
  const loan = getSelectedLoan(); if (!loan) return;
  document.querySelector('#selected-loan-name').textContent = loan.name || 'Unnamed loan';
  document.querySelector('#loan-property').innerHTML = `<option value="">No linked property</option>${getPortfolio().properties.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
  document.querySelectorAll('[data-meta]').forEach(el => { el.value = loan[el.dataset.meta] ?? ''; });
  document.querySelectorAll('[data-original]').forEach(el => { el.value = loan.original[el.dataset.original] ?? ''; });
  document.querySelector('#loan-history').innerHTML = loan.history.length ? `<details><summary>Retained loan history (${loan.history.length})</summary>${loan.history.map(h => `<p class="quiet-note">${esc(h.recordedAt)} · previous principal ${money(Number(h.config?.principal))}</p>`).join('')}</details>` : '';
}
