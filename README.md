# Backend boutique — Atelier Lune

API pour gérer les produits, les commandes, le paiement à la livraison et le paiement en ligne (Flouci).

## Stack

- **Node.js + Express** — serveur API
- **Turso** — base de données SQLite hébergée dans le cloud (gratuite, persistante, aucune carte requise)
- **Flouci** — paiement en ligne (wallet, carte bancaire, eDinar)

## Installation

### 1. Créer la base Turso (gratuit)
```bash
curl -sSfL https://get.tur.so/install.sh | bash   # installe la CLI Turso
turso auth signup                                  # ou "turso auth login" si tu as déjà un compte
turso db create boutique
turso db show boutique --url                        # copie cette URL
turso db tokens create boutique                     # copie ce token
```

### 2. Configurer le projet
```bash
cd ecommerce-backend
npm install
cp .env.example .env
```

Ouvre `.env` et remplis :
- `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` : récupérés à l'étape 1.
- `ADMIN_KEY` : invente une longue chaîne aléatoire — c'est le "mot de passe" qui protège tes routes admin.
- `FLOUCI_PUBLIC_KEY` / `FLOUCI_PRIVATE_KEY` : récupérées sur https://fr.flouci.com/business → compte Developer API (des clés de test sont fournies pour développer avant d'activer le mode réel).
- `SITE_URL` : l'adresse de ton site (en local : `http://localhost:5173` si tu utilises un frontend séparé).

Ajoute quelques produits de démo :
```bash
npm run seed
```

Lance le serveur :
```bash
npm run dev
```

Le serveur tourne sur `http://localhost:4000`.

## Endpoints principaux

### Publics (utilisés par le site)
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/products` | Liste des produits (filtres `?category=`, `?live=1`, `?search=`) |
| GET | `/api/products/:id` | Fiche produit |
| POST | `/api/orders` | Créer une commande (voir format ci-dessous) |
| GET | `/api/orders/:id` | Suivre une commande |
| POST | `/api/payments/flouci/start` | Démarrer un paiement en ligne pour une commande |

### Admin (nécessitent le header `Authorization: Bearer <ADMIN_KEY>`)
| Méthode | Route | Description |
|---|---|---|
| POST | `/api/products` | Ajouter un produit |
| PATCH | `/api/products/:id` | Modifier (prix, stock, badge "vu en live"...) |
| DELETE | `/api/products/:id` | Supprimer un produit |
| GET | `/api/orders` | Liste des commandes (filtre `?status=`) |
| PATCH | `/api/orders/:id` | Changer le statut d'une commande |

## Créer une commande (exemple)

```bash
curl -X POST http://localhost:4000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Sarra Ben Ali",
    "phone": "20123456",
    "city": "Sfax",
    "address": "12 rue des Oliviers",
    "payment_method": "online",
    "items": [{ "product_id": 1, "quantity": 1 }]
  }'
```

Si `payment_method` est `"online"`, appelle ensuite :

```bash
curl -X POST http://localhost:4000/api/payments/flouci/start \
  -H "Content-Type: application/json" \
  -d '{ "order_id": 1 }'
```

Ça renvoie un `payment_link` : redirige ta cliente vers ce lien pour qu'elle paie sur la page Flouci. Une fois payé, Flouci appelle ton webhook automatiquement et la commande passe en `payment_status: "paid"`.

Si `payment_method` est `"cod"` (paiement à la livraison), la commande est simplement créée et tu la gères depuis ton admin — pas d'étape de paiement en ligne.

## Prix en millimes

Tous les prix sont stockés en **millimes** (1 dinar = 1000 millimes) pour éviter les erreurs d'arrondi avec les nombres décimaux. `89000` = 89,000 DT. Fais bien la conversion côté frontend pour l'affichage (÷1000) et à l'envoi (×1000).

## Prochaines étapes suggérées

1. **Héberger le backend** : Railway, Render ou un petit VPS (OVH/Cloudinary Tunisie). SQLite fonctionne bien tant qu'il n'y a qu'un seul serveur.
2. **Photos produits** : brancher un service de stockage (Cloudinary, S3) plutôt que de stocker les images sur le serveur.
3. **Notifications** : envoyer un SMS/WhatsApp automatique à la cliente à la confirmation de commande (ex: via une API comme Twilio ou un fournisseur local).
4. **Frontend** : connecter ce backend à la maquette du site (remplacer les produits statiques par des appels à `/api/products`, brancher le formulaire de commande sur `/api/orders`).
5. **Passer en production Flouci** : suivre "Go Live" dans leur doc pour activer tes clés réelles une fois les tests validés.
