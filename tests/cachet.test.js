import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';
import { reglage } from '../src/db.js';
import { SIGNATURE } from '../src/vues/documents/feuille.js';

const idClient = (s, nom) => s.db.prepare('SELECT id FROM clients WHERE nom = ?').get(nom).id;
const commandeDe = (s, nom) => s.db.prepare('SELECT id FROM commandes WHERE client_id = ?').get(idClient(s, nom)).id;
const versement = { sens: 'entree', montant: '1 000 000', date: '2026-11-20', mode: 'especes' };
const aLeCachet = texte => /class="cachet"/.test(texte);

test('les données de l’entreprise sont celles de MougnierTech', async () => {
  const s = await demarrer();
  assert.equal(reglage(s.db, 'rccm'), 'GA-LBV-01-2022-A10-00891');
  assert.equal(reglage(s.db, 'nif'), '20220200154 F');
  assert.equal(reglage(s.db, 'cachet_actif'), '1');
  await s.fermer();
});

test('contrat, reçu et procès-verbal portent le cachet et la signature du vendeur', async () => {
  const s = await demarrer({ donnees: true });
  const fabrice = idClient(s, 'Fabrice');
  const contrat = await (await s.get((await s.post(`/commandes/${commandeDe(s, 'Fabrice')}/contrat`, {}, s.collab)).headers.get('location'), s.collab)).text();
  const recu = await (await s.get((await s.post(`/clients/${fabrice}/mouvements`, { ...versement, montant: '3 500 000' }, s.collab)).headers.get('location'), s.collab)).text();
  s.db.prepare("UPDATE vehicules SET statut = 'dedouanee' WHERE modele = 'K5'").run();
  const k5 = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'K5'").get().id;
  const pv = await (await s.get((await s.post(`/vehicules/${k5}/remise`, { date: '2026-11-21' }, s.collab)).headers.get('location'), s.collab)).text();
  for (const [nom, texte] of [['contrat', contrat], ['reçu', recu], ['PV', pv]]) {
    assert.ok(aLeCachet(texte), `${nom} : cachet`);
    assert.match(texte, /MOUGNIER TRANSPORT<\/textPath>/, `${nom} : nom sur le cachet`);
    assert.match(texte, /RCCM GA-LBV-01-2022/, `${nom} : RCCM`);
    assert.match(texte, /NIF 20220200154 F/, `${nom} : NIF`);
    // la signature n'est pas dans le dépôt GitHub : sans le fichier, le cachet s'affiche seul, sans planter
    if (SIGNATURE) assert.match(texte, /<img[^>]+src="data:image\/png;base64,[A-Za-z0-9+/=]{1000,}"[^>]+alt="Signature d’Eric Patrick MOUGNIER"/, `${nom} : signature`);
    else assert.doesNotMatch(texte, /alt="Signature/, `${nom} : pas d'image de signature`);
  }
  await s.fermer();
});

test('pas de cachet sur un reçu annulé ni sur un contrat remplacé', async () => {
  const s = await demarrer({ donnees: true });
  const fabrice = idClient(s, 'Fabrice');
  const recu = await s.post(`/clients/${fabrice}/mouvements`, versement, s.collab);
  await s.post(`/mouvements/${s.db.prepare('SELECT MAX(id) id FROM mouvements').get().id}/annuler`, { motif: 'erreur' }, s.admin);
  assert.ok(!aLeCachet(await (await s.get(recu.headers.get('location'), s.collab)).text()));
  const premier = await s.post(`/commandes/${commandeDe(s, 'Fabrice')}/contrat`, {}, s.collab);
  const second = await s.post(`/commandes/${commandeDe(s, 'Fabrice')}/contrat`, {}, s.collab);
  assert.ok(!aLeCachet(await (await s.get(premier.headers.get('location'), s.collab)).text()));
  assert.ok(aLeCachet(await (await s.get(second.headers.get('location'), s.collab)).text()));
  await s.fermer();
});

test('l’administrateur peut retirer le cachet des documents ; la signature n’est pas un fichier public', async () => {
  const s = await demarrer({ donnees: true });
  const doc = (await s.post(`/commandes/${commandeDe(s, 'Fabrice')}/contrat`, {}, s.collab)).headers.get('location');
  const reglages = { delai_jours: '10', rccm: 'GA-LBV-01-2022-A10-00891', nif: '20220200154 F' };
  assert.equal((await s.post('/reglages', { ...reglages, cachet_actif: '0' }, s.admin)).status, 302);
  assert.ok(!aLeCachet(await (await s.get(doc, s.collab)).text()));
  assert.equal((await s.post('/reglages', { ...reglages, cachet_actif: '1' }, s.admin)).status, 302);
  assert.ok(aLeCachet(await (await s.get(doc, s.collab)).text()));
  for (const chemin of ['/signature-eric.png', '/signature.png', '/vues/documents/signature-eric.png'])
    assert.notEqual((await s.get(chemin)).status, 200, chemin);
  await s.fermer();
});
