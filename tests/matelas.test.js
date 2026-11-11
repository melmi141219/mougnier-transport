import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';
import { reglage } from '../src/db.js';
import { stockMatelas } from '../src/matelas.js';
import { appliquerSuiviDu11Novembre, chargerMatelas } from '../scripts/charger-donnees.js';

const prep = async () => {
  const s = await demarrer({ donnees: true });
  appliquerSuiviDu11Novembre(s.db, { date: '2026-11-11' });
  chargerMatelas(s.db);
  const arriver = numero => s.db.prepare("UPDATE conteneurs SET date_arrivee = '2027-01-05' WHERE numero = ?").run(numero);
  return { s, arriver };
};
const vente = (extra = {}) => ({ type: '2', quantite: '2', prix_unitaire: '40 000', date: '2027-01-06', mode: 'especes', acheteur: 'Client de passage', ...extra });
const resume = stock => stock.map(l => [l.type, l.enMer, l.disponible, l.vendus]);

test('stock de départ : 79 matelas en mer, d’après les listes du transporteur', async () => {
  const { s } = await prep();
  assert.deepEqual(resume(stockMatelas(s.db)), [['1', 6, 0, 0], ['2', 68, 0, 0], ['3', 5, 0, 0]]);
  assert.deepEqual(['matelas_prix_1', 'matelas_prix_2', 'matelas_prix_3'].map(c => reglage(s.db, c)), ['20000', '40000', '70000']);
  assert.throws(() => chargerMatelas(s.db), /déjà/);
  await s.fermer();
});

test('on ne vend que ce qui est arrivé ; une vente baisse le stock', async () => {
  const { s, arriver } = await prep();
  assert.equal((await s.post('/matelas/ventes', vente(), s.collab)).status, 400); // tout est encore en mer
  arriver('TSTU0000002'); // conteneur 2 : 4 une place, 14 deux places, 3 trois places
  assert.deepEqual(resume(stockMatelas(s.db)), [['1', 2, 4, 0], ['2', 54, 14, 0], ['3', 2, 3, 0]]);
  assert.equal((await s.post('/matelas/ventes', vente(), s.collab)).status, 302);
  assert.deepEqual(resume(stockMatelas(s.db))[1], ['2', 54, 12, 2]);
  assert.equal((await s.post('/matelas/ventes', vente({ quantite: '13' }), s.collab)).status, 400); // il n'en reste que 12
  for (const mauvais of [{ quantite: '0' }, { quantite: 'deux' }, { type: '4' }, { prix_unitaire: 'gratuit' }, { date: 'hier' }, { mode: 'troc' }])
    assert.equal((await s.post('/matelas/ventes', vente(mauvais), s.collab)).status, 400, JSON.stringify(mauvais));
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM matelas_ventes').get().n, 1);
  const page = await (await s.get('/matelas', s.collab)).text();
  assert.match(page, /80 000 F/); // encaissé
  assert.match(page, /Client de passage/);
  await s.fermer();
});

test('prix minimum : le collaborateur ne vend pas en dessous, l’administrateur peut', async () => {
  const { s, arriver } = await prep();
  arriver('TSTU0000002');
  assert.equal((await s.post('/matelas/ventes', vente({ prix_unitaire: '35 000' }), s.collab)).status, 400);
  assert.equal((await s.post('/matelas/ventes', vente({ type: '3', quantite: '1', prix_unitaire: '69 000' }), s.collab)).status, 400);
  assert.equal((await s.post('/matelas/ventes', vente({ prix_unitaire: '45 000' }), s.collab)).status, 302); // au-dessus du minimum
  assert.equal((await s.post('/matelas/ventes', vente({ prix_unitaire: '35 000', quantite: '1' }), s.admin)).status, 302);
  await s.fermer();
});

test('annuler une vente : admin seulement, le stock revient', async () => {
  const { s, arriver } = await prep();
  arriver('TSTU0000002');
  await s.post('/matelas/ventes', vente(), s.collab);
  const id = s.db.prepare('SELECT id FROM matelas_ventes').get().id;
  assert.equal((await s.post(`/matelas/ventes/${id}/annuler`, { motif: 'erreur' }, s.collab)).status, 403);
  assert.equal((await s.post(`/matelas/ventes/${id}/annuler`, { motif: '' }, s.admin)).status, 400);
  assert.equal((await s.post(`/matelas/ventes/${id}/annuler`, { motif: 'client revenu' }, s.admin)).status, 302);
  assert.deepEqual(resume(stockMatelas(s.db))[1], ['2', 54, 14, 0]);
  await s.fermer();
});

test('le coût d’achat et la marge des matelas ne se voient que sur la page Marges', async () => {
  const { s, arriver } = await prep();
  arriver('TSTU0000002');
  await s.post('/matelas/ventes', vente(), s.collab); // 2 deux places à 40 000 : coût d'exemple 2 × 16 000 ₩ × 0,4365 = 2 × 6 984 F
  const collab = await (await s.get('/matelas', s.collab)).text();
  for (const secret of ['6 984', '66 032', '₩', '16 000 ₩']) assert.ok(!collab.includes(secret), secret);
  const marges = await (await s.get('/marges', s.admin)).text();
  assert.match(marges, /Matelas[\s\S]*?66 032 F/);        // marge sur les matelas vendus : 80 000 − 13 968
  assert.match(marges, /Matelas[\s\S]*?1 286 000 ₩/);     // coût d'achat du stock complet : 6 × 8 000 + 68 × 16 000 + 5 × 30 000
  await s.fermer();
});
