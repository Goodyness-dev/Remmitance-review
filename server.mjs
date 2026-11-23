import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { desk } from './server/local.mjs';
import { projectChain } from './server/project-chain.mjs';
import { projectHistory } from './server/project-history.mjs';

const dev = process.argv.includes('--dev');
const vite = dev && await (await import('vite')).createServer({
  configFile: false, server: { middlewareMode: true }, appType: 'spa',
});
const root = resolve('dist');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
const port = Number(process.env.PORT || 5173);
createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    return res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('ok');
  }
  const requestUrl = new URL(req.url, 'http://localhost');
  if (['/api/project-chain', '/api/project-history'].includes(requestUrl.pathname)) {
    const request = new Request(requestUrl, { method: req.method });
    const contract = process.env.REMITTANCE_DIANA_CONTRACT;
    const result = await (requestUrl.pathname === '/api/project-chain'
      ? projectChain(request, contract)
      : projectHistory(request, contract, process.env.REMITTANCE_DIANA_DEPLOYMENT_BLOCK));
    return res.writeHead(result.status, Object.fromEntries(result.headers)).end(await result.text());
  }
  if (req.url.startsWith('/api/')) return desk(req, res);
  if (vite) return vite.middlewares(req, res);
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (['/', '/desk'].includes(pathname) ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('Page not found');
  }
}).listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log('Remittance Review is listening on port ' + port);
});
