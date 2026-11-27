const express = require('express');
const { client } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Frais de livraison par commande (8 DT), modifiable via la variable Render SHIPPING_MILLIMES
const SHIPPING = Number(process.env.SHIPPING_MILLIMES || 8000);

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
    `Livraison : ${dt(SHIPPING)}`,
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
    `Livraison : ${dt(SHIPPING)}`,
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

// ---------- Notification WhatsApp (Green-API) ----------
// Variables Render : GREENAPI_ID, GREENAPI_TOKEN, GREENAPI_PHONE (ex. 21697565783), GREENAPI_URL (optionnel)
async function notifyGreenApi(order, items) {
  const id = process.env.GREENAPI_ID;
  const token = process.env.GREENAPI_TOKEN;
  // Plusieurs numéros possibles, séparés par des virgules
  const phones = (process.env.GREENAPI_PHONE || '').split(',').map(p => p.replace(/\D/g, '')).filter(Boolean);
  if (!id || !token || !phones.length) return;
  const base = (process.env.GREENAPI_URL || 'https://api.green-api.com').replace(/\/$/, '');
  const dt = (m) => (Number(m) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' DT';
  const message = [
    `*Nouvelle commande #${order.id}*`,
    ...items.map(i => `- ${i.product_name} x${i.quantity} : ${dt(i.unit_price_millimes * i.quantity)}`),
    `Livraison : ${dt(SHIPPING)}`,
    `Total : ${dt(order.total_millimes)} (paiement à la livraison)`,
    ``,
    `Nom : ${order.customer_name}`,
    `Tél : ${order.phone}`,
    `Adresse : ${order.address}, ${order.city}`,
  ].join('\n');
  for (const phone of phones) {
    try {
      const r = await fetch(`${base}/waInstance${id}/sendMessage/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: `${phone}@c.us`, message }),
      });
      if (!r.ok) console.error('Notification Green-API échouée :', phone, r.status, await r.text());
    } catch (err) {
      console.error('Notification Green-API échouée :', phone, err.message);
    }
  }
}

// ---------- Sécurité des notifications ----------
// Plafond global : au maximum 30 commandes notifiées par heure (évite qu'un robot
// fasse bannir le numéro WhatsApp en déclenchant des centaines de messages).
const notifLog = [];
function notifAllowed() {
  const now = Date.now();
  while (notifLog.length && now - notifLog[0] > 3600e3) notifLog.shift();
  if (notifLog.length >= 30) return false;
  notifLog.push(now); return true;
}
// Nettoie un texte saisi par le client : pas de caractères de contrôle, longueur limitée
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

router.post('/', async (req, res) => {
  const customer_name = clean(req.body.customer_name, 60);
  const city = clean(req.body.city, 40);
  const address = clean(req.body.address, 200);
  const phone = clean(req.body.phone, 20).replace(/[^\d+ ]/g, '');
  const { payment_method, items } = req.body;

  if (!customer_name || !phone || !city || !address) {
    return res.status(400).json({ error: 'Informations client incomplètes' });
  }
  if (customer_name.length < 2 || address.length < 5) {
    return res.status(400).json({ error: 'Nom ou adresse trop courts' });
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 13) {
    return res.status(400).json({ error: 'Numéro de téléphone invalide' });
  }
  if (Array.isArray(items) && (items.length > 20 || items.some(it => !Number.isInteger(Number(it?.quantity)) || Number(it.quantity) < 1 || Number(it.quantity) > 10))) {
    return res.status(400).json({ error: 'Panier invalide' });
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

      const d = Math.max(0, Math.min(90, Number(product.discount_percent) || 0));
      const unit = Math.round(product.price_millimes * (100 - d) / 100); // prix après promo
      total += unit * quantity;
      resolvedItems.push({ product, quantity, unit });
    }

    total += SHIPPING; // frais de livraison, une fois par commande

    const orderResult = await tx.execute({
      sql: `INSERT INTO orders (customer_name, phone, city, address, payment_method, total_millimes)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [customer_name, phone, city, address, payment_method, total],
    });
    const orderId = orderResult.lastInsertRowid;

    for (const { product, quantity, unit } of resolvedItems) {
      await tx.execute({
        sql: `INSERT INTO order_items (order_id, product_id, product_name, unit_price_millimes, quantity)
              VALUES (?, ?, ?, ?, ?)`,
        args: [orderId, product.id, product.name, unit, quantity],
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
    if (notifAllowed()) {
      notifyWhatsApp(order.rows[0], orderItems.rows);
      notifyNtfy(order.rows[0], orderItems.rows);
      notifyGreenApi(order.rows[0], orderItems.rows);
    } else console.warn('Plafond de notifications atteint : notification ignorée'); // n'attend pas : la réponse au client part tout de suite
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

// DELETE /api/orders/:id?restock=1 — supprimer une commande (admin)
// restock=1 : remet les articles de la commande en stock
router.delete('/:id', requireAdmin, async (req, res) => {
  const tx = await client.transaction('write');
  try {
    const order = await tx.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [req.params.id] });
    if (order.rows.length === 0) { await tx.rollback(); return res.status(404).json({ error: 'Commande introuvable' }); }
    if (req.query.restock === '1') {
      const items = await tx.execute({ sql: 'SELECT product_id, quantity FROM order_items WHERE order_id = ?', args: [req.params.id] });
      for (const it of items.rows) {
        if (it.product_id) await tx.execute({ sql: 'UPDATE products SET stock = stock + ? WHERE id = ?', args: [it.quantity, it.product_id] });
      }
    }
    await tx.execute({ sql: 'DELETE FROM order_items WHERE order_id = ?', args: [req.params.id] });
    await tx.execute({ sql: 'DELETE FROM orders WHERE id = ?', args: [req.params.id] });
    await tx.commit();
    res.json({ deleted: Number(req.params.id), restocked: req.query.restock === '1' });
  } catch (err) {
    await tx.rollback();
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
