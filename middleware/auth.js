// Protection simple des routes admin : on exige un header
//   Authorization: Bearer <ADMIN_KEY>
// Suffisant pour une seule personne qui gère la boutique. Si plusieurs personnes
// doivent se connecter avec des comptes séparés plus tard, il faudra passer à un
// vrai système d'utilisateurs (mots de passe hashés + sessions ou JWT par personne).
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || token !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

module.exports = { requireAdmin };
