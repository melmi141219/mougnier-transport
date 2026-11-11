import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';
import { compteClient } from '../src/compte.js';
import { margeVehicule } from '../src/calc.js';
import { msgRistourne } from '../src/messages.js';

// Carole : Maxcruz dans TSTU0000003, douane facturée 3 025 000. La facture du transitaire dit 2 900 000 : écart 125 000.
const prep = async () => {
  const s = await demarrer({ donnees: true });
  const carole = s.db.prepare("SELECT id FROM clients WHERE nom = 'Carole Mba'").get().id;
  const maxcruz = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Maxcruz'").get().id;
  const k5 = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'K5'").get().id;
  const facturer = () => {
    s.db.prepare("UPDATE conteneurs SET date_arrivee = '2026-12-10', date_facture = '2026-12-18' WHERE numero = 'TSTU0000003'").run();
    s.db.prepare('UPDATE vehicules SET douane_reelle = 2900000 WHERE id = ?').run(maxcruz);
    s.db.prepare('UPDATE vehicules SET douane_reelle = 1000000 WHERE id = ?').run(k5);
  };
  const reste = () => compteClient(s.db, carole, s.aujourdhui).reste;
  return { s, carole, maxcruz, k5, facturer, reste };
};

test('ristourne : admin seulement, après la facture, jusqu’à l’écart réel sur la douane', async () => {
  const { s, maxcruz, k5, facturer, reste } = await prep();
  assert.equal((await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: '100 000' }, s.admin)).status, 400); // pas encore de facture
  facturer();
  assert.equal((await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: '100 000' }, s.collab)).status, 403);
  assert.equal((await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: '130 000' }, s.admin)).status, 400); // plus que l'écart
  assert.equal((await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: 'cadeau' }, s.admin)).status, 400);
  assert.equal((await s.post(`/vehicules/${k5}/ristourne`, { montant: '10 000' }, s.admin)).status, 400); // forfait : pas de douane détaillée
  assert.equal(reste(), 13344000);
  assert.equal((await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: '100 000' }, s.admin)).status, 302);
  assert.equal(reste(), 13244000);
  assert.equal((await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: '30 000' }, s.admin)).status, 400); // il ne reste que 25 000 d'écart
  assert.equal((await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: '25 000' }, s.admin)).status, 302);
  assert.equal(reste(), 13219000);
  await s.fermer();
});

test('la ristourne baisse les échéances comme un versement, sans compter dans l’argent reçu', async () => {
  const { s, carole, maxcruz, facturer } = await prep();
  facturer();
  await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: '100 000' }, s.admin);
  const c = compteClient(s.db, carole, s.aujourdhui);
  assert.deepEqual([c.recu, c.totalRistournes, c.reste], [6500000, 100000, 13244000]);
  assert.equal(c.lignes.reduce((t, l) => t + l.reste, 0), 13244000);
  await s.fermer();
});

test('annuler une ristourne : admin seulement, avec un motif, le reste remonte', async () => {
  const { s, maxcruz, facturer, reste } = await prep();
  facturer();
  await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: '100 000' }, s.admin);
  const id = s.db.prepare('SELECT id FROM ristournes').get().id;
  assert.equal((await s.post(`/ristournes/${id}/annuler`, { motif: 'erreur' }, s.collab)).status, 403);
  assert.equal((await s.post(`/ristournes/${id}/annuler`, { motif: '' }, s.admin)).status, 400);
  assert.equal((await s.post(`/ristournes/${id}/annuler`, { motif: 'erreur de montant' }, s.admin)).status, 302);
  assert.equal(reste(), 13344000);
  await s.fermer();
});

test('la fiche du client montre la ristourne et le message WhatsApp prêt ; le reçu suivant la mentionne', async () => {
  const { s, carole, maxcruz, facturer } = await prep();
  facturer();
  s.db.prepare("UPDATE clients SET telephone = '+241 07 00 00 01' WHERE id = ?").run(carole);
  await s.post(`/vehicules/${maxcruz}/ristourne`, { montant: '100 000' }, s.admin);
  const fiche = await (await s.get('/clients/' + carole, s.admin)).text();
  assert.match(fiche, /Ristournes[\s\S]*?100 000 F/);
  assert.match(fiche, /href="https:\/\/wa\.me\/24107000001\?text=Bonjour%20Carole%20Mba/);
  const recu = await s.post(`/clients/${carole}/mouvements`, { sens: 'entree', montant: '1 000 000', date: '2026-12-19', mode: 'especes' }, s.collab);
  assert.match(await (await s.get(recu.headers.get('location'), s.collab)).text(), /Ristourne[\s\S]*?100 000 F/);
  const m = msgRistourne({ nom: 'Carole Mba', vehicules: 'Hyundai Maxcruz 2017', montant: 100000, reste: 13244000 });
  assert.match(m, /ristourne de 100 000 F/);
  assert.match(m, /13 244 000 F/);
  assert.doesNotMatch(m, /2 900 000|3 025 000/); // le message ne cite aucun montant de douane
  await s.fermer();
});

test('la marge tient compte de la ristourne accordée', () => {
  const v = { type: 'vente', achat: 3300000, transport: 1600000, arrondi: 0, forfait: null, achat_reel_fcfa: 2300000 };
  assert.equal(margeVehicule(v, 0.4365).marge, 1640000);
  const m = margeVehicule({ ...v, ristournes: 100000 }, 0.4365);
  assert.deepEqual([m.prixClient, m.marge], [7936000, 1540000]);
});
