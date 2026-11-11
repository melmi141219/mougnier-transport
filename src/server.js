import fs from 'node:fs';
import { config } from './config.js';
import { ouvrirBase } from './db.js';
import { creerApp } from './app.js';

const db = ouvrirBase(config.fichierBase);
db.prepare('DELETE FROM sessions WHERE expire_le < ?').run(new Date().toISOString());

// 127.0.0.1 seulement : l'accès à distance passe par « tailscale serve », jamais par un port ouvert.
creerApp(db, { https: config.https, dossierSauvegardes: config.dossierSauvegardes, dossierFichiers: config.dossierFichiers }).listen(config.port, '127.0.0.1', () => {
  console.log(`MOUGNIER TRANSPORT : http://127.0.0.1:${config.port} (base : ${config.fichierBase})`);
});

// Mise à jour : quand ce fichier change, le serveur s'arrête ; le superviseur (scripts/superviseur.js) le relance.
fs.watchFile(config.fichierRedemarrage, { interval: 2000 }, (actuel, avant) => {
  if (actuel.mtimeMs === avant.mtimeMs) return;
  console.log(`${new Date().toISOString()} redémarrage demandé par une mise à jour`);
  db.close();
  process.exit(0);
});
