import React, { lazy, Suspense, useEffect, useReducer, useState } from 'react';
import { initialScenario, transition } from './scenario.mjs';
import { ProjectApproval } from './ProjectApproval.jsx';
import { ProjectHistory } from './ProjectHistory.jsx';
import './project.css';

const Replay = lazy(() => import('./Replay.jsx').then(module => ({ default: module.Replay })));
const amount = '₦12,000,000';
const watTime = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
const grouping = new Intl.NumberFormat('en-NG');
function naira(amountKobo) {
  const kobo = BigInt(amountKobo);
  return '₦' + grouping.format(kobo / 100n) + '.' + (kobo % 100n).toString().padStart(2, '0');
}
const payment = { beneficiary: 'Kola Civil Works', reference: 'ROAD-02' };
const actions = {
  ready: ['swap', 'Try the account swap'],
  held: ['request', 'Open a documented change request'],
  requested: ['confirm', 'Confirm as the contractor'],
  confirmed: ['approve', 'Approve as the treasury reviewer'],
  approved: ['retry', 'Try the old approval'],
  rejected: ['authorize', 'Authorize the current instruction'],
  authorized: ['settle', 'Release and reconcile in simulator'],
  settled: ['finish', 'Reconcile final milestone and close'],
  closed: ['reset', 'Replay the review'],
};
const statuses = {
  ready: 'Scheduled',
  held: 'Payment on hold',
  requested: 'Awaiting contractor confirmation',
  confirmed: 'Awaiting independent approval',
  approved: 'Destination updated',
  rejected: 'Old approval rejected',
  authorized: 'Authorized in simulation',
  settled: 'Settled by simulator',
  closed: 'Settled by simulator',
};

function alertStillApplies(alert, chain) {
  const milestone = chain.payments.find(item => item.reference === alert.reference);
  if (!milestone || chain.closed || ['Settled', 'Cancelled', 'Unscheduled'].includes(milestone.state)) return false;
  return alert.version === (milestone.state === 'Claimed' ? milestone.approvedVersion : chain.version);
}

function ProjectInbox({ inbox, chain }) {
  const alerts = inbox?.alerts ?? [];
  const escalated = alerts.filter(alert => alert.reviewOverdue && alertStillApplies(alert, chain));
  return <>
    {escalated.length > 0 && <section aria-labelledby="supervisor-queue-title">
      <h3 id="supervisor-queue-title">Supervisor queue</h3>
      <ul>{escalated.map(alert => <li key={alert.id}><a href={'#alert-' + alert.id}>
        {alert.reference} · Version {alert.version} · {naira(alert.amountKobo)}
      </a></li>)}</ul>
    </section>}
    <section aria-labelledby="mismatch-alerts-title">
      <h3 id="mismatch-alerts-title">Rejected instruction reports</h3>
      {inbox?.status === 'unavailable' && <p>The reviewer inbox is unavailable.</p>}
      {inbox?.status === 'ready' && (alerts.length ? <ul className="project-history">
        {alerts.map(alert => <li id={'alert-' + alert.id} key={alert.id} tabIndex={-1}>
          <strong>{alert.reference} · Version {alert.version}</strong>
          {' · '}{({ destination: 'Bank or account could not be verified', amount: 'Amount differs from the approved record',
            instruction: 'File does not match the Diana claim' })[alert.kind]}
          <br />{naira(alert.amountKobo)} · {!alertStillApplies(alert, chain) ? 'Historical report' :
            alert.reviewOverdue ? 'Supervisor review due' : 'Treasury review'} · Editor unknown
          <br />First seen {watTime.format(new Date(alert.firstObserved))} WAT
          {alert.reviewBy && <> · Review by {watTime.format(new Date(alert.reviewBy))} WAT</>}
          {alert.dueAt > 0 && alert.dueAt <= 8640000000000 && <> · Payment due {watTime.format(new Date(alert.dueAt * 1000))} WAT</>}
        </li>)}
      </ul> : <p>No rejected instructions reported.</p>)}
    </section>
  </>;
}

function ClaimedPayout({ payments }) {
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState(null);
  if (!payments.some(payment => ['Claimed', 'Settled'].includes(payment.state))) return null;

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setReceipt(null);
    setEvidence(null);
    try {
      const file = form.get('csv');
      if (!file?.size || file.size > 3000) throw new Error('Choose a fictional CSV under 3 KB.');
      const csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      const input = { csv, salt: form.get('salt').trim(), destinationSalt: form.get('destinationSalt').trim() };
      const response = await fetch('/api/project-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The simulator could not verify the claim.');
      setReceipt(data);
      setEvidence({ format: 'remittance-review/project-evidence/v1', ...input, receipt: data });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadEvidence() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'restricted-training-project-evidence.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <form className="project-payout" onSubmit={submit}>
    <h3>Simulate a claimed payout</h3>
    <p>Use the exact fictional CSV, its instruction salt and the salt for the approved destination version.</p>
    <label>Payment CSV <input name="csv" type="file" accept=".csv,text/csv" required /></label>
    <label>Instruction salt <input name="salt" pattern="[A-Fa-f0-9]{64}" maxLength="64" spellCheck={false} required /></label>
    <label>Approved destination salt <input name="destinationSalt" pattern="[A-Fa-f0-9]{64}" maxLength="64" spellCheck={false} required /></label>
    <button type="submit" disabled={busy}>{busy ? 'Checking Diana…' : 'Verify claim and simulate payout'}</button>
    <div role="status">
      {error && <p>{error}</p>}
      {receipt && <><strong>Settled by simulator</strong><p>{receipt.reconciledOnDiana ? 'Receipt reconciled on Diana.' : 'Awaiting receipt reconciliation on Diana.'}</p><dl className="project-contract">
        <dt>Milestone</dt><dd>{receipt.reference}</dd>
        <dt>Diana block checked</dt><dd>{receipt.checkedAtBlock}</dd>
        <dt>Provider reference commitment</dt><dd>{receipt.providerReference}</dd>
        <dt>Receipt commitment</dt><dd>{receipt.receiptCommitment}</dd>
      </dl></>}
    </div>
    {evidence && <div>
      <button type="button" onClick={downloadEvidence}>Download restricted evidence</button>
      <p>The file contains the original fictional CSV and both salts. Share it with the reviewer who checks the claim.</p>
    </div>}
  </form>;
}

export function Project() {
  const [state, dispatch] = useReducer(transition, initialScenario);
  const [showComparison, setShowComparison] = useState(false);
  const [chain, setChain] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [action, label] = state.phase === 'held' && state.notifications.contractor === 'failed'
    ? ['retry-delivery', 'Retry contractor alert']
    : state.phase === 'held' && state.notifications.treasury === 'delivered'
      ? ['acknowledge', 'Acknowledge as treasury reviewer']
      : actions[state.phase];
  const reviewOpen = ['held', 'requested', 'confirmed'].includes(state.phase);
  const settled = ['settled', 'closed'].includes(state.phase);
  const mismatched = state.approved !== state.outgoing;

  useEffect(() => {
    const storage = new AbortController();
    let timer;
    async function refresh() {
      try {
        const response = await fetch('/api/project-chain', { signal: storage.signal });
        const next = await response.json();
        if (!storage.signal.aborted) setChain(next);
        if (next.status === 'unconfigured') return;
        if (next.status === 'confirmed') {
          try {
            const inboxResponse = await fetch('/api/project-alerts', { signal: storage.signal });
            const nextInbox = await inboxResponse.json();
            if (!storage.signal.aborted) setInbox(inboxResponse.ok ? nextInbox : { status: 'unavailable' });
          } catch {
            if (!storage.signal.aborted) setInbox({ status: 'unavailable' });
          }
        }
      } catch {
        if (!storage.signal.aborted) setChain({ status: 'unavailable' });
      }
      if (!storage.signal.aborted) timer = setTimeout(refresh, 30000);
    }
    void refresh();
    return () => { storage.abort(); clearTimeout(timer); };
  }, []);

  function advance() {
    dispatch(action);
    if (action === 'reset') setShowComparison(false);
  }

  return <div className="project-app">
    <header className="project-header"><strong>Remittance Review</strong><a href="/desk">Open QoreX approval desk</a></header>
    <main className="project-body">
      <p className="project-eyebrow">TRAINING SCENARIO · FICTIONAL PAYMENTS</p>
      <h1>Market Road rehabilitation</h1>
      <p className="project-subtitle">{payment.beneficiary} · Three milestone payments · {state.phase === 'closed' ? 'Closed' : 'Active'}</p>
      <ol className="project-milestones" aria-label="Milestone payment timeline">
        <li><small>07 November · ₦4,000,000</small><strong>Mobilisation</strong><span>Settled in scenario</span></li>
        <li aria-current={settled ? undefined : 'step'}><small>22 November · {amount}</small><strong>Drainage and grading</strong><span>{statuses[state.phase]}</span></li>
        <li><small>30 November · ₦8,000,000</small><strong>Final inspection</strong><span>{state.phase === 'closed' ? 'Settled in scenario' : 'Scheduled'}</span></li>
      </ol>
      <div className="project-grid">
        <section className="project-card" aria-labelledby="payment-title">
          <p className="project-eyebrow">MILESTONE ROAD-02</p>
          <h2 id="payment-title">{statuses[state.phase]}</h2>
          <div className="project-amount">{amount}</div>
          <p>{mismatched ? 'The outgoing file names a different account. The file editor is unknown.' :
            state.phase === 'rejected' ? 'The old authorization was for version 1. The current instruction requires a fresh decision.' :
            state.phase === 'closed' ? 'All milestone payments have been reconciled in the training scenario.' :
            'The outgoing instruction matches the current destination.'}</p>
          <dl className="project-accounts">
            <div><dt>Approved · version {state.version}</dt><dd>••{state.approved}</dd></div>
            <div><dt>Outgoing instruction</dt><dd>••{state.outgoing}</dd></div>
          </dl>
          <button type="button" onClick={advance}>{label}</button>
          {state.alert && <button type="button" className="project-secondary" aria-expanded={showComparison} onClick={() => setShowComparison(!showComparison)}>{showComparison ? 'Hide 3D comparison' : 'Show original 3D comparison'}</button>}
          {state.alert && showComparison && <Suspense fallback={<p>Loading 3D comparison…</p>}>
            <p>Original discrepancy · approved ••4821 · outgoing ••9036</p>
            <Replay step={1} approved={{ ...payment, account: '4821' }} outgoing={{ ...payment, account: '9036' }} approvedAmount={amount} outgoingAmount={amount} matches={false} />
          </Suspense>}
        </section>
        <aside className="project-card" aria-labelledby="inbox-title">
          <p className="project-eyebrow">FUNDER WORKSPACE</p>
          <h2 id="inbox-title">Reviewer inbox</h2>
          <div aria-live="polite">{state.alert ? <><strong>{reviewOpen ? 'Destination change · action required' : 'Destination change · reviewed'}</strong><p>{state.alert}</p><p>First observed 11:47 WAT · Payment due today at 12:00 WAT</p></> : <p>No alerts for this project.</p>}</div>
          {state.notifications && <dl aria-label="Simulated alert delivery">
            <dt>Treasury reviewer</dt><dd>{state.notifications.treasury}</dd>
            <dt>Enrolled contractor contact</dt><dd>{state.notifications.contractor}</dd>
          </dl>}
          <h3>Payment history</h3>
          <ol className="project-history">{state.events.map(event => <li key={event}>{event}</li>)}</ol>
        </aside>
      </div>
      {chain?.status === 'confirmed' && <section className="project-card project-chain" aria-labelledby="chain-title">
        <p className="project-eyebrow">DIANA TESTNET · BLOCK {chain.block}</p>
        <h2 id="chain-title">Verified contract state</h2>
        <p>{chain.closed ? 'Closed' : chain.hold ? 'Account-change hold active' : 'No account-change hold'} · Destination version {chain.version}</p>
        <div aria-live="polite">{chain.hold && <p><strong>Funder inbox · Destination change on hold</strong><br />
          {chain.changeConfirmed ? 'The contractor confirmed the change. Treasury review is pending.'
            : 'The enrolled contractor must confirm the destination before treasury can approve it.'}</p>}</div>
        <ProjectInbox inbox={inbox} chain={chain} />
        <p className="project-contract">{chain.contract}</p>
        <ul>{chain.payments.map(item => <li key={item.reference}>{item.reference} · {item.state}{item.certified ? ' · Certified' : ''}</li>)}</ul>
        <ProjectApproval />
        <ClaimedPayout payments={chain.payments} />
        <ProjectHistory />
      </section>}
      {chain?.status === 'unavailable' && <p>Live Diana verification unavailable.</p>}
    </main>
  </div>;
}
