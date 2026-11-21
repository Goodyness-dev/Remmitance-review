import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalEvidence, baseline, compare, fields, parsePayment } from './records.mjs';

test('the full bank and account values determine the comparison', () => {
  assert.deepEqual(compare(baseline, { ...baseline, bank: '002', account: '9999994821' }), ['bank', 'account']);
});

test('CSV preserves account and bank leading zeroes and rejects extra rows', () => {
  const row = fields.map(field => baseline[field]).join(',');
  const content = fields.join(',') + '\r\n' + row;
  assert.deepEqual(parsePayment(content), baseline);
  assert.throws(() => parsePayment(content + '\r\n' + row));
});

test('the approval digest binds the reason and prior version', async () => {
  const approval = { instruction: baseline, version: 2, previous: 'abc', reason: 'Migration', requester: 'officer-a', confirmation: 'CONF-001', approver: 'officer-b' };
  const salt = '00'.repeat(32);
  const { memo } = await approvalEvidence(approval, salt);
  assert.equal(memo, (await approvalEvidence(approval, salt)).memo);
  assert.notEqual(memo, (await approvalEvidence({ ...approval, reason: 'Closure' }, salt)).memo);
  assert.notEqual(memo, (await approvalEvidence({ ...approval, previous: 'def' }, salt)).memo);
});
