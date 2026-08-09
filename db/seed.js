// Ajoute quelques produits d'exemple. Lance avec: npm run seed
require('dotenv').config();
const { client, initDb } = require('./index');

const produits = [
  { name: 'Sac Camille', description: 'Simili cuir, 3 coloris', price_millimes: 89000, category: 'sacs', image_url: '', stock: 12, is_live: 1 },
  { name: 'Veste Jasmine', description: 'Édition limitée', price_millimes: 210000, category: 'pret-a-porter', image_url: '', stock: 5, is_live: 0 },
  { name: 'Boucles Lune', description: 'Plaqué or 18k', price_millimes: 38000, category: 'bijoux', image_url: '', stock: 30, is_live: 0 },
];

async function main() {
  await initDb();
  for (const p of produits) {
    await client.execute({
      sql: `INSERT INTO products (name, description, price_millimes, category, image_url, stock, is_live)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [p.name, p.description, p.price_millimes, p.category, p.image_url, p.stock, p.is_live],
    });
  }
  console.log(`${produits.length} produits ajoutés.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
