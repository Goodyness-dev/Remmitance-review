import React, { lazy, Suspense, useEffect, useState } from 'react';
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import './desk.css';

const Replay = lazy(() => import('./Replay.jsx').then(module => ({ default: module.Replay })));
const roles = { preparer: 'Bursary preparer', beneficiary: 'Receiving authority', approver: 'Approving officer', release: 'Release officer', auditor: 'Internal audit' };
const sample = 'reference,beneficiary,bank,account,currency,amountKobo\nTR-2026-118,State A Revenue Authority,001,0000009036,NGN,1240000000';
const labels = { account: 'Account number', bank: 'Bank code', beneficiary: 'Beneficiary', amountKobo: 'Amount', currency: 'Currency', reference: 'Payment reference' };
const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

function money(value) {
  const kobo = BigInt(value);
  const fraction = (kobo % 100n).toString().padStart(2, '0');
  return naira.formatToParts(kobo / 100n)
    .map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

function displayedValue(payment, field) {
  if (field === 'amountKobo') return money(payment[field]);
  if (field === 'account') return '••' + payment[field];
  return payment[field];
}

async function api(action, data) {
  const response = await fetch('/api/' + action, data && {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'The desk is unavailable.');
  return value;
}

export function App() {
  const [desk, setDesk] = useState();
  const [role, setRole] = useState('release');
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [csv, setCsv] = useState(sample);
  const [reason, setReason] = useState('');
  const [hash, setHash] = useState(() => sessionStorage.getItem('remittance-transaction') || '');
  const [showProof, setShowProof] = useState(false);
  useEffect(() => { api('desk').then(setDesk).catch(error => setError(error.message)); }, []);

  async function run(action, data = {}) {
    setBusy(true);
    setError('');
    try {
      let current = desk;
      if (action === 'wallet') {
        const wallet = window.qorex?.native;
        if (!wallet?.signAndBroadcast) throw new Error('Open this desk with QoreX installed and select Diana testnet.');
        const chainId = 'qorechain-diana';
        await wallet.enable(chainId);
        const { bech32Address } = await wallet.getKey(chainId);
        current = await api('prepare', { role, reviewId: desk.reviewId, signer: bech32Address });
        setDesk(current);
        const value = MsgSend.encode({ fromAddress: bech32Address, toAddress: bech32Address, amount: [{ denom: 'uqor', amount: '1' }] }).finish();
        const tx = await wallet.signAndBroadcast({
          chainId, memo: current.memo, messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value }],
        });
        setHash(tx.txHash || '');
        if (tx.txHash) sessionStorage.setItem('remittance-transaction', tx.txHash);
        if (!tx.txHash) throw new Error('QoreX did not return a transaction hash.');
        action = 'approve';
        data = { hash: tx.txHash };
      }
      const next = await api(action, { ...data, role, reviewId: current.reviewId });
      setDesk(next);
      if (action === 'approve') {
        setHash('');
        sessionStorage.removeItem('remittance-transaction');
      }
      if (action === 'export') {
        const { proof, canonicalRecord, approvals, release } = next;
        const url = URL.createObjectURL(new Blob([JSON.stringify({ proof, canonicalRecord, approvals, release }, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'restricted-training-evidence.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      setError(error.message);
      api('desk').then(setDesk).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  return <><header className="mast"><div><span className="mark">R</span> Remittance Review</div><span>Training scenario · Diana testnet</span></header>
    <main>
      <div className="context"><span>PUBLIC HOSPITAL · TREASURY DESK</span><label>Training role <select value={role} disabled={busy} onChange={event => setRole(event.target.value)}>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {desk ? <>
        <section className="hero">
          <div className="intro">
            <span className={desk.held ? 'status hold' : 'status'}>{desk.held ? '● Payment on hold' : desk.released ? '✓ Simulated release recorded' : '✓ Payment file matches'}</span>
            <h1>Review the remittance</h1>
            <div className="sum">{money(desk.outgoing.amountKobo)}</div>
            <p>{desk.outgoing.beneficiary} <span className="separator">·</span> {desk.outgoing.reference}</p>
            <p>{desk.differences.includes('account') ? 'The account in the payment file differs from the approved account.' : desk.differences.length ? 'The payment file contains differences from the approved instruction.' : desk.change ? 'A destination change is awaiting approval.' : 'The payment file matches the current approved instruction.'}</p>
            <button aria-controls="account-comparison" aria-expanded={step !== 0} onClick={() => setStep(step === 0 ? 1 : 0)}>{step === 0 ? 'Compare accounts' : 'Reset comparison'}</button>
            <button className="secondary" onClick={() => document.getElementById('history').focus()}>Trace this change</button>
          </div>
          <div className="comparison" id="account-comparison">
            <Suspense fallback={<div className="scene" />}><Replay step={step} approved={desk.approved} outgoing={desk.outgoing} approvedAmount={money(desk.approved.amountKobo)} outgoingAmount={money(desk.outgoing.amountKobo)} matches={!desk.differences.length} /></Suspense>
            <div className="comparison-values">
              <div><span>Approved account</span><strong>••{desk.approved.account}</strong><small>Bank {desk.approved.bank}</small></div>
              <div><span>Final payment file</span><strong>••{desk.outgoing.account}</strong><small>Bank {desk.outgoing.bank}</small></div>
            </div>
            {desk.differences.length > 0 && <p className="differences">Difference · {desk.differences.map(field => labels[field]).join(', ')}</p>}
            {step !== 0 && <div className="field-comparison">
              <table>
                <caption>Payment instruction comparison</caption>
                <thead><tr><th scope="col">Field</th><th scope="col">Approved</th><th scope="col">Final file</th></tr></thead>
                <tbody>{Object.entries(labels).map(([field, label]) => <tr key={field} className={desk.differences.includes(field) ? 'changed' : undefined}>
                  <th scope="row">{label}{desk.differences.includes(field) && <small>Different</small>}</th>
                  <td>{displayedValue(desk.approved, field)}</td>
                  <td>{displayedValue(desk.outgoing, field)}</td>
                </tr>)}</tbody>
              </table>
            </div>}
          </div>
        </section>
        <div className="lower">
          <section id="history" tabIndex={-1} aria-labelledby="history-title"><h2 id="history-title">Evidence history</h2><ol>{desk.events.map((event, index) => <li key={index}><time>{event.time.endsWith('Z') ? new Date(event.time).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) + ' WAT' : event.time}</time><strong>{event.title}</strong><p>{event.detail}</p></li>)}</ol></section>
          <section className="operation"><h2>{roles[role]}</h2>
            {role === 'preparer' && <><label>Payment CSV<textarea value={csv} onChange={event => setCsv(event.target.value)} rows={5} /></label>
              <label>Import a CSV file<input type="file" accept=".csv,text/csv" onChange={async event => {
                const file = event.target.files?.[0];
                if (file) setCsv(await file.text());
              }} /></label>
              <button disabled={busy} onClick={() => run('import', { csv })}>Compare final file</button>
              <label>Reason for changing the destination<input value={reason} onChange={event => setReason(event.target.value)} /></label>
              <button disabled={busy || !reason.trim()} onClick={() => run('request', { csv, reason })}>Request account change</button></>}
            {role === 'beneficiary' && <><p>{desk.change ? 'Review bank ' + desk.change.payment.bank + ', account ending ' + desk.change.payment.account + '. Stated reason: ' + desk.change.reason : 'No replacement account is awaiting confirmation.'}</p><button disabled={busy || !desk.change || desk.change.confirmed} onClick={() => run('confirm')}>Confirm exact destination</button></>}
            {role === 'approver' && <><p>{desk.change?.confirmed ? 'Confirm the replacement account and hybrid-sign the approval on Diana.' : 'The receiving authority must confirm the replacement first.'}</p>
              {desk.change && <p>Bank {desk.change.payment.bank} · Account ending {desk.change.payment.account} · {desk.change.reason}</p>}
              <button disabled={busy || !desk.change?.confirmed} onClick={() => run('wallet')}>Sign approval with QoreX</button>
              {hash && <button className="secondary" disabled={busy || !desk.change?.confirmed} onClick={() => run('approve', { hash })}>Check transaction again</button>}</>}
            {role === 'release' && <><p>{desk.held ? 'Resolve the differences before releasing this payment.' : desk.released ? 'This reference has already been released in the simulator.' : !desk.fileImported ? 'Import the final file through the bursary desk.' : 'Release the exact payment file checked in this review.'}</p><button disabled={busy || desk.held || desk.released || !desk.fileImported} onClick={() => run('release')}>Simulate release</button></>}
            {role === 'auditor' && <><p>Approval version {desk.version}. {desk.proof ? 'Signed evidence is available.' : 'The original training record is a fixture.'}</p><button disabled={busy || (!desk.proof && !desk.released)} onClick={() => run('export')}>Download restricted evidence</button></>}
            {desk.proof && <><button className="secondary" onClick={() => setShowProof(!showProof)}>{showProof ? 'Hide signed record' : 'Check signed record'}</button>{showProof && <p className="hash">Verified on Diana · Block {desk.proof.height}<br />{desk.proof.hash}</p>}</>}
            <p role="status">{busy ? 'Checking…' : error}</p>
          </section>
        </div>
      </> : <p role="status">{error || 'Opening the payment desk…'}</p>}
    </main></>;
}
