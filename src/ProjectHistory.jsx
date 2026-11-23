import React, { useEffect, useState } from 'react';

export function ProjectHistory() {
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/project-history', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      setHistory(await response.json());
    }).catch(() => {
      if (!controller.signal.aborted) setError('Diana history is unavailable.');
    });
    return () => controller.abort();
  }, []);

  async function load(before) {
    setBusy(true);
    setError('');
    try {
      const url = '/api/project-history' + (before ? '?before=' + encodeURIComponent(before) : '');
      const response = await fetch(url);
      if (!response.ok) throw new Error();
      const next = await response.json();
      setHistory(prior => {
        if (!before || next.status !== 'confirmed' || prior?.status !== 'confirmed') return next;
        const events = new Map([...prior.events, ...next.events].map(event => [event.id, event]));
        return { ...next, events: [...events.values()], through: prior.through };
      });
    } catch {
      setError('Diana history is unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (history?.status === 'unconfigured') return null;
  return <section className="project-approval" aria-labelledby="diana-history-title">
    <h3 id="diana-history-title">Diana transaction history</h3>
    {history?.status === 'confirmed' && <>
      <p>Blocks {history.from}–{history.through}</p>
      {history.events.length ? <ol className="project-history">
        {history.events.map(event => <li key={event.id}>
          {event.ref ? event.ref + ' · ' : ''}{event.label} · Block {event.block}
          <details><summary>Transaction hash</summary><code className="project-contract">{event.hash}</code></details>
        </li>)}
      </ol> : <p>No project events in these blocks.</p>}
      {history.before && <button type="button" disabled={busy} onClick={() => load(history.before)}>Load older blocks</button>}
    </>}
    {error && <p role="status">{error}</p>}
    <button className="project-secondary" type="button" disabled={busy} onClick={() => load(null)}>
      {busy ? 'Checking Diana…' : 'Refresh history'}
    </button>
  </section>;
}
