const TOKEN_KEY = 'bo_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function req(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Connexion au serveur impossible');
  }
  const data = await res.json().catch(() => ({}));
  // Always say what failed: the server's message when there is one, otherwise the HTTP status.
  if (!res.ok) throw new Error(data.error || `Erreur (${res.status})`);
  return data;
}

export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.readAsDataURL(file);
  });
}

export const api = {
  login: (username, password) => req('/api/login', { method: 'POST', body: { username, password } }),
  logout: () => req('/api/logout', { method: 'POST' }),
  me: () => req('/api/me'),
  stats: () => req('/api/stats'),
  listLetters: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req('/api/letters' + (qs ? `?${qs}` : ''));
  },
  getLetter: (id) => req('/api/letters/' + id),
  createLetter: (data) => req('/api/letters', { method: 'POST', body: data }),
  updateLetter: (id, data) => req('/api/letters/' + id, { method: 'PATCH', body: data }),
  deleteLetter: (id) => req('/api/letters/' + id, { method: 'DELETE' }),
  committees: () => req('/api/committees'),
  addCommissionEvent: (id, body) => req(`/api/letters/${id}/commission-events`, { method: 'POST', body }),
  uploadPiece: (id, filename, dataBase64) => req(`/api/letters/${id}/pieces`, { method: 'POST', body: { filename, dataBase64 } }),
  deletePiece: (letterId, pieceId) => req(`/api/letters/${letterId}/pieces/${pieceId}`, { method: 'DELETE' }),
  createLetterWithFiles: async (data, files = []) => {
    const d = await req('/api/letters', { method: 'POST', body: data });
    for (const f of files) {
      const b64 = await fileToBase64(f);
      await req(`/api/letters/${d.item.id}/pieces`, { method: 'POST', body: { filename: f.name, dataBase64: b64 } });
    }
    return d;
  },
  // Saves the letter's fields, then uploads the new files one by one. A file that fails does not
  // undo the saved edit: it is reported in `failed` so the caller can tell the user which ones.
  updateLetterWithFiles: async (id, fields, files = []) => {
    const saved = await req('/api/letters/' + id, { method: 'PATCH', body: fields });
    const failed = [];
    for (const f of files) {
      try {
        const b64 = await fileToBase64(f);
        await req(`/api/letters/${id}/pieces`, { method: 'POST', body: { filename: f.name, dataBase64: b64 } });
      } catch (e) {
        failed.push({ name: f.name, message: e.message || 'Erreur' });
      }
    }
    let item = saved.item;
    if (files.length) {
      // re-read the letter so the attachment list is up to date; the edit itself is already saved
      try { item = (await req('/api/letters/' + id)).item; } catch (e) { /* keep the saved copy */ }
    }
    return { item, failed };
  },
  openPiece: async (letterId, pieceId) => {
    const res = await fetch(`/api/letters/${letterId}/pieces/${pieceId}`, {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    });
    if (!res.ok) throw new Error('Fichier non disponible');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};
