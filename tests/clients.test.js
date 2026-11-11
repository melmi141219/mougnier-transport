import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';
import { compteClient } from '../src/compte.js';
import { dateValide } from '../src/format.js';

const idClient = (s, nom) => s.db.prepare('SELECT id FROM clients WHERE nom = ?').get(nom).id;
const commandeDe = (s, nom) => s.db.prepare('SELECT id FROM commandes WHERE client_id = ?').get(idClient(s, nom))?.id;

test('dateValide', () => {
  assert.equal(dateValide('2026-11-10'), '2026-11-10');
  for (const t of ['', '10/11/2026', '2026-13-45', '2026-02-30', 'abc', null, undefined]) assert.equal(dateValide(t), null, String(t));
});

test('la liste des clients reprend les soldes validés', async () => {
  const s = await demarrer({ donnees: true });
  const t = await (await s.get('/clients', s.collab)).text();
  assert.match(t, /Carole Mba[\s\S]*?13 344 000 F/);
  assert.match(t, /Gaston[\s\S]*?crédit[\s\S]*?4 850 000 F/);
  assert.match(t, /45 110 000 F/);
  await s.fermer();
});

test('créer un client puis une voiture en vente', async () => {
  const s = await demarrer();
  const r = await s.post('/clients', { nom: '<script>alert(1)</script>', telephone: '066123456' }, s.collab);
  assert.equal(r.status, 302);
  const id = s.db.prepare('SELECT id FROM clients').get().id;
  assert.doesNotMatch(await (await s.get('/clients/' + id, s.collab)).text(), /<script>alert/);
  await s.post(`/clients/${id}/commandes`, { mode: 'deux' }, s.collab);
  const cmd = s.db.prepare('SELECT id FROM commandes').get().id;
  const v = await s.post('/vehicules', { type: 'vente', commande_id: cmd, marque: 'Kia', modele: 'Sportage', achat: '3 300 000', transport: '1 600 000' }, s.collab);
  assert.equal(v.status, 302);
  assert.deepEqual({ ...s.db.prepare('SELECT achat, transport, client_id FROM vehicules').get() }, { achat: 3300000, transport: 1600000, client_id: id });
  assert.match(await (await s.get('/clients/' + id, s.collab)).text(), /8 036 000 F/);
  await s.fermer();
});

test('refus : vente sans commande, vente sans prix, montant illisible, sans marque', async () => {
  const s = await demarrer({ donnees: true });
  const cmd = commandeDe(s, 'Alice');
  const avant = s.db.prepare('SELECT COUNT(*) n FROM vehicules').get().n;
  const essais = [
    { type: 'vente', marque: 'Kia', modele: 'K5', forfait: '5 500 000' },
    { type: 'vente', commande_id: cmd, marque: 'Kia', modele: 'K5' },
    { type: 'vente', commande_id: cmd, marque: 'Kia', modele: 'K5', achat: 'abc', transport: '800000' },
    { type: 'vente', commande_id: cmd, marque: '', modele: 'K5', forfait: '5 500 000' },
    { type: 'vente', commande_id: 99999, marque: 'Kia', modele: 'K5', forfait: '5 500 000' },
    { type: 'charge', marque: 'Kia', modele: 'K5' },
    { type: 'bizarre', marque: 'Kia', modele: 'K5' },
  ];
  for (const corps of essais) assert.equal((await s.post('/vehicules', corps, s.collab)).status, 400, JSON.stringify(corps));
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM vehicules').get().n, avant);
  await s.fermer();
});

test('une voiture au forfait a tout son prix dans le solde, sans changer le mode de la commande', async () => {
  const s = await demarrer({ donnees: true });
  const cmd = commandeDe(s, 'Brigitte');
  assert.equal((await s.post('/vehicules', { type: 'vente', commande_id: cmd, marque: 'Kia', modele: 'Morning', forfait: '2 000 000' }, s.collab)).status, 302);
  assert.equal(s.db.prepare('SELECT mode FROM commandes WHERE id = ?').get(cmd).mode, 'deux');
  const lignes = compteClient(s.db, idClient(s, 'Brigitte'), '2026-11-10').lignes;
  assert.deepEqual(lignes.map(l => [l.type, l.montant]), [['solde', 7341000], ['douane', 2695000]]); // 5 341 000 + 2 000 000
  await s.fermer();
});

test('une voiture à moi n’a pas de client et ne compte dans aucun solde', async () => {
  const s = await demarrer();
  assert.equal((await s.post('/vehicules', { type: 'perso', marque: 'Hyundai', modele: 'Grand Starex', annee: '2017' }, s.collab)).status, 302);
  assert.deepEqual({ ...s.db.prepare('SELECT type, client_id, annee FROM vehicules').get() }, { type: 'perso', client_id: null, annee: 2017 });
  assert.match(await (await s.get('/vehicules', s.collab)).text(), /Grand Starex/);
  await s.fermer();
});

test('supprimer un client : réservé à l’admin, refusé s’il a de l’argent ou une voiture', async () => {
  const s = await demarrer({ donnees: true });
  await s.post('/clients', { nom: 'Client vide' }, s.collab);
  const vide = idClient(s, 'Client vide');
  assert.equal((await s.post(`/clients/${vide}/supprimer`, {}, s.collab)).status, 403);
  assert.equal((await s.post(`/clients/${idClient(s, 'Alice')}/supprimer`, {}, s.admin)).status, 409);
  assert.equal((await s.post(`/clients/${idClient(s, 'Gaston')}/supprimer`, {}, s.admin)).status, 409); // a versé de l'argent
  assert.equal((await s.post(`/clients/${vide}/supprimer`, {}, s.admin)).status, 302);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM clients WHERE id = ?').get(vide).n, 0);
  await s.fermer();
});

test('changer le statut ajoute une étape datée ; une date illisible est refusée', async () => {
  const s = await demarrer({ donnees: true });
  const v = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Avante'").get().id;
  assert.equal((await s.post(`/vehicules/${v}/statut`, { statut: 'achetee', date: '12/11/2026' }, s.collab)).status, 400);
  assert.equal((await s.post(`/vehicules/${v}/statut`, { statut: 'volee', date: '2026-11-12' }, s.collab)).status, 400);
  assert.equal((await s.post(`/vehicules/${v}/statut`, { statut: 'remise', date: '2026-11-12' }, s.collab)).status, 400); // la remise a sa propre route
  assert.equal((await s.post(`/vehicules/${v}/statut`, { statut: 'achetee', date: '2026-11-12' }, s.collab)).status, 302);
  assert.equal(s.db.prepare('SELECT statut FROM vehicules WHERE id = ?').get(v).statut, 'achetee');
  assert.deepEqual({ ...s.db.prepare('SELECT statut, date, par FROM etapes WHERE vehicule_id = ?').get(v) }, { statut: 'achetee', date: '2026-11-12', par: 'collab' });
  await s.fermer();
});

test('la fiche signale un numéro WhatsApp manquant et un prix verrouillé', async () => {
  const s = await demarrer({ donnees: true });
  const lucien = idClient(s, 'Lucien');
  assert.match(await (await s.get('/clients/' + lucien, s.collab)).text(), /numéro WhatsApp manquant/);
  await s.post('/clients/' + lucien, { nom: 'Lucien', telephone: '066 00 00 11' }, s.collab);
  assert.doesNotMatch(await (await s.get('/clients/' + lucien, s.collab)).text(), /numéro WhatsApp manquant/);
  const v = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Aveo'").get().id;
  const fiche = await (await s.get('/vehicules/' + v, s.collab)).text();
  assert.match(fiche, /verrouillé/);
  assert.match(fiche, /3 600 000 F/);
  await s.fermer();
});

test('modifier une voiture : les montants sont relus, le type ne change pas', async () => {
  const s = await demarrer({ donnees: true });
  const v = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Sportage'").get().id;
  assert.equal((await s.post('/vehicules/' + v, { marque: 'Kia', modele: 'Sportage', achat: 'beaucoup', transport: '1 600 000' }, s.collab)).status, 400);
  assert.equal((await s.post('/vehicules/' + v, { type: 'perso', marque: 'Kia', modele: 'Sportage', version: 'full option', achat: '3 400 000', transport: '1 600 000', kilometrage: '85 000', arrondi: '-10 000' }, s.collab)).status, 302);
  assert.deepEqual({ ...s.db.prepare('SELECT type, achat, kilometrage, arrondi FROM vehicules WHERE id = ?').get(v) }, { type: 'vente', achat: 3400000, kilometrage: 85000, arrondi: -10000 });
  await s.fermer();
});

test('annuler une voiture (admin) la sort du solde ; réaffecter la déplace chez un autre client', async () => {
  const s = await demarrer({ donnees: true });
  const santaFe = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Santa Fe'").get().id;
  const avante = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Avante'").get().id;
  assert.equal((await s.post(`/vehicules/${santaFe}/annuler`, {}, s.collab)).status, 403);
  assert.equal((await s.post(`/vehicules/${santaFe}/annuler`, {}, s.admin)).status, 302);
  assert.equal(compteClient(s.db, idClient(s, 'Alice'), '2026-11-10').total, 4264000);
  assert.equal((await s.post(`/vehicules/${avante}/reaffecter`, { commande_id: commandeDe(s, 'Gaston') ?? '' }, s.admin)).status, 400); // Gaston n'a pas de commande
  await s.post(`/clients/${idClient(s, 'Gaston')}/commandes`, { mode: 'deux' }, s.collab);
  assert.equal((await s.post(`/vehicules/${avante}/reaffecter`, { commande_id: commandeDe(s, 'Gaston') }, s.admin)).status, 302);
  const gaston = compteClient(s.db, idClient(s, 'Gaston'), '2026-11-10');
  assert.deepEqual([gaston.total, gaston.credit], [4264000, 586000]);
  assert.equal(compteClient(s.db, idClient(s, 'Alice'), '2026-11-10').total, 0);
  await s.fermer();
});

test('client ou voiture inconnus : page 404', async () => {
  const s = await demarrer();
  for (const chemin of ['/clients/9999', '/vehicules/9999', '/clients/abc']) assert.equal((await s.get(chemin, s.collab)).status, 404, chemin);
  await s.fermer();
});
