import { destinationAtVersion, projectChain } from './project-chain.mjs';
import { destinationCommitment, parsePayment, sha256 } from './records.mjs';
import { recordMismatch } from './project-alerts.mjs';

const headers = { 'Cache-Control': 'no-store' };
const digestPattern = /^[0-9a-f]{64}$/i;
const respond = (value, status = 200) => Response.json(value, { status, headers });

export async function instructionCommitment({ project, contract, version, csv, salt }) {
  const fileDigest = await sha256(csv);
  const value = ['remittance-review/project-instruction/v1', 'qorechain-diana',
    contract.toLowerCase(), project.toLowerCase(), String(version), fileDigest, salt.toLowerCase()];
  return '0x' + await sha256(JSON.stringify(value));
}

export async function simulatorReceipt({ contract, reference, instruction, amountKobo }) {
  const key = 'project-payout:' + contract.toLowerCase() + ':' + reference;
  const providerReference = '0x' + await sha256(key);
  const receiptCommitment = '0x' + await sha256(JSON.stringify([
    'remittance-review/simulated-receipt/v1', providerReference, instruction, amountKobo,
  ]));
  return { key, providerReference, receiptCommitment };
}

async function readInput(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json' || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

// This endpoint records a fictional payout after a treasury operator claims it on Diana.
export async function projectPayout(request, address, store, fetchRpc) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });
  const input = await readInput(request);
  let outgoing;
  try {
    if (typeof input?.csv !== 'string' || typeof input.salt !== 'string' || !digestPattern.test(input.salt) ||
        typeof input.destinationSalt !== 'string' || !digestPattern.test(input.destinationSalt)) throw new Error();
    outgoing = parsePayment(input.csv);
  } catch {
    return respond({ error: 'Provide one training CSV, its instruction salt and the approved destination salt.' }, 400);
  }

  const snapshotRequest = new Request(new URL('/api/project-chain', request.url));
  const snapshot = await projectChain(snapshotRequest, address, fetchRpc);
  const chain = await snapshot.json();
  if (chain.status !== 'confirmed') return respond({ error: 'The Diana contract is unavailable.' }, 503);
  const payment = chain.payments.find(item => item.reference === outgoing.reference);
  if (!payment?.certified || !['Claimed', 'Settled'].includes(payment.state) ||
      BigInt(payment.instruction) === 0n) {
    return respond({ error: 'Diana has no matching claim for this instruction.' }, 409);
  }
  async function blocked(kind, error) {
    if (payment.state === 'Settled') return respond({ error }, 409);
    try {
      await recordMismatch(store, chain.contract, {
        reference: payment.reference, version: payment.approvedVersion, kind,
        amountKobo: payment.amountKobo, dueAt: payment.dueAt,
      });
      return respond({ error }, 409);
    } catch {
      return respond({ error: 'The instruction remains blocked. The reviewer inbox is unavailable.' }, 503);
    }
  }
  if (payment.amountKobo !== outgoing.amountKobo) return blocked('amount', 'The payment amount differs from the Diana claim.');
  const instruction = await instructionCommitment({
    project: chain.project, contract: chain.contract, version: payment.approvedVersion,
    csv: input.csv, salt: input.salt,
  });
  if (instruction.toLowerCase() !== payment.instruction.toLowerCase()) {
    return blocked('instruction', 'The outgoing file differs from the instruction claimed on Diana.');
  }

  // An authorized file can still carry the wrong account. Verify the beneficiary
  // against the destination that applied when the milestone was claimed.
  const expected = await destinationCommitment({
    project: chain.project, bank: outgoing.bank, account: outgoing.account, salt: input.destinationSalt,
  });
  let recordedDestination;
  try {
    recordedDestination = await destinationAtVersion(chain, payment.approvedVersion, fetchRpc);
  } catch {
    return respond({ error: 'Diana could not verify the destination for this claim.' }, 503);
  }
  if (recordedDestination !== expected) {
    return blocked('destination', 'The payment bank or account differs from the approved destination on Diana.');
  }

  const { key, providerReference, receiptCommitment } = await simulatorReceipt({
    contract: chain.contract, reference: payment.reference, instruction, amountKobo: payment.amountKobo,
  });
  const prior = await store.read(key);
  if (prior) {
    const receipt = JSON.parse(prior.state);
    if (receipt.instruction !== instruction) return respond({ error: 'A different instruction was already simulated.' }, 409);
    if (payment.state === 'Settled' && payment.receipt.toLowerCase() !== receipt.receiptCommitment) {
      return respond({ error: 'Diana records a different receipt. Review the settlement before proceeding.' }, 409);
    }
    return respond({ ...receipt, reconciledOnDiana: payment.state === 'Settled' });
  }
  if (payment.state === 'Settled') return respond({ error: 'The contract already records a settlement.' }, 409);

  const receipt = {
    status: 'settled-by-simulator', reference: payment.reference, providerReference, receiptCommitment,
    instruction, amountKobo: payment.amountKobo, contract: chain.contract, checkedAtBlock: chain.block,
  };
  try {
    await store.insert(key, JSON.stringify(receipt));
  } catch (error) {
    const stored = await store.read(key);
    if (!stored) throw error;
    const concurrent = JSON.parse(stored.state);
    if (concurrent.instruction !== instruction) {
      return respond({ error: 'A different instruction was already simulated.' }, 409);
    }
    return respond({ ...concurrent, reconciledOnDiana: false });
  }
  return respond({ ...receipt, reconciledOnDiana: false });
}
