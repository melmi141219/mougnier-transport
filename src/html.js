// Gabarit HTML : toute valeur insérée est échappée, sauf le HTML déjà produit par html`` ou brut().
const ECHAPPEMENTS = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

class Brut {
  constructor(texte) { this.texte = texte; }
  toString() { return this.texte; }
}

export const brut = texte => new Brut(String(texte));

function rendre(valeur) {
  if (valeur == null || valeur === false) return '';
  if (valeur instanceof Brut) return valeur.texte;
  if (Array.isArray(valeur)) return valeur.map(rendre).join('');
  return String(valeur).replace(/[&<>"']/g, c => ECHAPPEMENTS[c]);
}

export function html(morceaux, ...valeurs) {
  let sortie = morceaux[0];
  valeurs.forEach((valeur, i) => { sortie += rendre(valeur) + morceaux[i + 1]; });
  return new Brut(sortie);
}

const MENU = [['/', 'Aujourd’hui'], ['/clients', 'Clients'], ['/vehicules', 'Voitures'], ['/conteneurs', 'Conteneurs'], ['/catalogue', 'Gamme'], ['/matelas', 'Matelas'], ['/partenaires', 'Partenaires']];
const MENU_ADMIN = [['/marges', 'Marges'], ['/reglages', 'Réglages'], ['/utilisateurs', 'Comptes']];
// Menu de chaque rôle partenaire, en anglais : uniquement des adresses de /partenaire, jamais de l'interne.
const MENU_PARTENAIRE = {
  fournisseur: [['/partenaire', 'Home'], ['/partenaire/offres', 'My offers'], ['/partenaire/voitures', 'Ordered cars'], ['/partenaire/paiements', 'Payments']],
  transporteur: [['/partenaire', 'Home'], ['/partenaire/conteneurs', 'Containers'], ['/partenaire/paiements', 'Payments']],
};

function gabarit({ langue, accueil, liens, deconnexion, titre, utilisateur, actif, contenu }) {
  return String(html`<!doctype html>
<html lang="${langue}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre} — MOUGNIER TRANSPORT</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="bandeau">
  <a class="marque" href="${accueil}"><strong>MT</strong> MOUGNIER TRANSPORT</a>
  ${utilisateur ? html`<nav>${liens.map(([href, nom]) => html`<a href="${href}" class="${href === actif ? 'actif' : ''}">${nom}</a>`)}</nav>
  <form class="session" method="post" action="/deconnexion">
    <a href="/mon-mot-de-passe">${utilisateur.nom}</a>
    <button class="lien">${deconnexion}</button>
  </form>` : ''}
</header>
<main>
<h1>${titre}</h1>
${contenu}
</main>
<script src="/app.js" defer></script>
</body>
</html>`);
}

export function page({ titre, utilisateur = null, actif = '', contenu }) {
  const liens = utilisateur ? [...MENU, ...(utilisateur.role === 'admin' ? MENU_ADMIN : [])] : [];
  return gabarit({ langue: 'fr', accueil: '/', liens, deconnexion: 'Déconnexion', titre, utilisateur, actif, contenu });
}

// Tout ce qu'un partenaire voit : en anglais, avec le menu de son rôle, sans aucun lien vers l'interne.
export function pagePartenaire({ titre, utilisateur, actif = '', contenu }) {
  return gabarit({ langue: 'en', accueil: '/partenaire', liens: MENU_PARTENAIRE[utilisateur.role], deconnexion: 'Log out', titre, utilisateur, actif, contenu });
}

// Petits éléments de formulaire, partagés par tous les écrans.
export function champ(libelle, nom, valeur = '', { type = 'text', requis = false, aide = '' } = {}) {
  return html`<label class="champ"><span>${libelle}</span>
    <input type="${type}" name="${nom}" value="${valeur ?? ''}" ${requis ? brut('required') : ''}>
    ${aide ? html`<small>${aide}</small>` : ''}</label>`;
}

export function choix(libelle, nom, options, valeur = '') {
  return html`<label class="champ"><span>${libelle}</span>
    <select name="${nom}">${options.map(([v, texte]) =>
      html`<option value="${v}" ${String(v) === String(valeur ?? '') ? brut('selected') : ''}>${texte}</option>`)}</select></label>`;
}
