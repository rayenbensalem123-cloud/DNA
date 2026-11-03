// Runs the API test suite against the local implementation (no network, nothing written to disk):
//   node tests/run-local.mjs
import { createHandler } from '../supabase/functions/api/handler.js';
import { hashPassword } from '../supabase/functions/api/auth.js';
import { createLocalStore, createMemoryStorage } from '../server/local-store.js';
import { runSuite } from './suite.js';

const users = {
  admin: { username: 'admin', password: 'admin-password-1' },
  agent: { username: 'agent', password: 'agent-password-1' },
  reader: { username: 'lecture', password: 'reader-password-1' },
};
const mk = async (id, u, name, role) => ({ id, username: u.username, name, role, passwordHash: await hashPassword(u.password) });

const store = createLocalStore({
  users: [await mk('u1', users.admin, 'Administrateur', 'admin'), await mk('u2', users.agent, 'Agent', 'agent'), await mk('u3', users.reader, 'Lecteur', 'lecture')],
});
const handle = createHandler({ store, storage: createMemoryStorage() });

async function call(path, { method = 'GET', body, token, raw, headers = {} } = {}) {
  const h = new Headers(headers);
  if (token) h.set('Authorization', 'Bearer ' + token);
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { payload = JSON.stringify(body); h.set('Content-Type', 'application/json'); }
  const res = await handle(new Request('http://local' + path, { method, headers: h, body: payload }));
  const bytes = new Uint8Array(await res.arrayBuffer());
  let data = null;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* binary */ }
  return { status: res.status, data, bytes, type: res.headers.get('content-type') };
}

const putFile = (url, headers, bytes) => call(url, { method: 'PUT', raw: bytes, headers });

const { failures } = await runSuite({ call, putFile, users, log: console.log });
process.exit(failures.length ? 1 : 0);
