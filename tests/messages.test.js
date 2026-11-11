import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msgSolde, msgArrivee, msgDouane, msgRetard, msgGroupeDepart, msgGroupeArrivee, msgCatalogue } from '../src/messages.js';

test('msgSolde donne le solde et la douane à prévoir', () => {
  const m = msgSolde({ nom: 'Alice', vehicules: 'Hyundai Avante', navire: 'MSC KOREA III', eta: '2026-12-10', montant: 3758000, douaneAPrevoir: 3960000 });
  assert.match(m, /3 758 000 F/);
  assert.match(m, /3 960 000 F/);
  assert.match(m, /10\/12\/2026/);
  assert.doesNotMatch(
    msgSolde({ nom: 'Fabrice', vehicules: 'Kia K5', navire: 'X', eta: '2026-12-10', montant: 3500000, douaneAPrevoir: 0 }),
    /douane/);
});

test('msgArrivee : reste à régler ou solde réglé', () => {
  assert.match(msgArrivee({ nom: 'Fabrice', vehicules: 'Kia K5', dateArrivee: '2026-12-10', montant: 3500000, delaiJours: 10 }), /3 500 000 F à régler sous 10 jours/);
  assert.match(msgArrivee({ nom: 'Carole', vehicules: 'Maxcruz', dateArrivee: '2026-12-10', montant: 0, delaiJours: 10 }), /Votre solde est réglé/);
});

test('msgDouane donne l’adresse des locaux', () => {
  assert.match(
    msgDouane({ nom: 'Carole', vehicules: 'Maxcruz', montant: 2520000, adresse: 'Mindoubé, Libreville' }),
    /2 520 000 F.*Mindoubé, Libreville/s);
});

test('msgRetard donne la somme, la date et le malus', () => {
  const m = msgRetard({ nom: 'Fabrice', montant: 3500000, depuis: '2026-12-20', malus: 87500 });
  assert.match(m, /3 500 000 F/);
  assert.match(m, /20\/12\/2026/);
  assert.match(m, /87 500 F/);
});

test('les messages de groupe ne portent ni montant ni nom de client', () => {
  for (const m of [
    msgGroupeDepart({ navire: 'MSC KOREA III', eta: '2026-12-10', nbVehicules: 5 }),
    msgGroupeArrivee({ navire: 'MSC KOREA III' })]) {
    assert.doesNotMatch(m, /\d \d{3} \d{3}/);
    assert.doesNotMatch(m, / F\b/);
  }
  assert.equal(msgGroupeDepart.length, 1); // un seul objet en paramètre, sans champ client
  assert.equal(msgGroupeArrivee.length, 1);
});

test('msgCatalogue annonce le prix rendu à Libreville', () => {
  const m = msgCatalogue({ libelle: 'Kia Sportage full option', achat: 3300000, transport: 1600000, rendu: 8036000 });
  assert.match(m, /Kia Sportage full option/);
  assert.match(m, /8 036 000 F/);
});
