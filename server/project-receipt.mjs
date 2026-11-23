import { dianaRpc } from './project-chain.mjs';

const hashPattern = /^0x[0-9a-f]{64}$/i;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const signedCall = /^0x(?:3b6fcfee|66ad2fe4|a8552f02)[0-9a-f]{9000,10000}$/i;

export async function checkProjectReceipt({ contract, data, hash }, fetchRpc) {
  if (!addressPattern.test(contract) || !signedCall.test(data) || !hashPattern.test(hash)) {
    throw new Error('Enter a valid Diana approval call and transaction hash.');
  }
  const rpc = dianaRpc(fetchRpc);
  const [network, transaction, receipt] = await Promise.all([
    rpc('eth_chainId'), rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash]),
  ]);
  if (BigInt(network) !== 9800n) throw new Error('Unexpected network.');
  if (!receipt || !transaction) return { status: 'pending-or-absent' };
  const target = contract.toLowerCase();
  const txHash = hash.toLowerCase();
  if (transaction.hash?.toLowerCase() !== txHash || receipt.transactionHash?.toLowerCase() !== txHash ||
      transaction.to?.toLowerCase() !== target || receipt.to?.toLowerCase() !== target ||
      transaction.input?.toLowerCase() !== data.toLowerCase() || BigInt(transaction.value ?? '-1') !== 0n ||
      !hashPattern.test(receipt.blockHash) || receipt.blockHash !== transaction.blockHash ||
      BigInt(receipt.blockNumber ?? '0') < 1n || BigInt(receipt.status ?? '0') !== 1n) {
    throw new Error('The committed Diana transaction does not match the signed approval call.');
  }
  return { status: 'verified-committed-call', network: 'qorechain-diana', contract: target,
    transaction: txHash, block: BigInt(receipt.blockNumber).toString() };
}
