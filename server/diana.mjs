const endpoints = 'https://api-testnet.qore.host';

export async function verifyTransaction(hash, pending, signer) {
  if (!/^[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Enter a valid Diana transaction hash.');
  const response = await fetch(endpoints + '/cosmos/tx/v1beta1/txs/' + hash, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'The transaction is pending or absent on Diana.' : 'Verification unavailable.');
  const { tx, tx_response: receipt } = await response.json();
  const extension = [...(tx?.body?.extension_options ?? []), ...(tx?.body?.non_critical_extension_options ?? [])]
    .find(option => option['@type'] === '/qorechain.pqc.v1.PQCHybridSignature');
  const verified = receipt?.events?.some(event => event.type === 'pqc_hybrid_verify' &&
    event.attributes?.some(attribute => attribute.key === 'status' && attribute.value === 'verified'));
  const messages = tx?.body?.messages;
  if (receipt?.code !== 0 || receipt.txhash?.toUpperCase() !== hash.toUpperCase() ||
      BigInt(receipt.height ?? 0) < 1n || !verified || atob(extension?.pqc_signature ?? '').length !== 4627 ||
      tx.body.memo !== pending.memo || messages?.length !== 1 ||
      messages[0]['@type'] !== '/cosmos.bank.v1beta1.MsgSend' ||
      messages[0].from_address !== signer || messages[0].to_address !== signer ||
      messages[0].amount?.length !== 1 || messages[0].amount[0].denom !== 'uqor' || messages[0].amount[0].amount !== '1') {
    throw new Error('The confirmed transaction does not match this approval.');
  }
  return { hash: hash.toUpperCase(), height: receipt.height, memo: pending.memo };
}

