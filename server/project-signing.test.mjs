import assert from 'node:assert/strict';
import test from 'node:test';
import { projectSigning } from './project-signing.mjs';
import { signProjectDigest } from '../src/qore-sign.mjs';
import { milestones } from './project-chain.mjs';
import { instructionCommitment } from './project-payout.mjs';
import { destinationCommitment, parsePayment } from './records.mjs';

const contract = '0x' + '34'.repeat(20);
const signer = '56'.repeat(20);
const message = '0x' + '78'.repeat(32);
const signature = '0x' + '89'.repeat(4627);
const now = 1900000000;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const project = '0x' + word(42);
const version = '2';
const csv = 'reference,beneficiary,bank,account,currency,amountKobo\nROAD-02,Kola Civil Works,001,0000009036,NGN,1200000000';
const authorize = { action: 'authorize', csv, salt: 'aa'.repeat(32), destinationSalt: 'bb'.repeat(32) };
const destination = await destinationCommitment({ project, ...parsePayment(csv), salt: authorize.destinationSalt });
const instruction = await instructionCommitment({ project, contract, version, csv, salt: authorize.salt });
const submit = input => new Request('https://remittance.example/api/project-signing', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});

test('the QoreX handoff signs raw digest bytes and accepts an ML-DSA-87 wallet response', async () => {
  const wallet = {
    capabilities: ['signArbitrary'],
    async enable(chain) { assert.equal(chain, 'qorechain-diana'); },
    async getKey() { return { bech32Address: 'qor1test' }; },
    async signArbitrary(chain, address, data) {
      assert.equal(chain, 'qorechain-diana');
      assert.equal(address, 'qor1test');
      assert.deepEqual(data, new Uint8Array(32).fill(0x78));
      return { signatureType: 'ml-dsa-87-hybrid', pq: { algorithmId: 1, signature: btoa('\x89'.repeat(4627)) } };
    },
  };
  assert.equal(await signProjectDigest(wallet, message), signature);
  await assert.rejects(signProjectDigest({}, message), /does not offer/);
});

test('the contract provides the approval digest and preflights the signed call at a pinned block', async () => {
  let signedChecks = 0;
  const args = milestones['ROAD-02'] + instruction.slice(2) + word(now + 900);
  const callData = '0xa8552f02' + args + word(128) + word(4627) + signature.slice(2) + '00'.repeat(13);
  const rpc = async (_url, options) => {
    const { method, params } = JSON.parse(options.body);
    if (method === 'eth_chainId') return Response.json({ result: '0x2648' });
    if (method === 'eth_blockNumber') return Response.json({ result: '0x42' });
    assert.equal(method, 'eth_call');
    assert.equal(params[0].to, contract);
    assert.equal(params[1], '0x42');
    if (params[0].data === '0xa54044f8') return Response.json({ result: '0x' + '0'.repeat(24) + signer });
    if (params[0].data === '0xf60ca60d') return Response.json({ result: project });
    if (params[0].data === '0x54fd4d50') return Response.json({ result: '0x' + word(version) });
    if (params[0].data === '0x08b9d17e' + word(version)) return Response.json({ result: destination });
    if (params[0].data === '0x9de9aaf4' + milestones['ROAD-02']) {
      return Response.json({ result: '0x' + word(1200000000) + word(0).repeat(7) });
    }
    if (params[0].data === '0x6ee6d613' + args) return Response.json({ result: message });
    assert.equal(params[0].data, callData);
    signedChecks++;
    return Response.json({ result: '0x' });
  };
  const prepared = await projectSigning(submit({ ...authorize, stage: 'prepare' }), contract, rpc, now);
  assert.equal(prepared.status, 200);
  assert.deepEqual(await prepared.json(), {
    contract, deadline: now + 900, message, signer: '0x' + signer, block: '0x42',
    instructionReview: { instruction, reference: 'ROAD-02', version, bank: '001', suffix: '9036', amountKobo: '1200000000' },
  });
  let recorded;
  const store = { read: async () => null, insert: async (_key, state) => { recorded = JSON.parse(state); } };
  const altered = await projectSigning(submit({ ...authorize, csv: csv.replace('0000009036', '1234569036'), stage: 'prepare' }), contract, rpc, now, store);
  assert.equal(altered.status, 409);
  assert.match((await altered.json()).error, /differs from the approved/);
  assert.equal(recorded[0].kind, 'destination');
  assert.doesNotMatch(JSON.stringify(recorded), /1234569036|Kola Civil Works/);
  const verified = await projectSigning(submit({ ...authorize, stage: 'verify', deadline: now + 900, signature }), contract, rpc, now);
  assert.equal(verified.status, 200);
  assert.equal(signedChecks, 1);
  assert.equal((await verified.json()).data, callData);
});

test('an empty contract response cannot be mistaken for a signature verification', async () => {
  const result = await projectSigning(submit({ ...authorize, stage: 'verify', deadline: now + 900, signature }),
    contract, async (_url, options) => {
      const { method } = JSON.parse(options.body);
      return Response.json({ result: method === 'eth_chainId' ? '0x2648' : method === 'eth_blockNumber' ? '0x42' : '0x' });
    }, now);
  assert.equal(result.status, 409);
});

test('the receipt stage only verifies the exact committed Diana call', async () => {
  const hash = '0x' + '19'.repeat(32);
  const blockHash = '0x' + '20'.repeat(32);
  const data = '0xa8552f02' + '12'.repeat(4700);
  const transaction = { hash, to: contract, input: data, value: '0x0', blockHash };
  const receipt = { transactionHash: hash, to: contract, blockHash, blockNumber: '0x42', status: '0x1' };
  const rpc = (tx, mined) => async (_url, options) => {
    const { method } = JSON.parse(options.body);
    const result = method === 'eth_chainId' ? '0x2648' : method === 'eth_getTransactionByHash' ? tx : mined;
    return Response.json({ result });
  };
  const check = fetchRpc => projectSigning(submit({ stage: 'receipt', data, hash }), contract, fetchRpc, now);
  const verified = await check(rpc(transaction, receipt));
  assert.equal((await verified.json()).status, 'verified-committed-call');
  assert.equal((await check(rpc({ ...transaction, input: '0x' }, receipt))).status, 409);
  assert.equal((await check(rpc(transaction, { ...receipt, status: '0x0' }))).status, 409);
  assert.equal((await (await check(rpc(transaction, null))).json()).status, 'pending-or-absent');
});
