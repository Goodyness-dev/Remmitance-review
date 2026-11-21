import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { reviewDesk } from './desk.mjs';

const db = new DatabaseSync(process.env.REMITTANCE_DB || 'remittance.sqlite');
db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS desks (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
const read = db.prepare('SELECT state FROM desks WHERE id = ?');
const insert = db.prepare('INSERT INTO desks VALUES (?, ?)');
const update = db.prepare('UPDATE desks SET state = ? WHERE id = ? AND state = ?');
const store = {
  read: id => read.get(id),
  insert: (id, state) => insert.run(id, state),
  replace: (id, previous, state) => update.run(state, id, previous).changes === 1,
};

export async function desk(req, res) {
  try {
    const body = req.method === 'POST' ? { body: Readable.toWeb(req), duplex: 'half' } : {};
    const protocol = process.env.REMITTANCE_HTTPS === 'true' ? 'https:' : 'http:';
    const request = new Request(new URL(req.url, protocol + '//localhost'), { method: req.method, headers: req.headers, ...body });
    const response = await reviewDesk(request, store);
    res.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text());
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'The desk is unavailable.' }));
  }
}
