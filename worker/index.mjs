import { reviewDesk } from '../server/desk.mjs';
import { projectChain } from '../server/project-chain.mjs';
import { assets } from './assets.generated.mjs';

function database(binding) {
  return {
    read: id => binding.prepare('SELECT state FROM desks WHERE id = ?').bind(id).first(),
    insert: (id, state) => binding.prepare('INSERT INTO desks VALUES (?, ?)').bind(id, state).run(),
    async replace(id, previous, state) {
      const result = await binding.prepare('UPDATE desks SET state = ? WHERE id = ? AND state = ?')
        .bind(state, id, previous).run();
      return result.meta.changes === 1;
    },
  };
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/healthz') return new Response('ok');
    if (pathname === '/api/project-chain') return projectChain(request, env.REMITTANCE_DIANA_CONTRACT);
    if (pathname.startsWith('/api/')) {
      try {
        return await reviewDesk(request, database(env.DB));
      } catch {
        return Response.json({ error: 'The desk is unavailable.' }, { status: 500 });
      }
    }
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const assetPath = pathname === '/desk' ? '/' : pathname;
    const asset = Object.hasOwn(assets, assetPath) ? assets[assetPath] : undefined;
    if (!asset) return new Response('Page not found', { status: 404 });
    return new Response(asset.body, { headers: {
      'Content-Type': asset.type,
      'Cache-Control': assetPath === '/' ? 'no-cache' : 'public, max-age=31536000, immutable',
    } });
  },
};
