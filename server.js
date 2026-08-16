require('dotenv').config();
const TIKTOK_USERNAME = 'amoulette.soltani';

async function checkTikTokLiveStatus() {
  try {
    const res = await fetch(
      `https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${TIKTOK_USERNAME}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
    );
    const data = await res.json();
    const isLive = data?.data?.liveRoom?.status === 2;
    const { client } = require('./db');
    await client.execute({
      sql: `UPDATE site_status SET is_live = ?, updated_at = datetime('now') WHERE id = 1`,
      args: [isLive ? 1 : 0],
    });
  } catch (err) {
    console.error('Vérification TikTok live échouée :', err.message);
  }
}

// Vérifie toutes les 60 secondes, + une fois tout de suite au démarrage
setInterval(checkTikTokLiveStatus, 60000);
checkTikTokLiveStatus();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { initDb } = require('./db');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const paymentsRouter = require('./routes/payments');
const liveStatusRouter = require('./routes/live-status');

const app = express();

app.use(cors());
app.use(express.json());

const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
app.use('/api/orders', orderLimiter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/live-status', liveStatusRouter);
app.use('/api/site-settings', require('./routes/site-settings'));
app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

const PORT = process.env.PORT || 4000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Backend boutique lancé sur http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Impossible d\'initialiser la base Turso :', err);
    process.exit(1);
  });
