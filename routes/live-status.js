const express = require('express');
const { client } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/live-status — public, consulté par le site pour savoir s'il doit
// faire clignoter le bouton TikTok.
router.get('/', async (req, res) => {
  try {
    const result = await client.execute({
      sql: 'SELECT is_live FROM site_status WHERE id = 1',
      args: [],
    });
    const isLive = result.rows.length ? !!result.rows[0].is_live : false;
    res.json({ is_live: isLive });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/live-status — protégé, basculé depuis la page admin.
// Body attendu : { "is_live": true } ou { "is_live": false }
router.patch('/', requireAdmin, async (req, res) => {
  const isLive = req.body.is_live ? 1 : 0;
  try {
    await client.execute({
      sql: `UPDATE site_status SET is_live = ?, updated_at = datetime('now') WHERE id = 1`,
      args: [isLive],
    });
    res.json({ is_live: !!isLive });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
