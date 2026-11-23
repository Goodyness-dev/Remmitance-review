import assert from 'node:assert/strict';
import test from 'node:test';
import { projectHistory } from './project-history.mjs';
import { milestones } from './project-chain.mjs';

const address = '0x' + 'ab'.repeat(20);
const transactionHash = '0x' + '12'.repeat(32);
const authorization = '0x1fdadc732495d623711b8029a2ac7218747b5eb8f66b9ad848883eed74663f3e';
const change = '0xeeccdcc1c26c7d88c4b03f8a6ad4475852164dc8b6673dfaba2d429223c152b2';
const url = 'https://remittance.example/api/project-history';

test('history reads a bounded range and orders deduplicated project events', async () => {
  const changeEvent = { address, transactionHash, blockNumber: '0x8fd', logIndex: '0x1', topics: [change] };
  const authorizeEvent = { address, transactionHash, blockNumber: '0x8fe', logIndex: '0x0', topics: [authorization, '0x' + milestones['ROAD-02']] };
  const rpc = async (_url, options) => {
    const { method, params } = JSON.parse(options.body);
    if (method === 'eth_chainId') return Response.json({ result: '0x2648' });
    if (method === 'eth_blockNumber') return Response.json({ result: '0x900' });
    assert.equal(method, 'eth_getLogs');
    assert.equal(params[0].address, address);
    assert.equal(params[0].fromBlock, '0x519');
    assert.equal(params[0].toBlock, '0x900');
    assert.ok(params[0].topics[0].includes(authorization));
    return Response.json({ result: [changeEvent, authorizeEvent, changeEvent, { ...changeEvent, logIndex: '0x2', removed: true }] });
  };
  const response = await projectHistory(new Request(url), address, '1000', rpc);
  assert.equal(response.status, 200);
  const history = await response.json();
  assert.equal(history.before, '1305');
  assert.equal(history.events.length, 2);
  assert.equal(history.events[0].ref, 'ROAD-02');
  assert.equal(history.events[0].label, 'Payment authorized');
  assert.equal(history.events[1].label, 'Destination change requested');
});

test('an older page ends before its cursor and stops at deployment', async () => {
  const response = await projectHistory(new Request(url + '?before=1305'), address, '1000', async (_url, options) => {
    const { method, params } = JSON.parse(options.body);
    if (method === 'eth_chainId') return Response.json({ result: '0x2648' });
    if (method === 'eth_blockNumber') return Response.json({ result: '0x900' });
    assert.equal(params[0].fromBlock, '0x3e8');
    assert.equal(params[0].toBlock, '0x518');
    return Response.json({ result: [] });
  });
  assert.deepEqual(await response.json(), { status: 'confirmed', events: [], from: '1000', through: '1304', before: null });
});
