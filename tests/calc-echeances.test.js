import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prixVehicule, echeances } from '../src/calc.js';

const P = (achat, transport, extra = {}) => prixVehicule({ achat, transport, arrondi: 0, ...extra });
const C = (id, extra = {}) => ({ id, eta: null, date_arrivee: null, date_facture: null, ...extra });
const V = (id, prix, mode, conteneur, notifArrivee = null, notifDouane = null) =>
  ({ id, prix, mode, conteneur, notifArrivee, notifDouane });

test('Carole : le Maxcruz est payé, le reste part sur les i30 sans date', () => {
  const l = echeances({ recu: 6500000, penalites: [], aujourdhui: '2026-12-01', vehicules: [
    V(1, P(3900000, 1600000), 'deux', C(7, { eta: '2026-12-10' })),
    V(2, P(2500000, 800000), 'deux', null),
    V(3, P(2500000, 800000), 'deux', null)] });
  const solde7 = l.find(x => x.type === 'solde' && x.conteneurId === 7);
  assert.deepEqual([solde7.montant, solde7.reste, solde7.etat], [5995000, 0, 'payee']);
  const soldeSans = l.find(x => x.type === 'solde' && x.conteneurId === null);
  assert.deepEqual([soldeSans.montant, soldeSans.paye, soldeSans.etat], [7194000, 505000, 'sans_date']);
  assert.deepEqual(soldeSans.vehiculeIds, [2, 3]);
  assert.equal(l.reduce((s, x) => s + x.reste, 0), 13344000);
});

test('forfait (Fabrice) : un seul solde, à relancer 10 jours avant', () => {
  const v = [V(1, prixVehicule({ forfait: 5500000 }), 'unique', C(7, { eta: '2026-12-10' }))];
  const j = d => echeances({ vehicules: v, penalites: [], recu: 2000000, aujourdhui: d });
  assert.equal(j('2026-11-29').length, 1);
  assert.equal(j('2026-11-29')[0].etat, 'a_venir');
  assert.deepEqual([j('2026-11-30')[0].etat, j('2026-11-30')[0].reste], ['a_relancer', 3500000]);
  assert.equal(j('2026-12-10')[0].etat, 'exigible');
});

test('retard et malus après notification + 10 jours', () => {
  const v = [V(1, prixVehicule({ forfait: 5500000 }), 'unique', C(7, { eta: '2026-12-10', date_arrivee: '2026-12-10' }), '2026-12-10')];
  const l = echeances({ vehicules: v, penalites: [], recu: 2000000, aujourdhui: '2026-12-25' })[0];
  assert.deepEqual([l.enRetardDepuis, l.etat, l.joursRetard, l.malus], ['2026-12-20', 'en_retard', 5, 87500]);
  assert.equal(echeances({ vehicules: v, penalites: [], recu: 2000000, aujourdhui: '2026-12-20' })[0].etat, 'exigible');
});

test('le délai se règle', () => {
  const v = [V(1, prixVehicule({ forfait: 5500000 }), 'unique', C(7, { date_arrivee: '2026-12-10' }), '2026-12-10')];
  const j = d => echeances({ vehicules: v, penalites: [], recu: 0, aujourdhui: d, delaiJours: 15 })[0].etat;
  assert.equal(j('2026-12-25'), 'exigible');
  assert.equal(j('2026-12-26'), 'en_retard');
});

test('la douane devient exigible quand la facture du transitaire est datée', () => {
  const ct = C(7, { eta: '2026-12-10', date_arrivee: '2026-12-10', date_facture: '2026-12-18' });
  const l = echeances({ vehicules: [V(1, P(2800000, 800000), 'deux', ct, '2026-12-10')], penalites: [], recu: 5000000, aujourdhui: '2026-12-19' });
  const d = l.find(x => x.type === 'douane');
  assert.deepEqual([d.montant, d.paye, d.reste, d.etat], [1980000, 1076000, 904000, 'exigible']);
});

test('crédit : payé plus que dû, ou payé sans voiture', () => {
  assert.deepEqual(echeances({ vehicules: [], penalites: [], recu: 4850000, aujourdhui: '2026-12-01' }), []);
  const v = [V(1, prixVehicule({ forfait: 1000000 }), 'unique', C(7, { eta: '2026-12-10' }))];
  const l = echeances({ vehicules: v, penalites: [], recu: 9000000, aujourdhui: '2026-12-09' });
  assert.deepEqual([l[0].paye, l[0].reste, l[0].etat], [1000000, 0, 'payee']);
});

test('une pénalité est exigible tout de suite et passe avant le solde du même jour', () => {
  const v = [V(1, prixVehicule({ forfait: 1000000 }), 'unique', C(7, { eta: '2026-12-10' }))];
  const l = echeances({ vehicules: v, penalites: [{ id: 1, montant: 50000, date: '2026-12-10' }], recu: 50000, aujourdhui: '2026-12-10' });
  assert.deepEqual(l.map(x => [x.type, x.reste]), [['penalite', 0], ['solde', 1000000]]);
});

test('voiture sans conteneur, ou conteneur sans date : rien de daté, pas de relance', () => {
  const l = echeances({ recu: 0, penalites: [], aujourdhui: '2026-12-01', vehicules: [
    V(1, P(1800000, 800000), 'deux', null),
    V(2, P(3000000, 1600000), 'deux', C(9))] });
  assert.equal(l.length, 4);
  assert.ok(l.every(x => x.etat === 'sans_date' && x.exigibleLe === null && x.malus === 0));
});

test('un remboursement supérieur aux versements ne crée pas de paiement négatif', () => {
  const v = [V(1, prixVehicule({ forfait: 1000000 }), 'unique', C(7, { eta: '2026-12-10' }))];
  const l = echeances({ vehicules: v, penalites: [], recu: -200000, aujourdhui: '2026-12-10' });
  assert.deepEqual([l[0].paye, l[0].reste], [0, 1000000]);
});
