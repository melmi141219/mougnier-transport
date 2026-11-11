import path from 'node:path';

const env = process.env;
const dossierDonnees = env.MT_DATA_DIR || 'C:\\MT\\transport\\data';

export const config = {
  port: Number(env.MT_PORT) || 3210,
  dossierDonnees,
  fichierBase: path.join(dossierDonnees, 'transport.db'),
  // à côté du dossier de la base (C:\MT\transport\fichiers) : une base d'essai garde ainsi ses propres fichiers
  dossierFichiers: env.MT_FILES_DIR || path.join(path.dirname(dossierDonnees), 'fichiers'),
  dossierSauvegardes: env.MT_BACKUP_DIR
    || path.join(env.OneDrive || env.USERPROFILE || '.', 'Sauvegardes', 'MT-Transport'),
  https: env.MT_HTTPS === '1',
  // déposé par scripts/mettre-a-jour.ps1 : le serveur s'arrête et le superviseur le relance avec le nouveau programme
  fichierRedemarrage: path.join(path.dirname(dossierDonnees), 'redemarrer.txt'),
};
