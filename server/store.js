import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const COMMITTEES = [
  { id: 'cna', nom: "Comité National d'Arbitrage" },
  { id: 'discipline', nom: 'Commission de Discipline' },
  { id: 'appel', nom: "Commission d'Appel" },
  { id: 'administration', nom: 'Administration' },
];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const hash = crypto.scryptSync(password, stored.salt, 64).toString('hex');
  const a = hash;
  const b = stored.hash;
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function seed() {
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const daysAgo = (n, h = 9) => {
    const d = new Date(now - n * 86400000);
    d.setHours(h, 15, 0, 0);
    return d.toISOString();
  };

  const users = [
    { id: 'u1', username: 'admin', password: hashPassword('admin123'), name: 'Amira Benali', role: 'admin', createdAt: iso(now) },
    { id: 'u2', username: 'agent', password: hashPassword('agent123'), name: 'Karim Bensaïd', role: 'agent', createdAt: iso(now) },
    { id: 'u3', username: 'lecture', password: hashPassword('lecture123'), name: 'Sara Oufkir', role: 'lecture', createdAt: iso(now) },
  ];

  const letters = [
    {
      id: 'l1', ref: 'BO-2026-0001', direction: 'entrant', type: 'courrier', categorie: 'juridique',
      objet: 'Demande de consultation d\'acte administratif', resume: 'Mairie demande l\'accès au registre public.',
      expediteur: { nom: 'Mairie de Casablanca', fonction: 'Secrétaire générale', service: 'Service juridique' },
      destinataire: { nom: 'Bureau ordre', fonction: 'Agent', service: 'Direction générale' },
      dateEmission: daysAgo(2, 14), dateReception: daysAgo(1, 10), statut: 'recu', priorite: 'normale',
      pieces: [{ nom: 'courrier_2026-0001.pdf', taille: '245000' }],
      createdAt: iso(now - 86400000), updatedAt: iso(now - 86400000), createdBy: 'u2',
    },
    {
      id: 'l2', ref: 'BO-2026-0002', direction: 'sortant', type: 'arrete', categorie: 'finances',
      objet: 'Arrêté fixant le budget de fonctionnement du service', resume: 'Transmission au contrôleur pour visa.',
      expediteur: { nom: 'Bureau ordre', fonction: 'Chef de bureau', service: 'Direction générale' },
      destinataire: { nom: 'Contrôleur de gestion', fonction: 'Contrôleur', service: 'Inspection générale' },
      dateEmission: daysAgo(5, 11), dateReception: daysAgo(4, 16), statut: 'transmis', priorite: 'urgente',
      pieces: [{ nom: 'arrete_budget_2026.pdf', taille: '512000' }],
      createdAt: iso(now - 5 * 86400000), updatedAt: iso(now - 4 * 86400000), createdBy: 'u1',
    },
    {
      id: 'l3', ref: 'BO-2026-0003', direction: 'entrant', type: 'note', categorie: 'ressources-humaines',
      objet: 'Note de service - Campagne de vaccination', resume: 'Consigne de vaccination pour le personnel.',
      expediteur: { nom: 'Direction des ressources humaines', fonction: 'Responsable RH', service: 'Ressources humaines' },
      destinataire: { nom: 'Bureau ordre', fonction: 'Agent', service: 'Direction générale' },
      dateEmission: daysAgo(8, 9), dateReception: daysAgo(7, 8), statut: 'traite', priorite: 'normale',
      pieces: [{ nom: 'note_vaccination_2026.pdf', taille: '180000' }],
      createdAt: iso(now - 8 * 86400000), updatedAt: iso(now - 6 * 86400000), createdBy: 'u2',
    },
    {
      id: 'l4', ref: 'BO-2026-0004', direction: 'entrant', type: 'courrier', categorie: 'administration',
      objet: 'Demande de renseignements administratifs', resume: 'Avocat général requiert pièces justificatives.',
      expediteur: { nom: 'Cabinet du conseil', fonction: 'Avocat', service: 'Conseil juridique' },
      destinataire: { nom: 'Bureau ordre', fonction: 'Agent', service: 'Direction générale' },
      dateEmission: daysAgo(12, 13), dateReception: daysAgo(11, 9), statut: 'en_cours', priorite: 'confidentielle',
      pieces: [{ nom: 'demande_pieces_2026.pdf', taille: '320000' }],
      createdAt: iso(now - 12 * 86400000), updatedAt: iso(now - 10 * 86400000), createdBy: 'u1',
    },
    {
      id: 'l5', ref: 'BO-2026-0005', direction: 'sortant', type: 'courrier', categorie: 'communication',
      objet: 'Note d\'information - Organisation de la fermeture administrative', resume: 'Diffusion interne.',
      expediteur: { nom: 'Bureau ordre', fonction: 'Agent', service: 'Direction générale' },
      destinataire: { nom: 'Tous les services', fonction: '', service: 'Direction générale' },
      dateEmission: daysAgo(15, 15), dateReception: daysAgo(14, 10), statut: 'archive', priorite: 'normale',
      pieces: [],
      createdAt: iso(now - 15 * 86400000), updatedAt: iso(now - 13 * 86400000), createdBy: 'u2',
    },
    {
      id: 'l6', ref: 'BO-2026-0006', direction: 'entrant', type: 'mandat', categorie: 'securite',
      objet: 'Mandat de protection', resume: 'Mandat de protection de l\'agent signataire.',
      expediteur: { nom: 'Autorité judiciaire', fonction: 'Juge', service: 'Tribunal' },
      destinataire: { nom: 'Bureau ordre', fonction: 'Agent', service: 'Direction générale' },
      dateEmission: daysAgo(20, 10), dateReception: daysAgo(19, 11), statut: 'enregistre', priorite: 'urgente',
      pieces: [{ nom: 'mandat_2026.pdf', taille: '420000' }],
      createdAt: iso(now - 20 * 86400000), updatedAt: iso(now - 18 * 86400000), createdBy: 'u1',
    },
    {
      id: 'l7', ref: 'BO-2026-0007', direction: 'entrant', type: 'courrier', categorie: 'finances',
      objet: 'Facture fournisseur - Papeterie', resume: 'Facture pour fourniture de documents.',
      expediteur: { nom: 'Fournisseur Atlas', fonction: 'Commercial', service: '' },
      destinataire: { nom: 'Bureau ordre', fonction: 'Agent', service: 'Direction générale' },
      dateEmission: daysAgo(25, 9), dateReception: daysAgo(24, 14), statut: 'archive', priorite: 'normale',
      pieces: [{ nom: 'facture_atlas_2026.pdf', taille: '96000' }],
      createdAt: iso(now - 25 * 86400000), updatedAt: iso(now - 22 * 86400000), createdBy: 'u2',
    },
    {
      id: 'l8', ref: 'BO-2026-0008', direction: 'entrant', type: 'decret', categorie: 'administration',
      objet: 'Décret - Réorganisation des services', resume: 'Décret portant réorganisation du périmètre.',
      expediteur: { nom: 'Présidence', fonction: 'Premier ministre', service: 'Cabinet présidentiel' },
      destinataire: { nom: 'Bureau ordre', fonction: 'Agent', service: 'Direction générale' },
      dateEmission: daysAgo(30, 8), dateReception: daysAgo(29, 10), statut: 'enregistre', priorite: 'normale',
      pieces: [{ nom: 'decret_reorg_2026.pdf', taille: '1500000' }],
      createdAt: iso(now - 30 * 86400000), updatedAt: iso(now - 28 * 86400000), createdBy: 'u1',
    },
  ];

  return { users, letters, seq: letters.length + 1 };
}

function migrate(db) {
  let changed = false;
  if (!Array.isArray(db.committees)) {
    db.committees = COMMITTEES.map((c) => ({ ...c }));
    changed = true;
  }
  for (const l of db.letters) {
    if (l.numeroLettre === undefined) { l.numeroLettre = l.ref || ''; changed = true; }
    if (l.commission === undefined) { l.commission = null; changed = true; }
    if (!Array.isArray(l.commissionHisto)) { l.commissionHisto = []; changed = true; }
    if (Array.isArray(l.pieces)) {
      for (const p of l.pieces) {
        if (!p.id) { p.id = 'p' + Math.random().toString(36).slice(2, 10); changed = true; }
      }
    }
  }
  if (changed) saveDB(db);
}

let cache = null;

export function getDB() {
  if (cache) return cache;
  let db = null;
  try {
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { db = null; }
  if (!db) { db = seed(); }
  cache = db;
  migrate(db);
  saveDB(db);
  return db;
}

export function saveDB(db) {
  cache = db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function resetDB() { cache = null; saveDB(seed()); }
