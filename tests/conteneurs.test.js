import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';

const KOREA = 'TSTU0000003';
const idConteneur = (s, numero = KOREA) => s.db.prepare('SELECT id FROM conteneurs WHERE numero = ?').get(numero).id;
const voitures = (s, ct) => Object.fromEntries(s.db.prepare('SELECT id, modele FROM vehicules WHERE conteneur_id = ?').all(ct).map(x => [x.modele, x.id]));
const statut = (s, id) => s.db.prepare('SELECT statut FROM vehicules WHERE id = ?').get(id).statut;

test('créer un conteneur : numéro obligatoire et unique, lien de suivi en https seulement', async () => {
  const s = await demarrer({ donnees: true });
  assert.equal((await s.post('/conteneurs', { numero: '  ' }, s.collab)).status, 400);
  assert.equal((await s.post('/conteneurs', { numero: KOREA }, s.collab)).status, 409);
  assert.equal((await s.post('/conteneurs', { numero: 'TGHU1234567', lien_suivi: 'javascript:alert(1)' }, s.collab)).status, 400);
  assert.equal((await s.post('/conteneurs', { numero: 'TGHU1234567', lien_suivi: 'http://msc.com' }, s.collab)).status, 400);
  assert.equal((await s.post('/conteneurs', { numero: 'TGHU1234567', eta: '10/12/2026' }, s.collab)).status, 400);
  const r = await s.post('/conteneurs', { numero: 'tghu 1234567', navire: 'MSC TEST', lien_suivi: 'https://www.msc.com/track?x=1', eta: '2026-12-30' }, s.collab);
  assert.equal(r.status, 302);
  const page = await (await s.get(r.headers.get('location'), s.collab)).text();
  assert.match(page, /TGHU1234567/);
  assert.match(page, /href="https:\/\/www\.msc\.com\/track\?x=1" target="_blank" rel="noopener"/);
  assert.match(await (await s.get('/conteneurs', s.collab)).text(), /TGHU1234567[\s\S]*?30\/12\/2026/);
  await s.fermer();
});

test('changer la date d’arrivée prévue garde l’historique', async () => {
  const s = await demarrer({ donnees: true });
  const ct = idConteneur(s);
  const fiche = { numero: KOREA, navire: 'MSC KOREA III - HR644A' };
  await s.post('/conteneurs/' + ct, { ...fiche, eta: '2026-12-10' }, s.collab);
  await s.post('/conteneurs/' + ct, { ...fiche, eta: '2026-12-10' }, s.collab); // même date : rien de plus
  await s.post('/conteneurs/' + ct, { ...fiche, eta: '2026-12-17' }, s.admin);
  assert.deepEqual(s.db.prepare('SELECT ancienne, nouvelle, par FROM eta_historique ORDER BY id').all().map(x => ({ ...x })), [
    { ancienne: null, nouvelle: '2026-12-10', par: 'collab' },
    { ancienne: '2026-12-10', nouvelle: '2026-12-17', par: 'eric' }]);
  assert.match(await (await s.get('/conteneurs/' + ct, s.collab)).text(), /10\/12\/2026[\s\S]*17\/12\/2026/);
  await s.fermer();
});

test('départ puis arrivée font avancer les voitures à bord, jamais reculer', async () => {
  const s = await demarrer({ donnees: true });
  const ct = idConteneur(s), v = voitures(s, ct);
  s.db.prepare("UPDATE vehicules SET statut = 'remise' WHERE id = ?").run(v.Pride);
  assert.equal((await s.post(`/conteneurs/${ct}/depart`, { date: 'hier' }, s.collab)).status, 400);
  assert.equal((await s.post(`/conteneurs/${ct}/depart`, { date: '2026-11-15' }, s.collab)).status, 302);
  assert.deepEqual([statut(s, v.Maxcruz), statut(s, v.K5), statut(s, v.Pride)], ['en_mer', 'en_mer', 'remise']);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM etapes WHERE statut = 'en_mer' AND date = '2026-11-15'").get().n, 4);
  assert.equal((await s.post(`/conteneurs/${ct}/arrivee`, { date: '2026-12-10' }, s.collab)).status, 302);
  assert.deepEqual([statut(s, v.Maxcruz), statut(s, v.Pride)], ['arrivee', 'remise']);
  assert.equal(s.db.prepare('SELECT date_arrivee FROM conteneurs WHERE id = ?').get(ct).date_arrivee, '2026-12-10');
  await s.fermer();
});

test('mettre une voiture dans un conteneur, puis l’en retirer', async () => {
  const s = await demarrer({ donnees: true });
  const ct = idConteneur(s);
  const avante = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Avante'").get().id;
  assert.equal((await s.post(`/conteneurs/${ct}/voitures`, { vehicule_id: 99999 }, s.collab)).status, 400);
  assert.equal((await s.post(`/conteneurs/${ct}/voitures`, { vehicule_id: avante }, s.collab)).status, 302);
  assert.deepEqual({ ...s.db.prepare('SELECT conteneur_id, statut FROM vehicules WHERE id = ?').get(avante) }, { conteneur_id: ct, statut: 'chargee' });
  assert.equal((await s.post(`/conteneurs/${ct}/voitures/${avante}/retirer`, {}, s.collab)).status, 302);
  assert.equal(s.db.prepare('SELECT conteneur_id FROM vehicules WHERE id = ?').get(avante).conteneur_id, null);
  await s.fermer();
});

test('facture du transitaire : répartition contrôlée, gain et perte affichés', async () => {
  const s = await demarrer({ donnees: true });
  const ct = idConteneur(s), v = voitures(s, ct);
  const corps = { date: '2026-12-18', [`douane_${v.Maxcruz}`]: '2 900 000', [`douane_${v.Tivoli}`]: '2 100 000',
    [`douane_${v.K5}`]: '1 500 000', [`douane_${v.Veloster}`]: '1 000 000', [`douane_${v.Pride}`]: '700 000' };
  assert.equal((await s.post(`/conteneurs/${ct}/facture`, { ...corps, montant: '9 000 000' }, s.collab)).status, 400);
  assert.equal((await s.post(`/conteneurs/${ct}/facture`, { ...corps, montant: '8 200 000', [`douane_${v.Pride}`]: 'abc' }, s.collab)).status, 400);
  assert.equal(s.db.prepare('SELECT date_facture FROM conteneurs WHERE id = ?').get(ct).date_facture, null);
  assert.equal((await s.post(`/conteneurs/${ct}/facture`, { ...corps, montant: '8 200 000' }, s.collab)).status, 302);
  const t = await (await s.get('/conteneurs/' + ct, s.collab)).text();
  assert.match(t, /125 000 F/);   // Maxcruz : 3 025 000 estimés − 2 900 000 réels = gain
  assert.match(t, /-120 000 F/);  // Tivoli : 1 980 000 − 2 100 000 = perte
  assert.match(t, />5 000 F</);    // total des voitures vendues dont on connaît l'estimation : 125 000 − 120 000
  assert.equal(statut(s, v.Maxcruz), 'dedouanee');
  assert.deepEqual({ ...s.db.prepare('SELECT date_facture, facture_transitaire FROM conteneurs WHERE id = ?').get(ct) }, { date_facture: '2026-12-18', facture_transitaire: 8200000 });
  await s.fermer();
});

test('conteneur inconnu : 404', async () => {
  const s = await demarrer();
  assert.equal((await s.get('/conteneurs/9999', s.collab)).status, 404);
  assert.equal((await s.post('/conteneurs/9999/depart', { date: '2026-11-15' }, s.collab)).status, 404);
  await s.fermer();
});
