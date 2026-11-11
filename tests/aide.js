// Démarre l'application sur une base en mémoire, avec un admin (eric), une collaboratrice (collab),
// un fournisseur (ayaan) et un transporteur (george).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { ouvrirBase } from '../src/db.js';
import { creerApp } from '../src/app.js';
import { hacherMotDePasse, ouvrirSession } from '../src/auth.js';
import { chargerDonnees } from '../scripts/charger-donnees.js';

// scrypt est volontairement lent : on ne hache qu'une fois par fichier de tests.
const COMPTES = [
  ['eric', 'Eric', 'admin', hacherMotDePasse('motdepasse-admin'), 'admin'],
  ['collab', 'Collaborateur', 'collaborateur', hacherMotDePasse('motdepasse-collab'), 'collab'],
  ['ayaan', 'Ayaan', 'fournisseur', hacherMotDePasse('motdepasse-ayaan'), 'ayaan'],
  ['george', 'George', 'transporteur', hacherMotDePasse('motdepasse-george'), 'george'],
];

export async function demarrer({ donnees = false, routesEnPlus = null } = {}) {
  const db = ouvrirBase(':memory:');
  if (donnees) chargerDonnees(db, { date: '2026-11-10' });
  const s = { db, aujourdhui: '2026-11-10', dossierFichiers: fs.mkdtempSync(path.join(os.tmpdir(), 'mt-fichiers-')) };
  const creer = db.prepare('INSERT INTO utilisateurs (identifiant, nom, role, mot_de_passe) VALUES (?, ?, ?, ?)');
  for (const [identifiant, nom, role, hache, cle] of COMPTES) {
    const id = Number(creer.run(identifiant, nom, role, hache).lastInsertRowid);
    s[cle] = `mt_session=${ouvrirSession(db, id)}`;
    s[`${cle}Id`] = id;
  }

  const serveur = creerApp(db, { horloge: () => s.aujourdhui, dossierFichiers: s.dossierFichiers, routesEnPlus }).listen(0, '127.0.0.1');
  await once(serveur, 'listening');
  serveur.unref(); // un test qui échoue avant fermer() ne doit pas bloquer la fin des tests
  s.url = `http://127.0.0.1:${serveur.address().port}`;
  s.get = (chemin, cookie) => fetch(s.url + chemin, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  s.post = (chemin, champs = {}, cookie) => fetch(s.url + chemin, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams(champs),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: s.url, ...(cookie ? { cookie } : {}) },
  });
  // Dépôt d'un fichier : corps brut, comme le fait public/depot.js
  s.deposer = (chemin, contenu, nom, cookie, type = 'application/octet-stream') => fetch(s.url + chemin, {
    method: 'POST', redirect: 'manual', body: contenu,
    headers: { 'content-type': type, 'x-nom-fichier': encodeURIComponent(nom), origin: s.url, ...(cookie ? { cookie } : {}) },
  });
  s.fermer = () => new Promise(fin => {
    fs.rmSync(s.dossierFichiers, { recursive: true, force: true }); // tout de suite : le processus peut finir avant close()
    serveur.closeAllConnections();
    serveur.close(fin);
  });
  return s;
}
