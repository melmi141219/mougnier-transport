import express from 'express';
import { fileURLToPath } from 'node:url';
import { aujourdHui } from './format.js';
import { html, page, pagePartenaire } from './html.js';
import { exigerConnexion, cloisonnerPartenaires, estPartenaire, verifierOrigine } from './auth.js';
import { Refus } from './saisie.js';
import { routesAuth } from './routes/auth.js';
import { routesAujourdhui } from './routes/aujourdhui.js';
import { routesClients } from './routes/clients.js';
import { routesVehicules } from './routes/vehicules.js';
import { routesArgent } from './routes/argent.js';
import { routesDocuments } from './routes/documents.js';
import { routesConteneurs } from './routes/conteneurs.js';
import { routesCatalogue } from './routes/catalogue.js';
import { routesAdmin } from './routes/admin.js';
import { routesMarges } from './routes/marges.js';
import { routesMatelas } from './routes/matelas.js';
import { routesPartenaire } from './routes/partenaire.js';
import { routesFichiers } from './routes/fichiers.js';
import { routesPartenaires } from './routes/partenaires.js';

const DOSSIER_PUBLIC = fileURLToPath(new URL('../public', import.meta.url));

// horloge() donne la date du jour à toutes les routes : aucune ne la lit dans la requête.
// routesEnPlus(app, contexte) sert aux tests : des routes ajoutées après celles de la plateforme.
export function creerApp(db, { https = false, horloge = aujourdHui, dossierSauvegardes = null, dossierFichiers = null, routesEnPlus = null } = {}) {
  const app = express();
  const contexte = { db, https, horloge, dossierSauvegardes, dossierFichiers };
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.static(DOSSIER_PUBLIC, { index: false }));
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }); // pages avec des montants
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use((req, res, next) => { req.body ??= {}; next(); });
  app.use(verifierOrigine);

  routesAuth(app, contexte);

  app.use(exigerConnexion(db));
  app.use((req, res, next) => {
    const anglais = estPartenaire(req.utilisateur); // tout ce qu'un partenaire lit est en anglais, dans sa mise en page
    res.page = (titre, contenu, { actif = '', statut = 200 } = {}) =>
      res.status(statut).send((anglais ? pagePartenaire : page)({ titre, utilisateur: req.utilisateur, actif, contenu }));
    res.refuser = (statut, message) => res.page(anglais ? 'Action not possible' : 'Action impossible',
      html`<p class="alerte">${message}</p><p><button type="button" class="bouton secondaire" data-retour>${anglais ? 'Back' : 'Retour'}</button></p>`,
      { statut });
    next();
  });
  app.use(cloisonnerPartenaires); // avant toute route : aucune n'a à penser aux partenaires

  routesAujourdhui(app, contexte);
  routesClients(app, contexte);
  routesVehicules(app, contexte);
  routesArgent(app, contexte);
  routesConteneurs(app, contexte);
  routesCatalogue(app, contexte);
  routesAdmin(app, contexte);
  routesMarges(app, contexte);
  routesMatelas(app, contexte);
  routesDocuments(app, contexte);
  routesPartenaires(app, contexte);
  routesPartenaire(app, contexte);
  routesFichiers(app, contexte);
  routesEnPlus?.(app, contexte);

  app.use((req, res) => res.refuser(404, estPartenaire(req.utilisateur) ? 'This page does not exist.' : 'Cette page n’existe pas.'));
  // eslint-disable-next-line no-unused-vars
  app.use((erreur, req, res, next) => {
    if (erreur instanceof Refus && res.refuser) return res.refuser(erreur.statut, erreur.message);
    if (erreur.type === 'entity.too.large') { // fichier ou formulaire au-delà de la limite : un refus, pas une panne
      const trop = estPartenaire(req.utilisateur) ? 'Upload too large. Nothing was saved.' : 'Envoi trop volumineux : rien n’a été enregistré.';
      return res.refuser ? res.refuser(413, trop) : res.status(413).type('text/plain').send(trop);
    }
    console.error(erreur);
    const message = estPartenaire(req.utilisateur) ? 'Something went wrong. Nothing was saved.' : 'Une erreur est survenue. Rien n’a été enregistré.';
    if (res.refuser) res.refuser(500, message); else res.status(500).type('text/plain').send(message);
  });
  return app;
}
