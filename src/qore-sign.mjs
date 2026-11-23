const chainId = 'qorechain-diana';
const bytes = hex => Uint8Array.from(hex.slice(2).match(/.{2}/g), pair => Number.parseInt(pair, 16));

export async function signProjectDigest(wallet, message) {
  if (!wallet?.capabilities?.includes('signArbitrary') || typeof wallet.signArbitrary !== 'function') {
    throw new Error('This QoreX version does not offer project message signing. The native proof desk is available separately.');
  }
  if (!/^0x[0-9a-f]{64}$/i.test(message)) throw new Error('Diana returned an invalid signing digest.');
  await wallet.enable(chainId);
  const { bech32Address } = await wallet.getKey(chainId);
  const result = await wallet.signArbitrary(chainId, bech32Address, bytes(message));
  if (result?.signatureType !== 'ml-dsa-87-hybrid' || result.pq?.algorithmId !== 1 || typeof result.pq.signature !== 'string') {
    throw new Error('QoreX did not return a hybrid message signature.');
  }
  const signature = atob(result.pq.signature);
  if (signature.length !== 4627) throw new Error('QoreX returned an invalid ML-DSA-87 signature.');
  return '0x' + Array.from(signature, character => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}
