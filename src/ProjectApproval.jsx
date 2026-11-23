import React, { useState } from 'react';
import { signProjectDigest } from './qore-sign.mjs';

async function projectSigning(data) {
  const response = await fetch('/api/project-signing', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Diana verification is unavailable.');
  return result;
}

function downloadCall(call, filename = 'diana-project-call.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(call, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProjectApproval() {
  const [action, setAction] = useState('confirm');
  const [prepared, setPrepared] = useState(null);
  const [verified, setVerified] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function prepare(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const input = { action };
    if (action === 'decide') Object.assign(input, { approved: fields.get('decision') === 'approve', evidence: fields.get('evidence').trim() });
    setBusy(true);
    setPrepared(null);
    setVerified(null);
    setReceipt(null);
    setError('');
    try {
      if (action === 'authorize') {
        const file = fields.get('csv');
        if (!file?.size || file.size > 3000) throw new Error('Choose a fictional CSV under 3 KB.');
        const csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
        Object.assign(input, { csv, salt: fields.get('salt').trim(), destinationSalt: fields.get('destinationSalt').trim() });
      }
      setPrepared({ input, ...await projectSigning({ ...input, stage: 'prepare' }) });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    setBusy(true);
    setError('');
    try {
      const signature = await signProjectDigest(window.qorex?.native, prepared.message);
      const result = await projectSigning({ ...prepared.input, stage: 'verify', deadline: prepared.deadline, signature });
      if (result.message !== prepared.message || result.contract !== prepared.contract || result.signer !== prepared.signer) {
        throw new Error('The contract or approval changed. Prepare a new signing request.');
      }
      setVerified(result);
      setPrepared(null);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkReceipt(event) {
    event.preventDefault();
    const hash = new FormData(event.currentTarget).get('hash').trim();
    setBusy(true);
    setError('');
    setReceipt(null);
    try {
      setReceipt(await projectSigning({ stage: 'receipt', data: verified.data, hash }));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <details className="project-approval">
    <summary>Prepare a live QoreX approval</summary>
    <p>Use enrolled Diana test accounts and fictional commitments. A role holder signs the action and a transaction sender commits it to Diana.</p>
    <form className="project-payout" onSubmit={prepare}>
      <label>Action <select value={action} disabled={busy} onChange={event => {
        setAction(event.target.value);
        setPrepared(null);
        setVerified(null);
        setReceipt(null);
        setError('');
      }}>
        <option value="confirm">Confirm destination as contractor</option>
        <option value="decide">Review destination as funder</option>
        <option value="authorize">Authorize exact milestone instruction</option>
      </select></label>
      {action === 'decide' && <>
        <label>Decision <select name="decision"><option value="approve">Approve</option><option value="reject">Reject</option></select></label>
        <label>Review evidence commitment <input name="evidence" pattern="0x[A-Fa-f0-9]{64}" spellCheck={false} required /></label>
      </>}
      {action === 'authorize' && <>
        <label>Outgoing payment CSV <input name="csv" type="file" accept=".csv,text/csv" required /></label>
        <label>Instruction salt <input name="salt" pattern="[A-Fa-f0-9]{64}" maxLength="64" spellCheck={false} required /></label>
        <label>Approved destination salt <input name="destinationSalt" pattern="[A-Fa-f0-9]{64}" maxLength="64" spellCheck={false} required /></label>
      </>}
      <button type="submit" disabled={busy}>Prepare signing request</button>
    </form>
    <div className="project-contract" role="status">
      {error && <p>{error}</p>}
      {prepared && <>
        <p>Required signer {prepared.signer}</p>
        {prepared.input.evidence && <p>Review evidence {prepared.input.evidence} · {prepared.input.approved ? 'Approve' : 'Reject'}</p>}
        {prepared.instructionReview && <p>{prepared.instructionReview.reference} · Destination version {prepared.instructionReview.version}
          {' · '}Bank {prepared.instructionReview.bank} · Account ending {prepared.instructionReview.suffix}
          {' · '}{prepared.instructionReview.amountKobo} kobo · Instruction {prepared.instructionReview.instruction}</p>}
        <p>Signing digest {prepared.message}</p>
        <button type="button" disabled={busy} onClick={sign}>{busy ? 'Checking QoreX and Diana…' : 'Sign in QoreX and check with Diana'}</button>
      </>}
      {verified && <p>Signature checked at Diana block {verified.checkedAtBlock}. Submit the signed call before expiry to record the decision.</p>}
    </div>
    {verified && <button type="button" onClick={() => downloadCall(verified)}>Download signed Diana call</button>}
    {verified && <form className="project-payout" onSubmit={checkReceipt}>
      <label>Mined Diana transaction hash <input name="hash" pattern="0x[A-Fa-f0-9]{64}" spellCheck={false} required /></label>
      <button type="submit" disabled={busy}>Check committed transaction</button>
      <div role="status">
        {receipt?.status === 'pending-or-absent' && <p>The transaction is pending or absent on Diana.</p>}
        {receipt?.status === 'verified-committed-call' && <p>Verified on Diana at block {receipt.block}.</p>}
      </div>
      {receipt?.status === 'verified-committed-call' && <button type="button"
        onClick={() => downloadCall({ ...verified, receipt }, 'diana-project-approval-evidence.json')}>Download verified approval evidence</button>}
    </form>}
  </details>;
}
