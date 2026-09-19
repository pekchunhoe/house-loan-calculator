import { initializeCalibration, validateCalibration } from './calibrationStore.js';
import { defaults } from './persistence.js';
import { validate } from './engine.js';
export const PORTFOLIO_KEY = 'flexi-mortgage-portfolio-v3';
export const V2_KEY = 'flexi-mortgage-portfolio-v2';
export const COLORS = ['#285b48', '#336eac', '#aa5b27', '#85579d', '#327e85', '#a84466', '#7b7429', '#465b9a'];
export const clone = value => structuredClone(value);
export const uid = () => globalThis.crypto.randomUUID();
export function createLoan(config = defaults(), metadata = {}, index = 0) {
  return initializeCalibration({ id: uid(), name: 'Home Loan', bank: '', propertyId: '', propertyName: '', accountReference: '', status: config.principal !== '' && config.principal !== null && Number(config.principal) === 0 ? 'settled' : 'active', color: COLORS[index % COLORS.length], original: { amount: '', start: '', tenure: '', rate: '', normal: '' }, assumptions: '', notes: '', history: [], ...metadata, config: clone(config) });
}
export function createPortfolio(loan = createLoan()) {
  return { schemaVersion: 3, id: uid(), name: 'My Mortgage Portfolio', selectedLoanId: loan.id, loans: [loan], properties: [], settings: { householdBudget: '', additional: 2000, strategy: 'highest-rate', rollover: true, custom: {}, target: defaults().target } };
}
export function activeLoans(p) { return p.loans.filter(l => l.status === 'active' && (l.config.principal === '' || Number(l.config.principal) !== 0)); }
export function validatePortfolio(p, { strict = true } = {}) {
  const errors = [];
  if (!p || ![2,3].includes(p.schemaVersion) || !Array.isArray(p.loans) || !Array.isArray(p.properties) || !p.settings || typeof p.settings !== 'object') return ['Unsupported or invalid portfolio backup. Expected schemaVersion 2 or 3.'];
  if (!p.settings.custom || typeof p.settings.custom !== 'object' || Array.isArray(p.settings.custom) || !['highest-rate','lowest-balance','equal','proportional','custom'].includes(p.settings.strategy) || typeof p.settings.rollover !== 'boolean') errors.push('Invalid portfolio strategy settings.');
  const ids = new Set();
  if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim()) errors.push('Portfolio needs a name and ID.');
  for (const l of p.loans) {
    if (!l || typeof l !== 'object' || !l.config) { errors.push('Each loan needs its own calculation state.'); continue; }
    if (typeof l.id !== 'string' || !l.id.trim() || ['__proto__', 'constructor', 'prototype'].includes(l.id) || ids.has(l.id)) errors.push('Loan IDs must be unique and non-empty.');
    ids.add(l.id);
    if (p.schemaVersion === 3) errors.push(...validateCalibration(l));
    if (typeof l.config.start !== 'string' || typeof l.config.method !== 'string') errors.push('Loan dates and calculation method need valid text fields.');
    if (typeof l.name !== 'string' || (strict && !l.name.trim())) errors.push('Loan names cannot be empty.');
    for (const key of ['bank', 'propertyName', 'propertyId', 'accountReference', 'notes', 'assumptions']) if (typeof l[key] !== 'string') errors.push(`Invalid ${key} for loan ${l.name || ''}.`);
    if (!/^#[0-9a-f]{6}$/i.test(l.color || '')) errors.push('Loan color must be a six-digit hex color.');
    if (!['active', 'settled', 'archived'].includes(l.status)) errors.push('Invalid loan status.');
    if (!l.original || typeof l.original !== 'object' || !Array.isArray(l.history) || l.history.some(h => !h || typeof h.recordedAt !== 'string' || !h.config || typeof h.config !== 'object')) errors.push('Missing or invalid original details or history.');
    if (['lumps', 'variables', 'transactions', 'rates'].some(k => !Array.isArray(l.config[k]) || l.config[k].some(r => !r || typeof r !== 'object'))) { errors.push('Invalid loan transactions.'); continue; }
    if (strict) {
      if (['principal','rate','normal','extra','flexi','paymentDay'].some(k => !['number','string'].includes(typeof l.config[k]))) errors.push(`${l.name}: financial fields must contain numbers.`);
      if (l.status === 'settled' && Number(l.config.principal) !== 0) errors.push(`${l.name}: settled loans must have zero principal.`);
      const c = l.config.principal !== '' && Number(l.config.principal) === 0 ? { ...l.config, principal: 1 } : l.config;
      try { errors.push(...validate(c).map(e => `${l.name}: ${e}`)); } catch { errors.push(`${l.name}: invalid calculation fields.`); }
      if (typeof l.config.offset !== 'boolean' || typeof l.config.overdraft !== 'boolean') errors.push(`${l.name}: invalid flexi settings.`);
    }
  }
  const properties = new Set();
  for (const property of p.properties) {
    if (!property || typeof property.id !== 'string' || properties.has(property.id) || typeof property.name !== 'string' || !property.name.trim() || typeof property.type !== 'string' || typeof property.notes !== 'string') errors.push('Invalid or duplicate property.');
    else properties.add(property.id);
  }
  for (const l of p.loans) if (l?.propertyId && !properties.has(l.propertyId)) errors.push('Loan references an unknown property.');
  if (strict) {
    for (const key of ['householdBudget', 'additional']) if (p.settings[key] !== '' && (!Number.isFinite(Number(p.settings[key])) || Number(p.settings[key]) < 0)) errors.push(`Invalid ${key}.`);
    if (!['highest-rate', 'lowest-balance', 'equal', 'proportional', 'custom'].includes(p.settings.strategy) || typeof p.settings.rollover !== 'boolean') errors.push('Invalid strategy settings.');
    if (!p.settings.custom || typeof p.settings.custom !== 'object' || Array.isArray(p.settings.custom)) errors.push('Invalid custom allocation.');
    else for (const [id, amount] of Object.entries(p.settings.custom)) if (!ids.has(id) || !Number.isFinite(Number(amount)) || Number(amount) < 0) errors.push('Invalid custom allocation entry.');
  }
  return [...new Set(errors)];
}
export function exportBackup(p) {
  const errors = validatePortfolio(p);
  if (errors.length) throw new Error(errors.join('\n'));
  return JSON.stringify(p, null, 2);
}
export function importBackup(raw) {
  let p; try { p = JSON.parse(raw); } catch { throw new Error('This file is not valid JSON.'); }
  const errors = validatePortfolio(p);
  if (errors.length) throw new Error(errors.join('\n'));
  for (const l of p.loans) if (Number(l.config.principal) === 0 && l.status === 'active') l.status = 'settled';
  return migratePortfolio(p);
}
export function migratePortfolio(value) {
  const p = clone(value);
  if (p.schemaVersion === 2) { p.schemaVersion = 3; p.loans.forEach(initializeCalibration); }
  return p;
}
export function migrateLegacy(data) {
  const state = data?.singleLoanState ?? (data?.version === 1 ? data.state : data);
  if (!state || typeof state !== 'object' || !('principal' in state)) throw new Error('Unrecognized legacy data.');
  const config = { ...defaults(), ...clone(state) };
  return createPortfolio(createLoan(config, { name: state.name || state.loanName || 'Home Loan', bank: state.bank || '' }));
}
export function savePortfolio(p, storage = globalThis.localStorage) {
  try { storage.setItem(PORTFOLIO_KEY, JSON.stringify(p)); return true; } catch { return false; }
}
export function loadPortfolio(storage = globalThis.localStorage) {
  try {
    const current = storage.getItem(PORTFOLIO_KEY);
    const raw = current ?? storage.getItem(V2_KEY);
    if (raw) {
      const p = JSON.parse(raw), errors = validatePortfolio(p, { strict: false });
      if (errors.length) throw new Error(errors.join(' '));
      const migrated = migratePortfolio(p);
      const changed = p.schemaVersion === 2;
      if (changed) savePortfolio(migrated, storage);
      return { portfolio: migrated, restored: true, migrated: changed };
    }
    const legacy = storage.getItem('flexi-mortgage-v1') ?? storage.getItem('singleLoanState');
    if (legacy) {
      const p = migrateLegacy(JSON.parse(legacy));
      if (validatePortfolio(p, { strict: false }).length) throw new Error('Invalid legacy structure.');
      const saved = savePortfolio(p, storage); // Deliberately keep the v1 backup untouched.
      return { portfolio: p, restored: true, migrated: true, warning: saved ? '' : 'Migration loaded; browser storage is unavailable.' };
    }
    return { portfolio: createPortfolio(), restored: false };
  } catch (error) {
    return { portfolio: createPortfolio(), restored: false, blocked: true, warning: `Saved data was not overwritten: ${error.message}. Export or recover the saved data before replacing it.` };
  }
}
