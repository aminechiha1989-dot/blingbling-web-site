require('dotenv').config();
// Comptes TikTok surveillés (séparés par des virgules), modifiable via la variable Render TIKTOK_ACCOUNTS
const TIKTOK_ACCOUNTS = (process.env.TIKTOK_ACCOUNTS || 'amoulette.soltani')
  .split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean);

async function isAccountLive(user) {
  const res = await fetch(
    `https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(user)}`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
  );
  const data = await res.json();
  return data?.data?.liveRoom?.status === 2;
}

// Détection automatique : le 1er compte trouvé en live est enregistré
async function checkTikTokLiveStatus() {
  let liveAccount = '';
  for (const user of TIKTOK_ACCOUNTS) {
    try {
      if (await isAccountLive(user)) { liveAccount = user; break; }
    } catch (err) {
      console.error(`Vérification TikTok live échouée (${user}) :`, err.message);
    }
  }
  try {
    const { client } = require('./db');
    await client.execute({
      sql: `UPDATE site_status SET auto_live = ?, live_account = ?, updated_at = datetime('now') WHERE id = 1`,
      args: [liveAccount ? 1 : 0, liveAccount],
    });
  } catch (err) {
    console.error('Enregistrement du statut live échoué :', err.message);
  }
}

// Vérifie toutes les 60 secondes (après le démarrage de la base)
setInterval(checkTikTokLiveStatus, 60000);
setTimeout(checkTikTokLiveStatus, 8000);
module.exports.TIKTOK_ACCOUNTS = TIKTOK_ACCOUNTS;
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { initDb } = require('./db');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const paymentsRouter = require('./routes/payments');
const liveStatusRouter = require('./routes/live-status');

const app = express();

app.set('trust proxy', 1); // Render : vraie adresse IP du visiteur pour les limites
app.disable('x-powered-by');
app.use((req, res, next) => { // en-têtes de sécurité de base
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  next();
});
app.use(cors());
app.use(express.json({ limit: '200kb' }));

const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
app.use('/api/orders', orderLimiter);
// Création de commandes : 5 par quart d'heure et par visiteur (anti-spam)
const newOrderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Trop de commandes en peu de temps. Réessaie plus tard ou contacte-nous sur WhatsApp.' } });
app.post('/api/orders', newOrderLimiter);

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
