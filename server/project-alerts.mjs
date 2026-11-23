const contractAddress = /^0x[0-9a-f]{40}$/i;
const headers = { 'Cache-Control': 'no-store' };
const inboxKey = contract => 'project-inbox:' + contract.toLowerCase();
const caseKey = ({ reference, version, kind }) => [reference, version, kind].join(':');
const reviewWindowMs = 24 * 60 * 60 * 1000;

function reviewDeadline(alert) {
  const observed = Date.parse(alert.firstObserved);
  const due = alert.dueAt * 1000;
  const nextDay = observed + reviewWindowMs;
  return new Date(due > 0 ? Math.max(observed, Math.min(nextDay, due)) : nextDay).toISOString();
}

// One case per milestone, destination version and mismatch type. Replayed
// submissions preserve the first observation and cannot fill the inbox.
export async function recordMismatch(store, contract, details, now = new Date()) {
  if (!store) throw new Error('The reviewer inbox is unavailable.');
  const key = inboxKey(contract);
  const id = caseKey(details);
  const alert = { id, ...details, firstObserved: now.toISOString() };
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await store.read(key);
    const cases = before ? JSON.parse(before.state) : [];
    if (cases.some(item => item.id === id)) return;
    if (cases.length >= 128) throw new Error('The reviewer inbox needs attention.');
    const next = JSON.stringify([alert, ...cases]);
    if (before) {
      if (await store.replace(key, before.state, next)) return;
    } else {
      try {
        await store.insert(key, next);
        return;
      } catch (error) {
        if (!await store.read(key)) throw error;
      }
    }
  }
  throw new Error('The reviewer inbox is busy.');
}

export async function projectAlerts(request, contract, store, now = new Date()) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers });
  if (!contractAddress.test(contract)) return Response.json({ status: 'unconfigured' }, { headers });
  const record = await store.read(inboxKey(contract));
  const alerts = record ? JSON.parse(record.state) : [];
  return Response.json({ status: 'ready', alerts: alerts.map(alert => {
    const reviewBy = reviewDeadline(alert);
    return { ...alert, reviewBy, reviewOverdue: now.getTime() >= Date.parse(reviewBy) };
  }) }, { headers });
}
