import assert from 'node:assert/strict';
import test from 'node:test';
import { projectChain } from './project-chain.mjs';

const request = new Request('https://remittance.example/api/project-chain');
const address = '0x' + 'ab'.repeat(20);
const abi = (...values) => '0x' + values.map(value => BigInt(value).toString(16).padStart(64, '0')).join('');

test('the Diana snapshot reads the project and every milestone at one block', async () => {
  const selectors = {
    '0xf60ca60d': abi(42),
    '0x54fd4d50': abi(2),
    '0x2ee79ded': abi(9, 1, 1),
    '0x597e1fb5': abi(0),
    '0x9de9aaf4': abi(1200000000, 1900000000, 1, 40, 51, 2, 1900003600, 0),
  };
  let calls = 0;
  const response = await projectChain(request, address, async (_url, options) => {
    const { method, params } = JSON.parse(options.body);
    if (method === 'eth_chainId') return Response.json({ result: '0x2648' });
    if (method === 'eth_blockNumber') return Response.json({ result: '0xff' });
    assert.equal(method, 'eth_call');
    assert.equal(params[0].to, address);
    assert.equal(params[1], '0xff');
    calls++;
    return Response.json({ result: selectors[params[0].data.slice(0, 10)] });
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(calls, 7);
  assert.equal(result.block, '255');
  assert.equal(result.version, '2');
  assert.equal(result.hold, true);
  assert.equal(result.payments[1].state, 'Claimed');
  assert.equal(result.payments[1].amountKobo, '1200000000');
});

test('missing configuration and invalid RPC output have distinct outcomes', async () => {
  assert.deepEqual(await (await projectChain(request)).json(), { status: 'unconfigured' });
  const response = await projectChain(request, address, async (_url, options) => {
    const { method } = JSON.parse(options.body);
    return Response.json({ result: method === 'eth_chainId' ? '0x2648' : method === 'eth_blockNumber' ? '0xff' : '0x' });
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'unavailable' });
});
