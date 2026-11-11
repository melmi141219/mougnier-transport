import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, reglage, definirReglage } from '../src/db.js';

test('ouvrirBase crée le schéma et les réglages, deux fois sans erreur', () => {
  const db = ouvrirBase(':memory:');
  assert.equal(reglage(db, 'delai_jours'), '10');
  definirReglage(db, 'delai_jours', '15');
  assert.equal(reglage(db, 'delai_jours'), '15');
  // clé étrangère : pas de mouvement pour un client inexistant
  assert.throws(() => db.prepare(
    "INSERT INTO mouvements (client_id,sens,montant,date,mode,saisi_par,saisi_le) VALUES (999,'entree',1,'2026-01-01','especes','x','x')"
  ).run());
});
