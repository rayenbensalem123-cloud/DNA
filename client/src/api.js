import { upload } from '@vercel/blob/client';
import { openPdf, closePdf } from './components/PdfViewer';

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
  createCommittee: (nom) => req('/api/committees', { method: 'POST', body: { nom } }),
  updateCommittee: (id, nom) => req(`/api/committees/${id}`, { method: 'PATCH', body: { nom } }),
  activity: (action = '', extra = {}) => {
    const p = new URLSearchParams({ limit: 500, ...(action ? { action } : {}), ...extra });
    return req('/api/activity?' + p.toString());
  },
  notifications: () => req('/api/notifications'),
  users: () => req('/api/users'),
  createUser: (data) => req('/api/users', { method: 'POST', body: data }),
  updateUser: (id, data) => req('/api/users/' + encodeURIComponent(id), { method: 'PATCH', body: data }),
  deleteUser: (id) => req('/api/users/' + encodeURIComponent(id), { method: 'DELETE' }),
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
  openPiece: async (letterId, pieceId, title = '') => {
    openPdf({ title: title || 'Document' });
    try {
      const d = await req(`/api/file-link?kind=piece&id=${encodeURIComponent(letterId + '/' + pieceId)}`);
      openPdf({ url: d.url, mime: d.mime });
    } catch (e) { closePdf(); throw e; }
  },
  // Courriers (scanned files awaiting validation)
  listCourriers: (status = '') => req('/api/courriers' + (status ? `?status=${encodeURIComponent(status)}` : '')),
  uploadCourrier: (filename, dataBase64, sujet = '') => req('/api/courriers', { method: 'POST', body: { filename, dataBase64, sujet } }),
  validateCourrierDaf: (id, note = '') => req(`/api/courriers/${id}`, { method: 'PATCH', body: { action: 'valide_daf', note } }),
  validateCourrier: (id, note = '') => req(`/api/courriers/${id}`, { method: 'PATCH', body: { action: 'valide', note } }),
  rejectCourrier: (id, reason) => req(`/api/courriers/${id}`, { method: 'PATCH', body: { action: 'rejete', rejectionReason: reason } }),
  // Files go straight from the browser to storage (signed upload URL), then a
  // small "complete" call records them. Falls back to the in-request upload
  // when direct storage is unavailable (local development).
  uploadCourrierFile: async (file, sujet = '', details = {}) => {
    const toBase64 = () => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(file); });
    try {
      const safeName = file.name.replace(/[^\w.\-\u00C0-\u017F]/g, '_');
      const blob = await upload(`cr-${Date.now().toString(36)}-${safeName}`, file, {
        access: 'private', handleUploadUrl: '/api/blob-upload',
        clientPayload: JSON.stringify({ courrier: true, filename: file.name }),
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
        multipart: file.size > 5 * 1024 * 1024,
      });
      return await req('/api/courriers/complete', { method: 'POST', body: { filename: file.name, pathname: blob.pathname, sujet, ...details } });
    } catch (error) {
      if (file.size <= 9 * 1024 * 1024) return api.uploadCourrier(file.name, await toBase64(), sujet);
      throw error;
    }
  },
  toSend: () => req('/api/to-send'),
  deleteCourrier: (id) => req(`/api/courriers/${id}`, { method: 'DELETE' }),
  openCourrierFile: async (id, title = '') => {
    openPdf({ title: title || 'Document' });
    try {
      const d = await req(`/api/file-link?kind=courrier&id=${encodeURIComponent(id)}`);
      openPdf({ url: d.url, mime: d.mime });
    } catch (e) { closePdf(); throw e; }
  },
  // Best-effort prefetch: mints the (stable) link and lets the browser cache
  // the file, so a later open is instant. Used on hover/touch of open buttons.
  warmFile: async (kind, id) => {
    try {
      const d = await req(`/api/file-link?kind=${kind}&id=${encodeURIComponent(id)}`);
      if (d.url) fetch(d.url, { priority: 'low' }).catch(() => {});
    } catch { /* warming is optional */ }
  },
  // Notifications (courrier rejections)
  courrierNotifications: () => req('/api/courrier-notifications'),
  markCourrierNotificationRead: (id) => req(`/api/courrier-notifications/${id}`, { method: 'PATCH', body: { read: true } }),
  // Transfer requests awaiting bureau approval (admin/supervisor)
  transferRequests: () => req('/api/transfer-requests'),
  transferApproval: (letterId, action, note = '') => req(`/api/letters/${encodeURIComponent(letterId)}/transfer-approval`, { method: 'POST', body: { action, note } }),
  // Chat + presence (poll-based)
  chat: (channel = 'general', after = '') => req('/api/chat?channel=' + encodeURIComponent(channel) + (after ? '&after=' + encodeURIComponent(after) : '')),
  chatChannels: () => req('/api/chat'),
  chatDirectory: () => req('/api/chat/directory'),
  markChatRead: (channel) => req('/api/chat/read', { method: 'POST', body: { channel } }),
  sendChat: (channel, text) => req('/api/chat', { method: 'POST', body: { channel, text } }),
  // Settings (admin) — Gmail IMAP credentials
  getSettings: () => req('/api/settings'),
  saveSettings: (body) => req('/api/settings', { method: 'PUT', body }),
  // Templates de courrier
  templates: () => req('/api/templates'),
  createTemplate: (data) => req('/api/templates', { method: 'POST', body: data }),
  updateTemplate: (id, data) => req(`/api/templates/${id}`, { method: 'PUT', body: data }),
  deleteTemplate: (id) => req(`/api/templates/${id}`, { method: 'DELETE' }),
  // Gmail inbox (bureau)
  gmailMessages: () => req('/api/gmail/messages'),
  gmailMessage: (uid) => req(`/api/gmail/messages/${uid}`),
  gmailUnread: () => req('/api/gmail/unread'),
  gmailAck: (uid) => req('/api/gmail/ack', { method: 'POST', body: { uid } }),
};

