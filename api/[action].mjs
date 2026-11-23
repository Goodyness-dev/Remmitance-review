import { reviewDesk } from '../server/desk.mjs';
import { redisStore } from '../server/redis.mjs';
import { projectChain } from '../server/project-chain.mjs';
import { projectPayout } from '../server/project-payout.mjs';
import { projectSigning } from '../server/project-signing.mjs';
import { projectHistory } from '../server/project-history.mjs';
import { projectAlerts } from '../server/project-alerts.mjs';

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/project-chain') {
      return projectChain(request, process.env.REMITTANCE_DIANA_CONTRACT);
    }
    if (pathname === '/api/project-history') {
      return projectHistory(request, process.env.REMITTANCE_DIANA_CONTRACT, process.env.REMITTANCE_DIANA_DEPLOYMENT_BLOCK);
    }
    try {
      const store = redisStore();
      if (pathname === '/api/project-signing') {
        return await projectSigning(request, process.env.REMITTANCE_DIANA_CONTRACT, undefined, undefined, store);
      }
      if (pathname === '/api/project-alerts') {
        return await projectAlerts(request, process.env.REMITTANCE_DIANA_CONTRACT, store);
      }
      if (pathname === '/api/project-payout') {
        return await projectPayout(request, process.env.REMITTANCE_DIANA_CONTRACT, store);
      }
      if (pathname === '/api/healthz') {
        if (!await store.check()) throw new Error('Storage unavailable');
        return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
      }
      return await reviewDesk(request, store);
    } catch {
      return Response.json({ error: 'The desk is unavailable. Its persistent review store must be connected.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
