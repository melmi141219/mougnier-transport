import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const REGLAGES_PAR_DEFAUT = {
  delai_jours: '10',
  entreprise_tel: '077229998',
  entreprise_adresse: 'BP 12 613, Mindoubé, Libreville',
  adresse_locaux: '',
  rccm: 'GA-LBV-01-2022-A10-00891', // données de MougnierTech (dossier Cachet_MOUGNIERTECH d'Eric)
  nif: '20220200154 F',
  cachet_actif: '1',                // cachet et signature du vendeur sur les documents émis
  taux_won: '0.4365', // francs CFA pour 1 won (début novembre 2026), modifiable sur la page Marges
  // coûts : valeurs d'exemple pour une base neuve ; les vrais se saisissent sur la page Marges et restent dans la base
  taux_usd: '585',             // francs CFA pour 1 dollar (début novembre 2026)
  fret_usd: '5000',            // fret d'un conteneur
  chargement_won: '400000',    // chargement d'un conteneur
  frais_voiture_won: '100000', // par voiture : carte grise, sticker, kilométrage
  // matelas : prix de vente minimum en francs CFA, coût d'achat en wons (1, 2 et 3 places)
  matelas_prix_1: '20000', matelas_prix_2: '40000', matelas_prix_3: '70000',
  matelas_cout_1: '8000', matelas_cout_2: '16000', matelas_cout_3: '30000',
};

// [table, colonne, définition (INTEGER par défaut)] : une colonne NOT NULL doit avoir une valeur par défaut.
const COLONNES_AJOUTEES = [
  ['commandes', 'delai_jours'], ['conteneurs', 'frais_coree_won'],
  ['vehicules', 'achat_reel_won'], ['vehicules', 'achat_reel_fcfa'], ['vehicules', 'transport_reel'],
  ['versements_fournisseur', 'destinataire', "TEXT NOT NULL DEFAULT 'fournisseur' CHECK (destinataire IN ('fournisseur','transporteur'))"],
];

// Base créée avant les comptes partenaires : sa table utilisateurs n'accepte que deux rôles, et SQLite ne sait pas
// modifier un contrôle. On la reconstruit comme le prescrit SQLite (https://sqlite.org/lang_altertable.html#otheralter) :
// nouvelle table, copie des lignes avec leur numéro, suppression de l'ancienne, renommage ; tout ou rien.
function accepterRolesPartenaires(db) {
  const actuelle = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'utilisateurs'").get().sql;
  if (actuelle.includes('transporteur')) return;
  const [, colonnes] = SCHEMA.match(/CREATE TABLE IF NOT EXISTS utilisateurs (\([\s\S]*?\));/); // la définition de schema.sql
  // Clés étrangères coupées le temps de l'opération, sinon DROP TABLE échoue dès qu'une session existe.
  // Ce réglage est sans effet dans une transaction : il se fait avant, et se rétablit après, quoi qu'il arrive.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(db, () => {
      db.exec(`
        CREATE TABLE utilisateurs_nouveau ${colonnes};
        INSERT INTO utilisateurs_nouveau (id, identifiant, nom, role, mot_de_passe, actif)
          SELECT id, identifiant, nom, role, mot_de_passe, actif FROM utilisateurs;
        DROP TABLE utilisateurs;
        ALTER TABLE utilisateurs_nouveau RENAME TO utilisateurs;`);
      const cassees = [...new Set(db.prepare('PRAGMA foreign_key_check').all().map(ligne => ligne.table))];
      if (cassees.length) throw new Error(`Mise à niveau des comptes annulée, rien n’a été modifié : clés étrangères incohérentes dans ${cassees.join(', ')}.`);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function ouvrirBase(fichier) {
  if (fichier !== ':memory:') fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const db = new DatabaseSync(fichier);
  // busy_timeout : la sauvegarde du soir ouvre la base pendant que le serveur tourne
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  accepterRolesPartenaires(db);
  // Base créée par une version plus ancienne : on ajoute les colonnes apparues depuis.
  for (const [table, colonne, definition = 'INTEGER'] of COLONNES_AJOUTEES) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === colonne))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
  }
  const inserer = db.prepare('INSERT OR IGNORE INTO reglages (cle, valeur) VALUES (?, ?)');
  for (const [cle, valeur] of Object.entries(REGLAGES_PAR_DEFAUT)) inserer.run(cle, valeur);
  return db;
}

export function reglage(db, cle) {
  return db.prepare('SELECT valeur FROM reglages WHERE cle = ?').get(cle)?.valeur ?? '';
}

export function definirReglage(db, cle, valeur) {
  db.prepare(
    'INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur'
  ).run(cle, String(valeur));
}

// Tout ou rien : si fn lève une erreur, rien n'est écrit.
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const resultat = fn();
    db.exec('COMMIT');
    return resultat;
  } catch (erreur) {
    db.exec('ROLLBACK');
    throw erreur;
  }
}
