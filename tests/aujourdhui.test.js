import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';
import { actionsDuJour as toutesLesActions } from '../src/aujourdhui.js';

// Ces tests portent sur les relances des clients et les annonces ; l'alerte « documents de transport manquants »
// a ses propres tests (tests/partenaires-soldes.test.js).
const actionsDuJour = (db, jour) => toutesLesActions(db, jour).filter(a => a.type !== 'documents_manquants');

const prep = async () => {
  const s = await demarrer({ donnees: true });
  const ct = s.db.prepare("SELECT id FROM conteneurs WHERE numero = 'TSTU0000003'").get().id;
  const id = nom => s.db.prepare('SELECT id FROM clients WHERE nom = ?').get(nom).id;
  const conteneur = champs => s.db.prepare(`UPDATE conteneurs SET ${Object.keys(champs).map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(champs), ct);
  return { s, ct, id, conteneur };
};
const resume = actions => actions.map(a => [a.type, a.clientId ?? null, a.montant ?? null]);

test('sans date d’arrivée, aucune action', async () => {
  const { s } = await prep();
  assert.deepEqual(actionsDuJour(s.db, '2026-12-01'), []);
  assert.match(await (await s.get('/', s.collab)).text(), /Rien à faire/);
  await s.fermer();
});

test('10 jours avant : seul Fabrice est à relancer, pour 3 500 000', async () => {
  const { s, id, conteneur } = await prep();
  conteneur({ eta: '2026-12-10' });
  assert.deepEqual(actionsDuJour(s.db, '2026-11-29'), []);
  const a = actionsDuJour(s.db, '2026-12-01');
  assert.deepEqual(resume(a), [['relance_solde', id('Fabrice'), 3500000]]);
  assert.match(a[0].message, /3 500 000 F/);
  assert.match(a[0].message, /10\/12\/2026/);
  assert.match(a[0].message, /Kia K5/);
  assert.equal(a[0].telephoneManquant, true); // pas de numéro dans les données de départ
  assert.equal(a[0].lien, null);
  await s.fermer();
});

test('la relance de solde annonce aussi la douane à prévoir', async () => {
  const { s, id, conteneur } = await prep();
  conteneur({ eta: '2026-12-10' });
  s.db.prepare("UPDATE mouvements SET annule = 1 WHERE client_id = ?").run(id('Delphine')); // elle n'a plus rien versé
  const a = actionsDuJour(s.db, '2026-12-01').find(x => x.clientId === id('Delphine'));
  assert.deepEqual([a.type, a.montant], ['relance_solde', 3924000]);
  assert.match(a.message, /3 924 000 F/);
  assert.match(a.message, /1 980 000 F pour la douane/);
  await s.fermer();
});

test('une relance marquée envoyée ne revient pas, même si la date d’arrivée change', async () => {
  const { s, ct, id, conteneur } = await prep();
  conteneur({ eta: '2026-12-10' });
  s.aujourdhui = '2026-12-01';
  assert.equal((await s.post('/relances', { type: 'solde', client_id: id('Fabrice'), conteneur_id: ct }, s.collab)).status, 302);
  assert.deepEqual({ ...s.db.prepare('SELECT type, envoye_le, par FROM relances').get() }, { type: 'solde', envoye_le: '2026-12-01', par: 'collab' });
  assert.deepEqual(actionsDuJour(s.db, '2026-12-01'), []);
  conteneur({ eta: '2026-12-20' });
  assert.deepEqual(actionsDuJour(s.db, '2026-12-12'), []);
  await s.fermer();
});

test('une relance mal formée est refusée', async () => {
  const { s, ct, id } = await prep();
  assert.equal((await s.post('/relances', { type: 'publicite', client_id: id('Fabrice'), conteneur_id: ct }, s.collab)).status, 400);
  assert.equal((await s.post('/relances', { type: 'solde', client_id: 9999, conteneur_id: ct }, s.collab)).status, 400);
  assert.equal((await s.post('/relances', { type: 'solde', client_id: id('Fabrice'), conteneur_id: 9999 }, s.collab)).status, 400);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM relances').get().n, 0);
  await s.fermer();
});

test('date dépassée sans arrivée enregistrée', async () => {
  const { s, ct, conteneur } = await prep();
  conteneur({ eta: '2026-12-10' });
  const a = actionsDuJour(s.db, '2026-12-11');
  assert.ok(a.some(x => x.type === 'eta_depassee' && x.conteneurId === ct));
  assert.ok(!actionsDuJour(s.db, '2026-12-10').some(x => x.type === 'eta_depassee'));
  await s.fermer();
});

test('départ : une annonce pour le groupe, sans montant ni nom', async () => {
  const { s, ct, conteneur } = await prep();
  conteneur({ date_depart: '2026-11-15', eta: '2026-12-30' });
  const a = actionsDuJour(s.db, '2026-11-16');
  assert.deepEqual(a.map(x => x.type), ['annonce_depart']);
  assert.match(a[0].message, /MSC KOREA III/);
  assert.match(a[0].message, /5 véhicules/);
  assert.doesNotMatch(a[0].message, /Fabrice|Carole|\d \d{3} \d{3}/);
  await s.post('/relances', { type: 'groupe_depart', conteneur_id: ct }, s.collab);
  assert.deepEqual(actionsDuJour(s.db, '2026-11-16'), []);
  await s.fermer();
});

test('arrivée : annonce de groupe et un message par client à bord', async () => {
  const { s, id, conteneur } = await prep();
  conteneur({ eta: '2026-12-10', date_arrivee: '2026-12-10' });
  const a = actionsDuJour(s.db, '2026-12-10');
  assert.deepEqual(a.filter(x => x.type === 'prevenir_arrivee').map(x => x.clientId).sort(), [id('Carole Mba'), id('Delphine'), id('Fabrice')].sort());
  assert.equal(a.filter(x => x.type === 'annonce_arrivee').length, 1);
  assert.ok(!a.some(x => x.type === 'relance_solde')); // le message d'arrivée porte déjà le montant
  const fabrice = a.find(x => x.type === 'prevenir_arrivee' && x.clientId === id('Fabrice'));
  assert.match(fabrice.message, /3 500 000 F à régler sous 10 jours/);
  assert.match(a.find(x => x.clientId === id('Carole Mba')).message, /Votre solde est réglé/);
  await s.fermer();
});

test('facture du transitaire : douane à encaisser', async () => {
  const { s, ct, id, conteneur } = await prep();
  conteneur({ eta: '2026-12-10', date_arrivee: '2026-12-10', date_facture: '2026-12-18' });
  s.db.prepare("UPDATE reglages SET valeur = 'Mindoubé, face à la station' WHERE cle = 'adresse_locaux'").run();
  const d = actionsDuJour(s.db, '2026-12-19').filter(x => x.type === 'douane');
  assert.deepEqual(d.map(x => [x.clientId, x.montant]).sort(), [[id('Carole Mba'), 2520000], [id('Delphine'), 904000]].sort());
  assert.match(d[0].message, /Mindoubé, face à la station/);
  await s.post('/relances', { type: 'douane', client_id: id('Delphine'), conteneur_id: ct }, s.collab);
  assert.deepEqual(actionsDuJour(s.db, '2026-12-19').filter(x => x.type === 'douane').map(x => x.clientId), [id('Carole Mba')]);
  await s.fermer();
});

test('retard : réapparaît 3 jours après la dernière relance, avec le malus', async () => {
  const { s, ct, id, conteneur } = await prep();
  conteneur({ eta: '2026-12-10', date_arrivee: '2026-12-10' });
  await s.post(`/commandes/${s.db.prepare('SELECT id FROM commandes WHERE client_id = ?').get(id('Fabrice')).id}/contrat`, {}, s.collab);
  s.aujourdhui = '2026-12-10';
  await s.post('/relances', { type: 'arrivee', client_id: id('Fabrice'), conteneur_id: ct }, s.collab);
  const retards = jour => actionsDuJour(s.db, jour).filter(x => x.type === 'retard');
  assert.deepEqual(retards('2026-12-20'), []);
  const r = retards('2026-12-25');
  assert.deepEqual(r.map(x => [x.clientId, x.montant, x.malus]), [[id('Fabrice'), 3500000, 87500]]);
  assert.match(r[0].message, /87 500 F/);
  s.aujourdhui = '2026-12-25';
  await s.post('/relances', { type: 'retard', client_id: id('Fabrice'), conteneur_id: ct, ligne: 'solde' }, s.collab);
  assert.deepEqual([retards('2026-12-26').length, retards('2026-12-27').length, retards('2026-12-28').length], [0, 0, 1]);
  await s.fermer();
});

test('voiture dédouanée et tout payé : prête à remettre', async () => {
  const { s, id, conteneur } = await prep();
  conteneur({ eta: '2026-12-10', date_arrivee: '2026-12-10', date_facture: '2026-12-18' });
  s.db.prepare("UPDATE vehicules SET statut = 'dedouanee' WHERE modele IN ('K5', 'Maxcruz')").run();
  s.db.prepare("INSERT INTO mouvements (client_id, sens, montant, date, mode, saisi_par, saisi_le) VALUES (?, 'entree', 3500000, '2026-12-19', 'especes', 'eric', '2026-12-19')").run(id('Fabrice'));
  const prets = actionsDuJour(s.db, '2026-12-19').filter(x => x.type === 'a_remettre');
  assert.deepEqual(prets.map(x => x.clientId), [id('Fabrice')]); // Carole doit encore la douane du Maxcruz
  await s.fermer();
});

test('la page affiche le lien WhatsApp, le texte à copier et le bouton « envoyé »', async () => {
  const { s, id, conteneur } = await prep();
  conteneur({ eta: '2026-12-10' });
  s.aujourdhui = '2026-12-01';
  let page = await (await s.get('/', s.collab)).text();
  assert.match(page, /numéro WhatsApp manquant/);
  s.db.prepare("UPDATE clients SET telephone = '077229998' WHERE id = ?").run(id('Fabrice'));
  page = await (await s.get('/', s.collab)).text();
  assert.match(page, /href="https:\/\/wa\.me\/24177229998\?text=Bonjour%20Fabrice/);
  assert.match(page, /data-copier="Bonjour Fabrice/);
  assert.match(page, /Marquer comme envoyé/);
  assert.match(page, /3 500 000 F/);
  await s.fermer();
});
