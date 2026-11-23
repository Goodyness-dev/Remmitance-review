import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAlerts, recordMismatch } from './project-alerts.mjs';

test('the durable inbox keeps the first observation and preserves concurrent reports', async () => {
  let state = null;
  const store = {
    read: async () => state && { state },
    async insert(_key, value) {
      if (state !== null) throw new Error('already inserted');
      state = value;
    },
    async replace(_key, previous, value) {
      if (state !== previous) return false;
      state = value;
      return true;
    },
  };
  const contract = '0x' + 'ab'.repeat(20);
  const alert = { reference: 'ROAD-02', version: '2', kind: 'destination', amountKobo: '1200000000' };
  const first = new Date('2026-11-22T10:47:00Z');
  await Promise.all([
    recordMismatch(store, contract, alert, first),
    recordMismatch(store, contract, { ...alert, kind: 'amount' }, first),
  ]);
  await recordMismatch(store, contract, alert, new Date('2026-11-22T11:00:00Z'));
  const response = await projectAlerts(new Request('https://remittance.example/api/project-alerts'), contract, store,
    new Date('2026-11-23T10:47:00Z'));
  const result = await response.json();
  assert.equal(result.alerts.length, 2);
  assert.equal(result.alerts.find(item => item.kind === 'destination').firstObserved, first.toISOString());
  assert.equal(result.alerts.find(item => item.kind === 'amount').id, 'ROAD-02:2:amount');
  assert.equal(result.alerts[0].reviewBy, '2026-11-23T10:47:00.000Z');
  assert.equal(result.alerts[0].reviewOverdue, true);
  const dueAt = Date.parse('2026-11-22T11:00:00Z') / 1000;
  await recordMismatch(store, contract, { ...alert, kind: 'instruction', dueAt }, first);
  const beforeDue = await projectAlerts(new Request('https://remittance.example/api/project-alerts'), contract, store, first);
  const instruction = (await beforeDue.json()).alerts.find(item => item.kind === 'instruction');
  assert.equal(instruction.reviewBy, '2026-11-22T11:00:00.000Z');
  assert.equal(instruction.reviewOverdue, false);
});
