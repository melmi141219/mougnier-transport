import { html } from '../../html.js';
import { fcfa, enFrancs, dateFr } from '../../format.js';
import { libelleMode } from '../../libelles.js';
import { feuille, cachet } from './feuille.js';

export function rendreRecu(donnees, doc) {
  const d = donnees;
  return feuille({
    doc, donnees,
    corps: html`
      <h1>Reçu de versement</h1>
      <p>MOUGNIER TRANSPORT reconnaît avoir reçu de <strong>${d.client.nom}</strong> la somme de
        <strong>${fcfa(d.montant)} CFA</strong> (${enFrancs(d.montant)}), pour l’importation de son véhicule.</p>
      <table>
        <tr><th>Date du versement</th><td>${dateFr(d.date)}</td></tr>
        <tr><th>Mode de paiement</th><td>${libelleMode(d.mode)}</td></tr>
        ${d.reference ? html`<tr><th>Référence</th><td>${d.reference}</td></tr>` : ''}
        <tr><th>Frais de transfert</th><td>${d.avecFrais ? 'Versement avec frais (90 000 F par million compris)' : 'Versement sans frais'}</td></tr>
        <tr><th>Total reçu à ce jour</th><td class="montant">${fcfa(d.totalRecu)}</td></tr>
        ${d.ristournes ? html`<tr><th>Ristourne accordée sur la douane</th><td class="montant">${fcfa(d.ristournes)}</td></tr>` : ''}
        <tr><th>${d.credit ? 'Crédit du client à ce jour' : 'Reste à payer à ce jour'}</th><td class="montant">${fcfa(d.credit || d.reste)}</td></tr>
      </table>
      <table class="signatures">
        <tr><th>Pour MOUGNIER TRANSPORT — ${d.par}</th><th>Le client — ${d.client.nom}</th></tr>
        <tr><td>${cachet(doc, d.entreprise)}</td><td></td></tr>
      </table>`,
  });
}
