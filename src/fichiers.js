// Fichiers déposés (photos des propositions, documents de transport) : rangés hors de public/, sous un nom tiré
// au hasard, reconnus par leurs premiers octets et jamais par leur nom. Le nom d'origine ne sert qu'à l'affichage.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Refus } from './saisie.js';

export const DEPOTS_PAR_JOUR = 200;
const MEGA = 1024 * 1024;

const TYPES = [
  { mime: 'image/jpeg', extension: 'jpg', reconnaitre: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', extension: 'png', reconnaitre: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', extension: 'webp', reconnaitre: b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { mime: 'application/pdf', extension: 'pdf', reconnaitre: b => b.toString('latin1', 0, 5) === '%PDF-' },
];
const NOM_STOCKE = /^[0-9a-f]{32}\.(jpg|png|webp|pdf)$/;

const MESSAGES = {
  fr: {
    vide: 'Le fichier est vide.',
    inconnu: 'Ce fichier n’est ni une photo (JPEG, PNG, WebP) ni un PDF.',
    photosSeulement: 'Seules les photos (JPEG, PNG, WebP) sont acceptées ici.',
    photoLourde: 'Photo trop lourde : 6 Mo au plus.',
    pdfLourd: 'PDF trop lourd : 15 Mo au plus.',
    limite: `Limite de ${DEPOTS_PAR_JOUR} fichiers par jour atteinte. Réessayez demain.`,
  },
  en: {
    vide: 'The file is empty.',
    inconnu: 'This file is neither a photo (JPEG, PNG, WebP) nor a PDF.',
    photosSeulement: 'Only photos (JPEG, PNG, WebP) are accepted here.',
    photoLourde: 'Photo too large: 6 MB at most.',
    pdfLourd: 'PDF too large: 15 MB at most.',
    limite: `Limit of ${DEPOTS_PAR_JOUR} files per day reached. Try again tomorrow.`,
  },
};

export function typeFichier(contenu) {
  const type = TYPES.find(t => t.reconnaitre(contenu));
  return type ? { mime: type.mime, extension: type.extension } : null;
}

// Dernier segment du nom (ni dossier ni lecteur), sans caractère de contrôle, 120 caractères au plus.
function nettoyerNom(nom, extension) {
  const propre = String(nom ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return propre || `document.${extension}`;
}

// Tout est contrôlé avant d'écrire quoi que ce soit : un fichier refusé ne laisse rien sur le disque.
export function enregistrerFichier(db, dossier, { contenu, nomOrigine, deposePar, offreId = null, pieceId = null, aujourdhui,
  imagesSeulement = false, anglais = false }) {
  const textes = MESSAGES[anglais ? 'en' : 'fr'];
  if (!dossier) throw new Error('Dossier des fichiers non configuré (MT_FILES_DIR).');
  if (!contenu?.length) throw new Refus(400, textes.vide);
  const type = typeFichier(contenu);
  if (!type) throw new Refus(400, textes.inconnu);
  const pdf = type.mime === 'application/pdf';
  if (pdf && imagesSeulement) throw new Refus(400, textes.photosSeulement);
  if (contenu.length > (pdf ? 15 : 6) * MEGA) throw new Refus(400, pdf ? textes.pdfLourd : textes.photoLourde);
  // Les fichiers supprimés comptent aussi : sinon déposer puis supprimer en boucle remplirait le disque et les sauvegardes.
  const deja = db.prepare('SELECT COUNT(*) AS n FROM fichiers WHERE depose_par = ? AND depose_le = ?').get(deposePar, aujourdhui).n;
  if (deja >= DEPOTS_PAR_JOUR) throw new Refus(429, textes.limite);

  const nomStocke = `${crypto.randomBytes(16).toString('hex')}.${type.extension}`;
  const chemin = path.join(dossier, nomStocke);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(chemin, contenu, { flag: 'wx' }); // wx : n'écrase jamais un fichier existant
  try {
    const id = db.prepare(`INSERT INTO fichiers (nom_stocke, nom_origine, type_mime, taille, offre_id, piece_id, depose_par, depose_le)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(nomStocke, nettoyerNom(nomOrigine, type.extension), type.mime, contenu.length,
      offreId, pieceId, deposePar, aujourdhui).lastInsertRowid;
    return { id: Number(id) };
  } catch (erreur) {
    fs.rmSync(chemin, { force: true });
    throw erreur;
  }
}

// null si le fichier n'existe pas, a été supprimé, manque sur le disque, ou si sa ligne a été trafiquée.
export function lireFichier(db, dossier, id) {
  const ligne = db.prepare('SELECT * FROM fichiers WHERE id = ? AND supprime_le IS NULL').get(id);
  if (!dossier || !ligne || !NOM_STOCKE.test(ligne.nom_stocke)) return null;
  const chemin = path.join(dossier, ligne.nom_stocke);
  return fs.existsSync(chemin) ? { ligne, chemin } : null;
}

// Retire le fichier du disque ; la ligne reste, marquée supprimée (même si le fichier manquait déjà).
// Renvoie false si rien n'était à supprimer.
export function supprimerFichier(db, dossier, id, aujourdhui) {
  const ligne = db.prepare('SELECT nom_stocke FROM fichiers WHERE id = ? AND supprime_le IS NULL').get(id);
  if (!ligne) return false;
  db.prepare('UPDATE fichiers SET supprime_le = ? WHERE id = ?').run(aujourdhui, id);
  if (dossier && NOM_STOCKE.test(ligne.nom_stocke)) fs.rmSync(path.join(dossier, ligne.nom_stocke), { force: true });
  return true;
}
