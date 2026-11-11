// Ce qu'il y a à faire aujourd'hui : relances, annonces, douane à encaisser, voitures à remettre.
// Chaque action porte son message prêt ; rien n'est envoyé d'ici.
import { reglage } from './db.js';
import { compteClient } from './compte.js';
import { joursEntre, ajouterJours } from './format.js';
import { piecesAttendues } from './partenaires.js';
import { lienWhatsApp } from './telephone.js';
import { libelleVoiture } from './libelles.js';
import { msgSolde, msgArrivee, msgDouane, msgRetard, msgGroupeDepart, msgGroupeArrivee } from './messages.js';

const JOURS_ENTRE_RELANCES_DE_RETARD = 3;
const JOURS_AVANT_ARRIVEE_DOCUMENTS = 15; // les documents de transport doivent être là avant que le conteneur arrive
const ORDRE = ['retard', 'relance_solde', 'prevenir_arrivee', 'douane', 'penalites', 'annonce_depart', 'annonce_arrivee', 'eta_depassee',
  'documents_manquants', 'a_remettre'];

export function actionsDuJour(db, aujourdhui) {
  const actions = [];
  const delaiJours = Number(reglage(db, 'delai_jours')) || 10;
  const adresse = reglage(db, 'adresse_locaux');
  const relances = db.prepare('SELECT type, client_id, conteneur_id, ligne, envoye_le FROM relances').all();
  const derniere = (type, clientId, conteneurId, ligne = null) => relances
    .filter(r => r.type === type && r.client_id === clientId && r.conteneur_id === conteneurId && (ligne === null || r.ligne === ligne))
    .map(r => r.envoye_le).sort().at(-1) ?? null;
  const conteneurs = db.prepare(`SELECT ct.*, (SELECT COUNT(*) FROM vehicules v WHERE v.conteneur_id = ct.id AND v.annulee = 0) AS nb
    FROM conteneurs ct ORDER BY ct.id`).all();
  const conteneur = id => conteneurs.find(ct => ct.id === id);

  for (const { id } of db.prepare('SELECT id FROM clients ORDER BY nom').all()) {
    const compte = compteClient(db, id, aujourdhui);
    const { client } = compte;
    const voitures = ids => compte.vehicules.filter(v => ids.includes(v.id)).map(libelleVoiture).join(', ');
    const ligne = (type, conteneurId) => compte.lignes.find(l => l.type === type && l.conteneurId === conteneurId);
    const personnel = (action, message) => {
      const lien = lienWhatsApp(client.telephone, message);
      actions.push({ clientId: id, message, lien, telephoneManquant: lien === null, ...action });
    };

    for (const l of compte.lignes) {
      if (l.type === 'penalite' || l.reste === 0 || l.conteneurId === null) continue;
      const ct = conteneur(l.conteneurId);
      const base = { conteneurId: ct.id, ligne: l.type, montant: l.reste };
      if (l.etat === 'en_retard') {
        const d = derniere('retard', id, ct.id, l.type);
        if (d === null || joursEntre(d, aujourdhui) >= JOURS_ENTRE_RELANCES_DE_RETARD)
          personnel({ ...base, type: 'retard', malus: l.malus, titre: `${client.nom} — en retard de ${l.joursRetard} jour(s), conteneur ${ct.numero}` },
            msgRetard({ nom: client.nom, montant: l.reste, depuis: l.enRetardDepuis, malus: l.malus }));
      } else if (l.type === 'solde' && ['a_relancer', 'exigible'].includes(l.etat) && !ct.date_arrivee && !derniere('solde', id, ct.id)) {
        // après l'arrivée, c'est le message d'arrivée qui porte le montant
        personnel({ ...base, type: 'relance_solde', titre: `${client.nom} — solde avant l’arrivée du ${ct.numero}` },
          msgSolde({ nom: client.nom, vehicules: voitures(l.vehiculeIds), navire: ct.navire, eta: ct.eta, montant: l.reste,
            douaneAPrevoir: ligne('douane', ct.id)?.reste ?? 0 }));
      } else if (l.type === 'douane' && l.etat === 'exigible' && !derniere('douane', id, ct.id)) {
        personnel({ ...base, type: 'douane', titre: `${client.nom} — douane, conteneur ${ct.numero}` },
          msgDouane({ nom: client.nom, vehicules: voitures(l.vehiculeIds), montant: l.reste, adresse }));
      }
    }

    // Pénalités et malus appliqués, pas encore payés : aucun message tout prêt, mais Eric doit les voir.
    const penalitesDues = compte.lignes.filter(l => l.type === 'penalite' && l.reste > 0 && l.exigibleLe <= aujourdhui)
      .reduce((s, l) => s + l.reste, 0);
    if (penalitesDues > 0)
      actions.push({ type: 'penalites', clientId: id, montant: penalitesDues, titre: `${client.nom} — pénalités et malus de retard à encaisser` });

    for (const ct of conteneurs) {
      const aBord = compte.vehicules.filter(v => v.conteneur_id === ct.id);
      if (!aBord.length) continue;
      if (ct.date_arrivee && !derniere('arrivee', id, ct.id)) {
        const reste = ligne('solde', ct.id)?.reste ?? 0;
        personnel({ type: 'prevenir_arrivee', conteneurId: ct.id, montant: reste, titre: `${client.nom} — prévenir de l’arrivée du ${ct.numero}` },
          msgArrivee({ nom: client.nom, vehicules: aBord.map(libelleVoiture).join(', '), dateArrivee: ct.date_arrivee, montant: reste, delaiJours }));
      }
      // comme pour la remise : le solde, la douane de ce conteneur et toutes les pénalités du client
      const toutPaye = compte.lignes.filter(l => l.type === 'penalite' || l.conteneurId === ct.id).every(l => l.etat === 'payee');
      for (const v of aBord.filter(x => x.statut === 'dedouanee')) {
        if (toutPaye) actions.push({ type: 'a_remettre', clientId: id, conteneurId: ct.id, vehiculeId: v.id,
          titre: `${libelleVoiture(v)} — à remettre à ${client.nom}` });
      }
    }
  }

  for (const ct of conteneurs) {
    if (ct.date_depart && !ct.date_arrivee && !derniere('groupe_depart', null, ct.id))
      actions.push({ type: 'annonce_depart', conteneurId: ct.id, groupe: true, titre: `Annoncer le départ du ${ct.numero}`,
        message: msgGroupeDepart({ navire: ct.navire ?? ct.numero, eta: ct.eta, nbVehicules: ct.nb }) });
    if (ct.date_arrivee && !derniere('groupe_arrivee', null, ct.id))
      actions.push({ type: 'annonce_arrivee', conteneurId: ct.id, groupe: true, titre: `Annoncer l’arrivée du ${ct.numero}`,
        message: msgGroupeArrivee({ navire: ct.navire ?? ct.numero }) });
    if (ct.eta && ct.eta < aujourdhui && !ct.date_arrivee)
      actions.push({ type: 'eta_depassee', conteneurId: ct.id, titre: `${ct.numero} : la date d’arrivée prévue est dépassée. Vérifiez le suivi.` });
    // Conteneur arrivé, ou attendu dans 15 jours au plus : un document encore attendu se réclame au transporteur.
    if (ct.date_arrivee || (ct.eta && ct.eta <= ajouterJours(aujourdhui, JOURS_AVANT_ARRIVEE_DOCUMENTS))) {
      const manquants = piecesAttendues(db, ct.id).filter(p => p.etat === 'attendu').length;
      if (manquants) actions.push({ type: 'documents_manquants', conteneurId: ct.id, partenaires: true,
        titre: `${ct.numero} : ${manquants} document(s) de transport manquant(s)` });
    }
  }

  return actions.sort((a, b) => ORDRE.indexOf(a.type) - ORDRE.indexOf(b.type));
}
