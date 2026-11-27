// Protection simple des routes admin : on exige un header
//   Authorization: Bearer <ADMIN_KEY>
// Suffisant pour une seule personne qui gère la boutique. Si plusieurs personnes
// doivent se connecter avec des comptes séparés plus tard, il faudra passer à un
// vrai système d'utilisateurs (mots de passe hashés + sessions ou JWT par personne).
const crypto = require('crypto');

// Anti force brute : après 10 clés fausses en 15 min, l'adresse IP est bloquée 15 min
const fails = new Map();
const WINDOW = 15 * 60 * 1000, MAX_FAILS = 10;

function sameKey(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y); // comparaison à temps constant
}

function requireAdmin(req, res, next) {
  const ip = req.ip || 'inconnu';
  const now = Date.now();
  const f = fails.get(ip);
  if (f && now - f.first < WINDOW && f.count >= MAX_FAILS) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || !process.env.ADMIN_KEY || !sameKey(token, process.env.ADMIN_KEY)) {
    const cur = f && now - f.first < WINDOW ? f : { first: now, count: 0 };
    cur.count++; fails.set(ip, cur);
    return res.status(401).json({ error: 'Non autorisé' });
  }
  fails.delete(ip);
  next();
}

module.exports = { requireAdmin };
