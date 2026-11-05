import { upload } from '@vercel/blob/client';

const TOKEN_KEY = 'bo_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
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
  createLetter: (data) => req('/api/letters', { method: 'POST', body: data }),
  updateLetter: (id, data) => req('/api/letters/' + id, { method: 'PATCH', body: data }),
  deleteLetter: (id) => req('/api/letters/' + id, { method: 'DELETE' }),
  committees: () => req('/api/committees'),
  users: () => req('/api/users'),
  createUser: (data) => req('/api/users', { method: 'POST', body: data }),
  updateUser: (id, data) => req('/api/users/' + encodeURIComponent(id), { method: 'PATCH', body: data }),
  deleteUser: (id) => req('/api/users/' + encodeURIComponent(id), { method: 'DELETE' }),
  addCommissionEvent: (id, body) => req(`/api/letters/${id}/commission-events`, { method: 'POST', body }),
  uploadPiece: (id, filename, dataBase64) => req(`/api/letters/${id}/pieces`, { method: 'POST', body: { filename, dataBase64 } }),
  uploadPieceDirect: async (id, file, onUploadProgress) => {
    const safeName = file.name.replace(/[^\w.\-\u00C0-\u017F]/g, '_');
    const blob = await upload(`${id}-${Date.now()}-${safeName}`, file, {
      access: 'private',
      handleUploadUrl: '/api/blob-upload',
      clientPayload: JSON.stringify({ letterId: id, filename: file.name }),
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      multipart: file.size > 5 * 1024 * 1024,
      onUploadProgress,
    });
    await req(`/api/letters/${id}/pieces/complete`, { method: 'POST', body: { filename: file.name, pathname: blob.pathname } });
    return blob;
  },
  deletePiece: (letterId, pieceId) => req(`/api/letters/${letterId}/pieces/${pieceId}`, { method: 'DELETE' }),
  createLetterWithFiles: async (data, files = []) => {
    const d = await req('/api/letters', { method: 'POST', body: data });
    for (const f of files) await api.uploadPieceDirect(d.item.id, f);
    return d;
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

