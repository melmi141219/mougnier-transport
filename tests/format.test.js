import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fcfa, parseMontant, enLettres, ajouterJours, joursEntre, dateFr } from '../src/format.js';

test('fcfa', () => {
  assert.equal(fcfa(5450000), '5 450 000 F');
  assert.equal(fcfa(0), '0 F');
  assert.equal(fcfa(-120000), '-120 000 F');
});

test('parseMontant accepte les écritures courantes', () => {
  for (const t of ['5 450 000', '5.450.000', '5450000 F', ' 5450000 ', '5 450 000 FCFA'])
    assert.equal(parseMontant(t), 5450000, t);
});

test('parseMontant refuse le reste', () => {
  for (const t of ['', 'abc', '-5', '0', '5,45', '4.5', '1e6', null, undefined])
    assert.equal(parseMontant(t), null, String(t));
});

test('enLettres', () => {
  assert.equal(enLettres(3600000), 'trois millions six cent mille');
  assert.equal(enLettres(2000000), 'deux millions');
  assert.equal(enLettres(1600000), 'un million six cent mille');
  assert.equal(enLettres(190000), 'cent quatre-vingt-dix mille');
  assert.equal(enLettres(8036000), 'huit millions trente-six mille');
  assert.equal(enLettres(80), 'quatre-vingts');
  assert.equal(enLettres(81), 'quatre-vingt-un');
  assert.equal(enLettres(71), 'soixante et onze');
  assert.equal(enLettres(21), 'vingt et un');
  assert.equal(enLettres(200), 'deux cents');
  assert.equal(enLettres(201), 'deux cent un');
  assert.equal(enLettres(1000), 'mille');
  assert.equal(enLettres(0), 'zéro');
});

test('dates', () => {
  assert.equal(ajouterJours('2026-12-10', -10), '2026-11-30');
  assert.equal(ajouterJours('2026-12-25', 10), '2027-01-04');
  assert.equal(joursEntre('2026-12-20', '2026-12-25'), 5);
  assert.equal(dateFr('2026-11-10'), '10/11/2026');
});
