// Copie propre de la base, une par jour, dans le dossier de sauvegardes. Garde les 30 derniers jours.
// Lancé chaque soir par la tâche planifiée : node scripts/sauvegarde.js
import fs from 'node:fs';
import path from 'node:path';
import { ouvrirBase } from '../src/db.js';
import { config } from '../src/config.js';
import { aujourdHui, ajouterJours } from '../src/format.js';

const JOURS_GARDES = 30;
const NOM = /^transport-(\d{4}-\d{2}-\d{2})\.db$/;
const FICHIER_DEPOSE = /^[0-9a-f]{32}\.(jpg|png|webp|pdf)$/;

// Photos et documents déposés : copiés dans <dossier>/fichiers s'ils n'y sont pas encore. Rien n'y est jamais effacé
// (un fichier supprimé de la plateforme reste dans la sauvegarde). Les noms sont tirés au hasard, jamais réutilisés.
function copierFichiers(dossierFichiers, dossier) {
  if (!dossierFichiers || !fs.existsSync(dossierFichiers)) return; // aucun dépôt encore
  const cible = path.join(dossier, 'fichiers');
  fs.mkdirSync(cible, { recursive: true });
  for (const nom of fs.readdirSync(dossierFichiers)) {
    if (FICHIER_DEPOSE.test(nom) && !fs.existsSync(path.join(cible, nom)))
      fs.copyFileSync(path.join(dossierFichiers, nom), path.join(cible, nom));
  }
}

export function sauvegarder(db, dossier, aujourdhui, dossierFichiers = null) {
  fs.mkdirSync(dossier, { recursive: true });
  // Les fichiers d'abord : s'ils ne se copient pas, la base du jour n'est pas écrite non plus,
  // et l'alerte de la page Aujourd'hui (aucune sauvegarde depuis 2 jours) le signale.
  copierFichiers(dossierFichiers, dossier);
  const fichier = path.join(dossier, `transport-${aujourdhui}.db`);
  // On écrit à côté puis on renomme : si l'écriture échoue, la copie précédente du jour reste intacte.
  const provisoire = `${fichier}.tmp`;
  fs.rmSync(provisoire, { force: true }); // VACUUM INTO refuse d'écraser un fichier
  db.exec(`VACUUM INTO '${provisoire.replaceAll("'", "''")}'`);
  fs.renameSync(provisoire, fichier);

  const limite = ajouterJours(aujourdhui, -JOURS_GARDES);
  for (const nom of fs.readdirSync(dossier)) {
    const date = NOM.exec(nom)?.[1];
    if (date && date < limite) fs.rmSync(path.join(dossier, nom));
  }
  return fichier;
}

// Date de la sauvegarde la plus récente du dossier, ou null s'il n'y en a aucune.
export function derniereSauvegarde(dossier) {
  if (!fs.existsSync(dossier)) return null;
  return fs.readdirSync(dossier).map(nom => NOM.exec(nom)?.[1]).filter(Boolean).sort().at(-1) ?? null;
}

if (import.meta.main) {
  // ouvrirBase créerait une base vide : sans ce contrôle, un mauvais chemin produirait une « sauvegarde » de rien.
  if (!fs.existsSync(config.fichierBase)) {
    console.error(`Base introuvable : ${config.fichierBase}. Aucune sauvegarde faite.`);
    process.exit(1);
  }
  console.log(`Sauvegarde écrite : ${sauvegarder(ouvrirBase(config.fichierBase), config.dossierSauvegardes, aujourdHui(), config.dossierFichiers)}`);
}
