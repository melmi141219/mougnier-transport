import { html } from '../../html.js';
import { dateFr } from '../../format.js';
import { feuille, cachet } from './feuille.js';

export function rendrePV(d, doc) {
  const v = d.vehicule;
  const lignes = [
    ['Marque', v.marque], ['Modèle / version', [v.modele, v.version].filter(Boolean).join(' ')], ['Année', v.annee], ['Couleur', v.couleur],
    ['N° de châssis', v.chassis], ['Kilométrage', v.kilometrage === null ? null : `${v.kilometrage} km`],
    ['Conteneur / connaissement', [v.conteneur, v.bl].filter(Boolean).join(' / ')],
  ];
  return feuille({
    doc, donnees: d,
    corps: html`
      <h1>Procès-verbal de livraison</h1>
      <p>Le ${dateFr(d.date)}, à Libreville, MOUGNIER TRANSPORT, représentée par ${d.par}, a remis à <strong>${d.client.nom}</strong>
        le véhicule désigné ci-dessous${d.contrat ? `, objet du contrat de vente n° ${d.contrat}` : ''}.</p>
      <table><tr><th>Caractéristique</th><th>Détail</th></tr>
        ${lignes.map(([nom, valeur]) => html`<tr><td>${nom}</td><td>${valeur ?? ''}</td></tr>`)}</table>
      <p>L'Acquéreur reconnaît avoir reçu ce jour la remise du véhicule, des clés et des documents, et avoir examiné le véhicule.
        Le prix a été intégralement payé.</p>
      <p>Le transfert de propriété et des risques intervient à cette remise. Les formalités de mutation et d'immatriculation
        sont à la charge de l'Acquéreur.</p>
      <p>Observations : ............................................................................................</p>
      <p>Fait à Libreville, le ${dateFr(d.date)}, en deux (2) exemplaires originaux, un pour chaque partie.</p>
      <table class="signatures">
        <tr><th>Le Vendeur — MOUGNIER TRANSPORT</th><th>L'Acquéreur<br>${d.client.nom}</th></tr>
        <tr><td>Signature et cachet${cachet(doc, d.entreprise)}</td><td>Signature précédée de « Lu et approuvé »</td></tr>
      </table>`,
  });
}
