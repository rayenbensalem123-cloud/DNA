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
  // The session ended (expired, or the password was changed elsewhere): go back to the sign-in page.
  if (res.status === 401 && path !== '/api/login' && getToken()) {
    clearToken();
    window.location.assign('/login');
  }
  // Always say what failed: the server's message when there is one, otherwise the HTTP status.
  if (!res.ok) throw new Error(data.error || `Erreur (${res.status})`);
  return data;
}

// Sends one file in three steps: ask the server where to put it, send the file there, then confirm so the
// server checks it and attaches it to the letter. The file itself never goes through the API.
async function uploadFile(letterId, file) {
  const init = await req(`/api/letters/${letterId}/pieces/upload-url`, { method: 'POST', body: { filename: file.name, size: file.size } });
  let sent;
  try {
    sent = await fetch(init.uploadUrl, { method: init.method || 'PUT', headers: init.headers, body: file });
  } catch (e) {
    throw new Error("Envoi du fichier impossible (vérifiez la connexion)");
  }
  if (!sent.ok) {
    const data = await sent.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Envoi du fichier refusé (${sent.status})`);
  }
  return (await req(`/api/letters/${letterId}/pieces/confirm`, { method: 'POST', body: { ticket: init.ticket } })).item;
}

// Uploads several files one after the other. A file that fails does not stop the others: it is reported
// in `failed` so the caller can tell the user which ones, while the letter and the other files stay saved.
async function uploadFiles(letterId, files) {
  const failed = [];
  for (const f of files) {
    try { await uploadFile(letterId, f); }
    catch (e) { failed.push({ name: f.name, message: e.message || 'Erreur' }); }
  }
  return failed;
}

export const api = {
  login: (username, password) => req('/api/login', { method: 'POST', body: { username, password } }),
  logout: () => req('/api/logout', { method: 'POST' }),
  me: () => req('/api/me'),
  changePassword: (current, next) => req('/api/me/password', { method: 'POST', body: { current, next } }),
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
  deletePiece: (letterId, pieceId) => req(`/api/letters/${letterId}/pieces/${pieceId}`, { method: 'DELETE' }),

  // Creates the letter, then attaches the files. Returns { item, failed }.
  createLetterWithFiles: async (data, files = []) => {
    const created = await req('/api/letters', { method: 'POST', body: data });
    const failed = await uploadFiles(created.item.id, files);
    let item = created.item;
    if (files.length) {
      try { item = (await req('/api/letters/' + item.id)).item; } catch (e) { /* keep the created copy */ }
    }
    return { item, failed };
  },

  // Saves the letter's fields, then attaches the new files. If the fields cannot be saved this throws
  // and nothing is uploaded. Returns { item, failed }.
  updateLetterWithFiles: async (id, fields, files = []) => {
    const saved = await req('/api/letters/' + id, { method: 'PATCH', body: fields });
    const failed = await uploadFiles(id, files);
    let item = saved.item;
    if (files.length) {
      // re-read the letter so the attachment list is up to date; the edit itself is already saved
      try { item = (await req('/api/letters/' + id)).item; } catch (e) { /* keep the saved copy */ }
    }
    return { item, failed };
  },

  openPiece: async (letterId, pieceId) => {
    // Opened first, while the click is still being handled, so the browser does not block the new tab.
    const tab = window.open('', '_blank');
    try {
      const res = await fetch(`/api/letters/${letterId}/pieces/${pieceId}`, {
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      });
      if (!res.ok) throw new Error('Fichier non disponible');
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      if (tab) tab.close();
      throw e;
    }
  },
};
