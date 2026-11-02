# Bureau Ordre — Plateforme de registre officiel (DNA)

Plateforme web de gestion du **bureau d'ordre** de la **DNA (Direction Nationale d'Arbitrage)** :
enregistrement des lettres officielles de l'office ainsi que de **tout ce qui est reçu** dans l'office.

## Fonctionnalités

- 🔐 **Authentification** (comptes démo + rôles : admin / agent / lecteur)
- 📋 **Tableau de bord** : statistiques (correspondances, reçus, envoyés, en attente, archivés, urgentes), répartition par catégorie / statut / **comité**
- 📄 **Lettres officielles** : registre complet avec filtres (direction, statut, type, catégorie, priorité, **comité**, recherche, dates)
- 📨 **Tout ce qui est reçu** : formulaire d'enregistrement des courriers reçus + suivi du workflow
- 🔄 **Workflow** : reçu → enregistré → en cours → traité → transmis → archivé
- 🧾 **Formulaire d'enregistrement** : numéro du courrier (lu sur le papier), expéditeur, objet/objet de la lettre, degré d'importance, **comité destinataire**, et **PDF scanné** du courrier (upload réel, jusqu'à 10 Mo)
- 🏛️ **Comités** : Comité National d'Arbitrage · Commission de Discipline · Commission d'Appel · Administration
- 🚦 **Suivi comité** : transmission au comité → reçu par le comité → traité par le comité, avec historique horodaté
- 🌐 Interface **français / anglais**

## Comptes démo

| Utilisateur | Mot de passe    | Rôle         |
| ----------- | --------------- | ----------- |
| `admin`     | `admin123`      | Administrateur |
| `agent`     | `agent123`      | Agent        |
| `lecture`   | `lecture123`    | Lecteur      |

## Lancement

Le serveur backend (Node.js natif, sans dépendance) écoute sur le port **3001** :

```bash
node server/index.js
```

Puis le client (Vite) :

```bash
cd client
npm install
npm run dev     # http://localhost:5173 (proxy /api -> localhost:3001)
```

Ou build + prod :

```bash
cd client
npm run build
node server/index.js    # sert le client + API sur http://localhost:3001
```

## API

- `POST /api/login` — connexion (username / password) → token
- `GET  /api/me` — utilisateur courant
- `GET  /api/committees` — liste des comités
- `GET  /api/stats` — statistiques (inclut `parCommission`)
- `GET  /api/letters` — liste avec filtres (`q`, `direction`, `statut`, `type`, `categorie`, `priorite`, `commission`, `from`, `to`, `sort`, `page`, `limit`)
- `POST /api/letters` — création (rôle admin/agent) ; champs : `numeroLettre`, `commission`, etc.
- `GET  /api/letters/:id` — détail
- `PATCH /api/letters/:id` — mise à jour / statut / transmission à un comité (enregistre un événement de suivi)
- `POST /api/letters/:id/commission-events` — suivi comité : `recu_comite` / `traite_comite` / `note`
- `POST /api/letters/:id/pieces` — upload du PDF scanné (`filename` + `dataBase64`, max 10 Mo)
- `GET  /api/letters/:id/pieces/:pieceId` — téléchargement / affichage (auth requise)
- `DELETE /api/letters/:id/pieces/:pieceId` — suppression d'une pièce (admin)
- `DELETE /api/letters/:id` — suppression (admin)

## Stockage

- `server/data/db.json` — base de données JSON (créée et peuplée automatiquement au premier lancement)
- `server/data/uploads/` — fichiers scannés des courriers (PDF / JPG / PNG)
