const RPC = 'https://evm-testnet.qore.host';
export const milestones = {
  'ROAD-01': 'ee9dda74fea6cf22c1cc0c2e9ba9ef6d365a1bca51bff02a1fee8d3985ae961f',
  'ROAD-02': '6d461b3c78bb2d23e2dea43b6274fc58727678a7062cb8323557ccdecd825c9e',
  'ROAD-03': 'df3055dc17960ebd3c98dc8b327e755c02a394c6671884addab122f18133d638',
};
const paymentStates = ['Open', 'Claimed', 'Settled', 'Cancelled'];
const headers = { 'Cache-Control': 'no-store' };

export function dianaRpc(fetchRpc = fetch) {
  const signal = AbortSignal.timeout(7000);
  return async (method, params = []) => {
    const response = await fetchRpc(RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal,
    });
    if (!response.ok) throw new Error('Diana is unavailable');
    const body = await response.json();
    const isTransaction = method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt';
    const valid = method === 'eth_getLogs' ? Array.isArray(body.result)
      : isTransaction ? body.result === null || (typeof body.result === 'object' && !Array.isArray(body.result))
      : typeof body.result === 'string';
    if (body.error || !valid) {
      throw new Error('Invalid Diana response');
    }
    return body.result;
  };
}

function words(value, length) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value) || value.length !== 2 + 64 * length) {
    throw new Error('Invalid Diana response');
  }
  return value.slice(2).match(/.{64}/g).map(word => '0x' + word);
}

export async function projectChain(request, address, fetchRpc = fetch, pinnedBlock) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers });
  if (!address) return Response.json({ status: 'unconfigured' }, { headers });
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }

  const rpc = dianaRpc(fetchRpc);

  try {
    const [chain, head] = await Promise.all([rpc('eth_chainId'), rpc('eth_blockNumber')]);
    if (BigInt(chain) !== 9800n || !/^0x[0-9a-f]+$/i.test(head)) throw new Error('Wrong network');
    if (pinnedBlock !== undefined && (!/^[1-9][0-9]{0,19}$/.test(pinnedBlock) || BigInt(pinnedBlock) > BigInt(head))) {
      throw new Error('Invalid block');
    }
    const block = pinnedBlock === undefined ? head : '0x' + BigInt(pinnedBlock).toString(16);
    const call = async (data, length) => words(await rpc('eth_call', [{ to: address, data }, block]), length);
    const [[project], [version], [candidate, , confirmation], [closed], ...records] = await Promise.all([
      call('0xf60ca60d', 1), // project()
      call('0x54fd4d50', 1), // version()
      call('0x2ee79ded', 3), // change()
      call('0x597e1fb5', 1), // closed()
      ...Object.values(milestones).map(id => call('0x9de9aaf4' + id, 8)), // milestones(bytes32)
    ]);
    const payments = records.map(([amount, due, state, certificate, instruction, approvedVersion, expiry, receipt], index) => {
      if (!paymentStates[Number(state)]) throw new Error('Invalid payment state');
      return {
        reference: Object.keys(milestones)[index],
        amountKobo: BigInt(amount).toString(),
        dueAt: Number(due),
        state: BigInt(amount) === 0n ? 'Unscheduled' : paymentStates[Number(state)],
        certified: BigInt(certificate) !== 0n,
        instruction,
        approvedVersion: BigInt(approvedVersion).toString(),
        expiry: Number(expiry),
        receipt,
      };
    });
    return Response.json({
      status: 'confirmed', network: 'qorechain-diana', block: BigInt(block).toString(), contract: address, project,
      version: BigInt(version).toString(), hold: BigInt(candidate) !== 0n,
      changeConfirmed: BigInt(confirmation) === 1n, closed: BigInt(closed) === 1n, payments,
    }, { headers });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
}

export async function destinationAtVersion({ contract, block }, version, fetchRpc) {
  const versionWord = BigInt(version).toString(16).padStart(64, '0');
  const destination = await dianaRpc(fetchRpc)('eth_call', [{
    to: contract, data: '0x08b9d17e' + versionWord, // destinationAtVersion(uint64)
  }, '0x' + BigInt(block).toString(16)]);
  if (!/^0x[0-9a-f]{64}$/i.test(destination) || BigInt(destination) === 0n) throw new Error('Destination unavailable');
  return destination.toLowerCase();
}
