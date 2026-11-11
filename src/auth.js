// Mots de passe (scrypt), sessions et contrôles d'accès.
import crypto from 'node:crypto';

const DUREE_SESSION_JOURS = 30;
// Les partenaires en Corée : ils n'atteignent que leur espace, en anglais (voir cloisonnerPartenaires).
export const ROLES_PARTENAIRES = ['fournisseur', 'transporteur'];
const ROLES = ['admin', 'collaborateur', ...ROLES_PARTENAIRES];
export const estPartenaire = utilisateur => ROLES_PARTENAIRES.includes(utilisateur?.role);

export function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16);
  return `scrypt$${sel.toString('hex')}$${crypto.scryptSync(String(motDePasse), sel, 64).toString('hex')}`;
}

export function verifierMotDePasse(motDePasse, stocke) {
  const [algo, sel, hache] = String(stocke).split('$');
  if (algo !== 'scrypt' || !sel || !hache) return false;
  const attendu = Buffer.from(hache, 'hex');
  const calcule = crypto.scryptSync(String(motDePasse), Buffer.from(sel, 'hex'), attendu.length);
  return crypto.timingSafeEqual(calcule, attendu);
}

export function validerMotDePasse(motDePasse, anglais = false) {
  if (typeof motDePasse !== 'string' || motDePasse.length < 10)
    throw new Error(anglais ? 'The password must be at least 10 characters long.' : 'Le mot de passe doit faire au moins 10 caractères.');
}

export function creerUtilisateur(db, { identifiant, nom, role, motDePasse }) {
  validerMotDePasse(motDePasse);
  const id = String(identifiant ?? '').trim().toLowerCase();
  if (!id || !String(nom ?? '').trim()) throw new Error('Identifiant et nom sont obligatoires.');
  if (!ROLES.includes(role)) throw new Error('Rôle inconnu.');
  if (db.prepare('SELECT 1 FROM utilisateurs WHERE identifiant = ?').get(id)) throw new Error('Cet identifiant existe déjà.');
  return Number(db.prepare('INSERT INTO utilisateurs (identifiant, nom, role, mot_de_passe) VALUES (?, ?, ?, ?)')
    .run(id, String(nom).trim(), role, hacherMotDePasse(motDePasse)).lastInsertRowid);
}

// La base ne garde que l'empreinte du jeton : une sauvegarde volée ne donne pas de session.
const empreinte = jeton => crypto.createHash('sha256').update(String(jeton)).digest('hex');

export function ouvrirSession(db, utilisateurId) {
  const jeton = crypto.randomBytes(32).toString('hex');
  const expire = new Date(Date.now() + DUREE_SESSION_JOURS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (jeton, utilisateur_id, expire_le) VALUES (?, ?, ?)').run(empreinte(jeton), utilisateurId, expire);
  return jeton;
}

export function fermerSession(db, jeton) {
  if (jeton) db.prepare('DELETE FROM sessions WHERE jeton = ?').run(empreinte(jeton));
}

// Après un changement de mot de passe : seule la session de l'appareil en cours reste ouverte.
export function fermerAutresSessions(db, req) {
  db.prepare('DELETE FROM sessions WHERE utilisateur_id = ? AND jeton <> ?')
    .run(req.utilisateur.id, empreinte(lireCookie(req, 'mt_session')));
}

export function lireCookie(req, nom) {
  for (const morceau of String(req.headers.cookie ?? '').split(';')) {
    const [cle, ...valeur] = morceau.trim().split('=');
    if (cle === nom) return valeur.join('=');
  }
  return null;
}

export function cookieSession(jeton, securise) {
  return `mt_session=${jeton}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${jeton ? DUREE_SESSION_JOURS * 86400 : 0}${securise ? '; Secure' : ''}`;
}

export function exigerConnexion(db) {
  const chercher = db.prepare(`
    SELECT u.id, u.identifiant, u.nom, u.role FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id
    WHERE s.jeton = ? AND s.expire_le > ? AND u.actif = 1`);
  return (req, res, next) => {
    const jeton = lireCookie(req, 'mt_session');
    const utilisateur = jeton ? chercher.get(empreinte(jeton), new Date().toISOString()) : null;
    if (!utilisateur) return res.redirect(302, '/connexion');
    req.utilisateur = utilisateur;
    next();
  };
}

// Refus par défaut, à monter avant toute route : un partenaire n'atteint que son espace (/partenaire…), les fichiers
// (/fichiers/…), son mot de passe et la déconnexion. Une route ajoutée plus tard lui est donc refusée sans qu'on y pense.
// Dans l'autre sens, un compte interne n'entre pas dans l'espace partenaire.
export function cloisonnerPartenaires(req, res, next) {
  // Express ne tient compte ni de la casse ni d'une barre finale : on compare l'adresse comme lui.
  const adresse = req.path.toLowerCase();
  const chemin = adresse.length > 1 && adresse.endsWith('/') ? adresse.slice(0, -1) : adresse;
  const espacePartenaire = chemin === '/partenaire' || chemin.startsWith('/partenaire/'); // /partenaires, avec un s, est une page interne
  if (!estPartenaire(req.utilisateur))
    return espacePartenaire ? res.refuser(403, 'Cette page est réservée aux partenaires.') : next();
  const lecture = req.method === 'GET' || req.method === 'HEAD';
  // Sous /fichiers/, un partenaire ne fait que lire : une action interne ajoutée là plus tard lui reste fermée.
  if (espacePartenaire || (chemin.startsWith('/fichiers/') && lecture) || chemin === '/mon-mot-de-passe' || chemin === '/deconnexion') return next();
  if (chemin === '/' && lecture) return res.redirect(302, '/partenaire');
  res.refuser(403, 'You do not have access to this page.');
}

// Dans l'espace partenaire, chaque page est réservée à un seul des deux rôles partenaires.
export const exigerRole = role => (req, res, next) =>
  req.utilisateur?.role === role ? next() : res.refuser(403, 'You do not have access to this page.');

export function exigerAdmin(req, res, next) {
  if (req.utilisateur?.role !== 'admin') return res.refuser(403, 'Cette action est réservée à l’administrateur.');
  next();
}

// Refuse un formulaire envoyé depuis un autre site (en plus du cookie SameSite=Strict).
export function verifierOrigine(req, res, next) {
  const origine = req.get('origin');
  if (req.method === 'GET' || req.method === 'HEAD' || !origine) return next();
  let hote = null;
  try { hote = new URL(origine).host; } catch { /* origine illisible : refus */ }
  if (hote && (hote === req.get('host') || hote === req.get('x-forwarded-host'))) return next();
  res.status(403).type('text/plain').send('Requête refusée : elle ne vient pas de la plateforme.');
}
