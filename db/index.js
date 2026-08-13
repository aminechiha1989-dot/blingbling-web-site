// Connexion à la base Turso (SQLite hébergé dans le cloud, données persistantes).
const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Crée les tables si elles n'existent pas encore. Appelée une fois au démarrage
// du serveur (voir server.js) — le client Turso étant asynchrone, on ne peut plus
// créer les tables de façon synchrone comme avec better-sqlite3.
async function initDb() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price_millimes INTEGER NOT NULL,
      category TEXT,
      image_url TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      is_live INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT NOT NULL,
      address TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cod', 'online')),
      payment_status TEXT NOT NULL DEFAULT 'pending',
      flouci_payment_id TEXT,
      total_millimes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'nouvelle',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit_price_millimes INTEGER NOT NULL,
      quantity INTEGER NOT NULL
    )
  `);

  // Statut "live en cours" — une seule ligne (id=1) que l'admin bascule
  // depuis la page admin. Le site public la consulte pour faire clignoter
  // le bouton TikTok.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS site_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      is_live INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await client.execute(`
    INSERT OR IGNORE INTO site_status (id, is_live) VALUES (1, 0)
  `);
}

module.exports = { client, initDb };
