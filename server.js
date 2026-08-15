require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { initDb } = require('./index');
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
