import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { demarrer } from './aide.js';
import { ouvrirBase } from '../src/db.js';
import { chargerDonnees } from '../scripts/charger-donnees.js';

// Le schéma d'avant les rôles partenaires : celui d'aujourd'hui, avec l'ancien contrôle des rôles.
const ANCIEN_SCHEMA = fs.readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8')
  .replace("'admin','collaborateur','fournisseur','transporteur'", "'admin','collaborateur'");
const fichierTemporaire = nom => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-roles-')), nom);
const definition = db => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'utilisateurs'").get().sql;
const versionSchema = db => db.prepare('PRAGMA schema_version').get().schema_version; // avance à chaque changement de structure

// Ce qu'une page servie à un partenaire ne contient jamais : un lien du menu interne, un texte en français
// (sensible à la casse : les noms de champs comme name="nouveau" ne sont pas du texte affiché).
const LIEN_INTERNE = /href="\/(|clients|vehicules|conteneurs|catalogue|matelas|marges|reglages|utilisateurs|partenaires)"/;
const FRANCAIS = /[àâçéèêîïôùûÀÉ’]|[Mm]ot de passe|Nouveau|Changer|Retour|Action impossible/;

const INTERNES_GET = ['/clients', '/clients/1', '/clients/nouveau', '/vehicules', '/vehicules/1', '/conteneurs', '/conteneurs/1',
  '/catalogue', '/matelas', '/marges', '/reglages', '/utilisateurs', '/documents/1', '/partenaires'];
const INTERNES_POST = ['/clients', '/vehicules', '/relances', '/clients/1/mouvements', '/clients/1/penalites', '/marges/taux',
  '/matelas/ventes', '/conteneurs', '/commandes/1/contrat', '/vehicules/1/ristourne', '/reglages', '/utilisateurs'];

test('chaque adresse interne répond 403 aux deux partenaires, et rien n’est écrit', async () => {
  const s = await demarrer({ donnees: true });
  const compter = () => ['clients', 'vehicules', 'mouvements', 'relances', 'documents', 'conteneurs', 'utilisateurs']
    .map(t => s.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n).join(',');
  const avant = compter();
  for (const cookie of [s.ayaan, s.george]) {
    for (const chemin of INTERNES_GET) assert.equal((await s.get(chemin, cookie)).status, 403, `GET ${chemin}`);
    for (const chemin of INTERNES_POST) assert.equal((await s.post(chemin, { nom: 'x', montant: '1000', taux: '0,5' }, cookie)).status, 403, `POST ${chemin}`);
  }
  assert.equal(compter(), avant);
  await s.fermer();
});

test('une route interne ajoutée plus tard est refusée aussi', async () => {
  const s = await demarrer({ routesEnPlus: app => app.get('/route-future', (req, res) => res.send('secret interne')) });
  assert.equal((await s.get('/route-future', s.collab)).status, 200);
  for (const cookie of [s.ayaan, s.george]) {
    const r = await s.get('/route-future', cookie);
    assert.equal(r.status, 403);
    assert.doesNotMatch(await r.text(), /secret interne/);
  }
  await s.fermer();
});

test('un partenaire atteint son espace en anglais, change son mot de passe et se déconnecte', async () => {
  const s = await demarrer();
  const accueil = await s.get('/', s.ayaan);
  assert.deepEqual([accueil.status, accueil.headers.get('location')], [302, '/partenaire']);
  const espace = await s.get('/partenaire', s.ayaan);
  const texte = await espace.text();
  assert.equal(espace.status, 200);
  assert.match(texte, /<html lang="en">/);
  assert.doesNotMatch(texte, /href="\/(clients|marges|vehicules|conteneurs|catalogue|matelas|reglages|utilisateurs)"/);
  assert.equal((await s.get('/mon-mot-de-passe', s.george)).status, 200);
  assert.equal((await s.post('/mon-mot-de-passe', { actuel: 'motdepasse-george', nouveau: 'new-password-12' }, s.george)).status, 302);
  assert.equal((await s.post('/connexion', { identifiant: 'george', mot_de_passe: 'new-password-12' })).status, 302);
  assert.equal((await s.post('/deconnexion', {}, s.ayaan)).status, 302);
  assert.equal((await s.get('/partenaire', s.ayaan)).status, 302); // session fermée
  await s.fermer();
});

test('un compte interne n’entre pas dans l’espace partenaire', async () => {
  const s = await demarrer();
  for (const cookie of [s.admin, s.collab]) assert.equal((await s.get('/partenaire', cookie)).status, 403);
  await s.fermer();
});

test('une base créée avant les rôles partenaires est mise à niveau sans rien perdre', () => {
  const fichier = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-roles-')), 'ancienne.db');
  const ancienne = new DatabaseSync(fichier);
  ancienne.exec(`
    CREATE TABLE utilisateurs (id INTEGER PRIMARY KEY, identifiant TEXT NOT NULL UNIQUE, nom TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','collaborateur')), mot_de_passe TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE sessions (jeton TEXT PRIMARY KEY, utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id), expire_le TEXT NOT NULL);
    INSERT INTO utilisateurs (identifiant, nom, role, mot_de_passe) VALUES ('admin', 'Eric', 'admin', 'scrypt$aa$bb');
    INSERT INTO sessions VALUES ('jeton-existant', 1, '2099-01-01');`);
  ancienne.close();
  const db = ouvrirBase(fichier);
  assert.deepEqual({ ...db.prepare('SELECT identifiant, role, mot_de_passe FROM utilisateurs').get() }, { identifiant: 'admin', role: 'admin', mot_de_passe: 'scrypt$aa$bb' });
  assert.equal(db.prepare('SELECT utilisateur_id FROM sessions').get().utilisateur_id, 1);
  db.prepare("INSERT INTO utilisateurs (identifiant, nom, role, mot_de_passe) VALUES ('ayaan', 'Ayaan', 'fournisseur', 'x')").run();
  assert.throws(() => db.prepare("INSERT INTO utilisateurs (identifiant, nom, role, mot_de_passe) VALUES ('z', 'Z', 'pirate', 'x')").run());
  assert.throws(() => db.prepare("INSERT INTO sessions VALUES ('j2', 999, '2099-01-01')").run()); // la clé étrangère tient toujours
  // Chaque table qui référence utilisateurs accepte et refuse toujours ce qu'il faut.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => t.name);
  assert.deepEqual(tables.filter(t => db.prepare(`PRAGMA foreign_key_list(${t})`).all().some(cle => cle.table === 'utilisateurs')).sort(),
    ['fichiers', 'frais_transporteur', 'offres', 'sessions'],
    'une autre table référence utilisateurs : vérifier ici qu’elle accepte et refuse encore ses lignes après la mise à niveau');
  db.prepare("INSERT INTO sessions VALUES ('j3', 1, '2099-01-01')").run(); // pour un compte d'avant la mise à niveau
  db.prepare("INSERT INTO sessions VALUES ('j4', 2, '2099-01-01')").run(); // pour le compte créé après
  const offre = fournisseur => db.prepare("INSERT INTO offres (fournisseur_id, marque, modele, prix_won, cree_le) VALUES (?, 'Kia', 'K5', 1, 'x')").run(fournisseur);
  const depot = (nom, auteur) => db.prepare("INSERT INTO fichiers (nom_stocke, nom_origine, type_mime, taille, depose_par, depose_le) VALUES (?, 'f', 'image/jpeg', 1, ?, 'x')").run(nom, auteur);
  offre(2);
  depot('a.jpg', 1);
  assert.throws(() => offre(999), /FOREIGN KEY/);
  assert.throws(() => depot('b.jpg', 999), /FOREIGN KEY/);
  db.prepare("INSERT INTO conteneurs (id, numero) VALUES (1, 'ESSU0000001')").run();
  const frais = auteur => db.prepare("INSERT INTO frais_transporteur (conteneur_id, libelle, montant_won, saisi_par, saisi_le) VALUES (1, 'x', 1, ?, 'x')").run(auteur);
  frais(2);
  assert.throws(() => frais(999), /FOREIGN KEY/);
  assert.throws(() => db.prepare('DELETE FROM utilisateurs WHERE id = 1').run(), /FOREIGN KEY/); // il a des sessions
  // Les clés étrangères sont de nouveau contrôlées sur cette connexion, pour toutes les tables.
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.prepare("INSERT INTO eta_historique (conteneur_id, modifie_le, par) VALUES (999, '2026-11-11', 'x')").run(), /FOREIGN KEY/);
  assert.match(definition(db), /^CREATE TABLE "utilisateurs"/); // SQLite met des guillemets au nom d'une table reconstruite
  const version = versionSchema(db);
  db.close();
  ouvrirBase(fichier).close(); // une deuxième ouverture ne refait rien et ne plante pas
  const rouverte = ouvrirBase(fichier);
  assert.equal(versionSchema(rouverte), version);
  rouverte.close();
});

test('mise à niveau des rôles : une base complète d’avant garde toutes ses lignes, ses numéros et ses comptes désactivés', () => {
  const fichier = fichierTemporaire('complete.db');
  const ancienne = new DatabaseSync(fichier);
  ancienne.exec(ANCIEN_SCHEMA);
  assert.match(definition(ancienne), /role IN \('admin','collaborateur'\)\)/);
  chargerDonnees(ancienne, { date: '2026-11-10' });
  ancienne.exec(`
    INSERT INTO utilisateurs (id, identifiant, nom, role, mot_de_passe, actif) VALUES
      (1, 'eric', 'Eric', 'admin', 'scrypt$aa$bb', 1), (5, 'ancien', 'Parti', 'collaborateur', 'scrypt$cc$dd', 0);
    INSERT INTO sessions VALUES ('s1', 1, '2099-01-01'), ('s2', 1, '2099-01-02'), ('s5', 5, '2099-01-03');`);
  // reglages mis à part : ouvrirBase y ajoute les réglages par défaut, absents de cette base faite à la main
  const tables = ancienne.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'reglages' ORDER BY name").all().map(t => t.name);
  const lignes = db => tables.map(t => `${t} ${db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}`).join(', ');
  const avant = lignes(ancienne);
  assert.match(avant, /clients [1-9].*mouvements [1-9].*vehicules [1-9]/); // la base n'est pas vide
  ancienne.close();

  const db = ouvrirBase(fichier);
  assert.match(definition(db), /'fournisseur','transporteur'/);
  assert.equal(lignes(db), avant);
  assert.deepEqual(db.prepare('SELECT * FROM utilisateurs ORDER BY id').all().map(u => ({ ...u })), [
    { id: 1, identifiant: 'eric', nom: 'Eric', role: 'admin', mot_de_passe: 'scrypt$aa$bb', actif: 1 },
    { id: 5, identifiant: 'ancien', nom: 'Parti', role: 'collaborateur', mot_de_passe: 'scrypt$cc$dd', actif: 0 }]);
  assert.deepEqual(db.prepare('SELECT * FROM sessions ORDER BY jeton').all().map(s => ({ ...s })), [
    { jeton: 's1', utilisateur_id: 1, expire_le: '2099-01-01' }, { jeton: 's2', utilisateur_id: 1, expire_le: '2099-01-02' },
    { jeton: 's5', utilisateur_id: 5, expire_le: '2099-01-03' }]);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.prepare("INSERT INTO utilisateurs (identifiant, nom, role, mot_de_passe) VALUES ('eric', 'Autre', 'admin', 'x')").run(), /UNIQUE/);
  db.close();
});

test('mise à niveau des rôles : annulée, sans rien changer, si une clé étrangère est déjà cassée', () => {
  const fichier = fichierTemporaire('cassee.db');
  const ancienne = new DatabaseSync(fichier, { enableForeignKeyConstraints: false });
  ancienne.exec(ANCIEN_SCHEMA);
  ancienne.exec(`
    INSERT INTO utilisateurs (identifiant, nom, role, mot_de_passe) VALUES ('eric', 'Eric', 'admin', 'scrypt$aa$bb');
    INSERT INTO sessions VALUES ('orpheline', 999, '2099-01-01');`);
  ancienne.close();
  assert.throws(() => ouvrirBase(fichier), /clés étrangères.*sessions/);
  const apres = new DatabaseSync(fichier);
  assert.match(definition(apres), /role IN \('admin','collaborateur'\)\)/); // l'ancienne table est toujours là, avec son compte
  assert.equal(apres.prepare('SELECT identifiant FROM utilisateurs').get().identifiant, 'eric');
  assert.deepEqual(apres.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'utilisateurs_%'").all(), []);
  apres.close();
});

test('mise à niveau des rôles : une base neuve n’y passe pas', () => {
  const fichier = fichierTemporaire('neuve.db');
  const neuve = ouvrirBase(fichier);
  assert.match(definition(neuve), /^CREATE TABLE utilisateurs \(/); // sans guillemets : la table n'a pas été reconstruite
  const version = versionSchema(neuve);
  neuve.close();
  const rouverte = ouvrirBase(fichier);
  assert.equal(versionSchema(rouverte), version);
  rouverte.close();
});

test('Comptes : l’admin crée un fournisseur et un transporteur', async () => {
  const s = await demarrer();
  const compte = (identifiant, role) => ({ identifiant, nom: identifiant, role, mot_de_passe: 'mot-de-passe-long' });
  assert.equal((await s.post('/utilisateurs', compte('ayaan2', 'fournisseur'), s.admin)).status, 302);
  assert.equal((await s.post('/utilisateurs', compte('george2', 'transporteur'), s.admin)).status, 302);
  assert.equal((await s.post('/utilisateurs', compte('pirate', 'pirate'), s.admin)).status, 400);
  const connexion = await s.post('/connexion', { identifiant: 'ayaan2', mot_de_passe: 'mot-de-passe-long' });
  assert.equal((await s.get('/', connexion.headers.get('set-cookie').split(';')[0])).headers.get('location'), '/partenaire');
  assert.match(await (await s.get('/utilisateurs', s.admin)).text(), /Fournisseur[\s\S]*Transporteur/);
  await s.fermer();
});

test('Comptes : chaque compte est affiché avec son rôle, et les quatre rôles sont proposés', async () => {
  const s = await demarrer();
  const comptes = await (await s.get('/utilisateurs', s.admin)).text();
  for (const ligne of ['<td>eric</td><td>Eric</td><td>Administrateur</td>', '<td>collab</td><td>Collaborateur</td><td>Collaborateur</td>',
    '<td>ayaan</td><td>Ayaan</td><td>Fournisseur</td>', '<td>george</td><td>George</td><td>Transporteur</td>'])
    assert.ok(comptes.includes(ligne), ligne);
  for (const role of ['admin', 'collaborateur', 'fournisseur', 'transporteur']) assert.ok(comptes.includes(`<option value="${role}"`), role);
  await s.fermer();
});

test('cloisonnement : ni la casse, ni une barre finale, ni HEAD ne le contournent ; /partenaires et /fichiers restent internes', async () => {
  const s = await demarrer({ routesEnPlus: app => app.get('/partenaires', (req, res) => res.send('page interne')) });
  for (const cookie of [s.ayaan, s.george]) {
    for (const chemin of ['/CLIENTS', '/clients/', '/Clients/1/', '/PARTENAIRES', '/partenaires/', '/partenaire-x', '/fichiers', '/fichiers-x/1'])
      assert.equal((await s.get(chemin, cookie)).status, 403, `GET ${chemin}`);
    assert.equal((await fetch(`${s.url}/clients`, { method: 'HEAD', headers: { cookie } })).status, 403, 'HEAD /clients');
    assert.equal((await s.post('/', {}, cookie)).status, 403, 'POST /');
    const accueil = await fetch(`${s.url}/`, { method: 'HEAD', redirect: 'manual', headers: { cookie } });
    assert.deepEqual([accueil.status, accueil.headers.get('location')], [302, '/partenaire'], 'HEAD /');
    // son espace et son mot de passe, quelle que soit l'écriture de l'adresse
    for (const chemin of ['/PARTENAIRE', '/partenaire/', '/Mon-Mot-De-Passe', '/mon-mot-de-passe/'])
      assert.equal((await s.get(chemin, cookie)).status, 200, `GET ${chemin}`);
    // adresses ouvertes aux partenaires, où il n'y a encore rien à lire : « introuvable », pas « refusé »
    for (const chemin of ['/fichiers/x', '/deconnexion', '/partenaire//'])
      assert.equal((await s.get(chemin, cookie)).status, 404, `GET ${chemin}`);
  }
  for (const cookie of [s.admin, s.collab]) {
    for (const chemin of ['/PARTENAIRE', '/Partenaire/x', '/partenaire/'])
      assert.equal((await s.get(chemin, cookie)).status, 403, `GET ${chemin}`);
    assert.equal((await s.get('/partenaires', cookie)).status, 200, 'GET /partenaires'); // avec un s : page interne
  }
  await s.fermer();
});

test('creerApp donne le dossier des fichiers aux routes', async () => {
  let recu;
  const s = await demarrer({ routesEnPlus: (app, contexte) => { recu = contexte; } });
  assert.equal(recu.dossierFichiers, s.dossierFichiers);
  assert.equal(recu.db, s.db);
  await s.fermer();
});

test('tout ce qu’un partenaire lit est en anglais, dans sa mise en page, sans lien vers l’interne', async t => {
  const journal = t.mock.method(console, 'error', () => {}); // la panne simulée ne doit pas salir la sortie des tests
  const s = await demarrer({ routesEnPlus: app => app.get('/partenaire/panne', () => { throw new Error('panne simulée'); }) });
  const refus = message => new RegExp(`<h1>Action not possible</h1>[\\s\\S]*<p class="alerte">${message}</p>[\\s\\S]*>Back</button>`);
  for (const [cookie, nom, motDePasse] of [[s.ayaan, 'Ayaan', 'motdepasse-ayaan'], [s.george, 'George', 'motdepasse-george']]) {
    const pages = [
      [200, () => s.get('/partenaire', cookie), /<h1>Welcome<\/h1>/],
      [200, () => s.get('/mon-mot-de-passe', cookie), /<h1>My password<\/h1>[\s\S]*Current password[\s\S]*New password[\s\S]*At least 10 characters[\s\S]*Change my password/],
      [403, () => s.get('/clients', cookie), refus('You do not have access to this page\\.')],
      [404, () => s.get('/partenaire/inconnue', cookie), refus('This page does not exist\\.')],
      [500, () => s.get('/partenaire/panne', cookie), refus('Something went wrong\\. Nothing was saved\\.')],
      [400, () => s.post('/mon-mot-de-passe', { actuel: motDePasse, nouveau: 'court' }, cookie), refus('The password must be at least 10 characters long\\.')],
      [400, () => s.post('/mon-mot-de-passe', { actuel: 'faux', nouveau: 'new-password-12' }, cookie), refus('The current password is incorrect\\.')],
    ];
    for (const [statut, demander, attendu] of pages) {
      const reponse = await demander();
      const texte = await reponse.text();
      assert.equal(reponse.status, statut, `${nom} ${attendu}`);
      assert.match(texte, attendu);
      assert.match(texte, /<html lang="en">/, `${nom} ${attendu}`);
      assert.match(texte, /<a class="marque" href="\/partenaire">/, `${nom} ${attendu}`);
      assert.ok(texte.includes(`<a href="/mon-mot-de-passe">${nom}</a>\n    <button class="lien">Log out</button>`), `${nom} ${attendu}`);
      assert.doesNotMatch(texte, LIEN_INTERNE, `${nom} ${attendu}`);
      assert.doesNotMatch(texte, FRANCAIS, `${nom} ${attendu}`);
    }
    assert.equal((await s.post('/connexion', { identifiant: nom.split(' ')[0].toLowerCase(), mot_de_passe: motDePasse })).status, 302); // mot de passe inchangé
  }
  assert.equal(journal.mock.callCount(), 2); // les deux pannes simulées, et elles seules, sont écrites dans le journal du serveur
  await s.fermer();
});

test('chaque partenaire a sa page d’accueil', async () => {
  const s = await demarrer();
  const ayaan = await (await s.get('/partenaire', s.ayaan)).text();
  const george = await (await s.get('/partenaire', s.george)).text();
  assert.match(ayaan, /offer cars/);
  assert.doesNotMatch(ayaan, /container/i);
  assert.match(george, /container/);
  assert.doesNotMatch(george, /offer/i);
  assert.match(ayaan, /<nav><a href="\/partenaire" class="actif">Home<\/a><a href="\/partenaire\/offres" class="">My offers<\/a><a href="\/partenaire\/voitures" class="">Ordered cars<\/a><a href="\/partenaire\/paiements" class="">Payments<\/a><\/nav>/);
  assert.match(george, /<nav><a href="\/partenaire" class="actif">Home<\/a><a href="\/partenaire\/conteneurs" class="">Containers<\/a><a href="\/partenaire\/paiements" class="">Payments<\/a><\/nav>/);
  await s.fermer();
});

test('les comptes internes gardent leurs pages en français', async () => {
  const s = await demarrer();
  for (const [cookie, motDePasse] of [[s.admin, 'motdepasse-admin'], [s.collab, 'motdepasse-collab']]) {
    const page = await (await s.get('/mon-mot-de-passe', cookie)).text();
    assert.match(page, /<html lang="fr">/);
    assert.match(page, /<h1>Mon mot de passe<\/h1>[\s\S]*Mot de passe actuel[\s\S]*Nouveau mot de passe[\s\S]*10 caractères au moins[\s\S]*Changer mon mot de passe/);
    assert.match(page, /<a class="marque" href="\/">[\s\S]*<a href="\/clients" class="">Clients<\/a>[\s\S]*<button class="lien">Déconnexion<\/button>/);
    const court = await s.post('/mon-mot-de-passe', { actuel: motDePasse, nouveau: 'court' }, cookie);
    assert.deepEqual([court.status, /Le mot de passe doit faire au moins 10 caractères\./.test(await court.text())], [400, true]);
    const faux = await s.post('/mon-mot-de-passe', { actuel: 'faux', nouveau: 'assez-long-12' }, cookie);
    assert.deepEqual([faux.status, /Le mot de passe actuel est incorrect\./.test(await faux.text())], [400, true]);
    assert.match(await (await s.get('/partenaire', cookie)).text(), /<h1>Action impossible<\/h1>[\s\S]*Cette page est réservée aux partenaires\.[\s\S]*Retour/);
    assert.match(await (await s.get('/inconnue', cookie)).text(), /<h1>Action impossible<\/h1>[\s\S]*Cette page n’existe pas\./);
  }
  await s.fermer();
});

test('relecture M6 : sous /fichiers/, un partenaire ne peut que lire', async () => {
  const s = await demarrer({ routesEnPlus: app => app.post('/fichiers/:id/supprimer', (req, res) => res.send('action interne')) });
  assert.equal((await s.post('/fichiers/1/supprimer', {}, s.collab)).status, 200);
  for (const cookie of [s.ayaan, s.george]) {
    const r = await s.post('/fichiers/1/supprimer', {}, cookie);
    assert.equal(r.status, 403);
    assert.doesNotMatch(await r.text(), /action interne/);
    assert.equal((await s.get('/fichiers/999', cookie)).status, 404); // la lecture passe toujours la porte
  }
  await s.fermer();
});
