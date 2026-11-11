// Dépôt et lecture des fichiers. Le dépôt lui-même se fait sur les routes des propositions (tâche 3) et des
// documents de transport (tâche 4), avec lireDepot puis deposer().
import express from 'express';
import fs from 'node:fs';
import { estPartenaire } from '../auth.js';
import { enregistrerFichier, lireFichier } from '../fichiers.js';
import { Refus, entier } from '../saisie.js';

// Un fichier par requête, envoyé tel quel par public/depot.js, quel que soit son type déclaré.
export const lireDepot = express.raw({ type: () => true, limit: '16mb' });

export function deposer(req, { db, horloge, dossierFichiers }, { offreId = null, pieceId = null, imagesSeulement = false } = {}) {
  const anglais = estPartenaire(req.utilisateur);
  const entete = req.get('x-nom-fichier');
  let nomOrigine = null;
  if (entete != null) {
    try { nomOrigine = decodeURIComponent(entete); } catch {
      throw new Refus(400, anglais ? 'The file name cannot be read.' : 'Le nom du fichier est illisible.');
    }
  }
  return enregistrerFichier(db, dossierFichiers, {
    contenu: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), nomOrigine, deposePar: req.utilisateur.id,
    offreId, pieceId, aujourdhui: horloge(), imagesSeulement, anglais,
  });
}

// Interne : tout. Fournisseur : les photos de ses propositions. Transporteur : les documents de transport.
function peutLire(db, utilisateur, fichier) {
  if (!estPartenaire(utilisateur)) return true;
  if (utilisateur.role === 'fournisseur')
    return fichier.offre_id != null && db.prepare('SELECT 1 FROM offres WHERE id = ? AND fournisseur_id = ?').get(fichier.offre_id, utilisateur.id) != null;
  return utilisateur.role === 'transporteur' && fichier.piece_id != null;
}

// En-tête sûr : un nom en ASCII sans guillemet pour les vieux navigateurs, le vrai nom encodé pour les autres.
function disposition(nom) {
  const ascii = nom.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encode = encodeURIComponent(nom).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${encode}`;
}

export function routesFichiers(app, { db, dossierFichiers }) {
  app.get('/fichiers/:id', (req, res) => {
    const id = /^\d{1,9}$/.test(req.params.id) ? entier(req.params.id) : null;
    const trouve = id && lireFichier(db, dossierFichiers, id);
    const anglais = estPartenaire(req.utilisateur);
    if (!trouve) return res.refuser(404, anglais ? 'This file does not exist.' : 'Ce fichier n’existe pas.');
    if (!peutLire(db, req.utilisateur, trouve.ligne))
      return res.refuser(403, anglais ? 'You do not have access to this file.' : 'Vous n’avez pas accès à ce fichier.');
    res.set({
      'Content-Type': trouve.ligne.type_mime,
      'Content-Disposition': disposition(trouve.ligne.nom_origine),
      'Cache-Control': 'private, no-store',
    });
    res.send(fs.readFileSync(trouve.chemin));
  });
}
