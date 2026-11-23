import assert from 'node:assert/strict';
import test from 'node:test';
import { instructionCommitment, projectPayout } from './project-payout.mjs';
import { destinationCommitment, parsePayment } from './records.mjs';
import { projectBundleFormat, verifyProjectBundle } from './project-audit.mjs';

const contract = '0x' + 'ab'.repeat(20);
const abi = (...values) => '0x' + values.map(value => BigInt(value).toString(16).padStart(64, '0')).join('');
const project = abi(42);
const salt = 'ab'.repeat(32);
const destinationSalt = 'cd'.repeat(32);
const csv = 'reference,beneficiary,bank,account,currency,amountKobo\nROAD-02,Kola Civil Works,001,0000009036,NGN,1200000000';
const request = (data = {}) => new Request('https://remittance.example/api/project-payout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, salt, destinationSalt, ...data }),
});
const commitment = await instructionCommitment({ project, contract, version: '2', csv, salt });
const destination = await destinationCommitment({ project, ...parsePayment(csv), salt: destinationSalt });

function rpc(state, instruction = commitment, receipt = 0) {
  return async (_url, options) => {
    const { method, params } = JSON.parse(options.body);
    if (method === 'eth_chainId') return Response.json({ result: '0x2648' });
    if (method === 'eth_blockNumber') return Response.json({ result: '0xff' });
    if (params[0].data.startsWith('0x08b9d17e')) {
      assert.equal(params[0].data, '0x08b9d17e' + abi(2).slice(2));
      assert.equal(params[1], '0xff');
      return Response.json({ result: destination });
    }
    const selectors = {
      '0xf60ca60d': project,
      '0x54fd4d50': abi(3),
      '0x2ee79ded': abi(9, 1, 1),
      '0x597e1fb5': abi(0),
      '0x9de9aaf4': abi(1200000000, 1900000000, state, 40, instruction, 2, 1900003600, receipt),
    };
    return Response.json({ result: selectors[params[0].data.slice(0, 10)] });
  };
}

function memoryStore() {
  const records = new Map();
  return {
    records,
    read: async key => records.has(key) ? { state: records.get(key) } : null,
    async insert(key, value) {
      if (records.has(key)) throw new Error('Duplicate');
      records.set(key, value);
    },
    async replace(key, before, value) {
      if (records.get(key) !== before) return false;
      records.set(key, value);
      return true;
    },
  };
}

test('the simulator refuses an open instruction and a different file after the contract claim', async () => {
  const store = memoryStore();
  for (const [input, state] of [
    [{ csv, salt }, 0],
    [{ csv: csv.replace('0000009036', '9999999036'), salt }, 1],
    [{ csv, salt: 'de'.repeat(32) }, 1],
    [{ csv, salt }, 2],
  ]) {
    assert.equal((await projectPayout(request(input), contract, store, rpc(state))).status, 409);
  }
  assert.equal([...store.records.keys()].filter(key => key.startsWith('project-payout:')).length, 0);
  assert.equal(JSON.parse([...store.records.values()][0]).length, 1);
});

test('a claimed file still fails if its bank or account does not open the approved destination commitment', async () => {
  const store = memoryStore();
  for (const altered of [csv.replace('0000009036', '1234569036'), csv.replace(',001,', ',002,')]) {
    const alteredCommitment = await instructionCommitment({ project, contract, version: '2', csv: altered, salt });
    const blocked = await projectPayout(request({ csv: altered }), contract, store, rpc(1, alteredCommitment));
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /bank or account/);
  }
  const invalidSalt = await projectPayout(request({ destinationSalt: 'ed'.repeat(32) }), contract, store, rpc(1));
  assert.equal(invalidSalt.status, 409);
  assert.equal([...store.records.keys()].filter(key => key.startsWith('project-payout:')).length, 0);
  assert.equal(JSON.parse([...store.records.values()][0]).length, 1);
});

test('concurrent simulator retries yield one receipt and never store account details', async () => {
  const store = memoryStore();
  // The claim predates a subsequent contract hold and destination version.
  const a = projectPayout(request(), contract, store, rpc(1));
  const b = projectPayout(request(), contract, store, rpc(1));
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const receipt = await first.json();
  assert.deepEqual(await second.json(), receipt);
  assert.equal(receipt.status, 'settled-by-simulator');
  assert.equal(receipt.instruction, commitment);
  assert.equal((await projectPayout(request(), contract, store, rpc(2))).status, 409);
  const settled = await projectPayout(request(), contract, store, rpc(2, commitment, receipt.receiptCommitment));
  assert.deepEqual(await settled.json(), { ...receipt, reconciledOnDiana: true });
  assert.equal(store.records.size, 1);
  assert.doesNotMatch([...store.records.values()][0], /0000009036|Kola Civil Works/);
});

test('the audit bundle verifies independently at the claim block and confirms a later reconciliation', async () => {
  const payout = await projectPayout(request(), contract, memoryStore(), rpc(1));
  const receipt = await payout.json();
  const bundle = { format: projectBundleFormat, csv, salt, destinationSalt, receipt };
  const historical = rpc(1);
  const reconciled = rpc(2, commitment, receipt.receiptCommitment);
  const fetchRpc = async (url, options) => {
    const { method, params } = JSON.parse(options.body);
    if (method === 'eth_blockNumber') return Response.json({ result: '0x100' });
    if (params[1] === '0xff') return historical(url, options);
    return reconciled(url, options);
  };
  const verified = await verifyProjectBundle(bundle, contract, fetchRpc);
  assert.equal(verified.status, 'simulated-receipt-reconciled-on-diana');
  assert.equal(verified.claimCheckedAtBlock, '255');
  assert.equal(verified.reconciliationCheckedAtBlock, '256');
  await assert.rejects(verifyProjectBundle({ ...bundle, csv: csv.replace('0000009036', '1234569036') }, contract, fetchRpc),
    /does not open/);
  await assert.rejects(verifyProjectBundle({ ...bundle, receipt: { ...receipt, providerReference: commitment } }, contract, fetchRpc),
    /receipt commitment/);
});
