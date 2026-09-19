import { validateStatement, calibrate } from './calibrationEngine.js';
import { validateCalibration, initializeCalibration } from './calibrationStore.js';
import { money, escapeHtml as esc } from './format.js';
import { CALIBRATION_DISCLAIMER, CALIBRATION_CONVENTIONS, CLOSEST_MATCH_NOTE, defaultAssumptions } from './calibrationModel.js';
export const CSV_FIELDS = ['loan_id','period_start','period_end','opening_balance','closing_balance','interest_charged','payment','extra_payment','flexi_start','flexi_end','rate','notes'];
const keys = ['','start','end','opening','closing','interest','payment','extra','flexiStart','flexiEnd','rate','notes'];
const cell = v => '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"','""') + '"';
export function calibrationCSV(p) {
  const headers=[...CSV_FIELDS,'statement_json','profiles_json','thresholds_json','loan_name','bank','predicted_interest','interest_difference','percentage_difference','predicted_closing_principal','closing_difference','reconciliation_residual','assumptions','warnings'];
  return [headers.join(','),...p.loans.flatMap(l=>l.calibrationRecords.map(s=>{const r=calibrate(l,s,s.testedAssumptions||defaultAssumptions(l.config),{thresholds:l.calibrationThresholds});return [l.id,...keys.slice(1).map(k=>s[k]),JSON.stringify(s),JSON.stringify(l.calibrationProfiles),JSON.stringify(l.calibrationThresholds),l.name,l.bank,r.predictedInterest,r.difference,r.percent,r.predictedPrincipal,r.principalDifference,r.reconciliation.residual,r.label,r.warnings.join(' | ')].map(cell).join(',');}))].join('\r\n');
}
export const csvTemplate = () => CSV_FIELDS.join(',')+'\r\n';
export function parseCSV(raw) {
  const rows=[];let row=[],value='',quoted=false,closed=false;
  raw=raw.replace(/^\uFEFF/,'');
  for(let i=0;i<raw.length;i++) {
    const ch=raw[i];
    if(quoted){if(ch==='"'){if(raw[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=ch;}
    else if(ch==='"'){if(value||closed)throw new Error('Malformed CSV quote.');quoted=true;}
    else if(ch===','||ch==='\n'||ch==='\r'){row.push(value);value='';closed=false;if(ch!==','){if(ch==='\r'&&raw[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push(row);row=[];}}
    else {if(closed)throw new Error('Unexpected text after CSV quote.');value+=ch;}
  }
  if(quoted)throw new Error('Unclosed CSV quote.');
  if(value||row.length||closed){row.push(value);rows.push(row);}return rows;
}
export function importCalibrationCSV(raw,p) {
  const rows=parseCSV(raw),headers=rows.shift();
  if(!headers||CSV_FIELDS.some(k=>!headers.includes(k))||new Set(headers).size!==headers.length)throw new Error('CSV needs the template column headings exactly once.');
  const next=structuredClone(p), errors=[];
  rows.forEach((row,i)=>{
    try {
      if(row.length!==headers.length)throw new Error('Column count does not match.');
      const d=Object.fromEntries(headers.map((k,j)=>[k,row[j]])),loan=next.loans.find(l=>l.id===d.loan_id);
      if(!loan)throw new Error('Unknown loan_id.');
      const s=d.statement_json?JSON.parse(d.statement_json):Object.fromEntries(keys.slice(1).map((k,j)=>[k,d[CSV_FIELDS[j+1]]]));
      const errors=validateStatement(s);if(errors.length)throw new Error(errors.join(' '));
      s.id=crypto.randomUUID();s.locked=!!s.locked;
      s.createdAt ||= new Date().toISOString();s.modifiedAt ||= s.createdAt;s.checkedAt=new Date().toISOString();s.testedAssumptions ||= defaultAssumptions(loan.config);
      s.result=calibrate(loan,s,s.testedAssumptions,{thresholds:loan.calibrationThresholds});loan.calibrationRecords.push(s);
      if(d.profiles_json){const profiles=JSON.parse(d.profiles_json);if(!Array.isArray(profiles))throw new Error('Invalid profiles.');for(const profile of profiles)if(!loan.calibrationProfiles.some(x=>x.id===profile.id))loan.calibrationProfiles.push(profile);}
      if(d.thresholds_json)loan.calibrationThresholds=JSON.parse(d.thresholds_json);
      const invalid=validateCalibration(loan);if(invalid.length)throw new Error(invalid.join(' '));
    }catch(e){errors.push(`Row ${i+2}: ${e.message}`);}
  });
  if(errors.length)throw new Error(errors.join('\n'));if(!rows.length)throw new Error('CSV contains no statement rows.');return next;
}
export function calibrationJSON(p) { return JSON.stringify({type:'flexi-calibration',version:1,loans:p.loans.map(l=>({id:l.id,name:l.name,bank:l.bank,calibrationRecords:l.calibrationRecords,calibrationProfiles:l.calibrationProfiles,calibrationThresholds:l.calibrationThresholds}))},null,2); }
export function importCalibrationJSON(raw,p) {
  let data;try{data=JSON.parse(raw);}catch{throw new Error('Invalid calibration JSON.');}
  if(data?.type!=='flexi-calibration'||data.version!==1||!Array.isArray(data.loans))throw new Error('Unsupported calibration JSON.');
  const next=structuredClone(p), ids=new Set();
  for(const item of data.loans){if(!item||ids.has(item.id))throw new Error('Duplicate or invalid loan ID.');ids.add(item.id);const l=next.loans.find(l=>l.id===item.id);if(!l)throw new Error('Unknown loan ID in calibration backup.');const errors=validateCalibration(item);if(errors.length)throw new Error(errors.join('\n'));Object.assign(l,{calibrationRecords:item.calibrationRecords,calibrationProfiles:item.calibrationProfiles,calibrationThresholds:item.calibrationThresholds});initializeCalibration(l);}
  return next;
}
export function calibrationSummary(l,s,r) { return `Loan: ${l.name}\nBank: ${l.bank}\nStatement Period (inclusive): ${s.start} – ${s.end}\nActual Interest: ${money(r.actualInterest)}\nPredicted Interest: ${money(r.predictedInterest)}\nDifference (predicted − actual): ${money(r.difference)}\nPercentage Difference: ${r.percent===null?'Undefined':r.percent.toFixed(2)+'%'}\nMethod Tested: ${r.label}\nActual Closing Principal: ${money(r.actualPrincipal)}\nPredicted Closing Principal: ${money(r.predictedPrincipal)}\nClosing Principal Difference: ${money(r.principalDifference)}\nReconciliation Residual: ${money(r.reconciliation.residual)}\nWarnings: ${r.warnings.join(' ')}\nNotes: ${s.notes||''}\n\n${CALIBRATION_DISCLAIMER}\n${CALIBRATION_CONVENTIONS}`; }
export function calibrationPrint(l,s,r,comparison=[]) {
  const table=(headers,rows)=>`<table><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<h1>Bank Statement Calibration</h1><h2>${esc(l.name)} · ${esc(l.bank)}</h2><p>${esc(s.start)} – ${esc(s.end)}</p><h2>Statement Comparison</h2>${table(['Figure','Actual','Predicted','Difference'],[['Interest',money(s.interest*1),money(r.predictedInterest),money(r.difference)],['Closing principal',money(s.closing*1),money(r.predictedPrincipal),money(r.principalDifference)]])}<p>${esc(r.label)}. Percentage difference: ${r.percent===null?'Not defined for zero actual interest':r.percent.toFixed(2)+'%'}.</p><h2>Balance Reconciliation</h2><p>Opening ${money(r.reconciliation.opening)} + actual interest ${money(r.reconciliation.interest)} + fees/adjustments ${money(r.reconciliation.fees)} − total payments ${money(r.reconciliation.payments)} = ${money(r.reconciliation.closing)}. Residual: ${money(r.reconciliation.residual)}.</p><h2>Assumptions Tested</h2>${table(['Method','Periods','Mean absolute difference','Maximum difference'],comparison.length?comparison.map(c=>[c.label,c.periods,money(c.meanAbsolute),money(c.maximumAbsolute)]):[[r.label,1,money(Math.abs(r.difference)),money(Math.abs(r.difference))]])}<h2>Transaction Timeline</h2>${table(['Date','Type','Amount'],(s.transactions||[]).map(t=>[t.date,t.type,money(Number(t.amount))]))}<p>Summary instalment: ${money(Number(s.payment))}; extra: ${money(Number(s.extra||0))}; lump sum: ${money(Number(s.lump||0))}. Payment posting: ${esc(s.paymentDate||'Statement end assumed')}. Interest posting: ${esc(s.interestDate||'Unspecified')}.</p><h2>Notes</h2><p>${esc(s.notes||'No notes entered.')}</p>${r.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}<p>${CALIBRATION_DISCLAIMER}</p><p>${CLOSEST_MATCH_NOTE}</p><h2>Inclusive dates and calculation conventions</h2><p>${CALIBRATION_CONVENTIONS}</p><h2>Historical rates</h2>${table(['Effective date','Annual rate (%)'],[[s.start,s.rate],...(s.rates||[]).map(t=>[t.date,t.rate])])}`;
}
