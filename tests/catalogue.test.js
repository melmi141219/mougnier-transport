import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';

test('la gamme calcule le prix rendu à Libreville et prépare le message', async () => {
  const s = await demarrer({ donnees: true });
  const t = await (await s.get('/catalogue', s.collab)).text();
  assert.match(t, /Sportage[\s\S]*?8 036 000 F/);   // (3 300 000 + 1 600 000) × 1,64
  assert.match(t, /Aveo[\s\S]*?3 608 000 F/);       // sans l'arrondi de Lucien
  assert.match(t, /data-copier="Kia Sportage full option — prix en Corée : 3 300 000 F\. Transport : 1 600 000 F\. Rendu à Libreville, dédouané, tous frais compris : 8 036 000 F\./);
  await s.fermer();
});

test('ajouter, modifier, refuser un montant illisible, supprimer en admin seulement', async () => {
  const s = await demarrer({ donnees: true });
  const ligne = { marque: 'Hyundai', modele: 'Tucson', version: 'SUV', annee: '2018', achat: '4 500 000', transport: '1 600 000' };
  assert.equal((await s.post('/catalogue', { ...ligne, achat: 'cher' }, s.collab)).status, 400);
  assert.equal((await s.post('/catalogue', { ...ligne, modele: '' }, s.collab)).status, 400);
  assert.equal((await s.post('/catalogue', { ...ligne, transport: '' }, s.collab)).status, 400);
  assert.equal((await s.post('/catalogue', ligne, s.collab)).status, 302);
  const id = s.db.prepare("SELECT id FROM catalogue WHERE modele = 'Tucson'").get().id;
  assert.match(await (await s.get('/catalogue', s.collab)).text(), /Tucson[\s\S]*?10 004 000 F/); // 6 100 000 × 1,64
  assert.equal((await s.post('/catalogue/' + id, { ...ligne, achat: '4 000 000' }, s.collab)).status, 302);
  assert.equal(s.db.prepare('SELECT achat FROM catalogue WHERE id = ?').get(id).achat, 4000000);
  assert.equal((await s.get('/catalogue/' + id, s.collab)).status, 200);
  assert.equal((await s.post(`/catalogue/${id}/supprimer`, {}, s.collab)).status, 403);
  assert.equal((await s.post(`/catalogue/${id}/supprimer`, {}, s.admin)).status, 302);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM catalogue').get().n, 8);
  assert.equal((await s.get('/catalogue/9999', s.collab)).status, 404);
  await s.fermer();
});

test('une ligne de la gamme préremplit le formulaire de voiture', async () => {
  const s = await demarrer({ donnees: true });
  const id = s.db.prepare("SELECT id FROM catalogue WHERE modele = 'Sportage'").get().id;
  const cmd = s.db.prepare('SELECT id FROM commandes').get().id;
  const vide = await (await s.get(`/vehicules/nouveau?commande=${cmd}`, s.collab)).text();
  assert.match(vide, /Préremplir depuis la gamme/);
  assert.doesNotMatch(vide, /value="3300000"/);
  const rempli = await (await s.get(`/vehicules/nouveau?commande=${cmd}&catalogue=${id}`, s.collab)).text();
  for (const attendu of ['value="Kia"', 'value="Sportage"', 'value="full option"', 'value="3300000"', 'value="1600000"', `name="commande_id" value="${cmd}"`])
    assert.ok(rempli.includes(attendu), attendu);
  await s.fermer();
});
