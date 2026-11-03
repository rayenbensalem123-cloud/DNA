// Runs the API test suite over real HTTP against a running server:
//   node tests/run-http.mjs http://localhost:3001 <admin-pass> <agent-pass> <reader-pass> [admin-user agent-user reader-user]
// The accounts must already exist. The suite creates its own test letters and deletes them at the end,
// and changes the agent's password once (so use throwaway accounts, not real ones).
import { runSuite } from './suite.js';

const [base, adminPass, agentPass, readerPass, adminUser = 'admin', agentUser = 'agent', readerUser = 'lecture'] = process.argv.slice(2);
if (!base || !adminPass || !agentPass || !readerPass) {
  console.error('usage: node tests/run-http.mjs <base-url> <admin-pass> <agent-pass> <reader-pass> [admin-user agent-user reader-user]');
  process.exit(2);
}

const users = {
  admin: { username: adminUser, password: adminPass },
  agent: { username: agentUser, password: agentPass },
  reader: { username: readerUser, password: readerPass },
};

async function send(url, { method = 'GET', headers = {}, body } = {}) {
  try {
    const res = await fetch(url, { method, headers, body });
    const bytes = new Uint8Array(await res.arrayBuffer());
    let data = null;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* binary */ }
    return { status: res.status, data, bytes, type: res.headers.get('content-type') };
  } catch (e) {
    return { status: 'NETWORK_ERROR', data: { error: String(e.cause?.code || e.message) }, bytes: new Uint8Array(0) };
  }
}

const call = (path, { method = 'GET', body, token, raw, headers = {} } = {}) => {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  return send(base + path, { method, headers: h, body: payload });
};

// Relative upload addresses stay on this server; absolute ones (cloud storage) are used as they are.
const putFile = (url, headers, bytes) => send(url.startsWith('/') ? base + url : url, { method: 'PUT', headers, body: bytes });

const { failures } = await runSuite({ call, putFile, users, log: console.log });
process.exit(failures.length ? 1 : 0);
