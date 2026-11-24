const express = require('express');
const { client } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /api/orders — créer une commande depuis le site
// ---------- Notification WhatsApp (CallMeBot) ----------
// Variables Render : WHATSAPP_NOTIFY_PHONE (ex. 21650202054) et CALLMEBOT_APIKEY
async function notifyWhatsApp(order, items) {
  const phone = process.env.WHATSAPP_NOTIFY_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) return;
  const dt = (m) => (Number(m) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' DT';
  const lines = items.map(i => `- ${i.product_name} x${i.quantity} : ${dt(i.unit_price_millimes * i.quantity)}`);
  const text = [
    `🛍️ Nouvelle commande #${order.id}`,
    ...lines,
    `Total : ${dt(order.total_millimes)} (paiement à la livraison)`,
    ``,
    `👤 ${order.customer_name}`,
    `📞 ${order.phone}`,
    `📍 ${order.address}, ${order.city}`,
  ].join('\n');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) console.error('Notification WhatsApp échouée :', r.status, await r.text());
  } catch (err) {
    console.error('Notification WhatsApp échouée :', err.message);
  }
}

// ---------- Notification sur le téléphone (ntfy) ----------
// Variable Render : NTFY_TOPIC (nom secret, ne jamais le mettre dans le code : le dépôt est public)
async function notifyNtfy(order, items) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const dt = (m) => (Number(m) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' DT';
  const body = [
    ...items.map(i => `• ${i.product_name} x${i.quantity} : ${dt(i.unit_price_millimes * i.quantity)}`),
    `Total : ${dt(order.total_millimes)} (paiement à la livraison)`,
    ``,
    `Nom : ${order.customer_name}`,
    `Tél : ${order.phone}`,
    `Adresse : ${order.address}, ${order.city}`,
  ].join('\n');
  try {
    const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        ...(process.env.NTFY_TOKEN ? { 'Authorization': `Bearer ${process.env.NTFY_TOKEN}` } : {}),
        'Title': `Nouvelle commande #${order.id} - ${dt(order.total_millimes)}`,
        'Priority': 'high',
        'Tags': 'shopping_bags',
      },
      body,
    });
    if (!r.ok) console.error('Notification ntfy échouée :', r.status);
  } catch (err) {
    console.error('Notification ntfy échouée :', err.message);
  }
}

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
    notifyWhatsApp(order.rows[0], orderItems.rows);
    notifyNtfy(order.rows[0], orderItems.rows); // n'attend pas : la réponse au client part tout de suite
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
