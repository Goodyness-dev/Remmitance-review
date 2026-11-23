import { dianaRpc, milestones } from './project-chain.mjs';
import { instructionCommitment } from './project-payout.mjs';
import { destinationCommitment, parsePayment } from './records.mjs';
import { recordMismatch } from './project-alerts.mjs';
import { checkProjectReceipt } from './project-receipt.mjs';

const digest = /^0x[0-9a-f]{64}$/i;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const signaturePattern = /^0x[0-9a-f]{9254}$/i;
const saltPattern = /^[0-9a-f]{64}$/i;
const word = number => BigInt(number).toString(16).padStart(64, '0');
const response = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function actionSpec(input, deadline) {
  const expires = word(deadline);
  switch (input.action) {
    case 'confirm':
      return { role: '0xfbfd2045', view: '0x00bd45bf', transaction: '0x3b6fcfee', args: expires };
    case 'decide':
      if (typeof input.approved !== 'boolean' || typeof input.evidence !== 'string' || !digest.test(input.evidence)) break;
      return {
        role: '0xa54044f8', view: '0x7927e13b', transaction: '0x66ad2fe4',
        args: word(Number(input.approved)) + input.evidence.slice(2) + expires,
      };
    case 'authorize':
      if (!Object.hasOwn(milestones, input.reference) || typeof input.instruction !== 'string' || !digest.test(input.instruction)) break;
      return {
        role: '0xa54044f8', view: '0x6ee6d613', transaction: '0xa8552f02',
        args: milestones[input.reference] + input.instruction.slice(2) + expires,
      };
  }
  return null;
}

async function boundedInput(request) {
  if (!request.body || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16000) {
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

function readPayout(body) {
  if (typeof body.csv !== 'string' || body.csv.length > 3000 ||
      typeof body.salt !== 'string' || !saltPattern.test(body.salt) ||
      typeof body.destinationSalt !== 'string' || !saltPattern.test(body.destinationSalt)) throw new Error();
  const payment = parsePayment(body.csv);
  if (!Object.hasOwn(milestones, payment.reference)) throw new Error();
  return payment;
}

export async function projectSigning(request, contract, fetchRpc, now = Math.floor(Date.now() / 1000), store) {
  if (request.method !== 'POST') return response({ error: 'Use POST.' }, 405);
  if (!addressPattern.test(contract)) return response({ error: 'The Diana project contract is unavailable.' }, 503);
  const body = await boundedInput(request);
  if (body?.stage === 'receipt') {
    try {
      const result = await checkProjectReceipt({ contract, data: body.data, hash: body.hash }, fetchRpc);
      return response(result);
    } catch (error) {
      return response({ error: error.message }, 409);
    }
  }
  if (!body || !['prepare', 'verify'].includes(body.stage)) return response({ error: 'Choose a signing action.' }, 400);
  const deadline = body.stage === 'prepare' ? now + 900 : body.deadline;
  if (!Number.isSafeInteger(deadline) || deadline <= now || deadline > now + 900) {
    return response({ error: 'The approval expired. Prepare a new approval.' }, 400);
  }
  let payout;
  if (body.action === 'authorize') {
    try {
      payout = readPayout(body);
    } catch {
      return response({ error: 'Provide a fictional milestone CSV, its instruction salt and the approved destination salt.' }, 400);
    }
  } else if (!actionSpec(body, deadline)) {
    return response({ error: 'Check the signing action and its commitments.' }, 400);
  }
  if (body.stage === 'verify' && (typeof body.signature !== 'string' || !signaturePattern.test(body.signature))) {
    return response({ error: 'A QoreX ML-DSA-87 signature is required.' }, 400);
  }

  const rpc = dianaRpc(fetchRpc);
  try {
    const [chain, block] = await Promise.all([rpc('eth_chainId'), rpc('eth_blockNumber')]);
    if (BigInt(chain) !== 9800n || !/^0x[0-9a-f]+$/i.test(block)) throw new Error();
    const call = data => rpc('eth_call', [{ to: contract, data, gas: '0x7a120' }, block]);
    let instructionReview;
    if (payout) {
      const [project, versionWord, milestone] = await Promise.all([
        call('0xf60ca60d'), call('0x54fd4d50'), call('0x9de9aaf4' + milestones[payout.reference]),
      ]);
      if (!digest.test(project) || !digest.test(versionWord) || !/^0x[0-9a-f]{512}$/i.test(milestone)) throw new Error();
      const version = BigInt(versionWord).toString();
      const recorded = await call('0x08b9d17e' + versionWord.slice(2));
      const destination = await destinationCommitment({ project, ...payout, salt: body.destinationSalt });
      if (!digest.test(recorded) || BigInt(recorded) === 0n) throw new Error();
      const amountKobo = BigInt(milestone.slice(0, 66)).toString();
      if (amountKobo === '0') return response({ error: 'The milestone is not scheduled on Diana.' }, 409);
      const mismatch = destination !== recorded.toLowerCase() ? 'destination' : amountKobo !== payout.amountKobo ? 'amount' : null;
      if (mismatch) {
        try {
          const dueAt = Number(BigInt('0x' + milestone.slice(66, 130)));
          await recordMismatch(store, contract, { reference: payout.reference, version, kind: mismatch, amountKobo, dueAt });
        } catch {
          return response({ error: 'The payout differs from the approved Diana records and remains blocked. The reviewer inbox is unavailable.' }, 503);
        }
        return response({ error: 'The outgoing bank, account or amount differs from the approved Diana records.' }, 409);
      }
      const instruction = await instructionCommitment({ project, contract, version, csv: body.csv, salt: body.salt });
      instructionReview = { instruction, reference: payout.reference, version, bank: payout.bank,
        suffix: payout.account.slice(-4), amountKobo: payout.amountKobo };
    }
    const spec = actionSpec(payout ? { action: body.action, ...instructionReview } : body, deadline);
    const [message, signerWord] = await Promise.all([call(spec.view + spec.args), call(spec.role)]);
    if (!digest.test(message) || !/^0x0{24}[0-9a-f]{40}$/i.test(signerWord)) throw new Error();
    if (body.stage === 'prepare') {
      return response({ contract, deadline, message, signer: '0x' + signerWord.slice(26), block, instructionReview });
    }
    const signature = body.signature.slice(2);
    const padding = '0'.repeat((64 - signature.length % 64) % 64);
    const data = spec.transaction + spec.args + word(spec.args.length / 2 + 32) + word(signature.length / 2) + signature + padding;
    if (await call(data) !== '0x') throw new Error();
    return response({ contract, data, deadline, message, signer: '0x' + signerWord.slice(26), checkedAtBlock: BigInt(block).toString() });
  } catch {
    return response({ error: body.stage === 'prepare'
      ? 'Diana could not prepare this action. Check the project state and connection.'
      : 'Diana could not verify this signature for the current action. Check the signer, project state and connection.' }, 409);
  }
}
