const express = require('express');
const { client } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/products — catalogue public, avec filtres optionnels
router.get('/', async (req, res) => {
  const { category, live, search } = req.query;

  let sql = 'SELECT * FROM products WHERE stock > 0';
  const args = [];

  if (category) { sql += ' AND category = ?'; args.push(category); }
  if (live === '1') { sql += ' AND is_live = 1'; }
  if (search) { sql += ' AND name LIKE ?'; args.push(`%${search}%`); }
  sql += ' ORDER BY created_at DESC';

  try {
    const result = await client.execute({ sql, args });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  const result = await client.execute({
    sql: 'SELECT * FROM products WHERE id = ?',
    args: [req.params.id],
  });
  if (result.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable' });
  res.json(result.rows[0]);
});

// --- Routes admin (protégées) ---

router.post('/', requireAdmin, async (req, res) => {
  const { name, description = '', price_millimes, category = '', image_url = '', stock = 0, is_live = 0 } = req.body;

  if (!name || !price_millimes) {
    return res.status(400).json({ error: 'name et price_millimes sont requis' });
  }

  const result = await client.execute({
    sql: `INSERT INTO products (name, description, price_millimes, category, image_url, stock, is_live)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [name, description, price_millimes, category, image_url, stock, is_live ? 1 : 0],
  });

  const created = await client.execute({
    sql: 'SELECT * FROM products WHERE id = ?',
    args: [result.lastInsertRowid],
  });
  res.status(201).json(created.rows[0]);
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const existing = await client.execute({
    sql: 'SELECT * FROM products WHERE id = ?',
    args: [req.params.id],
  });
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable' });

  const fields = ['name', 'description', 'price_millimes', 'category', 'image_url', 'stock', 'is_live'];
  const sets = [];
  const args = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      sets.push(`${field} = ?`);
      args.push(field === 'is_live' ? (req.body[field] ? 1 : 0) : req.body[field]);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

  args.push(req.params.id);
  await client.execute({ sql: `UPDATE products SET ${sets.join(', ')} WHERE id = ?`, args });

  const updated = await client.execute({
    sql: 'SELECT * FROM products WHERE id = ?',
    args: [req.params.id],
  });
  res.json(updated.rows[0]);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const result = await client.execute({
    sql: 'DELETE FROM products WHERE id = ?',
    args: [req.params.id],
  });
  if (result.rowsAffected === 0) return res.status(404).json({ error: 'Produit introuvable' });
  res.status(204).send();
});

module.exports = router;
