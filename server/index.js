// Local server: `node server/index.js` (port 3001). It serves the built client and runs the very same
// API handler as production, storing data in server/data/db.json and scans in server/data/uploads/.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/api/handler.js';
import { createLocalStore, createDiskStorage, defaultAdmin } from './local-store.js';

const PORT = process.env.PORT || 3001;
const ROOT = process.cwd();
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const MAX_BODY = 12 * 1024 * 1024; // files are capped at 10 MB by the API; this only stops runaway uploads

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const dbFile = path.join(DATA_DIR, 'db.json');
const store = createLocalStore({ file: dbFile, users: fs.existsSync(dbFile) ? undefined : [await defaultAdmin()] });
const handle = createHandler({ store, storage: createDiskStorage(path.join(DATA_DIR, 'uploads')) });

process.on('uncaughtException', (e) => console.error('uncaught', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

// Reads the request body. If it is too large we keep draining it (without keeping it) so the browser
// receives a clean 413 instead of a dropped connection.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (tooLarge) return;
      if (size > MAX_BODY) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => (tooLarge ? resolve(null) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const body = hasBody ? await readBody(req) : undefined;
      if (hasBody && body === null) {
        return reply(res, 413, JSON.stringify({ error: 'Fichier trop volumineux (max 10 Mo)' }), { 'Content-Type': 'application/json; charset=utf-8' });
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const response = await handle(new Request(url, { method: req.method, headers, body: body && body.length ? body : undefined }));
      const out = Buffer.from(await response.arrayBuffer());
      const outHeaders = Object.fromEntries(response.headers);
      outHeaders['content-length'] = String(out.length);
      res.writeHead(response.status, outHeaders);
      return res.end(out);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      let filePath = path.join(CLIENT_DIST, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      if (!filePath.startsWith(CLIENT_DIST) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(CLIENT_DIST, 'index.html'); // single-page app: unknown paths show the app
      }
      if (!fs.existsSync(filePath)) {
        return reply(res, 404, 'Client not built yet: run "npm run build" in the client folder.', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      const data = fs.readFileSync(filePath);
      return reply(res, 200, data, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    }

    reply(res, 404, JSON.stringify({ error: 'Not found' }), { 'Content-Type': 'application/json; charset=utf-8' });
  } catch (e) {
    console.error('Request error', req.url, e);
    if (!res.headersSent) reply(res, 500, JSON.stringify({ error: 'Erreur serveur' }), { 'Content-Type': 'application/json; charset=utf-8' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Bureau Ordre server listening on http://localhost:${PORT}`);
  if (store.fresh) console.log('New database created. Sign in as "admin" (password: DNA_ADMIN_PASSWORD, or "admin" if not set) and change the password.');
});
