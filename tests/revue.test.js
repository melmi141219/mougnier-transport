// Tests ajoutés après la relecture finale : chacun reproduit un défaut trouvé par le relecteur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrer } from './aide.js';
import { compteClient } from '../src/compte.js';
import { actionsDuJour } from '../src/aujourdhui.js';
import { numeroWhatsApp } from '../src/telephone.js';
import { parseMontant, dateValide, enFrancs } from '../src/format.js';
import { derniereSauvegarde } from '../scripts/sauvegarde.js';

const idClient = (s, nom) => s.db.prepare('SELECT id FROM clients WHERE nom = ?').get(nom).id;
const commandeDe = (s, nom) => s.db.prepare('SELECT id FROM commandes WHERE client_id = ? ORDER BY id').get(idClient(s, nom)).id;
const KOREA = s => s.db.prepare("SELECT id FROM conteneurs WHERE numero = 'TSTU0000003'").get().id;
const conteneur = (s, champs) => s.db.prepare(`UPDATE conteneurs SET ${Object.keys(champs).map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(champs), KOREA(s));
const versement = (extra = {}) => ({ sens: 'entree', montant: '1 000 000', date: '2026-11-20', mode: 'especes', ...extra });

test('C1 — ajouter une voiture au forfait ne change pas les échéances des autres voitures de la commande', async () => {
  const s = await demarrer({ donnees: true });
  const cmd = commandeDe(s, 'Delphine');
  conteneur(s, { eta: '2026-12-10' });
  assert.equal((await s.post('/vehicules', { type: 'vente', commande_id: cmd, marque: 'Kia', modele: 'Morning', forfait: '2 000 000' }, s.collab)).status, 302);
  assert.equal(s.db.prepare('SELECT mode FROM commandes WHERE id = ?').get(cmd).mode, 'deux');
  const c = compteClient(s.db, idClient(s, 'Delphine'), '2026-12-01');
  assert.deepEqual([c.total, c.dontDouane], [13808000, 3960000]);
  const solde = c.lignes.find(l => l.type === 'solde' && l.conteneurId === KOREA(s));
  assert.equal(solde.montant, 3924000); // la douane de la Tivoli n'est pas passée dans le solde d'avant l'arrivée
  await s.fermer();
});

test('I1 — +241 suivi d’un 0 donne un numéro WhatsApp valable', () => {
  for (const t of ['+241 077 22 99 98', '00241 077229998', '+241 (0)77 22 99 98', '24177229998', '241 77 22 99 98'])
    assert.equal(numeroWhatsApp(t), '24177229998', t);
});

test('I2 — un double envoi n’enregistre pas le versement deux fois', async () => {
  const s = await demarrer({ donnees: true });
  const fabrice = idClient(s, 'Fabrice');
  assert.equal((await s.post(`/clients/${fabrice}/mouvements`, versement(), s.collab)).status, 302);
  const double = await s.post(`/clients/${fabrice}/mouvements`, versement(), s.collab);
  assert.equal(double.status, 409);
  assert.match(await double.text(), /vient d’être enregistré/);
  assert.equal(compteClient(s.db, fabrice, s.aujourdhui).reste, 2500000);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM documents WHERE type = 'recu'").get().n, 1);
  assert.equal((await s.post(`/clients/${fabrice}/mouvements`, versement({ montant: '500 000' }), s.collab)).status, 302);
  await s.fermer();
});

test('I3 — une pénalité impayée bloque « à remettre » et apparaît dans Aujourd’hui', async () => {
  const s = await demarrer({ donnees: true });
  const fabrice = idClient(s, 'Fabrice');
  conteneur(s, { eta: '2026-12-10', date_arrivee: '2026-12-10', date_facture: '2026-12-18' });
  s.db.prepare("UPDATE vehicules SET statut = 'dedouanee' WHERE modele = 'K5'").run();
  await s.post(`/clients/${fabrice}/mouvements`, versement({ montant: '3 500 000', date: '2026-12-19' }), s.collab);
  await s.post(`/clients/${fabrice}/penalites`, { nature: 'magasinage', montant: '75 000', date: '2026-12-19' }, s.collab);
  const a = actionsDuJour(s.db, '2026-12-20').filter(x => x.clientId === fabrice);
  assert.ok(!a.some(x => x.type === 'a_remettre'));
  assert.deepEqual(a.filter(x => x.type === 'penalites').map(x => x.montant), [75000]);
  s.aujourdhui = '2026-12-20';
  assert.match(await (await s.get('/', s.collab)).text(), /Pénalités[\s\S]*?75 000 F/);
  await s.fermer();
});

test('I4 — changer le délai dans les réglages ne change pas celui d’un contrat déjà émis', async () => {
  const s = await demarrer({ donnees: true });
  const fabrice = idClient(s, 'Fabrice');
  await s.post(`/commandes/${commandeDe(s, 'Fabrice')}/contrat`, {}, s.collab); // délai de 10 jours figé
  await s.post('/reglages', { delai_jours: '3' }, s.admin);
  conteneur(s, { eta: '2026-12-10', date_arrivee: '2026-12-10' });
  s.db.prepare("INSERT INTO relances (type, client_id, conteneur_id, envoye_le, par) VALUES ('arrivee', ?, ?, '2026-12-10', 'eric')").run(fabrice, KOREA(s));
  const etat = jour => compteClient(s.db, fabrice, jour).lignes[0].etat;
  assert.deepEqual([etat('2026-12-17'), etat('2026-12-20'), etat('2026-12-21')], ['exigible', 'exigible', 'en_retard']);
  await s.fermer();
});

test('I5 — pas de malus sans la clause : contrat papier ou pas de contrat', async () => {
  const s = await demarrer({ donnees: true });
  const lucien = idClient(s, 'Lucien'), estelle = idClient(s, 'Estelle'), fabrice = idClient(s, 'Fabrice');
  s.db.prepare("UPDATE vehicules SET conteneur_id = ? WHERE modele IN ('Aveo', 'i30')").run(KOREA(s));
  await s.post(`/commandes/${commandeDe(s, 'Fabrice')}/contrat`, {}, s.collab);
  conteneur(s, { eta: '2026-12-10', date_arrivee: '2026-12-10' });
  for (const c of [lucien, estelle, fabrice])
    s.db.prepare("INSERT INTO relances (type, client_id, conteneur_id, envoye_le, par) VALUES ('arrivee', ?, ?, '2026-12-10', 'eric')").run(c, KOREA(s));
  const ligne = c => compteClient(s.db, c, '2026-12-25').lignes[0];
  assert.deepEqual([ligne(lucien).etat, ligne(lucien).malus], ['en_retard', 0]);
  assert.deepEqual([ligne(estelle).etat, ligne(estelle).malus], ['en_retard', 0]);
  assert.deepEqual([ligne(fabrice).etat, ligne(fabrice).malus], ['en_retard', 87500]);
  const retards = actionsDuJour(s.db, '2026-12-25').filter(x => x.type === 'retard');
  assert.doesNotMatch(retards.find(x => x.clientId === lucien).message, /malus|article 5/);
  assert.match(retards.find(x => x.clientId === fabrice).message, /malus de 0,5 %/);
  s.aujourdhui = '2026-12-25';
  assert.equal((await s.post(`/clients/${lucien}/malus`, { conteneur_id: KOREA(s), ligne: 'solde', montant: '1000' }, s.admin)).status, 400);
  await s.fermer();
});

test('I6 — garde-fous : remboursement, remise, montant et date démesurés', async () => {
  const s = await demarrer({ donnees: true });
  const fabrice = idClient(s, 'Fabrice');
  assert.equal((await s.post(`/clients/${fabrice}/mouvements`, versement({ sens: 'sortie', montant: '5 000 000' }), s.collab)).status, 400);
  assert.equal((await s.post(`/clients/${fabrice}/mouvements`, versement({ sens: 'sortie', montant: '2 000 000' }), s.collab)).status, 302);
  const sportage = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Sportage'").get().id;
  assert.equal((await s.post('/vehicules/' + sportage, { marque: 'Kia', modele: 'Sportage', achat: '3 300 000', transport: '1 600 000', arrondi: '-9 000 000' }, s.collab)).status, 400);
  assert.equal(parseMontant('5 450 000 000'), null);
  assert.equal(parseMontant('999 999 999'), 999999999);
  for (const d of ['0202-11-10', '9999-12-31', '1899-12-31']) assert.equal(dateValide(d), null, d);
  assert.equal(dateValide('1985-03-02'), '1985-03-02');
  await s.fermer();
});

test('I7 — l’admin peut annuler une arrivée, une facture ou un message marqué envoyé par erreur', async () => {
  const s = await demarrer({ donnees: true });
  const ct = KOREA(s), fabrice = idClient(s, 'Fabrice');
  const k5 = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'K5'").get().id;
  const statut = () => s.db.prepare('SELECT statut FROM vehicules WHERE id = ?').get(k5).statut;
  await s.post(`/conteneurs/${ct}/depart`, { date: '2026-11-08' }, s.collab);
  await s.post(`/conteneurs/${ct}/arrivee`, { date: '2026-11-10' }, s.collab);
  await s.post('/relances', { type: 'arrivee', client_id: fabrice, conteneur_id: ct }, s.collab);
  assert.equal((await s.post(`/conteneurs/${ct}/arrivee/annuler`, {}, s.collab)).status, 403);
  assert.equal((await s.post(`/conteneurs/${ct}/arrivee/annuler`, {}, s.admin)).status, 302);
  assert.deepEqual([s.db.prepare('SELECT date_arrivee FROM conteneurs WHERE id = ?').get(ct).date_arrivee, statut()], [null, 'en_mer']);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM relances WHERE type = 'arrivee'").get().n, 0); // le délai ne court plus

  await s.post(`/conteneurs/${ct}/arrivee`, { date: '2026-12-10' }, s.collab);
  const parts = Object.fromEntries(s.db.prepare('SELECT id FROM vehicules WHERE conteneur_id = ?').all(ct).map(v => [`douane_${v.id}`, '1 000 000']));
  await s.post(`/conteneurs/${ct}/facture`, { date: '2026-12-18', montant: '5 000 000', ...parts }, s.collab);
  assert.equal(statut(), 'dedouanee');
  assert.equal((await s.post(`/conteneurs/${ct}/facture/annuler`, {}, s.collab)).status, 403);
  assert.equal((await s.post(`/conteneurs/${ct}/facture/annuler`, {}, s.admin)).status, 302);
  assert.deepEqual({ ...s.db.prepare('SELECT date_facture, facture_transitaire FROM conteneurs WHERE id = ?').get(ct) }, { date_facture: null, facture_transitaire: null });
  assert.deepEqual([statut(), s.db.prepare('SELECT douane_reelle FROM vehicules WHERE id = ?').get(k5).douane_reelle], ['arrivee', null]);

  await s.post('/relances', { type: 'solde', client_id: fabrice, conteneur_id: ct }, s.collab);
  const relance = s.db.prepare("SELECT id FROM relances WHERE type = 'solde'").get().id;
  assert.equal((await s.post(`/relances/${relance}/supprimer`, {}, s.collab)).status, 403);
  assert.equal((await s.post(`/relances/${relance}/supprimer`, {}, s.admin)).status, 302);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM relances WHERE type = 'solde'").get().n, 0);
  await s.fermer();
});

test('I8 — le reçu d’un versement annulé et un contrat remplacé le disent, à l’écran comme sur papier', async () => {
  const s = await demarrer({ donnees: true });
  const fabrice = idClient(s, 'Fabrice');
  const r = await s.post(`/clients/${fabrice}/mouvements`, versement(), s.collab);
  const m = s.db.prepare('SELECT MAX(id) id FROM mouvements').get().id;
  await s.post(`/mouvements/${m}/annuler`, { motif: 'saisi par erreur' }, s.admin);
  const recu = await (await s.get(r.headers.get('location'), s.collab)).text();
  assert.match(recu, /class="avertissement"[^>]*>[^<]*VERSEMENT ANNULÉ[^<]*saisi par erreur/);
  const premier = await s.post(`/commandes/${commandeDe(s, 'Fabrice')}/contrat`, {}, s.collab);
  await s.post(`/commandes/${commandeDe(s, 'Fabrice')}/contrat`, {}, s.collab);
  assert.match(await (await s.get(premier.headers.get('location'), s.collab)).text(), /class="avertissement"[^>]*>[^<]*CONTRAT REMPLACÉ/);
  await s.fermer();
});

test('I9 — une commande peut être marquée « contrat papier signé » : prix verrouillé, pas de contrat émis ensuite', async () => {
  const s = await demarrer({ donnees: true });
  const brigitte = commandeDe(s, 'Brigitte'), fabrice = commandeDe(s, 'Fabrice');
  assert.equal((await s.post(`/commandes/${brigitte}/papier`, {}, s.collab)).status, 302);
  assert.equal(s.db.prepare('SELECT contrat_papier FROM commandes WHERE id = ?').get(brigitte).contrat_papier, 1);
  assert.deepEqual({ ...s.db.prepare("SELECT verrou_hors_douane h, verrou_douane d FROM vehicules WHERE modele = 'Sportage'").get() }, { h: 5341000, d: 2695000 });
  assert.equal((await s.post(`/commandes/${brigitte}/contrat`, {}, s.collab)).status, 409);
  await s.post(`/commandes/${fabrice}/contrat`, {}, s.collab);
  assert.equal((await s.post(`/commandes/${fabrice}/papier`, {}, s.collab)).status, 409); // un contrat de la plateforme existe déjà
  assert.equal((await s.post('/commandes/9999/papier', {}, s.collab)).status, 404);
  await s.fermer();
});

test('I11 — la date de la dernière sauvegarde se lit dans le dossier', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-derniere-'));
  assert.equal(derniereSauvegarde(dossier), null);
  assert.equal(derniereSauvegarde(path.join(dossier, 'absent')), null);
  for (const nom of ['transport-2026-11-08.db', 'transport-2026-11-10.db', 'transport-2026-11-12.db.tmp', 'notes.txt'])
    fs.writeFileSync(path.join(dossier, nom), 'x');
  assert.equal(derniereSauvegarde(dossier), '2026-11-10');
});

test('les millions ronds s’écrivent « de francs CFA », comme dans le modèle d’Eric', async () => {
  assert.equal(enFrancs(2000000), 'deux millions de francs CFA');
  assert.equal(enFrancs(3600000), 'trois millions six cent mille francs CFA');
  assert.equal(enFrancs(1000000), 'un million de francs CFA');
  const s = await demarrer({ donnees: true });
  const r = await s.post(`/commandes/${commandeDe(s, 'Fabrice')}/contrat`, {}, s.collab);
  assert.ok((await (await s.get(r.headers.get('location'), s.collab)).text()).includes('deux millions de francs CFA'));
  await s.fermer();
});
