# Bureau d'Ordre — DNA (Direction Nationale d'Arbitrage)

Registre officiel de correspondance du bureau d'ordre de la **Direction Nationale
d'Arbitrage** de la **Fédération Tunisienne de Football**.

Application React + API Node, prête pour un déploiement **Vercel** avec
persistance réelle :

- **Neon Postgres** pour le registre (lettres, comptes, comités, historique) ;
- **Vercel Blob** (privé) pour les PDF scannés ;
- Sessions signées (HMAC) persistantes entre les redémarrages.

## Fonctionnalités

- Authentification par compte (rôles `admin` / `agent` / `lecture`), interface
  **français / anglais**, thème sombre FTF (bascule clair/sombre disponible).
- Tableau de bord : totaux, reçus / envoyés / en attente / archivés, urgences,
  répartition par statut, catégorie, type de courrier et **comité**.
- Registre complet avec filtres (direction, statut, type, catégorie, priorité,
  comité, recherche, dates) et archives par comité.
- **Numéro de lettre saisi manuellement** (lu sur le papier), objet, degré
  d'importance (`normale` / `urgente` / `confidentielle`), comité destinataire.
- **PDF scanné** joint à la lettre (téléversement réel, 25 Mo maximum),
  consultable en ligne et supprimable.
- **Suivi comité** horodaté : transmission → reçu par le comité → traité,
  avec notes.
- Gestion des comptes (création, modification, mot de passe, comité affecté).

## Compte initial

| Identifiant | Mot de passe | Rôle |
| ----------- | ------------ | ---- |
| `admin`     | `admin`      | Administrateur |

> Le mot de passe initial peut être fixé à la première installation avec la
> variable `DNA_ADMIN_PASSWORD`. **Changez-le dès la première connexion** depuis
> la page *Comptes*.

L'application démarre en **mode officiel** : aucun compte de démonstration, aucun
courrier pré-rempli. Si une ancienne base de démonstration est détectée, elle est
automatiquement remplacée par ce registre vide.

## Développement local

Sans base externe, les données sont stockées dans `server/data/` (ignoré par Git).

```bash
npm install
npm run build      # construit client/dist
npm start          # http://localhost:3001 (API + client)
```

Pour travailler sur le client avec rechargement à chaud :

```bash
npm start                    # terminal 1 : API sur 3001
npm --prefix client run dev  # terminal 2 : http://localhost:5173 (proxy /api)
```

## Déploiement Vercel

1. Importer le dépôt GitHub dans Vercel (framework **Vite** détecté via
   `vercel.json`).
2. Ajouter les variables d'environnement du projet :

   | Variable | Rôle |
   | -------- | ---- |
   | `DATABASE_URL` | chaîne de connexion Neon Postgres |
   | `BLOB_READ_WRITE_TOKEN` | jeton Vercel Blob (store privé) |
   | `SESSION_SECRET` | (recommandé) secret aléatoire long pour signer les sessions |
   | `DNA_ADMIN_PASSWORD` | (optionnel) mot de passe initial du compte `admin` |

   Si `SESSION_SECRET` n'est pas défini, un secret aléatoire est généré et
   conservé dans la base : les sessions restent valides après redéploiement.
3. Déployer. La table `dna_app_state` et le compte administrateur sont créés
   automatiquement au premier appel.

## API

Toutes les routes `/api/*` sont servies par la fonction serverless
`api/[...path].js` (et par `server/index.js` en local).

- `POST /api/login` — connexion → jeton signé
- `POST /api/logout` — déconnexion côté client
- `GET  /api/me` — utilisateur courant
- `GET  /api/committees` — comités disponibles
- `GET  /api/users` · `POST /api/users` · `PATCH /api/users/:id` — comptes (admin)
- `GET  /api/stats` — statistiques
- `GET  /api/letters` — registre avec filtres
- `POST /api/letters` — création (admin) ; `numeroLettre`, `commission`, etc.
- `GET  /api/letters/:id` — détail
- `PATCH /api/letters/:id` — mise à jour, affectation de comité, statut
- `DELETE /api/letters/:id` — suppression (admin)
- `POST /api/letters/:id/commission-events` — suivi comité
- `POST /api/blob-upload` — jeton de téléversement Vercel Blob
- `POST /api/letters/:id/pieces/complete` — rattachement du fichier téléversé
- `GET  /api/letters/:id/pieces/:pieceId` — consultation du PDF
- `DELETE /api/letters/:id/pieces/:pieceId` — suppression d'une pièce (admin)

## Structure

```
api/[...path].js      entrée serverless Vercel
server/index.js       API HTTP + service du client en local
server/store.js       persistance Neon / fichier local, comptes, comités
client/               application React (Vite)
vercel.json           build, dossier de sortie et réécritures
```

## Sécurité

- Mots de passe hachés avec `scrypt` + sel.
- Jetons de session signés HMAC-SHA256, expiration 8 h.
- Fichiers Blob en accès privé ; lecture protégée par authentification.
- Compte administrateur unique au départ ; créer les autres comptes depuis
  l'application.
