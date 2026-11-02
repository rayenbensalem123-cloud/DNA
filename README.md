# Bureau Ordre — Plateforme de registre officiel

Plateforme web de gestion du **bureau d'ordre** : enregistrement des lettres officielles
de l'office ainsi que de **tout ce qui est reçu** dans l'office.

## Fonctionnalités

- 🔐 **Authentification** (comptes démo + rôles : admin / agent / lecteur)
- 📋 **Tableau de bord** : statistiques (correspondances, reçus, envoyés, en attente, archivés, urgentes), répartition par catégorie / statut
- 📄 **Lettres officielles** : registre complet avec filtres (direction, statut, type, catégorie, priorité, recherche, dates)
- 📨 **Tout ce qui est reçu** : formulaire d'enregistrement des courriers reçus + suivi du workflow
- 🔄 **Workflow** : reçu → enregistré → en cours → traité → transmis → archivé

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
- `GET  /api/stats` — statistiques
- `GET  /api/letters` — liste avec filtres (`q`, `direction`, `statut`, `type`, `categorie`, `priorite`, `from`, `to`, `sort`, `page`, `limit`)
- `POST /api/letters` — création (rôle admin/agent)
- `GET  /api/letters/:id` — détail
- `PATCH /api/letters/:id` — mise à jour / changement de statut
- `DELETE /api/letters/:id` — suppression (admin)
