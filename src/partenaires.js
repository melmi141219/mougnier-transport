// Documents de transport attendus pour chaque conteneur. La liste se déduit du conteneur et des voitures à bord :
// rien n'est à créer à la main. Pas de ligne dans « pieces » = document attendu.
import { Refus, entier } from './saisie.js';
import { libelleVoiture } from './libelles.js';

// [code, libellé français, libellé anglais]
export const TYPES_PIECES = {
  conteneur: [
    ['bl_brouillon', 'Brouillon du connaissement', 'Draft bill of lading'],
    ['bl_final', 'Connaissement final', 'Final bill of lading'],
    ['telex', 'Libération télex', 'Telex release'],
    ['facture_colisage', 'Facture et liste de colisage', 'Invoice and packing list'],
    ['declaration_export', 'Déclaration d’export', 'Export declaration'],
    ['bietc', 'BIETC', 'BIETC (cargo tracking note)'],
  ],
  voiture: [
    ['immatriculation', 'Certificat d’immatriculation', 'Registration certificate'],
    ['radiation', 'Certificat de radiation', 'Deregistration certificate'],
  ],
};
const TOUS = [...TYPES_PIECES.conteneur, ...TYPES_PIECES.voiture];
export const libellePiece = (type, anglais = false) => TOUS.find(([code]) => code === type)?.[anglais ? 2 : 1] ?? type;
export const ETATS_PIECE = { attendu: ['Attendu', 'Expected'], envoye: ['Envoyé', 'Sent'], valide: ['Validé', 'Validated'] };

const nomVoiture = v => [libelleVoiture(v), v.chassis].filter(Boolean).join(' — ');

export function piecesAttendues(db, conteneurId) {
  const voitures = db.prepare('SELECT id, marque, modele, version, annee, chassis FROM vehicules WHERE conteneur_id = ? AND annulee = 0 ORDER BY id').all(conteneurId);
  const lignes = db.prepare('SELECT * FROM pieces WHERE conteneur_id = ?').all(conteneurId);
  const fichiers = db.prepare(`SELECT f.id, f.nom_origine, f.piece_id FROM fichiers f JOIN pieces p ON p.id = f.piece_id
    WHERE p.conteneur_id = ? AND f.supprime_le IS NULL ORDER BY f.id`).all(conteneurId);
  // Une ligne d'une voiture qui n'est plus à bord n'est pas lue (ni effacée : si la voiture revient, ses pièces aussi).
  const piece = (type, voiture) => {
    const ligne = lignes.find(l => l.type === type && l.vehicule_id === (voiture?.id ?? null));
    return {
      type, vehiculeId: voiture?.id ?? null, libelleVoiture: voiture ? nomVoiture(voiture) : null,
      etat: ligne?.etat ?? 'attendu', remarque: ligne?.remarque ?? null,
      fichiers: ligne ? fichiers.filter(f => f.piece_id === ligne.id).map(({ id, nom_origine }) => ({ id, nom_origine })) : [],
    };
  };
  return [...TYPES_PIECES.conteneur.map(([type]) => piece(type, null)),
    ...voitures.flatMap(v => TYPES_PIECES.voiture.map(([type]) => piece(type, v)))];
}

// Le document désigné par un formulaire : type connu, rattaché au conteneur ou à une voiture à bord non annulée.
export function designerPiece(db, conteneurId, { type, vehicule_id: vehicule }, anglais = false) {
  const refus = (fr, en) => new Refus(400, anglais ? en : fr);
  const code = String(type ?? '');
  const vehiculeId = String(vehicule ?? '').trim() === '' ? null : entier(vehicule);
  const duConteneur = TYPES_PIECES.conteneur.some(([c]) => c === code);
  const dUneVoiture = TYPES_PIECES.voiture.some(([c]) => c === code);
  if (!duConteneur && !dUneVoiture) throw refus('Document inconnu.', 'Unknown document.');
  if (duConteneur && vehiculeId !== null)
    throw refus('Ce document concerne le conteneur, pas une voiture.', 'This document belongs to the container, not to a car.');
  if (dUneVoiture && (vehiculeId === null
    || !db.prepare('SELECT 1 FROM vehicules WHERE id = ? AND conteneur_id = ? AND annulee = 0').get(vehiculeId, conteneurId)))
    throw refus('Choisissez une voiture à bord de ce conteneur.', 'Choose a car on board this container.');
  return { type: code, vehiculeId };
}

const ligneDe = (db, conteneurId, { type, vehiculeId }) =>
  db.prepare('SELECT * FROM pieces WHERE conteneur_id = ? AND IFNULL(vehicule_id, 0) = ? AND type = ?').get(conteneurId, vehiculeId ?? 0, type);

export const etatPiece = (db, conteneurId, piece) => ligneDe(db, conteneurId, piece)?.etat ?? 'attendu';

// Ce qu'Eric doit à chaque partenaire, en wons. Un reste négatif est une avance d'Eric.
// Fournisseur : prix réels en wons des voitures non annulées. Transporteur : ses lignes de frais validées.
const envoyesA = (db, destinataire) =>
  db.prepare('SELECT COALESCE(SUM(montant_won), 0) AS n FROM versements_fournisseur WHERE destinataire = ?').get(destinataire).n;
const solde = (du, paye) => ({ du, paye, reste: du - paye });

export const soldeFournisseur = db => solde(
  db.prepare('SELECT COALESCE(SUM(achat_reel_won), 0) AS n FROM vehicules WHERE annulee = 0').get().n, envoyesA(db, 'fournisseur'));

export const soldeTransporteur = db => solde(
  db.prepare("SELECT COALESCE(SUM(montant_won), 0) AS n FROM frais_transporteur WHERE etat = 'valide'").get().n, envoyesA(db, 'transporteur'));

// Écrit l'état d'un document (une seule ligne par document) et renvoie le numéro de sa ligne. À appeler dans une transaction.
export function ecrirePiece(db, conteneurId, piece, { etat, remarque = null, par, le }) {
  const ligne = ligneDe(db, conteneurId, piece);
  if (ligne) {
    db.prepare('UPDATE pieces SET etat = ?, remarque = ?, maj_par = ?, maj_le = ? WHERE id = ?').run(etat, remarque, par, le, ligne.id);
    return ligne.id;
  }
  return Number(db.prepare('INSERT INTO pieces (conteneur_id, vehicule_id, type, etat, remarque, maj_par, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(conteneurId, piece.vehiculeId, piece.type, etat, remarque, par, le).lastInsertRowid);
}
