import { Refus, entier } from '../saisie.js';
import { reglage } from '../db.js';
import { emettreContrat, marquerContratPapier } from '../documents.js';
import { rendreRecu } from '../vues/documents/recu.js';
import { rendreContrat } from '../vues/documents/contrat.js';
import { rendrePV } from '../vues/documents/pv.js';

const RENDUS = { recu: rendreRecu, contrat: rendreContrat, pv: rendrePV };

export function routesDocuments(app, { db, horloge }) {
  const trouver = req => {
    const id = entier(req.params.id);
    const doc = id && db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!doc) throw new Refus(404, 'Ce document n’existe pas.');
    return doc;
  };

  // Ce qui n'est plus valable doit se voir, à l'écran comme sur le papier imprimé.
  const avertissement = doc => {
    if (doc.type === 'recu') {
      const m = db.prepare('SELECT annule, motif_annulation FROM mouvements WHERE id = ?').get(doc.mouvement_id);
      if (m?.annule) return `VERSEMENT ANNULÉ — ce reçu n’est plus valable. Motif : ${m.motif_annulation}`;
    }
    if (doc.type === 'contrat' && doc.etat === 'remplace') {
      const suivant = db.prepare('SELECT numero FROM documents WHERE remplace_id = ?').get(doc.id);
      return `CONTRAT REMPLACÉ — ce document n’est plus valable${suivant ? `. Il est remplacé par le contrat n° ${suivant.numero}` : ''}.`;
    }
    return null;
  };

  // Un document se lit toujours depuis sa copie figée, jamais depuis les fiches actuelles.
  app.get('/documents/:id', (req, res) => {
    const doc = trouver(req);
    const plusValable = avertissement(doc);
    // Le cachet et la signature du vendeur ne figurent que sur un document valable, et si l'administrateur les a activés.
    const avecCachet = !plusValable && reglage(db, 'cachet_actif') !== '0';
    res.send(RENDUS[doc.type](JSON.parse(doc.donnees), { ...doc, avertissement: plusValable, cachet: avecCachet }));
  });

  app.post('/documents/:id/signe', (req, res) => {
    const doc = trouver(req);
    if (doc.etat !== 'emis') throw new Refus(409, 'Seul un document émis, non remplacé, peut être marqué comme signé.');
    db.prepare("UPDATE documents SET etat = 'signe' WHERE id = ?").run(doc.id);
    res.redirect(302, `/documents/${doc.id}`);
  });

  app.post('/commandes/:id/contrat', (req, res) => {
    const { id } = emettreContrat(db, entier(req.params.id), req.utilisateur, horloge());
    res.redirect(302, `/documents/${id}`);
  });

  app.post('/commandes/:id/papier', (req, res) => {
    const commande = marquerContratPapier(db, entier(req.params.id));
    res.redirect(302, `/clients/${commande.client_id}`);
  });
}
