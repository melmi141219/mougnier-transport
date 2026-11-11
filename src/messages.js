// Textes WhatsApp. Rien n'est envoyé d'ici : la plateforme les affiche, Eric les envoie.
import { fcfa, dateFr } from './format.js';

export function msgSolde({ nom, vehicules, navire, eta, montant, douaneAPrevoir }) {
  return `Bonjour ${nom}, ici MOUGNIER TRANSPORT. Votre véhicule (${vehicules}) arrive à Libreville vers le ${dateFr(eta)}`
    + `${navire ? `, à bord du navire ${navire}` : ''}. Merci de régler le solde de ${fcfa(montant)} avant cette date.`
    + (douaneAPrevoir > 0
      ? ` À prévoir ensuite : ${fcfa(douaneAPrevoir)} pour la douane, à nous apporter dès que notre transitaire aura terminé les démarches.`
      : '')
    + ' Merci de votre confiance.';
}

export function msgArrivee({ nom, vehicules, dateArrivee, montant, delaiJours }) {
  return `Bonjour ${nom}, bonne nouvelle : votre véhicule (${vehicules}) est arrivé à Libreville le ${dateFr(dateArrivee)}.`
    + (montant > 0 ? ` Il reste ${fcfa(montant)} à régler sous ${delaiJours} jours.` : ' Votre solde est réglé.')
    + ' Nous vous prévenons dès que le dédouanement est terminé.';
}

export function msgDouane({ nom, vehicules, montant, adresse }) {
  return `Bonjour ${nom}, notre transitaire a terminé les démarches pour votre véhicule (${vehicules}).`
    + ` Merci d'apporter ${fcfa(montant)} pour la douane dans nos locaux${adresse ? ` : ${adresse}` : ''}.`
    + ' Le véhicule vous est remis dès réception.';
}

export function msgRetard({ nom, montant, depuis, malus }) {
  // Le malus n'est cité que s'il est prévu par le contrat du client (malus > 0).
  return `Bonjour ${nom}, sauf erreur de notre part, ${fcfa(montant)} restent à régler depuis le ${dateFr(depuis)}.`
    + (malus > 0 ? ` Comme prévu à l'article 5 du contrat, un malus de 0,5 % par jour s'applique : ${fcfa(malus)} à ce jour.` : '')
    + ' Merci de régulariser rapidement.';
}

// Annonce d'une ristourne : le message donne le geste et ce qui reste à payer, sans citer de montant de douane.
export function msgRistourne({ nom, vehicules, montant, reste }) {
  return `Bonjour ${nom}, bonne nouvelle : le dédouanement de votre véhicule (${vehicules}) a coûté moins que prévu.`
    + ` Nous vous faisons bénéficier d'une ristourne de ${fcfa(montant)}.`
    + (reste > 0 ? ` Il vous reste ${fcfa(reste)} à régler.` : ' Votre compte est soldé.')
    + ' Merci de votre confiance.';
}

// Messages de groupe : jamais de montant dû, jamais de nom de client.
export function msgGroupeDepart({ navire, eta, nbVehicules }) {
  return `Bonjour à tous. Le navire ${navire} a quitté la Corée avec ${nbVehicules} véhicules.`
    + `${eta ? ` Arrivée prévue à Libreville vers le ${dateFr(eta)}.` : ''} Nous écrivons à chaque client en privé.`;
}

export function msgGroupeArrivee({ navire }) {
  return `Bonjour à tous. Le navire ${navire} est arrivé à Libreville. Le dédouanement commence.`
    + ' Nous écrivons à chaque client en privé pour la suite.';
}

export function msgCatalogue({ libelle, achat, transport, rendu }) {
  return `${libelle} — prix en Corée : ${fcfa(achat)}. Transport : ${fcfa(transport)}.`
    + ` Rendu à Libreville, dédouané, tous frais compris : ${fcfa(rendu)}. MOUGNIER TRANSPORT, +241 77 22 99 98.`;
}
