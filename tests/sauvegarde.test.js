import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ouvrirBase } from '../src/db.js';
import { chargerDonnees } from '../scripts/charger-donnees.js';
import { sauvegarder } from '../scripts/sauvegarde.js';

test('la sauvegarde est une base lisible et les anciennes sont purgées', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-sauvegarde-'));
  const copies = path.join(dossier, "copies de l'entreprise"); // un chemin avec espace et apostrophe
  const db = ouvrirBase(path.join(dossier, 'source.db'));
  chargerDonnees(db, { date: '2026-11-10' });
  fs.mkdirSync(copies);
  fs.writeFileSync(path.join(copies, 'transport-2026-10-01.db'), 'vieux');
  fs.writeFileSync(path.join(copies, 'transport-2026-11-01.db'), 'récent');
  fs.writeFileSync(path.join(copies, 'autre-fichier.txt'), 'ne pas toucher');

  const fichier = sauvegarder(db, copies, '2026-11-10');
  assert.equal(path.basename(fichier), 'transport-2026-11-10.db');
  const copie = new DatabaseSync(fichier, { readOnly: true });
  assert.equal(copie.prepare('SELECT COUNT(*) n FROM clients').get().n, 10);
  assert.equal(copie.prepare('SELECT SUM(montant) total FROM mouvements').get().total, 35160000);
  copie.close();
  assert.ok(!fs.existsSync(path.join(copies, 'transport-2026-10-01.db')));
  assert.ok(fs.existsSync(path.join(copies, 'transport-2026-11-01.db')));
  assert.ok(fs.existsSync(path.join(copies, 'autre-fichier.txt')));
  assert.equal(sauvegarder(db, copies, '2026-11-10'), fichier); // deux fois le même jour : pas d'erreur
  db.close();
});
