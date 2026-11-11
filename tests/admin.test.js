import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';
import { reglage } from '../src/db.js';
import { compteClient } from '../src/compte.js';

const REGLAGES = { delai_jours: '15', entreprise_tel: '077229998', entreprise_adresse: 'BP 12 613, Libreville', adresse_locaux: 'Mindoubé, face à la station', rccm: 'GA-LBV-01-2026-A10-00001', nif: '123456 A' };

test('réglages : réservés à l’admin, délai entre 1 et 90 jours', async () => {
  const s = await demarrer();
  assert.equal((await s.get('/reglages', s.collab)).status, 403);
  assert.equal((await s.post('/reglages', REGLAGES, s.collab)).status, 403);
  for (const delai of ['0', '91', 'abc', '']) assert.equal((await s.post('/reglages', { ...REGLAGES, delai_jours: delai }, s.admin)).status, 400, delai);
  assert.equal(reglage(s.db, 'delai_jours'), '10');
  assert.equal((await s.post('/reglages', REGLAGES, s.admin)).status, 302);
  assert.deepEqual(['delai_jours', 'adresse_locaux', 'rccm'].map(c => reglage(s.db, c)), ['15', 'Mindoubé, face à la station', 'GA-LBV-01-2026-A10-00001']);
  assert.match(await (await s.get('/reglages', s.admin)).text(), /Mindoubé, face à la station/);
  await s.fermer();
});

test('le délai réglé pilote les retards', async () => {
  const s = await demarrer({ donnees: true });
  await s.post('/reglages', REGLAGES, s.admin); // 15 jours
  const fabrice = s.db.prepare("SELECT id FROM clients WHERE nom = 'Fabrice'").get().id;
  const ct = s.db.prepare("SELECT id FROM conteneurs WHERE numero = 'TSTU0000003'").get().id;
  s.db.prepare("UPDATE conteneurs SET eta = '2026-12-10', date_arrivee = '2026-12-10' WHERE id = ?").run(ct);
  s.db.prepare("INSERT INTO relances (type, client_id, conteneur_id, envoye_le, par) VALUES ('arrivee', ?, ?, '2026-12-10', 'eric')").run(fabrice, ct);
  const etat = jour => compteClient(s.db, fabrice, jour).lignes[0].etat;
  assert.deepEqual([etat('2026-12-25'), etat('2026-12-26')], ['exigible', 'en_retard']);
  await s.fermer();
});

test('comptes : création par l’admin, mot de passe court refusé, identifiant unique', async () => {
  const s = await demarrer();
  const nouveau = { identifiant: 'Marie', nom: 'Marie', role: 'collaborateur', mot_de_passe: 'motdepasse-marie' };
  assert.equal((await s.get('/utilisateurs', s.collab)).status, 403);
  assert.equal((await s.post('/utilisateurs', nouveau, s.collab)).status, 403);
  assert.equal((await s.post('/utilisateurs', { ...nouveau, mot_de_passe: 'court' }, s.admin)).status, 400);
  assert.equal((await s.post('/utilisateurs', { ...nouveau, role: 'patron' }, s.admin)).status, 400);
  assert.equal((await s.post('/utilisateurs', nouveau, s.admin)).status, 302);
  assert.equal((await s.post('/utilisateurs', nouveau, s.admin)).status, 400); // existe déjà
  assert.equal((await s.post('/connexion', { identifiant: 'marie', mot_de_passe: 'motdepasse-marie' })).status, 302);
  assert.doesNotMatch(await (await s.get('/utilisateurs', s.admin)).text(), /scrypt\$/);
  await s.fermer();
});

test('comptes : aucun rôle n’est choisi d’avance, un compte sans rôle est refusé', async () => {
  const s = await demarrer();
  const formulaire = await (await s.get('/utilisateurs', s.admin)).text();
  const liste = formulaire.match(/<select name="role">([\s\S]*?)<\/select>/)[1];
  assert.match(liste, /^\s*<option value=""/); // la première option est vide : rien n'est choisi par défaut
  assert.doesNotMatch(liste, /<option value="[^"]+" selected/); // aucun vrai rôle choisi d'avance
  const avant = s.db.prepare('SELECT COUNT(*) n FROM utilisateurs').get().n;
  const sansRole = { identifiant: 'ayaan2', nom: 'Ayaan', mot_de_passe: 'motdepasse-long' };
  assert.equal((await s.post('/utilisateurs', sansRole, s.admin)).status, 400);
  assert.equal((await s.post('/utilisateurs', { ...sansRole, role: '' }, s.admin)).status, 400);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM utilisateurs').get().n, avant);
  await s.fermer();
});

test('désactiver un compte le déconnecte ; le dernier admin est protégé', async () => {
  const s = await demarrer();
  const id = identifiant => s.db.prepare('SELECT id FROM utilisateurs WHERE identifiant = ?').get(identifiant).id;
  assert.equal((await s.post(`/utilisateurs/${id('eric')}/actif`, { actif: '0' }, s.admin)).status, 409);
  assert.equal((await s.post(`/utilisateurs/${id('collab')}/actif`, { actif: '0' }, s.admin)).status, 302);
  assert.equal((await s.get('/', s.collab)).status, 302);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM sessions WHERE utilisateur_id = ?').get(id('collab')).n, 0);
  assert.equal((await s.post(`/utilisateurs/${id('collab')}/actif`, { actif: '1' }, s.admin)).status, 302);
  assert.equal((await s.post('/connexion', { identifiant: 'collab', mot_de_passe: 'motdepasse-collab' })).status, 302);
  await s.fermer();
});

test('l’admin change le mot de passe d’un compte ; chacun change le sien avec l’actuel', async () => {
  const s = await demarrer();
  const collab = s.db.prepare("SELECT id FROM utilisateurs WHERE identifiant = 'collab'").get().id;
  assert.equal((await s.post(`/utilisateurs/${collab}/mot-de-passe`, { nouveau: 'court' }, s.admin)).status, 400);
  assert.equal((await s.post(`/utilisateurs/${collab}/mot-de-passe`, { nouveau: 'nouveau-motdepasse' }, s.collab)).status, 403);
  assert.equal((await s.post(`/utilisateurs/${collab}/mot-de-passe`, { nouveau: 'nouveau-motdepasse' }, s.admin)).status, 302);
  assert.equal((await s.get('/', s.collab)).status, 302); // ses anciennes sessions sont fermées
  assert.equal((await s.post('/connexion', { identifiant: 'collab', mot_de_passe: 'motdepasse-collab' })).status, 401);
  const connexion = await s.post('/connexion', { identifiant: 'collab', mot_de_passe: 'nouveau-motdepasse' });
  const cookie = connexion.headers.get('set-cookie').split(';')[0];
  assert.equal((await s.get('/mon-mot-de-passe', cookie)).status, 200);
  assert.equal((await s.post('/mon-mot-de-passe', { actuel: 'faux', nouveau: 'encore-un-autre-mdp' }, cookie)).status, 400);
  assert.equal((await s.post('/mon-mot-de-passe', { actuel: 'nouveau-motdepasse', nouveau: 'court' }, cookie)).status, 400);
  assert.equal((await s.post('/mon-mot-de-passe', { actuel: 'nouveau-motdepasse', nouveau: 'encore-un-autre-mdp' }, cookie)).status, 302);
  assert.equal((await s.post('/connexion', { identifiant: 'collab', mot_de_passe: 'encore-un-autre-mdp' })).status, 302);
  await s.fermer();
});

test('comptes : l’admin supprime un compte qui n’a jamais servi, pas un compte qui a laissé des traces', async () => {
  const s = await demarrer();
  await s.post('/utilisateurs', { identifiant: 'larry', nom: 'MOUGNIER', role: 'collaborateur', mot_de_passe: 'motdepasse-larry' }, s.admin);
  const id = identifiant => s.db.prepare('SELECT id FROM utilisateurs WHERE identifiant = ?').get(identifiant)?.id;
  const larry = id('larry');
  await s.post('/connexion', { identifiant: 'larry', mot_de_passe: 'motdepasse-larry' }); // une session, aucune saisie
  const page = await (await s.get('/utilisateurs', s.admin)).text();
  assert.match(page, new RegExp(`action="/utilisateurs/${larry}/supprimer"`));
  assert.doesNotMatch(page, new RegExp(`action="/utilisateurs/${s.adminId}/supprimer"`)); // jamais pour soi-même
  assert.equal((await s.post(`/utilisateurs/${larry}/supprimer`, {}, s.collab)).status, 403);
  assert.equal((await s.post(`/utilisateurs/${s.adminId}/supprimer`, {}, s.admin)).status, 409);
  assert.equal((await s.post('/utilisateurs/9999/supprimer', {}, s.admin)).status, 404);
  assert.equal((await s.post(`/utilisateurs/${larry}/supprimer`, {}, s.admin)).status, 302);
  assert.equal(id('larry'), undefined);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM sessions WHERE utilisateur_id = ?').get(larry).n, 0);

  // un compte qui a déjà saisi quelque chose se désactive : l'historique garde son auteur
  s.db.prepare("INSERT INTO relances (type, envoye_le, par) VALUES ('groupe_depart', '2026-11-10', 'collab')").run();
  const refus = await s.post(`/utilisateurs/${s.collabId}/supprimer`, {}, s.admin);
  assert.equal(refus.status, 409);
  assert.match(await refus.text(), /désactivez-le/);
  assert.ok(id('collab'));
  s.db.prepare("INSERT INTO offres (fournisseur_id, marque, modele, prix_won, cree_le) VALUES (?, 'Kia', 'K5', 1, 'x')").run(s.ayaanId);
  assert.equal((await s.post(`/utilisateurs/${s.ayaanId}/supprimer`, {}, s.admin)).status, 409);
  assert.ok(id('ayaan'));
  assert.equal((await s.post(`/utilisateurs/${s.georgeId}/supprimer`, {}, s.admin)).status, 302); // sans aucune trace
  await s.fermer();
});
