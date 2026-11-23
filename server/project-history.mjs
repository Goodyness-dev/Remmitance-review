import { dianaRpc, milestones } from './project-chain.mjs';

const topics = {
  '0xfd3950f1636eeb765f9f909444dbb88d77e6389707af2b42b526e077e274518d': ['Milestone scheduled', true],
  '0x1e8ebf007ed81dae2df386e019e59162e068761cb847365a10db125ec060d8aa': ['Work certified', true],
  '0xeeccdcc1c26c7d88c4b03f8a6ad4475852164dc8b6673dfaba2d429223c152b2': ['Destination change requested', false],
  '0xc8881c8ed696fff5666d750614a6e48db2f4a63397817567d49274288c8344d8': ['Destination confirmed by contractor', false],
  '0x901f7768bad31dbf87f9a239b88ebc660c5231a5a4ed817b744a431aa5613ccc': ['Destination change decided', false],
  '0x1fdadc732495d623711b8029a2ac7218747b5eb8f66b9ad848883eed74663f3e': ['Payment authorized', true],
  '0x38d6042dbdae8e73a7f6afbabd3fbe0873f9f5ed3cd71294591c3908c2e65fee': ['Payment claimed', true],
  '0x170651f316bde520e85f746dca889e6e682e61f5fb18b86705e17a10b127ad07': ['Receipt reconciled', true],
  '0xdc27861385a2db534480df8036d8ce2348d069242d9554c39e75a7e37982de57': ['Payment cancelled', true],
  '0x1cdde67b72a90f19919ac732a437ac2f7a10fc128d28c2a6e525d89ce5cd9d3a': ['Project closed', false],
};
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
const heightPattern = /^0x[0-9a-f]{1,16}$/i;
const blockNumber = /^[1-9][0-9]{0,18}$/;
const headers = { 'Cache-Control': 'no-store' };
const respond = (data, status = 200) => Response.json(data, { status, headers });
const refs = new Map(Object.entries(milestones).map(([reference, id]) => ['0x' + id, reference]));

export async function projectHistory(request, contract, deployment, fetchRpc) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers });
  if (!addressPattern.test(contract) || !blockNumber.test(deployment)) return respond({ status: 'unconfigured' });
  const before = new URL(request.url).searchParams.get('before');
  if (before !== null && !blockNumber.test(before)) return respond({ status: 'invalid-cursor' }, 400);

  const rpc = dianaRpc(fetchRpc);
  try {
    const [network, tip] = await Promise.all([rpc('eth_chainId'), rpc('eth_blockNumber')]);
    if (BigInt(network) !== 9800n || !heightPattern.test(tip)) throw new Error();
    const head = BigInt(tip);
    const start = BigInt(deployment);
    const end = before === null ? head : BigInt(before) - 1n;
    if (start > head || end > head || end < start) return respond({ status: 'invalid-range' }, 400);
    const from = end - 999n > start ? end - 999n : start;
    const logs = await rpc('eth_getLogs', [{
      address: contract, fromBlock: '0x' + from.toString(16), toBlock: '0x' + end.toString(16),
      topics: [Object.keys(topics)],
    }]);

    const result = new Map();
    for (const log of logs) {
      const event = topics[log.topics?.[0]?.toLowerCase()];
      if (!event || log.removed || log.address?.toLowerCase() !== contract.toLowerCase() ||
          !hashPattern.test(log.transactionHash) || !heightPattern.test(log.blockNumber) || !heightPattern.test(log.logIndex)) continue;
      const block = BigInt(log.blockNumber);
      if (block < from || block > end) continue;
      const index = BigInt(log.logIndex);
      const id = log.transactionHash.toLowerCase() + ':' + index.toString();
      const ref = event[1] ? refs.get(log.topics[1]?.toLowerCase()) ?? null : null;
      result.set(id, { id, label: event[0], ref, block, index, hash: log.transactionHash });
    }
    const events = [...result.values()].sort((a, b) => Number(b.block - a.block || b.index - a.index))
      .map(({ id, label, ref, block, hash }) => ({ id, label, ref, block: block.toString(), hash }));
    return respond({
      status: 'confirmed', events, from: from.toString(), through: end.toString(),
      before: from > start ? from.toString() : null,
    });
  } catch {
    return respond({ status: 'unavailable' }, 503);
  }
}
