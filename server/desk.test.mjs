import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { altered, baseline, fields, sha256 } from './records.mjs';

test('release requires the exact current instruction and a revision requires verified evidence', async t => {
  process.env.REMITTANCE_DB = ':memory:';
  const { desk } = await import('./local.mjs');
  const server = createServer(desk);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const realFetch = globalThis.fetch;
  const origin = 'http://127.0.0.1:' + server.address().port;
  const csv = payment => fields.join(',') + '\n' + fields.map(field => payment[field]).join(',');
  let cookie, reviewId;
  async function call(action, role, data = {}, expected = 200) {
    const headers = { 'Content-Type': 'application/json', ...(cookie && { cookie }) };
    const response = await realFetch(origin + '/api/' + action, {
      headers, ...(role && { method: 'POST', body: JSON.stringify({ role, reviewId, ...data }) }),
    });
    cookie ??= response.headers.get('set-cookie').split(';')[0];
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    if (value.reviewId) reviewId = value.reviewId;
    return value;
  }
  assert.equal((await call('desk')).held, true);
  await call('release', 'release', {}, 400);
  await call('import', 'preparer', { csv: csv(altered) });
  await call('request', 'preparer', { csv: csv(altered), reason: 'Training bank migration' });
  const signer = 'qor1' + 'q'.repeat(38);
  await call('prepare', 'approver', { signer }, 400);
  await call('confirm', 'beneficiary');
  const { memo } = await call('prepare', 'approver', { signer });
  const hash = 'A'.repeat(64);
  const tx = {
    body: {
      memo: 'wrong memo',
      extension_options: [{ '@type': '/qorechain.pqc.v1.PQCHybridSignature', pqc_signature: Buffer.alloc(4627).toString('base64') }],
      messages: [{ '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: signer, to_address: signer, amount: [{ denom: 'uqor', amount: '1' }] }],
    },
  };
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/' + hash);
    return Response.json({ tx, tx_response: { txhash: hash, code: 0, height: '100', events: [{ type: 'pqc_hybrid_verify', attributes: [{ key: 'status', value: 'verified' }] }] } });
  });
  await call('approve', 'approver', { hash }, 400);
  tx.body.memo = memo;
  const approved = await call('approve', 'approver', { hash });
  assert.equal(approved.held, false);
  assert.equal(approved.version, 2);
  const evidence = await call('export', 'auditor');
  assert.equal(evidence.proof.memo, 'remittance-review:v1:' + await sha256(JSON.stringify(evidence.canonicalRecord)));
  const priorReview = reviewId;
  await call('import', 'preparer', { csv: csv(baseline) });
  await call('release', 'release', { reviewId: priorReview }, 400);
  await call('release', 'release', {}, 400);
  await call('import', 'preparer', { csv: csv(altered) });
  assert.equal((await call('release', 'release')).released, true);
  await call('import', 'preparer', { csv: csv(altered).replace('\n', '\r\n') });
  const releaseEvidence = await call('export', 'auditor');
  assert.equal(releaseEvidence.release.file, csv(altered));
  assert.equal(releaseEvidence.release.sha256, await sha256(csv(altered)));
  assert.equal(releaseEvidence.release.approvalVersion, 2);
  assert.equal(releaseEvidence.release.approvalTransaction, hash);
  await call('release', 'release', {}, 400);
});
