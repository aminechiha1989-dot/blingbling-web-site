const express = require('express');
const { client } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /api/orders — créer une commande depuis le site
router.post('/', async (req, res) => {
  const { customer_name, phone, city, address, payment_method, items } = req.body;

  if (!customer_name || !phone || !city || !address) {
    return res.status(400).json({ error: 'Informations client incomplètes' });
  }
  if (!['cod', 'online'].includes(payment_method)) {
    return res.status(400).json({ error: 'payment_method doit être "cod" ou "online"' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Le panier est vide' });
  }

  // Transaction interactive : soit tout passe (commande + stock mis à jour), soit rien.
  const tx = await client.transaction('write');

  try {
    let total = 0;
    const resolvedItems = [];

    // On revérifie stock et prix côté serveur : jamais confiance au navigateur.
    for (const { product_id, quantity } of items) {
      const result = await tx.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [product_id] });
      const product = result.rows[0];
      if (!product) throw new Error(`Produit ${product_id} introuvable`);
      if (product.stock < quantity) throw new Error(`Stock insuffisant pour ${product.name}`);

      total += product.price_millimes * quantity;
      resolvedItems.push({ product, quantity });
    }

    const orderResult = await tx.execute({
      sql: `INSERT INTO orders (customer_name, phone, city, address, payment_method, total_millimes)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [customer_name, phone, city, address, payment_method, total],
    });
    const orderId = orderResult.lastInsertRowid;

    for (const { product, quantity } of resolvedItems) {
      await tx.execute({
        sql: `INSERT INTO order_items (order_id, product_id, product_name, unit_price_millimes, quantity)
              VALUES (?, ?, ?, ?, ?)`,
        args: [orderId, product.id, product.name, product.price_millimes, quantity],
      });
      await tx.execute({
        sql: 'UPDATE products SET stock = stock - ? WHERE id = ?',
        args: [quantity, product.id],
      });
    }

    await tx.commit();

    const order = await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [orderId] });
    const orderItems = await client.execute({ sql: 'SELECT * FROM order_items WHERE order_id = ?', args: [orderId] });
    res.status(201).json({ ...order.rows[0], items: orderItems.rows });
  } catch (err) {
    await tx.rollback();
    res.status(400).json({ error: err.message });
  }
});

// GET /api/orders/:id — suivi d'une commande
router.get('/:id', async (req, res) => {
  const order = await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [req.params.id] });
  if (order.rows.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  const items = await client.execute({ sql: 'SELECT * FROM order_items WHERE order_id = ?', args: [req.params.id] });
  res.json({ ...order.rows[0], items: items.rows });
});

// --- Routes admin ---

router.get('/', requireAdmin, async (req, res) => {
  const { status } = req.query;
  const result = status
    ? await client.execute({ sql: 'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC', args: [status] })
    : await client.execute('SELECT * FROM orders ORDER BY created_at DESC');
  res.json(result.rows);
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const allowed = ['nouvelle', 'confirmee', 'expediee', 'livree', 'annulee'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status doit être l'un de : ${allowed.join(', ')}` });
  }
  const result = await client.execute({ sql: 'UPDATE orders SET status = ? WHERE id = ?', args: [status, req.params.id] });
  if (result.rowsAffected === 0) return res.status(404).json({ error: 'Commande introuvable' });
  const updated = await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [req.params.id] });
  res.json(updated.rows[0]);
});

module.exports = router;
