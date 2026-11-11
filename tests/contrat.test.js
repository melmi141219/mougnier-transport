import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';
import { compteClient } from '../src/compte.js';

const idClient = (s, nom) => s.db.prepare('SELECT id FROM clients WHERE nom = ?').get(nom).id;
const commandeDe = (s, nom) => s.db.prepare('SELECT id FROM commandes WHERE client_id = ? ORDER BY id').get(idClient(s, nom)).id;
const emettre = async (s, nom, cookie = s.collab) => {
  const r = await s.post(`/commandes/${commandeDe(s, nom)}/contrat`, {}, cookie);
  return { r, texte: r.status === 302 ? await (await s.get(r.headers.get('location'), s.collab)).text() : await r.text() };
};
const occurrences = (texte, motif) => texte.split(motif).length - 1;

test('contrat de Brigitte : montants, échéancier, clauses', async () => {
  const s = await demarrer({ donnees: true });
  s.aujourdhui = '2026-11-20';
  const { r, texte } = await emettre(s, 'Brigitte');
  assert.equal(r.status, 302);
  for (const attendu of ['MT-C-2026-001', '20/11/2026', 'Brigitte', 'Sportage', '8 036 000', 'huit millions trente-six mille',
    '3 300 000', '1 600 000', '2 695 000', '441 000', '3 270 000', '2 071 000', "vendu en l'état", 'Corée du Sud',
    'communiqués ultérieurement', 'dans un délai de 10 jours', '0,5 % par jour de retard, plafonné à 10 %',
    'magasinage, surestaries', "sauf les frais et malus de retard prévus à l'article 5",
    'Dès la fin des démarches du transitaire', 'Eric Patrick MOUGNIER', 'juridictions compétentes de Libreville', 'Lu et approuvé'])
    assert.ok(texte.includes(attendu), attendu);
  await s.fermer();
});

test('le prix est verrouillé : modifier la fiche ne change ni le solde ni le contrat émis', async () => {
  const s = await demarrer({ donnees: true });
  const { r, texte } = await emettre(s, 'Brigitte');
  const v = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Sportage'").get().id;
  await s.post('/vehicules/' + v, { marque: 'Kia', modele: 'Sportage', version: 'full option', achat: '3 500 000', transport: '1 600 000' }, s.collab);
  await s.post('/clients/' + idClient(s, 'Brigitte'), { nom: 'Brigitte MODIFIÉE' }, s.collab);
  assert.equal(compteClient(s.db, idClient(s, 'Brigitte MODIFIÉE'), s.aujourdhui).total, 8036000);
  assert.equal(await (await s.get(r.headers.get('location'), s.collab)).text(), texte);
  await s.fermer();
});

test('ré-émettre remplace l’ancien contrat et reprend les prix à jour', async () => {
  const s = await demarrer({ donnees: true });
  const premier = await emettre(s, 'Brigitte');
  const v = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Sportage'").get().id;
  await s.post('/vehicules/' + v, { marque: 'Kia', modele: 'Sportage', achat: '3 500 000', transport: '1 600 000' }, s.collab);
  const second = await emettre(s, 'Brigitte');
  assert.ok(second.texte.includes('MT-C-2026-002'));
  assert.ok(second.texte.includes('annule et remplace le contrat n° MT-C-2026-001'));
  assert.ok(second.texte.includes('8 364 000'));
  assert.equal(compteClient(s.db, idClient(s, 'Brigitte'), s.aujourdhui).total, 8364000);
  assert.deepEqual(s.db.prepare("SELECT numero, etat FROM documents WHERE type = 'contrat' ORDER BY id").all().map(x => ({ ...x })),
    [{ numero: 'MT-C-2026-001', etat: 'remplace' }, { numero: 'MT-C-2026-002', etat: 'emis' }]);
  assert.match(await (await s.get(premier.r.headers.get('location'), s.collab)).text(), /Remplacé/);
  await s.fermer();
});

test('pas de contrat pour un contrat papier, une commande vide ou inconnue', async () => {
  const s = await demarrer({ donnees: true });
  assert.equal((await emettre(s, 'Lucien')).r.status, 409);
  await s.post(`/clients/${idClient(s, 'Gaston')}/commandes`, { mode: 'deux' }, s.collab);
  assert.equal((await emettre(s, 'Gaston')).r.status, 409);
  assert.equal((await s.post('/commandes/9999/contrat', {}, s.collab)).status, 404);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM documents').get().n, 0);
  await s.fermer();
});

test('forfait (Fabrice) : acompte, un seul solde, pas de ligne douane ni de décomposition', async () => {
  const s = await demarrer({ donnees: true });
  const { texte } = await emettre(s, 'Fabrice');
  for (const attendu of ['5 500 000', 'cinq millions cinq cent mille', '2 000 000', '3 500 000', 'payable en une seule fois', 'ESSAI000000000003', 'TSTU0000003'])
    assert.ok(texte.includes(attendu), attendu);
  assert.ok(!texte.includes('Dès la fin des démarches du transitaire'));
  assert.ok(!texte.includes('Frais de service'));
  await s.fermer();
});

test('plusieurs voitures (Carole) : une désignation par voiture, total 19 844 000', async () => {
  const s = await demarrer({ donnees: true });
  const { texte } = await emettre(s, 'Carole Mba');
  assert.equal(occurrences(texte, 'N° de châssis'), 3);
  for (const attendu of ['19 844 000', 'dix-neuf millions huit cent quarante-quatre mille', '6 500 000', '6 689 000', '6 655 000', 'les véhicules'])
    assert.ok(texte.includes(attendu), attendu);
  await s.fermer();
});

test('deux commandes : les versements couvrent d’abord la plus ancienne', async () => {
  const s = await demarrer();
  await s.post('/clients', { nom: 'Paul' }, s.collab);
  const paul = idClient(s, 'Paul');
  for (const forfait of ['1 000 000', '2 000 000']) {
    await s.post(`/clients/${paul}/commandes`, { mode: 'unique' }, s.collab);
    const cmd = s.db.prepare('SELECT MAX(id) id FROM commandes').get().id;
    await s.post('/vehicules', { type: 'vente', commande_id: cmd, marque: 'Kia', modele: 'Morning', forfait }, s.collab);
  }
  await s.post(`/clients/${paul}/mouvements`, { sens: 'entree', montant: '1 500 000', date: '2026-11-10', mode: 'especes' }, s.collab);
  const [a, b] = s.db.prepare('SELECT id FROM commandes ORDER BY id').all().map(c => c.id);
  await s.post(`/commandes/${a}/contrat`, {}, s.collab);
  await s.post(`/commandes/${b}/contrat`, {}, s.collab);
  const donnees = s.db.prepare("SELECT donnees FROM documents WHERE type = 'contrat' ORDER BY id").all().map(d => JSON.parse(d.donnees));
  assert.deepEqual(donnees.map(d => [d.total, d.acompte, d.echeancier.at(-1).montant]), [[1000000, 1000000, 0], [2000000, 500000, 1500000]]);
  await s.fermer();
});

test('le contrat échappe ce que l’on a saisi', async () => {
  const s = await demarrer();
  await s.post('/clients', { nom: '<img src=x onerror=alert(1)>' }, s.collab);
  await s.post(`/clients/${s.db.prepare('SELECT id FROM clients').get().id}/commandes`, { mode: 'unique' }, s.collab);
  await s.post('/vehicules', { type: 'vente', commande_id: 1, marque: 'Kia', modele: '<b>K5</b>', forfait: '5 500 000' }, s.collab);
  const r = await s.post('/commandes/1/contrat', {}, s.collab);
  const texte = await (await s.get(r.headers.get('location'), s.collab)).text();
  assert.ok(!texte.includes('<img src=x'));
  assert.ok(!texte.includes('<b>K5</b>'));
  await s.fermer();
});

test('marquer un contrat comme signé', async () => {
  const s = await demarrer({ donnees: true });
  await emettre(s, 'Fabrice');
  const doc = s.db.prepare('SELECT id FROM documents').get().id;
  assert.equal((await s.post(`/documents/${doc}/signe`, {}, s.collab)).status, 302);
  assert.equal(s.db.prepare('SELECT etat FROM documents WHERE id = ?').get(doc).etat, 'signe');
  assert.equal((await s.post('/documents/9999/signe', {}, s.collab)).status, 404);
  await s.fermer();
});

test('remise refusée tant qu’il reste à payer, acceptée ensuite avec un procès-verbal', async () => {
  const s = await demarrer({ donnees: true });
  const fabrice = idClient(s, 'Fabrice');
  const k5 = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'K5'").get().id;
  s.aujourdhui = '2026-12-20';
  assert.equal((await s.post(`/vehicules/${k5}/remise`, { date: '2026-12-20' }, s.collab)).status, 409); // pas encore dédouanée
  s.db.prepare("UPDATE vehicules SET statut = 'dedouanee' WHERE id = ?").run(k5);
  const refus = await s.post(`/vehicules/${k5}/remise`, { date: '2026-12-20' }, s.collab);
  assert.equal(refus.status, 409);
  assert.match(await refus.text(), /3 500 000 F/);
  await s.post(`/clients/${fabrice}/mouvements`, { sens: 'entree', montant: '3 500 000', date: '2026-12-20', mode: 'especes' }, s.collab);
  assert.equal((await s.post(`/vehicules/${k5}/remise`, { date: 'demain' }, s.collab)).status, 400);
  const ok = await s.post(`/vehicules/${k5}/remise`, { date: '2026-12-20' }, s.collab);
  assert.equal(ok.status, 302);
  assert.equal(s.db.prepare('SELECT statut FROM vehicules WHERE id = ?').get(k5).statut, 'remise');
  const pv = await (await s.get(ok.headers.get('location'), s.collab)).text();
  for (const attendu of ['MT-PV-2026-001', 'Procès-verbal de livraison', 'Fabrice', 'ESSAI000000000003', '20/12/2026', 'des clés et des documents'])
    assert.ok(pv.includes(attendu), attendu);
  assert.equal((await s.post(`/vehicules/${k5}/remise`, { date: '2026-12-21' }, s.collab)).status, 409); // déjà remise
  await s.fermer();
});

test('une voiture à moi se récupère sans procès-verbal', async () => {
  const s = await demarrer({ donnees: true });
  const pride = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Pride'").get().id;
  assert.equal((await s.post(`/vehicules/${pride}/remise`, { date: '2026-12-20' }, s.collab)).status, 302);
  assert.equal(s.db.prepare('SELECT statut FROM vehicules WHERE id = ?').get(pride).statut, 'remise');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM documents').get().n, 0);
  await s.fermer();
});
