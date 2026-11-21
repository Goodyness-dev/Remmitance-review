import { verifyTransaction } from './diana.mjs';
import { approvalEvidence, altered, baseline, compare, parsePayment, sha256 } from './records.mjs';

const randomUUID = () => crypto.randomUUID();

function verdict(state) {
  const differences = compare(state.approved, state.outgoing);
  const held = Boolean(differences.length || state.change);
  return { differences, held, released: state.released === state.outgoing.reference, fileImported: Boolean(state.fileDigest) };
}

function mask(payment) {
  return { ...payment, account: payment.account.slice(-4) };
}

function view(state) {
  return {
    ...verdict(state), approved: mask(state.approved), outgoing: mask(state.outgoing),
    version: state.version, reviewId: state.reviewId, events: state.events,
    change: state.change && { reason: state.change.reason, confirmed: Boolean(state.change.confirmation), payment: mask(state.change.payment) },
    proof: state.proof, signer: state.signer,
  };
}

function initial() {
  return {
    approved: baseline, outgoing: altered, version: 1, reviewId: randomUUID(),
    change: null, pending: null, proof: null, evidence: null, approvals: [], released: null, signer: null, fileDigest: null,
    events: [
      { time: '09:00 WAT', title: 'Bursary approved account •4821', detail: 'Original beneficiary instruction · Training record' },
      { time: '11:47 WAT', title: 'Final file contains account •9036', detail: 'Editor unknown · No reason on record' },
    ],
  };
}

export async function reviewDesk(req, store) {
  const url = new URL(req.url);
  const action = url.pathname.slice('/api/'.length);
  const cookie = req.headers.get('cookie')?.match(/(?:^|; ?)remittance=([a-f0-9-]{36})(?:;|$)/)?.[1];
  const stored = cookie && await store.read(cookie);
  const id = stored ? cookie : randomUUID();
  const state = stored ? JSON.parse(stored.state) : initial();
  const headers = {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Set-Cookie': 'remittance=' + id + '; HttpOnly; SameSite=Strict; Path=/' + (url.protocol === 'https:' ? '; Secure' : ''),
  };
  try {
    let result;
    if (req.method === 'GET' && action === 'desk') {
      if (!stored) await store.insert(id, JSON.stringify(state));
      result = view(state);
    } else if (req.method === 'POST') {
      if (req.headers.get('content-type') !== 'application/json' || !req.body) throw new Error('Use a JSON request.');
      const decoder = new TextDecoder();
      const reader = req.body.getReader();
      let raw = '', size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 20000) throw new Error('The request is too large.');
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      const data = JSON.parse(raw);
      const actor = ({ import: 'preparer', request: 'preparer', confirm: 'beneficiary', prepare: 'approver', approve: 'approver', release: 'release', export: 'auditor' })[action];
      if (!actor || data.role !== actor) throw new Error('Switch to the corresponding training role.');
      const event = (title, detail) => state.events.push({ time: new Date().toISOString(), title, detail });
      if (!stored || data.reviewId !== state.reviewId) throw new Error('The review changed. Refresh the desk and check the latest record.');
      switch (action) {
        case 'import': {
          state.outgoing = parsePayment(data.csv);
          state.file = data.csv;
          state.fileDigest = await sha256(data.csv);
          const fields = compare(state.approved, state.outgoing);
          event('Final payment file received', fields.length ? 'Difference observed · File editor unknown' : 'Matches approved instruction');
          break;
        }
        case 'request': {
          const reason = String(data.reason ?? '').trim();
          const payment = parsePayment(data.csv);
          if (state.change) throw new Error('The current request is awaiting a decision.');
          if (!reason || reason.length > 300 || !compare(state.approved, payment).length ||
              compare(state.approved, payment).some(field => !['bank', 'account'].includes(field))) {
            throw new Error('Provide a reason and change only the destination bank or account.');
          }
          state.change = { payment, reason, requester: 'Training preparer A', id: randomUUID() };
          event('Training preparer A requested a change', 'Stated reason · ' + reason);
          break;
        }
        case 'confirm':
          if (!state.change || state.change.confirmation) throw new Error('There is no unconfirmed request.');
          state.change.confirmation = 'Training beneficiary confirmation for ' + state.change.id;
          event('Receiving authority confirmed the proposed account', 'Training beneficiary contact');
          break;
        case 'prepare': {
          if (!state.change?.confirmation || !/^qor1[a-z0-9]{38}$/.test(data.signer)) throw new Error('Confirm the beneficiary first and connect a valid QoreX account.');
          if (state.signer && state.signer !== data.signer) throw new Error('Use the wallet enrolled as training approver.');
          state.signer = data.signer;
          state.pending ??= await approvalEvidence({
            ...state.change, instruction: state.change.payment, version: state.version + 1,
            previous: state.proof?.memo ?? await sha256(JSON.stringify(baseline)), approver: state.signer,
          });
          result = { memo: state.pending.memo };
          break;
        }
        case 'approve': {
          if (!state.pending) throw new Error('Prepare the approval first.');
          const proof = await verifyTransaction(data.hash, state.pending, state.signer);
          state.proof = proof;
          state.evidence = state.pending.record;
          (state.approvals ??= []).push({ proof, canonicalRecord: state.evidence });
          state.approved = state.change.payment;
          state.version++;
          state.pending = state.change = null;
          event('Training approver B signed the replacement', 'Hybrid signature verified on Diana');
          break;
        }
        case 'release':
          if (verdict(state).held || verdict(state).released || !state.file || await sha256(state.file) !== state.fileDigest) {
            throw new Error('Import a matching, unreleased payment file before release.');
          }
          state.releaseRecord = {
            reference: state.outgoing.reference,
            recordedAt: new Date().toISOString(),
            file: state.file,
            sha256: state.fileDigest,
            approvalVersion: state.version,
            approvalTransaction: state.proof?.hash ?? null,
          };
          event('Simulated release recorded', 'File SHA-256 · ' + state.fileDigest);
          break;
        case 'export':
          if (!state.proof && !state.releaseRecord) throw new Error('The case has no approval or release evidence to export.');
          result = { proof: state.proof, canonicalRecord: state.evidence, approvals: state.approvals, release: state.releaseRecord ?? null };
          break;
      }
      if (action !== 'export') {
        state.reviewId = randomUUID();
        if (action === 'release') state.released = state.outgoing.reference;
        if (!await store.replace(id, stored.state, JSON.stringify(state))) {
          throw new Error('The review changed. Refresh the desk and check the latest record.');
        }
      }
      result = { ...view(state), ...result };
    } else throw new Error('Unknown request.');
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400, headers });
  }
}
