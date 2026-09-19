import { getPortfolio, getSelectedLoan, commit, replacePortfolio } from './session.js';
import { activeLoans, clone } from './storage.js';
import { calibrate, comparePeriods, compareAssumptions, TRANSACTION_TYPES } from './calibrationEngine.js';
import { defaultAssumptions, assumptionLabel, CALIBRATION_DISCLAIMER, CALIBRATION_CONVENTIONS, CLOSEST_MATCH_NOTE, matchQuality, validateThresholds } from './calibrationModel.js';
import { saveStatement, lockStatement, saveProfile, duplicateProfile, revertProfile, applyProfile } from './calibrationStore.js';
import { calibrationCSV, calibrationJSON, importCalibrationCSV, importCalibrationJSON, csvTemplate, calibrationSummary, calibrationPrint } from './calibrationExport.js';
import { downloadFile } from './portfolioExport.js';
import { money, escapeHtml as esc } from './format.js';

const labels = {normal:'Normal Payment',extra:'Extra Payment',lump:'Lump Sum',deposit:'Flexi Deposit',withdrawal:'Flexi Withdrawal',interest:'Interest Posted',fee:'Fee',adjustment:'Adjustment',other:'Other'};
const table = (headers, rows) => `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(headers[0])} table"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const button = (action, text, extra='') => `<button type="button" class="button secondary" data-caction="${action}" ${extra}>${text}</button>`;
const percent = n => n === null ? 'Undefined (zero actual interest)' : `${n.toFixed(2)}%`;
const field = (key,label,value,type='number') => `<label class="field">${label}<input id="cal-${key}" data-cfield="${key}" type="${type}" ${type==='number'?'step="any" inputmode="decimal"':''} value="${esc(value ?? '')}"></label>`;
const select = (key,label,values,value) => `<label class="field">${label}<select id="cal-${key}" data-cassumption="${key}">${values.map(v=>`<option value="${esc(v)}" ${value===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`;

export function mountCalibration(panel, navigate, applied) {
  let loanId, draft, assumptions, advanced=false, result=null, resultStatement=null, comparisons=[], selected=new Set(), filter=false, pending=null, previewBase=null;
  const $ = selector => panel.querySelector(selector);
  const loan = () => getPortfolio().loans.find(l=>l.id===loanId);
  const report = document.createElement('div'); report.id='calibration-print-report'; report.hidden=true; document.body.append(report);
  const dialog = document.createElement('dialog'); dialog.id='calibration-dialog'; dialog.setAttribute('aria-labelledby','cal-dialog-title'); document.body.append(dialog);
  let confirmAction;
  dialog.addEventListener('click',e=>{if(e.target.dataset.cconfirm){dialog.close();try{confirmAction?.();}catch(error){message(error.message,true);}confirmAction=null;}else if(e.target.dataset.ccancel)dialog.close();});
  const confirm = (title,text,action) => {confirmAction=action;dialog.innerHTML=`<h2 id="cal-dialog-title">${esc(title)}</h2><p>${esc(text)}</p><div class="dialog-actions"><button class="button secondary" data-ccancel="true" autofocus>Cancel</button><button class="button primary" data-cconfirm="true">Confirm</button></div>`;dialog.showModal();};
  function message(text,error=false) { $('#cal-message').textContent=text; $('#cal-message').className=error?'validation':'portfolio-message'; $('#cal-message').hidden=!text; }
  function fresh() {
    const c=loan().config;
    const d=new Date(c.start+'T00:00:00Z');
    draft={start:c.start,end:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10),opening:'',closing:'',interest:'',payment:'',extra:0,rate:c.rate,notes:'',transactions:[],rates:[]};
    assumptions=defaultAssumptions(c);result=null;resultStatement=null;comparisons=[];
  }
  function choose(id) {loanId=id;selected=new Set(loan().calibrationRecords.map(s=>s.id));fresh();render();}
  function collect() {
    if (!draft) return;
    if(!draft.locked){
      panel.querySelectorAll('[data-cfield]').forEach(el=>draft[el.dataset.cfield]=el.value);
      for(const key of ['transactions','rates']) draft[key]=[...panel.querySelectorAll(`[data-crow="${key}"]`)].map(row=>Object.fromEntries([...row.querySelectorAll('[data-cprop]')].map(el=>[el.dataset.cprop,el.value])));
      const fees=$('#cal-fees')?.value || 0;
      if(Number(fees)!==Object.values(draft.fees||{}).reduce((n,v)=>n+Number(v),0))draft.fees=Number(fees)<0?{legal:fees}:{service:fees};
    }
    panel.querySelectorAll('[data-cassumption]').forEach(el=>assumptions[el.dataset.cassumption]=el.value);
  }
  function overview() {
    const loans=activeLoans(getPortfolio());
    const latest = l => [...l.calibrationRecords].filter(s=>s.result).sort((a,b)=>(b.checkedAt||'').localeCompare(a.checkedAt||'')).at(0);
    const quality = l => {const s=latest(l);return s?matchQuality(s.result.difference,s.result.percent,l.calibrationThresholds):'Not Calibrated';};
    const calibrated=loans.filter(l=>latest(l)).length,close=loans.filter(l=>quality(l)==='Close Match').length;
    return `<section class="card"><h2>Calibration overview</h2><div class="cal-metrics">${[['Loans calibrated',calibrated],['Total active loans',loans.length],['Statements entered',getPortfolio().loans.reduce((n,l)=>n+l.calibrationRecords.length,0)],['Close historical matches',close],['Loans needing review',calibrated-close],['Loans not calibrated',loans.length-calibrated]].map(([k,v])=>`<div class="metric"><div class="metric-label">${k}</div><strong>${v}</strong></div>`).join('')}</div><label class="check-field"><input id="cal-filter" type="checkbox" ${filter?'checked':''}>Show only loans needing calibration/review</label>${table(['Loan','Bank','Status','Last Checked','Latest Difference'],loans.filter(l=>!filter||quality(l)!=='Close Match').map(l=>[button('choose',esc(l.name),`data-id="${esc(l.id)}"`),esc(l.bank),quality(l),esc(latest(l)?.checkedAt || 'Never'),money(latest(l)?.result.difference)]))}<p class="quiet-note">Thresholds are UI indicators, not proof of correctness. Small differences are included for review.</p></section>`;
  }
  function rows(key) {
    return (draft[key]||[]).map((t,i)=>`<tr data-crow="${key}"><td><input type="date" aria-label="${key} date ${i+1}" data-cprop="date" value="${esc(t.date)}"></td>${key==='transactions'?`<td><select aria-label="Transaction type ${i+1}" data-cprop="type">${TRANSACTION_TYPES.map(v=>`<option value="${v}" ${v===t.type?'selected':''}>${labels[v]}</option>`).join('')}</select></td>`:''}<td><input type="number" step="any" aria-label="${key==='rates'?'Historical rate':'Transaction amount'} ${i+1}" data-cprop="${key==='rates'?'rate':'amount'}" value="${esc(key==='rates'?t.rate:t.amount)}"></td><td>${button('remove','Remove',`data-key="${key}" data-index="${i}" aria-label="Remove ${key} row ${i+1}"`)}</td></tr>`).join('');
  }
  function render() {
    if (!loan()) {loanId=getSelectedLoan()?.id || getPortfolio().loans[0]?.id;if(loanId){selected=new Set(loan().calibrationRecords.map(s=>s.id));fresh();}}
    panel.innerHTML=`<h2>Bank Statement Calibration</h2><p>${CALIBRATION_DISCLAIMER}</p><p class="quiet-note">All statement data stays on this device. Save a statement to retain your entries.</p>${overview()}<div id="cal-message" role="status" aria-live="polite" hidden></div>`;
    if(!loan()){panel.insertAdjacentHTML('beforeend','<p>Add a housing loan to begin calibration.</p>');return;}
    const l=loan();
    panel.insertAdjacentHTML('beforeend',`<section class="card"><h3>1. Choose loan</h3><label class="field">Loan<select id="cal-loan">${getPortfolio().loans.map(x=>`<option value="${esc(x.id)}" ${x.id===loanId?'selected':''}>${esc(x.name)} — ${esc(x.bank)}</option>`).join('')}</select></label><p>Loan ID for CSV: <code>${esc(l.id)}</code></p><label class="check-field"><input type="checkbox" id="cal-advanced" ${advanced?'checked':''}>Advanced Mode (exact transactions and assumptions)</label><p>${draft.locked?'Locked statement — viewing and comparison are available. Unlock explicitly to edit.':'Basic Mode requires dates, opening and closing principal, interest, payment and annual rate.'}</p><fieldset id="cal-fields" ${draft.locked?'disabled':''}><legend>Statement figures</legend><h3>2. Enter statement period</h3><p>Both dates are inclusive.</p><div class="cal-grid">${field('start','Statement start date',draft.start,'date')}${field('end','Statement end date',draft.end,'date')}</div><h3>3. Enter actual bank figures</h3><div class="cal-grid">${[['opening','Opening principal balance (RM)'],['closing','Closing principal balance (RM)'],['interest','Interest charged (RM)'],['payment','Payment amount (RM)'],['rate','Annual rate (%)'],['extra','Extra payment (optional, RM)']].map(([k,label])=>field(k,label,draft[k])).join('')}</div><label class="field">Notes<textarea id="cal-notes" data-cfield="notes">${esc(draft.notes||'')}</textarea></label><div ${advanced?'':'hidden'}><h3>4. Enter exact transactions</h3><div class="cal-grid">${field('paymentDate','Summary payment posting date',draft.paymentDate,'date')}${field('interestDate','Interest posting date',draft.interestDate,'date')}${field('lump','Summary lump sum (RM)',draft.lump||0)}${field('flexiStart','Opening flexi balance (RM)',draft.flexiStart||0)}${field('flexiEnd','Closing flexi balance (optional, RM)',draft.flexiEnd)}<label class="field">Summary fees/adjustments (RM)<input id="cal-fees" type="number" step="any" value="${esc(Object.values(draft.fees||{}).reduce((n,v)=>n+Number(v),0))}"></label></div><p class="quiet-note">Dated payment rows replace the matching summary category. Dated fees/adjustments replace summary fees. Positive adjustments increase the reconciliation balance; negative adjustments reduce it. Other rows are annotations.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Transaction entry"><table class="cal-entry"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Amount (RM)</th><th scope="col">Action</th></tr></thead><tbody>${rows('transactions')}</tbody></table></div>${button('add-transaction','Add transaction')}<h3>Historical rate changes</h3><div class="table-scroll" tabindex="0" role="region" aria-label="Historical rate entry"><table class="cal-entry"><thead><tr><th scope="col">Effective date</th><th scope="col">Annual rate (%)</th><th scope="col">Action</th></tr></thead><tbody>${rows('rates')}</tbody></table></div>${button('add-rate','Add rate change')}</div></fieldset></section>
    <section class="card"><h3>5. Run comparison</h3><details ${advanced?'open':''}><summary>Calculation assumptions</summary><div class="cal-grid">${select('basis','Interest method',['daily','monthly'],assumptions.basis)}${select('dayCount','Day-count convention',['Actual/365','Actual/366','Actual/360','Monthly / 12'],assumptions.dayCount.replace('365 fixed','Actual/365').replace('366 fixed','Actual/366'))}${select('timing','Transaction effective timing',['beginning','end'],assumptions.timing)}${select('paymentTiming','Payment dates',['actual','scheduled'],assumptions.paymentTiming)}${select('flexi','Flexi treatment',['daily','monthly','ignored','capped'],assumptions.flexi)}${select('posting','Interest posting convention',['monthly','statement','daily'],assumptions.posting)}</div></details><details><summary>Exact conventions and limitations</summary><p>${CALIBRATION_CONVENTIONS}</p></details><div class="cal-actions">${button('run','Run Comparison')}${button('save','Save Statement',draft.locked?'disabled':'')}${draft.id?button('lock',draft.locked?'Unlock Statement':'Lock Statement'):''}${button('new','New Statement')}</div><div id="cal-result"></div></section>
    <section class="card"><h3>6. Compare assumptions across periods</h3><p>Select saved periods. With none selected, comparison uses the current statement. Draft edits enter multi-period comparison after saving.</p><div id="cal-records">${l.calibrationRecords.length?l.calibrationRecords.map(s=>`<div class="cal-record"><label class="check-field"><input type="checkbox" data-cperiod="${esc(s.id)}" ${selected.has(s.id)?'checked':''}>${esc(s.start)} – ${esc(s.end)}${s.locked?' · Locked':''}</label>${button('view','View statement',`data-id="${esc(s.id)}"`)}</div>`).join(''):'<p>No saved statements yet.</p>'}</div><div class="cal-actions">${button('periods','Compare Selected Periods')}${button('compare','Compare Assumptions')}</div><div id="cal-comparisons"></div></section>
    <section class="card"><h3>7. Save calibration profile</h3><label class="field">Profile name<input id="cal-profile-name" type="text"></label>${button('profile-save','Save Profile')}<h3>8. Optionally apply profile to loan</h3><p>Saving or testing assumptions does not alter mortgage settings. Apply Profile changes the saved loan only after confirmation. Revert creates a new revision; apply that revision separately.</p><label class="field">Saved profile<select id="cal-profile">${l.calibrationProfiles.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${l.appliedCalibrationProfile===p.id?' (applied)':''}</option>`).join('')}</select></label><div class="cal-actions">${button('profile-use','Use for Comparison')}${button('profile-apply','Apply Profile')}${button('profile-duplicate','Duplicate Profile')}${button('profile-revert','Revert to Previous Profile')}</div><details><summary>Profile History</summary>${table(['Revision','Created','Assumptions','Source revision'],l.calibrationProfiles.map(p=>[esc(p.name),esc(p.createdAt),esc(assumptionLabel(p.assumptions)),esc(p.revertedFrom||'New profile')]))}</details></section>
    <section class="card"><h3>Match indicators</h3><div class="cal-grid">${Object.entries(l.calibrationThresholds).map(([k,v])=>`<label class="field">${esc(({closeAmount:'Close match amount (RM)',closePercent:'Close match relative (%)',smallAmount:'Small difference amount (RM)',smallPercent:'Small difference relative (%)',largeAmount:'Large difference amount (RM)',largePercent:'Large difference relative (%)'})[k])}<input data-cthreshold="${k}" type="number" step="any" min="0" value="${v}"></label>`).join('')}</div><p>Close/small match uses the amount OR percentage threshold. Larger differences need review.</p>${button('thresholds','Save Thresholds')}</section>
    <section class="card"><h3>Import and export</h3><p>CSV adds statements. JSON restores calibration records and profiles for the listed loan IDs. Both require a validated preview before import; mortgage settings stay intact.</p><div class="cal-actions">${button('csv','Export Calibration CSV')}${button('json','Export Calibration JSON')}${button('template','Download CSV Template')}${button('copy','Copy Calibration Summary')}${button('print','Print Calibration Report')}</div><label class="field">Import calibration CSV or JSON<input id="cal-import" type="file" accept=".csv,.json,text/csv,application/json"></label><div id="cal-preview"></div></section>`);
    renderResult(); renderComparisons();
  }
  function renderResult() {
    if(!result){$('#cal-result').innerHTML='';return;}
    const r=result;
    $('#cal-result').innerHTML=`<h3>Actual vs predicted</h3><p>${esc(resultStatement.start)} – ${esc(resultStatement.end)} · ${esc(r.quality)}</p>${table(['Figure','Actual','Predicted','Difference (predicted − actual)'],[['Interest',money(r.actualInterest),money(r.predictedInterest),money(r.difference)],['Closing principal',money(r.actualPrincipal),money(r.predictedPrincipal),money(r.principalDifference)]])}<p>Percentage difference: ${percent(r.percent)}</p><p>${esc(r.label)}</p><h3>Balance reconciliation</h3><p>Opening ${money(r.reconciliation.opening)} + actual interest ${money(r.reconciliation.interest)} + fees/adjustments ${money(r.reconciliation.fees)} − total payments ${money(r.reconciliation.payments)} = ${money(r.reconciliation.closing)}.</p><p>Actual closing balance: ${money(r.actualPrincipal)}. <strong>Unexplained Residual: ${money(r.reconciliation.residual)}</strong></p><p>Predicted account balance including unpaid interest and fees: ${money(r.predictedAccountBalance)}. Unpaid interest kept separate from principal: ${money(r.unpaidInterest)}.</p>${r.warnings.length?`<ul class="cal-warnings">${r.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:'<p>No input reconciliation warnings.</p>'}<details id="cal-trace"><summary>${r.assumptions.basis==='daily'?'Daily trace':'Monthly breakdown'}</summary><div id="cal-trace-body"></div></details><details><summary>Interest posting ledger</summary>${table(['Posting date','Accrued interest posted'],r.postings.map(p=>[esc(p.date),money(p.interest)]))}<p>Unposted accrual: ${money(r.unpostedInterest)}. Posting does not capitalize interest.</p></details>`;
    $('#cal-trace').addEventListener('toggle',()=>{if($('#cal-trace').open&&!$('#cal-trace-body').innerHTML){const trace=calibrate(loan(),resultStatement,result.assumptions,{trace:true,thresholds:loan().calibrationThresholds});$('#cal-trace-body').innerHTML=table(trace.assumptions.basis==='daily'?['Date','Principal','Flexi','Effective Balance','Rate','Daily Interest','Transaction']:['Segment (inclusive)','Principal','Flexi snapshot','Effective Balance','Rate','Segment Interest','Transaction'],(trace.assumptions.basis==='daily'?trace.dailyRows:trace.monthlyRows).map(t=>[esc(t.end?`${t.date} – ${t.end}`:t.date),money(t.principal),money(t.flexi),money(t.effective),`${t.rate.toFixed(4)}%`,money(t.interest),esc(t.transactions.join('; '))]));}});
  }
  function renderComparisons() {
    if(!comparisons.length){$('#cal-comparisons').innerHTML='';return;}
    const closest=comparisons.length>1;
    $('#cal-comparisons').innerHTML=`${closest?`<h3>Closest Tested Match</h3><p>${esc(comparisons[0].label)}</p><p>${CLOSEST_MATCH_NOTE}</p>`:''}${table(['Method','Periods Compared','Mean Absolute Difference','Maximum Absolute Difference','Mean Percentage Difference','Use assumptions'],comparisons.map((c,i)=>[esc(c.label),c.periods,money(c.meanAbsolute),money(c.maximumAbsolute),percent(c.meanPercentage),button('candidate','Use for comparison',`data-index="${i}"`)]))}<p>Percentage means omit periods with nonzero prediction and zero actual interest. ${comparisons[0].percentagePeriods} of ${comparisons[0].periods} periods have defined percentages. Ranked by mean absolute difference.</p>`;
  }
  function run(){collect();if(draft.rate==='')throw new Error('Annual rate is required.');result=calibrate(loan(),draft,assumptions,{thresholds:loan().calibrationThresholds});resultStatement=clone(draft);renderResult();}
  const periods = () => selected.size?loan().calibrationRecords.filter(s=>selected.has(s.id)):[draft];
  panel.addEventListener('input',e=>{
    if(e.target.matches('[data-cfield],[data-cprop],[data-cassumption],#cal-fees')){result=null;resultStatement=null;comparisons=[];pending=null;renderResult();renderComparisons();}
  });
  panel.addEventListener('change',async e=>{
    try {
      const el=e.target;
      if(el.id==='cal-loan')choose(el.value);
      else if(el.id==='cal-advanced'){collect();advanced=el.checked;render();}
      else if(el.id==='cal-filter'){collect();filter=el.checked;render();}
      else if(el.dataset.cperiod){el.checked?selected.add(el.dataset.cperiod):selected.delete(el.dataset.cperiod);comparisons=[];renderComparisons();}
      else if(el.dataset.cassumption==='basis'){collect();assumptions.dayCount=assumptions.basis==='monthly'?'Monthly / 12':'Actual/365';$('#cal-dayCount').value=assumptions.dayCount;}
      else if(el.dataset.cassumption==='dayCount'){collect();assumptions.basis=assumptions.dayCount==='Monthly / 12'?'monthly':'daily';$('#cal-basis').value=assumptions.basis;}
      else if(el.id==='cal-import'){
        pending=null;$('#cal-preview').innerHTML='';const file=el.files[0];if(!file)return;
        const raw=await file.text();previewBase=JSON.stringify(getPortfolio());pending=file.name.toLowerCase().endsWith('.csv')?importCalibrationCSV(raw,getPortfolio()):importCalibrationJSON(raw,getPortfolio());
        $('#cal-preview').innerHTML=`<h3>Validated import preview</h3><p>${esc(file.name)}. All rows validated. ${file.name.toLowerCase().endsWith('.csv')?'Statements will be added.':'Calibration data for listed loans will be replaced, including locked records; other loans are retained.'}</p>${table(['Loan','Statements after import','Profiles after import'],pending.loans.map(l=>[esc(l.name),l.calibrationRecords.length,l.calibrationProfiles.length]))}${button('import-confirm','Import Validated Data')}${button('import-cancel','Cancel Import')}`;
      }
    }catch(error){pending=null;message(error.message,true);}finally{if(e.target.id==='cal-import')e.target.value='';}
  });
  panel.addEventListener('click',async e=>{
    const el=e.target.closest('[data-caction]');if(!el)return;
    try {
      const action=el.dataset.caction;collect();
      if(action==='choose'){choose(el.dataset.id);return;}
      if(action==='run'){run();message('Comparison complete. Save Statement to retain it.');}
      else if(action==='save'){run();draft=clone(saveStatement(loan(),draft,assumptions));selected.add(draft.id);result=draft.result;resultStatement=clone(draft);const saved=commit();render();message(saved?'Statement saved locally.':'Storage unavailable. Export JSON to keep this statement.',!saved);}
      else if(action==='new'){fresh();render();$('#cal-start').focus();}
      else if(action==='view'){draft=clone(loan().calibrationRecords.find(s=>s.id===el.dataset.id));assumptions=clone(draft.testedAssumptions||defaultAssumptions(loan().config));result=calibrate(loan(),draft,assumptions,{thresholds:loan().calibrationThresholds});resultStatement=clone(draft);comparisons=[];render();$('#cal-fields').scrollIntoView();}
      else if(action==='lock'){if(!draft.locked)draft=clone(saveStatement(loan(),draft,assumptions));lockStatement(loan(),draft.id,!draft.locked);draft=clone(loan().calibrationRecords.find(s=>s.id===draft.id));result=draft.result;resultStatement=clone(draft);commit();render();message(draft.locked?'Statement locked.':'Statement unlocked.');}
      else if(action==='add-transaction'||action==='add-rate'){if(draft.locked)return;const key=action==='add-rate'?'rates':'transactions';draft[key].push(key==='rates'?{date:draft.start,rate:draft.rate}:{date:draft.start,type:'normal',amount:0});result=null;resultStatement=null;comparisons=[];render();panel.querySelectorAll(`[data-crow="${key}"] input`)[(draft[key].length-1)*2]?.focus();}
      else if(action==='remove'){if(draft.locked)return;draft[el.dataset.key].splice(Number(el.dataset.index),1);result=null;comparisons=[];render();}
      else if(action==='compare'||action==='periods'){comparisons=action==='compare'?compareAssumptions(loan(),periods(),assumptions):[comparePeriods(loan(),periods(),assumptions)];renderComparisons();}
      else if(action==='candidate'){assumptions=clone(comparisons[Number(el.dataset.index)].assumptions);result=null;render();message('Assumptions selected for comparison. Mortgage settings unchanged.');}
      else if(action==='profile-save'){const p=saveProfile(loan(),$('#cal-profile-name').value,assumptions);commit();render();$('#cal-profile').value=p.id;message('Profile saved as a new revision. Mortgage settings unchanged.');}
      else if(action.startsWith('profile-')){
        const id=$('#cal-profile').value,p=loan().calibrationProfiles.find(p=>p.id===id);if(!p)throw new Error('Save or select a profile first.');
        if(action==='profile-apply'){const target=loan();confirm('Apply profile to saved mortgage?',`${target.name}: ${p.name}. ${assumptionLabel(p.assumptions)}. This changes future mortgage simulations. The prior settings will be retained in loan history.`,()=>{applyProfile(target,id);commit();applied();render();message('Profile applied to the saved loan.');});}
        else if(action==='profile-use'){assumptions=clone(p.assumptions);result=null;comparisons=[];render();message('Profile loaded for comparison only.');}
        else {const next=action==='profile-duplicate'?duplicateProfile(loan(),id):revertProfile(loan(),id);commit();render();$('#cal-profile').value=next.id;message('New profile revision saved. Apply it separately to change the loan.');}
      }
      else if(action==='thresholds'){const thresholds=Object.fromEntries([...panel.querySelectorAll('[data-cthreshold]')].map(el=>[el.dataset.cthreshold,Number(el.value)]));const errors=validateThresholds(thresholds);if(errors.length)throw new Error(errors.join(' '));loan().calibrationThresholds=thresholds;commit();if(result)result.quality=matchQuality(result.difference,result.percent,thresholds);render();message('Match thresholds saved.');}
      else if(action==='csv')downloadFile('mortgage-calibration.csv',calibrationCSV(getPortfolio()),'text/csv;charset=utf-8');
      else if(action==='json')downloadFile('mortgage-calibration.json',calibrationJSON(getPortfolio()),'application/json');
      else if(action==='template')downloadFile('calibration-template.csv',csvTemplate(),'text/csv;charset=utf-8');
      else if(action==='copy'){run();await navigator.clipboard.writeText(calibrationSummary(loan(),resultStatement,result));message('Calibration summary copied.');}
      else if(action==='print'){run();report.innerHTML=calibrationPrint(loan(),resultStatement,result,comparisons);document.body.classList.add('calibration-print');window.print();}
      else if(action==='import-cancel'){pending=null;$('#cal-preview').innerHTML='';}
      else if(action==='import-confirm'){if(!pending)throw new Error('Choose and validate a file first.');if(previewBase!==JSON.stringify(getPortfolio()))throw new Error('Portfolio changed since preview. Select the file again.');replacePortfolio(pending);pending=null;choose(loanId);applied();message('Validated calibration data imported.');}
    }catch(error){message(error.message,true);}
  });
  document.addEventListener('click',e=>{const el=e.target.closest('[data-calibrate],[data-calibrate-current]');if(!el)return;const id=el.dataset.calibrate||getSelectedLoan()?.id;if(id){choose(id);navigate();}});
  window.addEventListener('beforeprint',()=>{if(!panel.hidden&&result){report.innerHTML=calibrationPrint(loan(),resultStatement,result,comparisons);document.body.classList.add('calibration-print');}});
  window.addEventListener('afterprint',()=>document.body.classList.remove('calibration-print'));
  return {render:()=>{if(draft)collect();render();}};
}
