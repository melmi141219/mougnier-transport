// Le contrat de vente. Le texte reprend l'acte d'Eric (docs/reference/acte-de-vente-modele.txt),
// avec les ajouts décidés avec lui : kilométrage, vente en l'état, conteneur, délai, frais et malus de retard.
import { html } from '../../html.js';
import { fcfa, enFrancs, dateFr } from '../../format.js';
import { feuille, cachet } from './feuille.js';

const VIDE = '........................';
const ou = valeur => valeur ?? VIDE;
const somme = n => html`${fcfa(n)} CFA (${enFrancs(n)})`;

function designation(v) {
  const lignes = [
    ['Marque', v.marque], ['Modèle / version', [v.modele, v.version].filter(Boolean).join(' ')], ['Année', v.annee],
    ['Couleur', v.couleur], ['Énergie / boîte', v.energie_boite], ['N° de châssis', v.chassis],
    ['Kilométrage', v.kilometrage === null ? null : `${v.kilometrage} km`],
    ['Conteneur / connaissement', v.conteneur ? [v.conteneur, v.bl].filter(Boolean).join(' / ') : 'communiqués ultérieurement'],
    ['Pays de provenance', 'Corée du Sud'],
  ];
  return html`<table><tr><th>Caractéristique</th><th>Détail</th></tr>
    ${lignes.map(([nom, valeur]) => html`<tr><td>${nom}</td><td>${valeur ?? ''}</td></tr>`)}</table>`;
}

function decomposition(vehicules) {
  const cellule = (v, valeur) => html`<td class="montant">${v.forfait || valeur === null ? '—' : fcfa(valeur)}</td>`;
  const base = v => (v.achat ?? 0) + (v.transport ?? 0);
  const seul = vehicules.length === 1 ? vehicules[0] : null;
  return html`<table>
    <tr><th>Poste</th>${vehicules.map(v => html`<th>${seul ? 'Montant (F CFA)' : v.libelle}</th>`)}</tr>
    <tr><td>Prix d'achat du véhicule</td>${vehicules.map(v => cellule(v, v.achat))}</tr>
    <tr><td>Transport jusqu'à Libreville</td>${vehicules.map(v => cellule(v, v.transport))}</tr>
    <tr><td>Douane : 55 % du prix d'achat et du transport${seul ? ` (${fcfa(base(seul))})` : ''}</td>${vehicules.map(v => cellule(v, v.douane))}</tr>
    <tr><td>Frais de service MOUGNIER TRANSPORT</td>${vehicules.map(v => cellule(v, v.fraisService))}</tr>
    <tr><th>Total</th>${vehicules.map(v => html`<th class="montant">${fcfa(v.total)}</th>`)}</tr>
  </table>`;
}

export function rendreContrat(d, doc) {
  const c = d.client, e = d.entreprise;
  const pluriel = d.vehicules.length > 1;
  const leVehicule = pluriel ? 'des véhicules' : 'du véhicule';
  const ligne = libelle => d.echeancier.find(x => x.libelle === libelle);
  const solde = ligne('Solde'), douane = ligne('Douane');
  const detaille = d.vehicules.some(v => !v.forfait);

  return feuille({
    doc, donnees: d,
    actions: doc.etat === 'emis' ? html`<form method="post" action="/documents/${doc.id}/signe"><button>Marquer comme signé</button></form>` : '',
    corps: html`
      <h1>Acte de vente de véhicule avec versement d'acompte</h1>
      ${d.remplace ? html`<p class="remplace">Le présent acte annule et remplace le contrat n° ${d.remplace}.</p>` : ''}

      <h2>Entre les soussignés</h2>
      <p><strong>Le Vendeur :</strong> MOUGNIER TRANSPORT (MT), entreprise d'importation et de transport établie à Libreville (Gabon),
        représentée par Monsieur Eric Patrick MOUGNIER, en qualité de Directeur. Téléphone / WhatsApp : ${ou(e.tel)}.</p>
      <p><strong>L'Acquéreur :</strong> ${c.nom}, né(e) le ${c.date_naissance ? dateFr(c.date_naissance) : VIDE} à ${ou(c.lieu_naissance)} —
        Nationalité : ${ou(c.nationalite)}. Pièce d'identité (nature et n°) : ${ou(c.piece_identite)}, valable jusqu'au
        ${c.piece_valable_jusqu ? dateFr(c.piece_valable_jusqu) : VIDE}. Adresse : ${ou(c.adresse)} — Téléphone / WhatsApp : ${ou(c.telephone)}.</p>
      <p>Il a été convenu et arrêté ce qui suit.</p>

      <h2>Article 1 — Objet et désignation ${leVehicule}</h2>
      <p>Le Vendeur vend à l'Acquéreur, qui accepte, ${pluriel
        ? html`les véhicules d'occasion importés par les soins du Vendeur, désignés comme suit :`
        : html`un véhicule d'occasion importé par les soins du Vendeur, désigné comme suit :`}</p>
      ${d.vehicules.map(designation)}
      <p>${pluriel
        ? html`L'Acquéreur reconnaît avoir choisi ces véhicules sur la base des photos et informations transmises par le Vendeur. Les véhicules sont des véhicules d'occasion, vendus en l'état.`
        : html`L'Acquéreur reconnaît avoir choisi ce véhicule sur la base des photos et informations transmises par le Vendeur. Le véhicule est un véhicule d'occasion, vendu en l'état.`}</p>

      <h2>Article 2 — Prix et modalités de paiement</h2>
      <p>Le prix de vente est fixé à <strong>${somme(d.total)}</strong>, ${pluriel ? 'véhicules rendus' : 'véhicule rendu'} à Libreville.</p>
      <table>
        <tr><th>Échéance</th><th>Montant (F CFA)</th><th>Moment du paiement</th></tr>
        ${d.echeancier.map(x => html`<tr><td>${x.libelle}</td><td class="montant">${fcfa(x.montant)}</td><td>${x.moment}</td></tr>`)}
        <tr><th>Total</th><th class="montant">${fcfa(d.total)}</th><th></th></tr>
      </table>
      <p>${d.acompte > 0
        ? html`L'Acquéreur a versé au Vendeur, à la date du présent acte, la somme de ${somme(d.acompte)} à titre d'acompte pour l'importation ${leVehicule}.
          Le Vendeur reconnaît l'avoir reçue et en donne quittance par le présent acte.`
        : html`Aucun acompte n'a été versé à la date du présent acte.`}</p>
      <p>${douane
        ? html`Le solde de ${somme(solde.montant)} est payable à l'arrivée du véhicule à Libreville. La part de douane, soit ${somme(douane.montant)},
          est payable dès la fin des démarches du transitaire, avant la remise du véhicule.`
        : html`Le solde de ${somme(solde.montant)} est payable en une seule fois à l'arrivée du véhicule.`}
        Tout paiement donne lieu à un reçu signé du Vendeur.</p>
      <p>Ce prix est forfaitaire et comprend l'achat ${leVehicule}, son transport jusqu'à Libreville et son dédouanement.${detaille ? ' Il se décompose comme suit :' : ''}</p>
      ${detaille ? decomposition(d.vehicules) : ''}
      <p>Aucun frais de transport ou de douane n'est dû par l'Acquéreur en sus de ce prix, sauf les frais et malus de retard prévus à l'article 5.</p>

      <h2>Article 3 — Importation, arrivée et livraison</h2>
      <p>Le Vendeur se charge de l'achat du véhicule, de son expédition et de son acheminement jusqu'à Libreville.</p>
      <p>La date d'arrivée du véhicule sera communiquée à l'Acquéreur par le Vendeur via la plateforme WhatsApp de MOUGNIER TRANSPORT,
        au numéro indiqué en tête du présent acte. Cette date est donnée à titre indicatif : elle dépend du transport maritime et des
        formalités portuaires et douanières. Le Vendeur informe l'Acquéreur par le même canal de tout changement.</p>
      <p>Les parties conviennent que les messages échangés via WhatsApp entre les numéros indiqués au présent acte valent notification.</p>
      <p>La remise du véhicule, des clés et des documents a lieu à Libreville, après paiement intégral ${douane ? 'du solde et de la part de douane' : 'du solde'}.
        Elle est constatée par un procès-verbal de livraison signé des deux parties.</p>

      <h2>Article 4 — Transfert de propriété</h2>
      <p>Le véhicule reste la propriété du Vendeur jusqu'au paiement intégral du prix. Le transfert de propriété et des risques intervient
        à la remise du véhicule à l'Acquéreur. Les formalités de mutation et d'immatriculation sont à la charge de l'Acquéreur,
        le Vendeur lui remettant les documents nécessaires.</p>

      <h2>Article 5 — Engagements des parties</h2>
      <ol>
        <li>Le Vendeur s'engage à livrer un véhicule conforme à la désignation de l'article 1.</li>
        <li>Si le véhicule ne peut pas être livré du fait du Vendeur, celui-ci restitue à l'Acquéreur l'intégralité de l'acompte versé.</li>
        <li>L'Acquéreur s'engage à régler le solde dans un délai de ${d.delaiJours} jours à compter de la notification de l'arrivée du véhicule.</li>
        <li>Passé ce délai, et après une relance restée sans suite, le Vendeur peut remettre le véhicule en vente. L'acompte est alors
          restitué à l'Acquéreur, déduction faite des frais justifiés engagés par le Vendeur.</li>
        <li>Tout retard de paiement de l'Acquéreur qui entraîne des frais ou des pénalités liés au dédouanement (magasinage, surestaries,
          pénalités du transitaire) met ces frais à la charge de l'Acquéreur, sur présentation des justificatifs.</li>
        <li>Passé le délai prévu au point 3, toute somme restant due porte un malus de 0,5 % par jour de retard, plafonné à 10 % de cette somme.
          Ce malus s'ajoute aux frais de retard du point 5. MOUGNIER TRANSPORT peut y renoncer en tout ou en partie.</li>
      </ol>

      <h2>Article 6 — Règlement des différends</h2>
      <p>Tout différend né du présent acte est d'abord réglé à l'amiable. À défaut d'accord, il est porté devant les juridictions compétentes de Libreville.</p>

      <h2>Signatures</h2>
      <p>Fait à Libreville, le ${dateFr(d.date)}, en deux (2) exemplaires originaux, un pour chaque partie.</p>
      <table class="signatures">
        <tr><th>Le Vendeur — MOUGNIER TRANSPORT<br>Eric Patrick MOUGNIER, Directeur</th><th>L'Acquéreur<br>${c.nom}</th></tr>
        <tr><td>Signature et cachet, précédés de « Lu et approuvé »${cachet(doc, e)}</td><td>Signature précédée de « Lu et approuvé »</td></tr>
      </table>`,
  });
}
