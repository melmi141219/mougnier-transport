// Règles d'argent de MOUGNIER TRANSPORT. Fonctions pures : aucune lecture de base ici.
import { ajouterJours, joursEntre } from './format.js';

// Points de base : 1 % = 100.
export const TAUX = { frais: 900, douane: 5500, malusJour: 50, malusPlafond: 1000 };

export function pourcent(montant, pb) {
  return Math.round(montant * pb / 10000);
}

// Prix client d'une voiture. Les frais (9 %) et la douane (55 %) se calculent sur achat + transport ;
// la douane, payée à Libreville, ne porte pas de frais.
export function prixVehicule(v) {
  const achat = v.achat ?? null, transport = v.transport ?? null, arrondi = v.arrondi ?? 0;
  const base = achat !== null && transport !== null ? achat + transport : null;
  const douaneEstimee = base === null ? null : pourcent(base, TAUX.douane);
  const frais = base === null ? 0 : pourcent(base, TAUX.frais);

  const forfait = v.forfait != null; // prix tout compris, saisi directement : la douane est dedans
  let horsDouane, douane, verrouille = false;
  if (v.verrou_hors_douane != null) {
    horsDouane = v.verrou_hors_douane; douane = v.verrou_douane ?? 0; verrouille = true;
  } else if (forfait) {
    horsDouane = v.forfait; douane = 0;
  } else {
    horsDouane = (base ?? 0) + frais + arrondi; douane = douaneEstimee ?? 0;
  }
  return { frais: forfait ? 0 : frais, douane, horsDouane, total: horsDouane + douane, douaneEstimee, forfait, verrouille };
}

// 0,5 % de la somme encore due par jour de retard, plafonné à 10 %.
export function malus(reste, joursRetard) {
  if (joursRetard <= 0) return 0;
  return Math.min(Math.round(reste * TAUX.malusJour * joursRetard / 10000), pourcent(reste, TAUX.malusPlafond));
}

// Marge d'Eric sur une voiture : ce que paie le client, moins ce que la voiture coûte vraiment.
// Coût réel = achat réel + transport + 9 % d'envoi d'argent sur ces deux montants + douane.
// La douane est la facture du transitaire dès qu'elle est saisie ; avant, c'est une estimation.
// Transport réel d'une voiture, en francs CFA : sa part du fret et du chargement du conteneur,
// plus ses frais propres en Corée (carte grise, sticker, kilométrage).
// fraisConteneurWon : le total réellement payé en Corée pour ce conteneur, quand il est connu ;
// sinon on applique le tarif habituel (chargement du conteneur + frais par voiture).
// Le détail compte : la douane se calcule sur le fret seulement, pas sur les frais payés en Corée.
export function transportReelDetail({ fretUsd, chargementWon, fraisVoitureWon, tauxUsd, tauxWon, nbVoitures, fraisConteneurWon = null }) {
  const fret = Math.round(fretUsd * tauxUsd / nbVoitures);
  const fraisWon = fraisConteneurWon !== null ? fraisConteneurWon / nbVoitures : chargementWon / nbVoitures + fraisVoitureWon;
  const fraisCoree = Math.round(fraisWon * tauxWon);
  return { fret, fraisCoree, total: fret + fraisCoree };
}

export function transportReelParVoiture(couts) {
  return transportReelDetail(couts).total;
}

// transportCalcule : le transport réel de cette voiture, soit le détail { fret, total } de transportReelDetail,
// soit un simple montant. Un transport saisi à la main sur la voiture passe avant ; sans rien, on retombe sur le transport facturé.
export function margeVehicule(v, tauxWon, transportCalcule = null) {
  const prix = prixVehicule(v);
  const achatReel = v.achat_reel_fcfa ?? (v.achat_reel_won != null ? Math.round(v.achat_reel_won * tauxWon) : null);
  const detail = typeof transportCalcule === 'number' ? { total: transportCalcule, fret: transportCalcule } : transportCalcule;
  const transport = v.transport_reel ?? detail?.total ?? v.transport ?? null;
  const manque = [];
  if (achatReel === null) manque.push('prix réel d’achat');
  if (transport === null) manque.push('transport réel');
  // ce que le client paie vraiment : le prix du contrat, moins les ristournes qu'Eric lui a accordées
  const prixClient = v.type === 'vente' ? prix.total - (v.ristournes ?? 0) : null;
  if (manque.length) return { prixClient, achatReel, transport, complet: false, manque, frais: null, douane: null, douaneReelle: false, cout: null, marge: null };

  const baseReelle = achatReel + transport;
  const frais = pourcent(baseReelle, TAUX.frais);
  const douaneReelle = v.douane_reelle != null;
  // Règle d'Eric : les 9 % sont des frais d'envoi d'argent vers la Corée, ils n'entrent pas dans la douane.
  // Avant la facture du transitaire, la douane est estimée à 55 % de (achat réel + fret du conteneur),
  // sans les frais payés en Corée (chargement, cartes grises, stickers, kilométrage).
  const fretSeul = v.transport_reel == null && detail ? detail.fret : transport;
  const douane = douaneReelle ? v.douane_reelle : pourcent(achatReel + fretSeul, TAUX.douane);
  const cout = baseReelle + frais + douane;
  return { prixClient, achatReel, transport, complet: true, manque, frais, douane, douaneReelle, cout,
    marge: prixClient === null ? null : prixClient - cout };
}

const RANG = { penalite: 0, solde: 1, douane: 2 };
const somme = (liste, f) => liste.reduce((s, x) => s + f(x), 0);
const plusAncienne = dates => dates.filter(Boolean).sort()[0] ?? null;

// Ce qu'un client doit, échéance par échéance, pour ses voitures vendues.
// Les versements s'imputent dans l'ordre des dates d'exigibilité : le plus ancien dû est payé d'abord.
export function echeances({ vehicules, penalites, recu, aujourdhui, delaiJours = 10 }) {
  const parConteneur = new Map();
  for (const v of vehicules) {
    const cle = v.conteneur?.id ?? null;
    if (!parConteneur.has(cle)) parConteneur.set(cle, []);
    parConteneur.get(cle).push(v);
  }

  const lignes = [];
  for (const [conteneurId, voitures] of parConteneur) {
    const ct = voitures[0].conteneur;
    const exigibleSolde = ct?.date_arrivee ?? ct?.eta ?? null;
    const notifArrivee = plusAncienne(voitures.map(v => v.notifArrivee));
    // Le délai est celui du contrat de la commande s'il est émis, sinon celui des réglages.
    // Le malus ne se calcule que si le client a signé la clause (contrat émis par la plateforme).
    const delai = voitures[0].delaiJours ?? delaiJours;
    const avecMalus = voitures.every(v => v.malusPrevu !== false);
    lignes.push({
      type: 'solde', conteneurId, vehiculeIds: voitures.map(v => v.id), avecMalus,
      montant: somme(voitures, v => (v.mode === 'unique' ? v.prix.total : v.prix.horsDouane)),
      exigibleLe: exigibleSolde,
      relanceDes: exigibleSolde && ajouterJours(exigibleSolde, -10),
      enRetardDepuis: notifArrivee && ajouterJours(notifArrivee, delai),
    });
    const enDeux = voitures.filter(v => v.mode === 'deux');
    const douane = somme(enDeux, v => v.prix.douane);
    if (douane > 0) {
      const notifDouane = plusAncienne(enDeux.map(v => v.notifDouane));
      lignes.push({
        type: 'douane', conteneurId, vehiculeIds: enDeux.map(v => v.id), montant: douane, avecMalus,
        exigibleLe: ct?.date_facture ?? null, relanceDes: null,
        enRetardDepuis: notifDouane && ajouterJours(notifDouane, delai),
      });
    }
  }
  for (const p of penalites) {
    lignes.push({ type: 'penalite', conteneurId: null, vehiculeIds: [], penaliteId: p.id, montant: p.montant,
      exigibleLe: p.date, relanceDes: null, enRetardDepuis: null });
  }

  lignes.sort((a, b) => {
    if (a.exigibleLe !== b.exigibleLe) {
      if (a.exigibleLe === null) return 1;
      if (b.exigibleLe === null) return -1;
      return a.exigibleLe < b.exigibleLe ? -1 : 1;
    }
    if (a.type !== b.type) return RANG[a.type] - RANG[b.type];
    return (a.conteneurId ?? Number.MAX_SAFE_INTEGER) - (b.conteneurId ?? Number.MAX_SAFE_INTEGER);
  });

  let disponible = Math.max(0, recu);
  for (const l of lignes) {
    l.paye = Math.min(l.montant, disponible);
    disponible -= l.paye;
    l.reste = l.montant - l.paye;
    l.joursRetard = 0;
    l.malus = 0;
    if (l.reste === 0) l.etat = 'payee';
    else if (l.exigibleLe === null) l.etat = 'sans_date';
    else if (l.enRetardDepuis && aujourdhui > l.enRetardDepuis) {
      l.etat = 'en_retard';
      l.joursRetard = joursEntre(l.enRetardDepuis, aujourdhui);
      l.malus = l.avecMalus ? malus(l.reste, l.joursRetard) : 0;
    } else if (aujourdhui >= l.exigibleLe) l.etat = 'exigible';
    else if (l.type === 'solde' && aujourdhui >= l.relanceDes) l.etat = 'a_relancer';
    else l.etat = 'a_venir';
  }
  return lignes;
}
