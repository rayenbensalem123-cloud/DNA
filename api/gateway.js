import { route } from '../server/index.js';

// Single entry point for the whole API. Vercel routes every /api/* request
// here via the rewrite in vercel.json, so one warm instance serves them all
// (no per-path cold starts on page loads).
export default async function handler(req, res) {
  try {
    await route(req, res);
  } catch (error) {
    console.error('API request failed', error);
    if (!res.headersSent) {
      res.statusCode = error.status || 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: (error.status === 409 || error.status === 413) ? error.message : 'Erreur serveur' }));
    } else {
      res.end();
    }
  }
}
