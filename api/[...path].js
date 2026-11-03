import { route } from '../server/index.js';

export default async function handler(req, res) {
  try {
    await route(req, res);
  } catch (error) {
    console.error('API request failed', error);
    if (!res.headersSent) {
      res.statusCode = error.status || 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error.status === 409 ? error.message : 'Erreur serveur' }));
    } else {
      res.end();
    }
  }
}
