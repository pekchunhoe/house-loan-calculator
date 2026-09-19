import { getPortfolio, commit, subscribe, loadedPortfolio } from './session.js';
import { activeLoans, clone, uid } from './storage.js';
import { FIXED_STRATEGIES, fixedOptions } from './fixedCommitmentModel.js';
import { payoffMonthDifference } from './fixedCommitmentEngine.js';
import { lineChart } from './charts.js';
import { money, monthDate, duration, escapeHtml as esc } from './format.js';
import { monthsBetween, parseDate } from './dates.js';
import { downloadFile } from './portfolioExport.js';

const table = (headers, rows) => `<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const date = value => value ? monthDate(value) : 'Not fully repaid';
const timeDifference = n => n === null ? 'Unavailable' : `${duration(Math.abs(n))} ${n > 0 ? 'earlier' : n < 0 ? 'later' : 'difference'}`;
const interestDifference = n => n === null ? 'Unavailable' : `${money(Math.abs(n))} ${n > 0 ? 'less interest' : n < 0 ? 'more interest' : 'difference'}`;
export function mountFixedCommitment(root, run) {
  root.innerHTML = `<section class="card fixed-card"><div class="eyebrow">PLAN A CONSTANT MONTHLY BUDGET</div><h2>Fixed Monthly Mortgage Commitment</h2>
    <p class="section-help">Fixed Monthly Commitment keeps your total mortgage payment budget approximately constant after the selected start month. When a loan is settled, the payment previously allocated to that loan is redirected to your remaining active loans according to your selected strategy.</p>
    <div class="field-row"><label class="field">Fixed Commitment Starts From<input id="fc-start" type="month"></label><label class="field">Target Total Monthly Mortgage Commitment<select id="fc-mode"><option value="current">Use Current Total Commitment</option><option value="custom">Custom Commitment</option></select></label></div>
    <label class="field" id="fc-amount-field" hidden>Fixed commitment (RM / month)<input id="fc-amount" type="number" min="0" step="any" inputmode="decimal" value="8000"></label>
    <p class="quiet-note">Current commitment uses normal instalments plus included regular extras for loans still active at the selected start month. It is then held fixed. Temporary monthly overrides and lump sums are separate.</p>
    <label class="field">Allocation strategy<select id="fc-strategy">${Object.entries(FIXED_STRATEGIES).map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select></label>
    <div id="fc-priorities" hidden><p class="quiet-note">Assign a unique priority number to every loan. The first remaining loan receives the available extra budget.</p><div id="fc-priority-fields" class="allocation-inputs"></div></div>
    <div id="fc-percentages" hidden><p class="quiet-note">Enter percentages totaling 100%. Active shares renormalize after settlement; if all remaining shares are zero, money is split equally.</p><div id="fc-percentage-fields" class="allocation-inputs"></div></div>
    <details><summary>Rollover timing and existing extras</summary><label class="field">Rollover Timing<select id="fc-timing"><option value="following-month">Following calendar month</option><option value="next-payment">Next eligible payment date</option></select></label>
    <label class="check-field"><input id="fc-extras" type="checkbox" checked> Include Existing Extra Payments in Fixed Commitment</label>
    <p class="quiet-note">ON: regular extras are part of the budget and retained when affordable; a smaller custom budget reallocates discretionary extras after required instalments. OFF: existing extras are paid on top of the budget, so actual monthly spending can be higher.</p>
    <p class="quiet-note">Following-month rollover preserves the existing convention: unused cash in a settlement month stays unspent; released monthly allocations start next month. Next eligible payment date sends only unused cash to later scheduled payments in the same month. Money already paid is never spent twice. Priorities use month-start balances and rates; same-month transfers use rates effective on the transfer date.</p></details>
    <p class="quiet-note">The final month may be lower because the calculator will not intentionally overpay the remaining balance. Lump sums remain separate. Parked flexi cash only affects interest. Payments settle on existing scheduled dates or entered transaction dates; no new daily settlement dates are invented.</p>
    <div class="export-actions"><button class="button primary" id="fc-run">Run Fixed Commitment Scenario</button><button class="button secondary" id="fc-cancel">Cancel scenario</button></div>
    <div id="fc-status" role="status"></div><div id="fc-results" class="scenario-output"></div>
    <div id="fc-save-area" hidden><label class="field">Scenario name<input id="fc-name" maxlength="160" placeholder="Maintain RM8,000 from Jan 2027"></label><div class="export-actions"><button class="button secondary" id="fc-save">Save Scenario</button><button class="button secondary" id="fc-csv">Export monthly allocation CSV</button></div><p class="quiet-note">Saves configuration only. Actual loan payments and calibration records stay unchanged.</p></div>
    <details id="fc-saved-section"><summary>Saved fixed commitment scenarios</summary><div id="fc-saved"></div><button class="button secondary" id="fc-compare">Compare selected scenarios</button><div id="fc-comparison" class="scenario-output"></div></details>
  </section>`;
  const $ = s => root.querySelector(s);
  let preview = null, ticket = 0, signature = '', loanSignature = '', saving = false;
  const message = (text, error = false) => { $('#fc-status').textContent = text; $('#fc-status').className = error ? 'validation' : 'quiet-note'; };
  function invalidate() { ticket++; preview = null; $('#fc-results').innerHTML = ''; $('#fc-save-area').hidden = true; }
  function controls() {
    const loans = activeLoans(getPortfolio()), sig = JSON.stringify(loans.map(l=>[l.id,l.name]));
    if (!$('#fc-start').value) $('#fc-start').value = loans.map(l=>l.config.start.slice(0,7)).sort().at(-1) || new Date().toISOString().slice(0,7);
    if (sig !== signature) {
      signature = sig;
      $('#fc-priority-fields').innerHTML = loans.map((l,i)=>`<label class="field">${esc(l.name)} priority<input type="number" min="1" max="${loans.length}" step="1" data-fc-priority="${esc(l.id)}" value="${i+1}"></label>`).join('');
      $('#fc-percentage-fields').innerHTML = loans.map((l,i)=>`<label class="field">${esc(l.name)} (%)<input type="number" min="0" max="100" step="any" data-fc-percent="${esc(l.id)}" value="${i === loans.length-1 ? 100-Math.floor(100/loans.length)*(loans.length-1) : Math.floor(100/loans.length)}"></label>`).join('');
    }
    $('#fc-amount-field').hidden = $('#fc-mode').value !== 'custom';
    $('#fc-priorities').hidden = $('#fc-strategy').value !== 'priority';
    $('#fc-percentages').hidden = $('#fc-strategy').value !== 'percentage';
    const selected = new Set([...root.querySelectorAll('[data-fc-select]:checked')].map(el=>el.dataset.fcSelect));
    $('#fc-saved').innerHTML = (getPortfolio().fixedCommitmentScenarios || []).map(s=>`<div class="fc-saved-row"><label class="check-field"><input type="checkbox" data-fc-select="${esc(s.id)}" ${selected.has(s.id)?'checked':''}>${esc(s.name)}</label><button class="button secondary" data-fc-load="${esc(s.id)}">Load</button><button class="text-button" data-fc-delete="${esc(s.id)}">Delete</button></div>`).join('') || '<p class="quiet-note">No saved scenarios yet.</p>';
  }
  function readOptions() {
    const priorities = [...root.querySelectorAll('[data-fc-priority]')];
    if ($('#fc-strategy').value === 'priority' && (priorities.some(el=>!Number.isInteger(Number(el.value)) || Number(el.value)<1 || Number(el.value)>priorities.length) || new Set(priorities.map(el=>Number(el.value))).size !== priorities.length)) throw new Error('Assign a unique priority from 1 to the number of active loans.');
    const percentages = Object.fromEntries([...root.querySelectorAll('[data-fc-percent]')].map(el=>[el.dataset.fcPercent,Number(el.value)]));
    if ($('#fc-strategy').value === 'percentage' && Math.abs(Object.values(percentages).reduce((a,b)=>a+b,0)-100)>0.0001) throw new Error('Custom percentages must total 100%.');
    return fixedOptions({ startMonth:$('#fc-start').value, mode:$('#fc-mode').value, commitment:$('#fc-mode').value==='current'?0:$('#fc-amount').value, strategy:$('#fc-strategy').value, timing:$('#fc-timing').value, includeExtras:$('#fc-extras').checked, priority:priorities.sort((a,b)=>Number(a.value)-Number(b.value)).map(el=>el.dataset.fcPriority), percentages });
  }
  function draw() {
    if (!preview || root.closest('[hidden]')) return;
    const series = [preview.current,preview], colors = ['#899881','#285b48'];
    const lastMonth = [...preview.currentMonthly,...preview.monthly].map(m=>m.month).sort().at(-1);
    lineChart($('#fc-payment-chart'),[preview.currentMonthly,preview.monthly].map((rows,i)=>{
      const map = new Map(rows.map(r=>[r.month,r.total])), points = [];
      const cursor = new Date(preview.start+'T00:00:00Z'); cursor.setUTCDate(1);
      while (lastMonth && cursor.toISOString().slice(0,7)<=lastMonth) { points.push([cursor.getTime(),map.get(cursor.toISOString().slice(0,7)) || 0]); cursor.setUTCMonth(cursor.getUTCMonth()+1); }
      points.push([cursor.getTime(),0]); return { points,color:colors[i],dashed:i===0,step:true };
    }),'Monthly Mortgage Commitment Over Time: current and fixed commitment, RM per month');
    lineChart($('#fc-balance-chart'),series.map((r,i)=>({ points:r.points.map(p=>[Date.parse(p.date),p.total]),color:colors[i],dashed:i===0,step:true })),'Portfolio principal balance: current and fixed commitment');
  }
  function renderResult(r) {
    const loans = activeLoans(getPortfolio()), name = id => esc(loans.find(l=>l.id===id)?.name || id);
    const allocations = amounts => Object.entries(amounts).filter(([,n])=>n>0).map(([id,n])=>`${name(id)}: ${money(n)}/month`).join('; ');
    const effects = loans.map(l=>{
      const a=r.current.results[l.id],b=r.results[l.id],release=r.timeline.find(t=>t.type==='settled' && t.loanId===l.id);
      const delta = payoffMonthDifference(a.payoff,b.payoff);
      const redirects = release ? r.timeline.filter(t=>(t.type==='transfer'&&t.loanId===l.id)||(t.type==='redirected'&&t.month===release.availableMonth)) : [];
      return [name(l.id),date(a.payoff),date(b.payoff),timeDifference(delta),interestDifference(a.status==='paid'&&b.status==='paid'?a.interestPaid-b.interestPaid:null),release?money(release.amount)+'/month':'—',redirects.map(t=>allocations(t.amounts)).join('<br>') || 'No remaining eligible allocation'];
    });
    const years = [...new Set(r.monthly.map(m=>m.month.slice(0,4)))];
    $('#fc-results').innerHTML = `<div class="portfolio-hero fc-hero"><div><span class="eyebrow light">FIXED COMMITMENT RESULT</span><h3>All mortgages fully paid by</h3><div class="payoff-date">${date(r.payoff)}</div><p>${money(r.commitment)}/month · begins ${monthDate(r.options.startMonth+'-01')}</p><p>Time remaining from strategy start: ${r.payoff?duration(monthsBetween(parseDate(r.options.startMonth+'-01'),parseDate(r.payoff))):'No payoff within projection limit'}</p></div></div>
      <div class="scenario-totals"><div><small>Future interest from loan snapshots</small><strong>${money(r.interest)}</strong></div><div><small>Compared with current strategy</small><strong>${timeDifference(r.difference.months)}</strong><strong>${interestDifference(r.difference.interest)}</strong></div></div>
      ${table(['Strategy','Portfolio fully paid','Future interest'],[['Current Payment Strategy',date(r.current.payoff),money(r.current.interest)],['Fixed Monthly Commitment Strategy',date(r.payoff),money(r.interest)]])}
      <p class="quiet-note">${r.options.includeExtras?'Regular extras included in commitment.':'Existing regular extras paid in addition to commitment.'} Monthly overrides may change actual spending. Settlement-month payments may be lower under following-month rollover. Each loan retains its own interest and flexi rules.</p>
      <h3>Monthly Mortgage Commitment Over Time</h3><p class="fc-legend"><span>┄ Current strategy</span><strong>━ Fixed commitment strategy</strong></p><div id="fc-payment-chart" class="chart"></div>
      <h3>Portfolio Balance Over Time</h3><div id="fc-balance-chart" class="chart"></div>
      <h3>Loan-by-loan results</h3>${table(['Loan','Current Payoff','Fixed Commitment Payoff','Time Difference','Interest Difference','Released after settlement','Redirected to / new total allocation'],effects)}
      <details open><summary>Payment rollover timeline</summary><ol class="payoff-timeline fc-timeline">${r.timeline.map(t=>`<li><strong>${monthDate(t.month+'-01')}</strong><span>${t.type==='start'?`Fixed commitment begins: ${money(t.amount)}/month`:t.type==='complete'?'All mortgages settled':t.type==='settled'?`${name(t.loanId)} settled on ${esc(t.date)}. ${money(t.amount)}/month released for future months.`:t.type==='transfer'?`${money(t.amount)} unused cash redirected to later payment dates: ${allocations(t.amounts)}`:`${money(t.amount)}/month released. New allocations: ${allocations(t.amounts)}`}</span></li>`).join('')}</ol></details>
      <h3>Monthly Mortgage Allocation</h3><p class="quiet-note">Actual recurring payments, capped at remaining debt. Lump sums are shown separately. Expand a year for each month.</p>${years.map((year,i)=>`<details class="year-detail" ${i===0?'open':''}><summary>${year}</summary>${table(['Month',...loans.map(l=>esc(l.name)),'Total recurring','Lump sums'],r.monthly.filter(m=>m.month.startsWith(year)).map(m=>[monthDate(m.month+'-01'),...loans.map(l=>money(m.amounts[l.id]||0)),money(m.total),money(m.lump)]))}</details>`).join('')}`;
    $('#fc-save-area').hidden = false; draw();
  }
  root.addEventListener('input',e=>{
    if (e.target.id==='fc-name' || e.target.dataset.fcSelect) return;
    invalidate(); controls(); message('Inputs changed. Run the scenario to refresh the results.');
  });
  root.addEventListener('click',async e=>{
    const button=e.target.closest('button'); if (!button) return;
    try {
      if (button.id==='fc-run') {
        invalidate(); const options=readOptions(), job=++ticket; button.disabled=true; message('Calculating each mortgage independently…');
        const result=await run('fixed',options); if (job!==ticket) return;
        preview=result; renderResult(result); message('Simulation complete. Saved loan payments are unchanged.');
      } else if (button.id==='fc-cancel') { invalidate(); message('Scenario cancelled. Current scheduled payments remain in effect.'); }
      else if (button.id==='fc-save') {
        if (!preview) throw new Error('Run the scenario before saving.');
        if (loadedPortfolio.blocked) throw new Error('Saved data is protected. Recover the existing portfolio before saving scenarios.');
        const p=getPortfolio(),name=$('#fc-name').value.trim() || `Maintain ${money(preview.commitment)} from ${monthDate(preview.options.startMonth+'-01')}`;
        const before=p.fixedCommitmentScenarios;
        p.fixedCommitmentScenarios=[...(before||[]),{id:uid(),name,options:clone({...preview.options, commitment:preview.commitment, mode:'custom'})}];
        saving=true; const saved=commit(); saving=false;
        if (!saved) { if(before===undefined)delete p.fixedCommitmentScenarios;else p.fixedCommitmentScenarios=before; controls(); throw new Error('Browser storage is unavailable. Scenario was not saved.'); }
        controls(); $('#fc-saved-section').open=true; message('Scenario configuration saved.');
      } else if (button.dataset.fcLoad) {
        const scenario=getPortfolio().fixedCommitmentScenarios.find(s=>s.id===button.dataset.fcLoad); if(!scenario)return;
        invalidate(); const o=fixedOptions(scenario.options);
        for (const [id,v] of [['start',o.startMonth],['mode',o.mode],['amount',o.commitment],['strategy',o.strategy],['timing',o.timing],['name',scenario.name]]) $('#fc-'+id).value=v;
        $('#fc-extras').checked=o.includeExtras; controls();
        const fields=[...root.querySelectorAll('[data-fc-priority]')], ids=fields.map(el=>el.dataset.fcPriority), order=[...o.priority.filter(id=>ids.includes(id)),...ids.filter(id=>!o.priority.includes(id))];
        fields.forEach(el=>el.value=order.indexOf(el.dataset.fcPriority)+1);
        root.querySelectorAll('[data-fc-percent]').forEach(el=>el.value=o.percentages[el.dataset.fcPercent]||0); message('Configuration loaded. Run it against the current loan records.');
      } else if (button.dataset.fcDelete) {
        if(loadedPortfolio.blocked)throw new Error('Saved data is protected.');
        const p=getPortfolio(),before=p.fixedCommitmentScenarios; p.fixedCommitmentScenarios=before.filter(s=>s.id!==button.dataset.fcDelete);
        saving=true;const saved=commit();saving=false;if(!saved){p.fixedCommitmentScenarios=before;throw new Error('Scenario deletion could not be saved.');}controls();$('#fc-comparison').innerHTML='';
      } else if (button.id==='fc-compare') {
        const ids=new Set([...root.querySelectorAll('[data-fc-select]:checked')].map(el=>el.dataset.fcSelect)), scenarios=(getPortfolio().fixedCommitmentScenarios||[]).filter(s=>ids.has(s.id));
        if (!scenarios.length) throw new Error('Select at least one saved scenario.');
        button.disabled=true; const job=ticket, rows=await run('fixedCompare',{scenarios}); if(job!==ticket)return;
        $('#fc-comparison').innerHTML=table(['Scenario','Monthly Commitment','Start','Strategy','Portfolio Payoff','Future Interest'],rows.map(s=>[esc(s.name),money(s.result?.commitment??s.result?.monthly),s.options?monthDate(s.options.startMonth+'-01'):'—',s.options?esc(FIXED_STRATEGIES[s.options.strategy]):'Current',s.error?esc(s.error):date(s.result.payoff),money(s.result?.interest)]));
        message('Selected scenarios recalculated using current loans. No rankings.');
      } else if (button.id==='fc-csv' && preview) {
        const loans=activeLoans(getPortfolio()), cell=v=>'"'+String(v).replaceAll('"','""')+'"';
        const rows=[['Month',...loans.map(l=>l.name),'Total recurring','Lump sums'],...preview.monthly.map(m=>[m.month,...loans.map(l=>(m.amounts[l.id]||0).toFixed(2)),m.total.toFixed(2),m.lump.toFixed(2)])];
        downloadFile('fixed-commitment-monthly.csv',rows.map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
      }
    } catch(error) { message(error.message,true); }
    finally { button.disabled=false; }
  });
  loanSignature=JSON.stringify(getPortfolio().loans);
  subscribe(()=>{const sig=JSON.stringify(getPortfolio().loans);if(sig!==loanSignature){loanSignature=sig;invalidate();$('#fc-comparison').innerHTML='';message('Loan records changed. Run the scenario again.');}if(!saving)controls();});
  let resize; window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(draw,150);});
  controls();
  return { renderControls:()=>{controls();draw();} };
}
