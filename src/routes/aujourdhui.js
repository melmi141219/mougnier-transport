import { html } from '../html.js';
import { actionsDuJour } from '../aujourdhui.js';
import { fcfa, dateFr, joursEntre } from '../format.js';
import { exigerAdmin } from '../auth.js';
import { Refus, entier, parmi } from '../saisie.js';
import { derniereSauvegarde } from '../../scripts/sauvegarde.js';

const SECTIONS = [
  ['retard', 'Paiements en retard'],
  ['relance_solde', 'Soldes à relancer avant l’arrivée'],
  ['prevenir_arrivee', 'Clients à prévenir de l’arrivée'],
  ['douane', 'Douane à encaisser'],
  ['penalites', 'Pénalités et malus à encaisser'],
  ['annonce_depart', 'Annonces pour le groupe : départs'],
  ['annonce_arrivee', 'Annonces pour le groupe : arrivées'],
  ['eta_depassee', 'Dates d’arrivée dépassées'],
  ['documents_manquants', 'Documents de transport manquants'],
  ['a_remettre', 'Voitures prêtes à être remises'],
];
// type d'action → type de relance enregistré une fois le message envoyé
const RELANCE = { retard: 'retard', relance_solde: 'solde', prevenir_arrivee: 'arrivee', douane: 'douane', annonce_depart: 'groupe_depart', annonce_arrivee: 'groupe_arrivee' };
const TYPES_RELANCE = Object.values(RELANCE);

export function routesAujourdhui(app, { db, horloge, dossierSauvegardes }) {
  const carte = a => html`<section class="carte">
    <p><strong>${a.titre}</strong>${a.montant ? html` — ${fcfa(a.montant)}` : ''}${a.malus ? html` — malus calculé : ${fcfa(a.malus)}` : ''}</p>
    ${a.message ? html`<p class="message">${a.message}</p>
    <div class="actions">
      ${a.groupe ? html`<span class="discret">À coller dans le groupe WhatsApp :</span>`
        : a.lien ? html`<a class="bouton" href="${a.lien}" target="_blank" rel="noopener">Ouvrir WhatsApp</a>`
        : html`<span class="etat retard">numéro WhatsApp manquant</span> <a href="/clients/${a.clientId}">Compléter la fiche</a>`}
      <button type="button" class="bouton secondaire" data-copier="${a.message}">${a.groupe ? 'Copier le message' : 'Copier (message privé)'}</button>
      <form method="post" action="/relances" data-confirmer="${a.type === 'prevenir_arrivee' || a.type === 'douane'
        ? 'Le message est bien parti ? Le délai de paiement du client commence aujourd’hui.' : 'Le message est bien parti ?'}">
        <input type="hidden" name="type" value="${RELANCE[a.type]}">
        <input type="hidden" name="client_id" value="${a.clientId ?? ''}">
        <input type="hidden" name="conteneur_id" value="${a.conteneurId}">
        <input type="hidden" name="ligne" value="${a.ligne ?? ''}">
        <button class="bouton secondaire">Marquer comme envoyé</button>
      </form>
    </div>` : ''}
    <p class="actions">
      ${a.clientId ? html`<a href="/clients/${a.clientId}">Fiche du client</a>` : ''}
      ${a.vehiculeId ? html`<a href="/vehicules/${a.vehiculeId}">Fiche de la voiture</a>` : ''}
      ${a.conteneurId ? html`<a href="/conteneurs/${a.conteneurId}">Conteneur</a>` : ''}
      ${a.partenaires ? html`<a href="/partenaires">Documents de transport</a>` : ''}
    </p>
  </section>`;

  // Une sauvegarde qui échoue chaque soir ne doit pas passer inaperçue : l'administrateur le voit ici.
  const alerteSauvegarde = utilisateur => {
    if (utilisateur.role !== 'admin' || !dossierSauvegardes) return '';
    const derniere = derniereSauvegarde(dossierSauvegardes);
    if (derniere && joursEntre(derniere, horloge()) <= 2) return '';
    return html`<p class="alerte">${derniere ? `La dernière sauvegarde date du ${dateFr(derniere)}.` : 'Aucune sauvegarde trouvée.'}
      Vérifiez la tâche « MT Transport - sauvegarde » dans le Planificateur de tâches.</p>`;
  };

  app.get('/', (req, res) => {
    const actions = actionsDuJour(db, horloge());
    res.page('Aujourd’hui', html`${alerteSauvegarde(req.utilisateur)}${actions.length
      ? SECTIONS.map(([type, titre]) => {
        const groupe = actions.filter(a => a.type === type);
        return groupe.length ? html`<h2>${titre} (${groupe.length})</h2>${groupe.map(carte)}` : '';
      })
      : html`<p class="note">Rien à faire aujourd’hui. Les relances apparaîtront ici 10 jours avant l’arrivée d’un conteneur,
        dès que sa date d’arrivée prévue est saisie.</p>`}`, { actif: '/' });
  });

  app.post('/relances', (req, res) => {
    const type = parmi(req.body.type, TYPES_RELANCE, 'Type de message');
    const conteneurId = entier(req.body.conteneur_id);
    if (!conteneurId || !db.prepare('SELECT 1 FROM conteneurs WHERE id = ?').get(conteneurId)) throw new Refus(400, 'Conteneur inconnu.');
    let clientId = null;
    if (!type.startsWith('groupe_')) {
      clientId = entier(req.body.client_id);
      if (!clientId || !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) throw new Refus(400, 'Client inconnu.');
    }
    const ligne = ['solde', 'douane'].includes(req.body.ligne) ? req.body.ligne : null;
    db.prepare('INSERT INTO relances (type, client_id, conteneur_id, ligne, envoye_le, par) VALUES (?, ?, ?, ?, ?, ?)')
      .run(type, clientId, conteneurId, ligne, horloge(), req.utilisateur.identifiant);
    res.redirect(302, '/');
  });

  // « Marquer comme envoyé » cliqué par erreur : l'administrateur retire la ligne, l'action revient dans la liste.
  app.post('/relances/:id/supprimer', exigerAdmin, (req, res) => {
    const relance = entier(req.params.id) && db.prepare('SELECT * FROM relances WHERE id = ?').get(entier(req.params.id));
    if (!relance) throw new Refus(404, 'Ce message n’existe pas.');
    db.prepare('DELETE FROM relances WHERE id = ?').run(relance.id);
    res.redirect(302, relance.client_id ? `/clients/${relance.client_id}` : `/conteneurs/${relance.conteneur_id}`);
  });
}
