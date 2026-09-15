import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, load, save } from '../src/persistence.js';

test('demo target remains a valid date when starting on leap day', () => {
  const state = defaults('2028-02-29'); assert.equal(state.start, '2028-02-29'); assert.equal(state.target, '2038-02-28');
});

test('local storage round-trip preserves all strategy data', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = { ...defaults(), demo: false, principal: 123456, variables: [{ month: '2027-01', normal: 2000, extra: 750 }], lumps: [{ date: '2027-02-01', amount: 5000, park: true }], rates: [{ date: '2028-01-01', rate: 4.35 }], transactions: [{ date: '2028-02-01', amount: 2000, type: 'withdrawal' }] };
  assert.equal(save(state), true); assert.deepEqual(load().state, state); assert.equal(load().restored, true);
  delete globalThis.localStorage;
});
test('unavailable browser storage is handled without throwing', () => {
  globalThis.localStorage = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  assert.equal(save(defaults()), false); const result = load(); assert.equal(result.state.demo, true); assert.ok(result.warning);
  delete globalThis.localStorage;
});
test('corrupt saved JSON and malformed transaction entries fall back safely', () => {
  for (const raw of ['broken JSON', JSON.stringify({ version: 1, state: { lumps: [null] } })]) {
    globalThis.localStorage = { getItem: () => raw }; const result = load(); assert.equal(result.restored, false); assert.ok(result.warning);
  }
  delete globalThis.localStorage;
});
