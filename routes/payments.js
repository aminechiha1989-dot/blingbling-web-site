// Intégration Flouci (paiement en ligne tunisien : wallet Flouci, carte bancaire, eDinar).
// Doc officielle utilisée pour cette intégration : https://docs.flouci.com
const express = require('express');
const axios = require('axios');
const { client } = require('../db');

const router = express.Router();

const FLOUCI_BASE = 'https://developers.flouci.com/api/v2';

function flouciAuthHeader() {
  return `Bearer ${process.env.FLOUCI_PUBLIC_KEY}:${process.env.FLOUCI_PRIVATE_KEY}`;
}

// POST /api/payments/flouci/start  { order_id }
router.post('/flouci/start', async (req, res) => {
  const { order_id } = req.body;
  const orderResult = await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [order_id] });
  const order = orderResult.rows[0];

  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (order.payment_method !== 'online') {
    return res.status(400).json({ error: "Cette commande n'est pas en paiement en ligne" });
  }

  try {
    const { data } = await axios.post(
      `${FLOUCI_BASE}/generate_payment`,
      {
        amount: String(order.total_millimes),
        developer_tracking_id: String(order.id),
        accept_card: true,
        success_link: `${process.env.SITE_URL}/paiement/succes?order=${order.id}`,
        fail_link: `${process.env.SITE_URL}/paiement/echec?order=${order.id}`,
        webhook: `${process.env.SITE_URL.replace(/\/$/, '')}/api/payments/flouci/webhook`,
        client_id: order.customer_name,
      },
      { headers: { Authorization: flouciAuthHeader(), 'Content-Type': 'application/json' } }
    );

    if (!data?.result?.success) {
      return res.status(502).json({ error: 'Flouci a refusé la demande de paiement' });
    }

    await client.execute({
      sql: 'UPDATE orders SET flouci_payment_id = ? WHERE id = ?',
      args: [data.result.payment_id, order.id],
    });

    res.json({ payment_link: data.result.link, payment_id: data.result.payment_id });
  } catch (err) {
    console.error('Erreur Flouci generate_payment:', err.response?.data || err.message);
    res.status(502).json({ error: 'Impossible de contacter Flouci' });
  }
});

// GET /api/payments/flouci/verify/:paymentId
router.get('/flouci/verify/:paymentId', async (req, res) => {
  try {
    const { data } = await axios.get(
      `${FLOUCI_BASE}/verify_payment/${req.params.paymentId}`,
      { headers: { Authorization: flouciAuthHeader() } }
    );
    res.json(data);
  } catch (err) {
    console.error('Erreur Flouci verify_payment:', err.response?.data || err.message);
    res.status(502).json({ error: 'Impossible de vérifier le paiement' });
  }
});

// POST /api/payments/flouci/webhook
router.post('/flouci/webhook', async (req, res) => {
  const paymentId = req.body.payment_id || req.query.payment_id;
  if (!paymentId) return res.status(400).end();

  try {
    const { data } = await axios.get(
      `${FLOUCI_BASE}/verify_payment/${paymentId}`,
      { headers: { Authorization: flouciAuthHeader() } }
    );

    if (data?.success && data.result?.status === 'SUCCESS') {
      await client.execute({
        sql: "UPDATE orders SET payment_status = 'paid', status = 'confirmee' WHERE flouci_payment_id = ?",
        args: [paymentId],
      });
    } else if (data?.result?.status === 'FAILURE' || data?.result?.status === 'EXPIRED') {
      await client.execute({
        sql: "UPDATE orders SET payment_status = 'failed' WHERE flouci_payment_id = ?",
        args: [paymentId],
      });
    }

    res.status(200).end();
  } catch (err) {
    console.error('Erreur webhook Flouci:', err.response?.data || err.message);
    res.status(200).end();
  }
});

module.exports = router;
