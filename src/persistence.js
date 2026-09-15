import { today, paymentDate, iso } from './dates.js';
const KEY = 'flexi-mortgage-v1';
export function defaults(start = today()) {
  const date = new Date(start + 'T00:00:00Z');
  const target = iso(paymentDate(date.getUTCFullYear() + 10, date.getUTCMonth(), date.getUTCDate()));
  return { principal: 350000, rate: 4.15, normal: 2000, extra: 1000, start, paymentDay: 1, method: 'daily', flexi: 0, offset: true, overdraft: false, lumps: [], variables: [], transactions: [], rates: [], budget: 3000, target, demo: true };
}
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { state: defaults(), restored: false };
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || typeof data.state !== 'object') throw new Error();
    const state = { ...defaults(), ...data.state };
    for (const key of ['lumps', 'variables', 'transactions', 'rates']) {
      if (!Array.isArray(state[key]) || state[key].some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Invalid saved entries');
    }
    return { state, restored: true };
  } catch { return { state: defaults(), restored: false, warning: 'Saved data could not be read. Demo values have been loaded.' }; }
}
export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, state })); return true; } catch { return false; }
}
