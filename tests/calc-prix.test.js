import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prixVehicule, malus, pourcent, TAUX } from '../src/calc.js';

test('les taux sont ceux fixés avec Eric', () => {
  assert.deepEqual(TAUX, { frais: 900, douane: 5500, malusJour: 50, malusPlafond: 1000 });
  assert.equal(pourcent(1000000, 900), 90000); // 90 000 F par million
});

test('Lucien : calcul avec arrondi', () => {
  const p = prixVehicule({ achat: 1400000, transport: 800000, arrondi: -8000, forfait: null, verrou_hors_douane: null, verrou_douane: null });
  assert.deepEqual([p.frais, p.douane, p.horsDouane, p.total], [198000, 1210000, 2390000, 3600000]);
});

test('Alice : Avante + Santa Fe = 11 808 000', () => {
  const a = prixVehicule({ achat: 1800000, transport: 800000, arrondi: 0 });
  const s = prixVehicule({ achat: 3000000, transport: 1600000, arrondi: 0 });
  assert.equal(a.total, 4264000);
  assert.equal(s.total, 7544000);
  assert.equal(a.douane + s.douane, 3960000); // pas de 9 % sur la douane
});

test('forfait : douane comprise', () => {
  const p = prixVehicule({ forfait: 4000000, arrondi: 0 });
  assert.deepEqual([p.horsDouane, p.douane, p.total, p.forfait, p.douaneEstimee], [4000000, 0, 4000000, true, null]);
});

test('prix verrouillé : les coûts modifiés ne changent plus le prix client', () => {
  const p = prixVehicule({ achat: 3500000, transport: 1600000, arrondi: 0, verrou_hors_douane: 5341000, verrou_douane: 2695000 });
  assert.equal(p.total, 8036000);
  assert.equal(p.verrouille, true);
  assert.equal(p.douaneEstimee, 2805000); // suit les coûts réels
});

test('malus : 0,5 % par jour, plafonné à 10 %', () => {
  assert.equal(malus(3758000, 1), 18790);
  assert.equal(malus(3758000, 5), 93950);
  assert.equal(malus(3758000, 20), 375800);
  assert.equal(malus(3758000, 60), 375800);
  assert.equal(malus(3758000, 0), 0);
});
