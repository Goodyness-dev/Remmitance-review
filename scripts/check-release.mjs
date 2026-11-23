const [site, expectedContract] = process.argv.slice(2);
const amounts = { 'ROAD-01': '400000000', 'ROAD-02': '1200000000', 'ROAD-03': '800000000' };

async function checkRelease() {
  if (!site) throw new Error('Usage: node scripts/check-release.mjs <site-url> [expected-diana-contract]');
  const url = new URL(site);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Provide the site origin. Hosted checks require HTTPS.');
  }
  if ((!local || expectedContract) && !/^0x[0-9a-f]{40}$/i.test(expectedContract)) {
    throw new Error('Provide the expected Diana contract address.');
  }
  async function read(path, options) {
    const response = await fetch(new URL(path, url), { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(path + ' returned HTTP ' + response.status + '.');
    return response;
  }

  const [home, desk, health, apiDesk, chain] = await Promise.all([
    read('/'), read('/desk'), read(local ? '/healthz' : '/api/healthz'), read('/api/desk'), read('/api/project-chain'),
  ]);
  const [mainHtml, deskHtml, healthText, deskState, snapshot] = await Promise.all([
    home.text(), desk.text(), health.text(), apiDesk.json(), chain.json(),
  ]);
  const assets = mainHtml.match(/src="(\/assets\/[^"]+\.js)"/);
  if (!assets || !mainHtml.includes('<title>Remittance Review</title>') || !deskHtml.includes(assets[1])) {
    throw new Error('The project and approval desk must serve the latest built app.');
  }
  const script = await read(assets[1]);
  if (!/javascript/.test(script.headers.get('content-type') ?? '')) throw new Error('The application script could not be loaded.');
  const cookie = apiDesk.headers.get('set-cookie')?.match(/^(remittance=[a-f0-9-]{36});/i)?.[1];
  if (healthText.trim() !== 'ok' || !cookie || !deskState.held ||
      deskState.approved?.account !== '4821' || deskState.outgoing?.account !== '9036') {
    throw new Error('The storage check or the original payout hold failed.');
  }
  const resumedDesk = await (await read('/api/desk', { headers: { Cookie: cookie } })).json();
  if (!deskState.reviewId || resumedDesk.reviewId !== deskState.reviewId) {
    throw new Error('The approval desk did not retain its review.');
  }
  if (!expectedContract) {
    console.log('Local release routes, built assets and review persistence passed.');
    return;
  }
  if (snapshot.status !== 'confirmed' || snapshot.network !== 'qorechain-diana' ||
      snapshot.contract?.toLowerCase() !== expectedContract.toLowerCase() ||
      snapshot.payments?.length !== 3 ||
      Object.entries(amounts).some(([ref, amount]) => !snapshot.payments.some(item =>
        item.reference === ref && item.amountKobo === amount && item.certified))) {
    throw new Error('The site did not return the expected certified Diana project.');
  }
  const [history, inbox] = await Promise.all([
    read('/api/project-history').then(res => res.json()), read('/api/project-alerts').then(res => res.json()),
  ]);
  if (history.status !== 'confirmed' || !Array.isArray(history.events) || inbox.status !== 'ready' || !Array.isArray(inbox.alerts)) {
    throw new Error('The release is missing Diana history or the reviewer inbox.');
  }
  console.log('Release routes, review persistence, Diana project, history and inbox passed at block ' + snapshot.block + '.');
}

try {
  await checkRelease();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
