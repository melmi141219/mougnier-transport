import { html, page, champ } from '../html.js';
import { verifierMotDePasse, hacherMotDePasse, ouvrirSession, fermerSession, lireCookie, cookieSession } from '../auth.js';

const ESSAIS_MAX = 5;
const FENETRE_MS = 15 * 60000;
// Pour un identifiant inconnu, on vérifie quand même un mot de passe : même durée de réponse.
const LEURRE = hacherMotDePasse('aucun compte ne porte ce mot de passe');

export function routesAuth(app, { db, https }) {
  const echecs = new Map(); // identifiant → heures des échecs récents (propre à cette application)
  const securise = req => https || req.get('x-forwarded-proto') === 'https';

  // En deux langues : personne n'est encore identifié, et les partenaires lisent l'anglais.
  const formulaire = (erreur = '') => page({
    titre: 'Connexion',
    contenu: html`${erreur ? html`<p class="alerte">${erreur}</p>` : ''}
      <form method="post" action="/connexion" class="carte etroit">
        ${champ('Identifiant / Username', 'identifiant', '', { requis: true })}
        ${champ('Mot de passe / Password', 'mot_de_passe', '', { type: 'password', requis: true })}
        <button class="bouton">Se connecter / Sign in</button>
      </form>`,
  });

  app.get('/connexion', (req, res) => res.send(formulaire()));

  app.post('/connexion', (req, res) => {
    const identifiant = String(req.body.identifiant ?? '').trim().toLowerCase();
    const maintenant = Date.now();
    const recents = (echecs.get(identifiant) ?? []).filter(t => maintenant - t < FENETRE_MS);
    if (recents.length >= ESSAIS_MAX)
      return res.status(429).send(formulaire('Trop d’essais, réessayez dans 15 minutes. / Too many attempts, try again in 15 minutes.'));

    const utilisateur = db.prepare('SELECT id, mot_de_passe FROM utilisateurs WHERE identifiant = ? AND actif = 1').get(identifiant);
    const bon = verifierMotDePasse(String(req.body.mot_de_passe ?? ''), utilisateur?.mot_de_passe ?? LEURRE);
    if (!utilisateur || !bon) {
      if (echecs.size > 1000) echecs.clear(); // borne la mémoire
      echecs.set(identifiant, [...recents, maintenant]);
      return res.status(401).send(formulaire('Identifiant ou mot de passe incorrect. / Wrong username or password.'));
    }
    echecs.delete(identifiant);
    res.setHeader('Set-Cookie', cookieSession(ouvrirSession(db, utilisateur.id), securise(req)));
    res.redirect(302, '/');
  });

  app.post('/deconnexion', (req, res) => {
    fermerSession(db, lireCookie(req, 'mt_session'));
    res.setHeader('Set-Cookie', cookieSession('', securise(req)));
    res.redirect(302, '/connexion');
  });
}
