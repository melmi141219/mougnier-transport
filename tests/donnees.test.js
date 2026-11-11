import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../src/db.js';
import { compteClient } from '../src/compte.js';
import { chargerDonnees, appliquerSuiviDu11Novembre } from '../scripts/charger-donnees.js';
import { actionsDuJour } from '../src/aujourdhui.js';

const ATTENDU = { // nom → [total, reçu, reste, dont douane] : le tableau validé par Eric
  'Alice': [11808000, 4090000, 7718000, 3960000],
  'Directrice (Entreprise A)': [10824000, 5450000, 5374000, 3630000],
  'Brigitte': [8036000, 3270000, 4766000, 2695000],
  'Carole Mba': [19844000, 6500000, 13344000, 6655000],
  'Delphine': [11808000, 5000000, 6808000, 3960000],
  'Lucien': [3600000, 2000000, 1600000, 1210000],
  'Estelle': [4000000, 2000000, 2000000, 0],
  'Fabrice': [5500000, 2000000, 3500000, 0],
};

const base = () => { const db = ouvrirBase(':memory:'); chargerDonnees(db, { date: '2026-11-10' }); return db; };
const idDe = (db, nom) => db.prepare('SELECT id FROM clients WHERE nom = ?').get(nom).id;

test('les soldes de départ sont ceux validés par Eric', () => {
  const db = base();
  let somme = 0;
  for (const [nom, [total, recu, reste, douane]] of Object.entries(ATTENDU)) {
    const c = compteClient(db, idDe(db, nom), '2026-11-10');
    assert.deepEqual([c.total, c.recu, c.reste, c.dontDouane], [total, recu, reste, douane], nom);
    somme += c.reste;
  }
  assert.equal(somme, 45110000);
});

test('Gaston a un crédit, Hélène ne doit rien, les voitures d’Eric ne comptent pas', () => {
  const db = base();
  const gaston = compteClient(db, idDe(db, 'Gaston'), '2026-11-10');
  assert.deepEqual([gaston.reste, gaston.credit, gaston.lignes.length], [0, 4850000, 0]);
  const helene = compteClient(db, idDe(db, 'Hélène'), '2026-11-10');
  assert.deepEqual([helene.total, helene.reste, helene.credit], [0, 0, 0]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM vehicules WHERE type = 'perso'").get().n, 6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vehicules WHERE conteneur_id IS NOT NULL').get().n, 8);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM catalogue').get().n, 8);
});

test('les données de départ ne se chargent qu’une fois', () => {
  const db = base();
  assert.throws(() => chargerDonnees(db), /déjà/);
});

test('Lucien suit son contrat papier : un seul solde de 1 600 000', () => {
  const db = base();
  const c = compteClient(db, idDe(db, 'Lucien'), '2026-11-10');
  assert.deepEqual(c.lignes.map(l => [l.type, l.montant, l.reste]), [['solde', 3600000, 1600000]]);
});

test('mise à jour du 11/11 : conteneur 2, dates MSC, voitures de Gaston, relances attendues', () => {
  const db = base();
  appliquerSuiviDu11Novembre(db, { date: '2026-11-11' });
  const id = nom => idDe(db, nom);

  const gaston = compteClient(db, id('Gaston'), '2026-11-11');
  assert.deepEqual([gaston.total, gaston.recu, gaston.reste, gaston.credit], [8000000, 4850000, 3150000, 0]);
  const resteTotal = db.prepare('SELECT id FROM clients').all().reduce((s, c) => s + compteClient(db, c.id, '2026-11-11').reste, 0);
  assert.equal(resteTotal, 48260000);

  const conteneurs = db.prepare(`SELECT ct.numero, ct.date_depart, ct.eta, ct.lien_suivi,
    (SELECT COUNT(*) FROM vehicules v WHERE v.conteneur_id = ct.id) AS nb,
    (SELECT COUNT(*) FROM vehicules v WHERE v.conteneur_id = ct.id AND v.statut = 'en_mer') AS en_mer
    FROM conteneurs ct ORDER BY ct.numero`).all().map(c => ({ ...c }));
  assert.deepEqual(conteneurs.map(c => [c.numero, c.date_depart, c.eta, c.nb, c.en_mer]), [
    ['TSTU0000001', '2026-10-31', '2027-01-05', 3, 3],
    ['TSTU0000002', '2026-10-31', '2027-01-05', 6, 6],
    ['TSTU0000003', '2026-11-08', '2027-01-09', 5, 5]]);
  assert.equal(conteneurs[1].lien_suivi, 'https://www.msc.com/en/track-a-shipment?trackingNumber=TSTU0000002&trackingMode=0');
  const aBord = db.prepare(`SELECT COALESCE(c.nom, 'Eric') AS pour, v.modele, v.couleur FROM vehicules v LEFT JOIN clients c ON c.id = v.client_id
    WHERE v.conteneur_id = (SELECT id FROM conteneurs WHERE numero = 'TSTU0000002') ORDER BY pour, v.id`).all().map(v => `${v.pour}:${v.modele}:${v.couleur ?? ''}`);
  assert.deepEqual(aBord, ['Alice:Avante:', 'Carole Mba:i30 GDI:Rouge', 'Eric:i30 GDI:Blanche', 'Estelle:i30:', 'Gaston:i30:', 'Gaston:i30:']);

  const relances = jour => actionsDuJour(db, jour).filter(a => a.type === 'relance_solde').map(a => [a.clientId, a.montant]).sort((x, y) => x[0] - y[0]);
  const tri = liste => liste.sort((x, y) => x[0] - y[0]);
  assert.deepEqual(relances('2026-12-25'), []);
  assert.deepEqual(relances('2026-12-26'), tri([[id('Gaston'), 3150000], [id('Estelle'), 2000000]]));
  assert.deepEqual(relances('2026-12-30'), tri([[id('Gaston'), 3150000], [id('Estelle'), 2000000], [id('Carole Mba'), 3092000], [id('Fabrice'), 3500000]]));
  assert.equal(actionsDuJour(db, '2026-11-11').filter(a => a.type === 'annonce_depart').length, 3);
});

test('compteClient renvoie null pour un client inconnu', () => {
  assert.equal(compteClient(base(), 9999, '2026-11-10'), null);
});
