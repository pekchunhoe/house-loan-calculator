import { parseDate } from './dates.js';

export const FIXED_STRATEGIES = {
  'highest-rate': 'Highest Interest Rate First', 'lowest-balance': 'Lowest Outstanding Balance First',
  'earliest-payoff': 'Earliest Existing Payoff First', 'largest-balance': 'Largest Balance First',
  equal: 'Equal Split', proportional: 'Proportional by Outstanding Balance',
  priority: 'Custom Priority Order', percentage: 'Custom Percentage Allocation'
};
export function fixedOptions(value = {}) {
  return { startMonth: '', mode: 'current', commitment: 0, strategy: 'highest-rate', timing: 'following-month', includeExtras: true, priority: [], percentages: {}, ...value };
}
export function validateFixedOptions(value) {
  const o = fixedOptions(value), errors = [];
  if (!Number.isFinite(parseDate(o.startMonth + '-01'))) errors.push('Choose a valid fixed commitment start month.');
  if (!['current', 'custom'].includes(o.mode)) errors.push('Choose current or custom commitment.');
  if (o.commitment === '' || !['number','string'].includes(typeof o.commitment) || !Number.isFinite(Number(o.commitment)) || Number(o.commitment) < 0) errors.push('Enter a non-negative monthly commitment.');
  if (!Object.hasOwn(FIXED_STRATEGIES, o.strategy)) errors.push('Choose a fixed commitment allocation strategy.');
  if (!['following-month','next-payment'].includes(o.timing)) errors.push('Choose a rollover timing.');
  if (typeof o.includeExtras !== 'boolean') errors.push('Choose whether to include recurring extras.');
  if (!Array.isArray(o.priority) || o.priority.some(id => typeof id !== 'string') || new Set(o.priority).size !== o.priority.length) errors.push('Priority order must contain unique loan IDs.');
  if (!o.percentages || typeof o.percentages !== 'object' || Array.isArray(o.percentages) || Object.values(o.percentages).some(n => n === '' || !['number','string'].includes(typeof n) || !Number.isFinite(Number(n)) || Number(n) < 0 || Number(n) > 100)) errors.push('Percentages must be between 0 and 100.');
  else if (o.strategy === 'percentage' && Math.abs(Object.values(o.percentages).reduce((s,n)=>s+Number(n),0)-100)>0.0001) errors.push('Custom percentages must total 100%.');
  return errors;
}
export function validateFixedScenarios(items) {
  if (items === undefined) return [];
  if (!Array.isArray(items)) return ['Invalid fixed commitment scenarios.'];
  const ids = new Set(), errors = [];
  for (const s of items) {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id) || typeof s.name !== 'string' || !s.name.trim() || !s.options) errors.push('Invalid saved fixed commitment scenario.');
    else { ids.add(s.id); errors.push(...validateFixedOptions(s.options)); }
  }
  return errors;
}
