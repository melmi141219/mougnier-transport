// Le cadre commun des documents imprimables : barre d'actions (masquée à l'impression) et en-tête de l'entreprise.
import fs from 'node:fs';
import { html } from '../../html.js';
import { dateFr } from '../../format.js';

const ETATS = { emis: 'Émis', signe: 'Signé', remplace: 'Remplacé' };

// La signature d'Eric est incluse dans la page du document, jamais servie comme fichier public.
// La signature n'est pas envoyée sur GitHub : dans une copie qui ne l'a pas, le cachet s'affiche sans elle.
const FICHIER_SIGNATURE = new URL('./signature-eric.png', import.meta.url);
export const SIGNATURE = fs.existsSync(FICHIER_SIGNATURE)
  ? `data:image/png;base64,${fs.readFileSync(FICHIER_SIGNATURE).toString('base64')}` : null;

// Cachet rond de MOUGNIER TRANSPORT (même dessin que le cachet bleu de MougnierTech) et signature du directeur.
// À placer dans la case de signature du vendeur. Rien n'est rendu si le document n'est plus valable.
export function cachet(doc, entreprise) {
  if (!doc.cachet) return '';
  const rccm = entreprise.rccm ?? '';
  const coupe = rccm.indexOf('-A');
  const [rccm1, rccm2] = coupe > 0 ? [rccm.slice(0, coupe), rccm.slice(coupe)] : [rccm, ''];
  return html`<div class="cachet">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" role="img" aria-label="Cachet de MOUGNIER TRANSPORT">
      <defs>
        <path id="cachet-haut" d="M 45 150 A 105 105 0 0 1 255 150"/>
        <path id="cachet-bas" d="M 40 150 A 110 110 0 0 0 260 150"/>
      </defs>
      <g fill="none" stroke="#1d3c9a" opacity="0.92">
        <circle cx="150" cy="150" r="142" stroke-width="5"/>
        <circle cx="150" cy="150" r="132" stroke-width="1.5"/>
        <circle cx="150" cy="150" r="78" stroke-width="1.5"/>
      </g>
      <g fill="#1d3c9a" font-family="Arial, Helvetica, sans-serif" font-weight="700" opacity="0.92">
        <text font-size="20" letter-spacing="1.5"><textPath href="#cachet-haut" startOffset="50%" text-anchor="middle">MOUGNIER TRANSPORT</textPath></text>
        <text font-size="15" letter-spacing="2.5"><textPath href="#cachet-bas" startOffset="50%" text-anchor="middle" dominant-baseline="hanging">LIBREVILLE · GABON</textPath></text>
        <text x="38" y="155" font-size="16">★</text><text x="248" y="155" font-size="16">★</text>
        <text x="150" y="126" font-size="34" font-style="italic" text-anchor="middle">MT</text>
        <text x="150" y="143" font-size="9.5" text-anchor="middle">IMPORTATION · TRANSPORT</text>
        ${rccm1 ? html`<text x="150" y="160" font-size="10.5" text-anchor="middle">RCCM ${rccm1}</text>` : ''}
        ${rccm2 ? html`<text x="150" y="174" font-size="10.5" text-anchor="middle">${rccm2}</text>` : ''}
        ${entreprise.nif ? html`<text x="150" y="192" font-size="11.5" text-anchor="middle">NIF ${entreprise.nif}</text>` : ''}
      </g>
    </svg>
    ${SIGNATURE ? html`<img src="${SIGNATURE}" alt="Signature d’Eric Patrick MOUGNIER">` : ''}
  </div>`;
}

export function feuille({ doc, donnees, corps, actions = '' }) {
  const e = donnees.entreprise;
  return String(html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${doc.numero} — MOUGNIER TRANSPORT</title>
<link rel="stylesheet" href="/impression.css">
</head>
<body>
<div class="barre-doc">
  <a href="/clients/${donnees.client.id}">← Retour à la fiche de ${donnees.client.nom}</a>
  <button type="button" data-imprimer>Imprimer / Enregistrer en PDF</button>
  <span class="etat">${ETATS[doc.etat]}</span>
  ${actions}
</div>
<div class="feuille">
  <div class="entete">
    <div>
      <div class="marque"><em>MT</em> MOUGNIER TRANSPORT</div>
      <small>Importation et transport — Libreville, Gabon</small>
      <small>${e.adresse}${e.tel ? ` — Tél. / WhatsApp : ${e.tel}` : ''}</small>
      ${e.rccm || e.nif ? html`<small>${e.rccm ? `RCCM : ${e.rccm}` : ''}${e.rccm && e.nif ? ' — ' : ''}${e.nif ? `NIF : ${e.nif}` : ''}</small>` : ''}
    </div>
    <div><strong>N° ${doc.numero}</strong><small>${dateFr(donnees.date)}</small></div>
  </div>
  ${doc.avertissement ? html`<p class="avertissement">${doc.avertissement}</p>` : ''}
  ${corps}
</div>
<script src="/app.js" defer></script>
</body>
</html>`);
}
