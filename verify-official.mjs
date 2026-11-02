const BASE = 'http://localhost:3001';
// demo passwords must now fail
let c = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
console.log('old demo password ->', c.status, '(expect 401)');
// official login
c = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) });
const d = await c.json();
console.log('official login ->', c.status, JSON.stringify(d.user));
// letters empty
const list = await (await fetch(BASE + '/api/letters', { headers: { Authorization: 'Bearer ' + d.token } })).json();
console.log('letters ->', list.total, '(expect 0)');
// committees ready
const coms = await (await fetch(BASE + '/api/committees', { headers: { Authorization: 'Bearer ' + d.token } })).json();
console.log('committees ->', coms.items.map((x) => x.id));
// logo served
c = await fetch(BASE + '/logo-ftf.webp');
console.log('logo ->', c.status, c.headers.get('content-type'), '(expect 200)');
