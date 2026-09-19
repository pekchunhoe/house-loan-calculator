import { validateStatement, calibrate } from './calibrationEngine.js';
import { validateAssumptions, DEFAULT_THRESHOLDS, validateThresholds } from './calibrationModel.js';
const clone = v => structuredClone(v);
const id = () => crypto.randomUUID();
export function initializeCalibration(loan) { loan.calibrationRecords ??= []; loan.calibrationProfiles ??= []; loan.calibrationThresholds ??= clone(DEFAULT_THRESHOLDS); return loan; }
export function validateCalibration(loan) {
  const errors = [];
  for (const key of ['calibrationRecords','calibrationProfiles']) {
    if (!Array.isArray(loan[key])) { errors.push(`Invalid ${key}.`); continue; }
    const ids = new Set();
    for (const item of loan[key]) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) { errors.push(`Invalid or duplicate ${key} ID.`); continue; }
      ids.add(item.id);
      errors.push(...(key === 'calibrationRecords' ? validateStatement(item) : validateAssumptions(item.assumptions)));
      if (key === 'calibrationRecords' && item.testedAssumptions) errors.push(...validateAssumptions(item.testedAssumptions));
      if (key === 'calibrationProfiles' && (typeof item.name !== 'string' || !item.name.trim() || typeof item.createdAt !== 'string')) errors.push('Invalid calibration profile.');
    }
  }
  errors.push(...validateThresholds(loan.calibrationThresholds));
  return errors;
}
export function saveStatement(loan, value, assumptions) {
  initializeCalibration(loan);
  const old = loan.calibrationRecords.find(s=>s.id===value.id);
  if (old?.locked) throw new Error('Unlock this statement before editing it.');
  const errors = [...validateStatement(value),...validateAssumptions(assumptions)];
  if (errors.length) throw new Error(errors.join('\n'));
  const now = new Date().toISOString();
  const record = {...clone(value),id:value.id || id(),locked:old?.locked || false,createdAt:old?.createdAt || now,modifiedAt:now,checkedAt:now,testedAssumptions:clone(assumptions)};
  record.result = calibrate(loan,record,assumptions,{thresholds:loan.calibrationThresholds});
  if (old) loan.calibrationRecords.splice(loan.calibrationRecords.indexOf(old),1,record); else loan.calibrationRecords.push(record);
  return record;
}
export function lockStatement(loan, recordId, locked) { const s=loan.calibrationRecords.find(s=>s.id===recordId); if (!s) throw new Error('Statement not found.'); s.locked=!!locked; s.modifiedAt=new Date().toISOString(); }
export function duplicateProfile(loan, profileId) { const p=loan.calibrationProfiles.find(p=>p.id===profileId); if(!p) throw new Error('Profile not found.'); return saveProfile(loan,`${p.name} (copy)`,p.assumptions,p.id); }
export function saveProfile(loan, name, assumptions, revertedFrom) {
  if (!name.trim()) throw new Error('Enter a profile name.');
  const errors=validateAssumptions(assumptions); if(errors.length) throw new Error(errors.join('\n'));
  initializeCalibration(loan); const profile={id:id(),name:name.trim(),createdAt:new Date().toISOString(),assumptions:clone(assumptions),...(revertedFrom ? {revertedFrom} : {})};
  loan.calibrationProfiles.push(profile); return profile;
}
export function revertProfile(loan, profileId) { const old=loan.calibrationProfiles.find(p=>p.id===profileId); if(!old) throw new Error('Profile not found.'); return saveProfile(loan,`Reverted: ${old.name}`,old.assumptions,old.id); }
export function applyProfile(loan, profileId) {
  const profile=loan.calibrationProfiles.find(p=>p.id===profileId); if(!profile) throw new Error('Profile not found.');
  const errors=validateAssumptions(profile.assumptions); if(errors.length) throw new Error(errors.join('\n'));
  loan.history.push({recordedAt:new Date().toISOString(),config:clone(loan.config)});
  loan.config.calculationAssumptions=clone(profile.assumptions); loan.config.method=profile.assumptions.basis; loan.config.offset=profile.assumptions.flexi !== 'ignored';
  loan.appliedCalibrationProfile=profile.id;
}
