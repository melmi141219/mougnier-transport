// Montants en francs CFA entiers, dates en 'AAAA-MM-JJ'.

const milliers = n => (n < 0 ? '-' : '') + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function fcfa(n) {
  return `${milliers(n)} F`;
}

export function won(n) {
  return `${milliers(n)} ₩`;
}

// '5 450 000', '5.450.000', '5450000 F' → 5450000. Tout le reste → null.
export function parseMontant(texte) {
  if (typeof texte !== 'string') return null;
  const t = texte.trim().replace(/\s*F(CFA)?$/i, '').trim();
  if (!/^(\d{1,3}([ .  ]\d{3})+|\d+)$/.test(t)) return null;
  const n = Number(t.replace(/\D/g, ''));
  return n > 0 && n < 1e9 ? n : null; // au-delà d'un milliard, c'est une faute de frappe
}

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function sousCent(n) {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (d === 7 || d === 9) return d === 7 && u === 1 ? 'soixante et onze' : `${DIZAINES[d]}-${UNITES[10 + u]}`;
  if (u === 0) return d === 8 ? 'quatre-vingts' : DIZAINES[d];
  if (u === 1 && d !== 8) return `${DIZAINES[d]} et un`;
  return `${DIZAINES[d]}-${UNITES[u]}`;
}

function sousMille(n) {
  const c = Math.floor(n / 100), r = n % 100;
  if (c === 0) return sousCent(r);
  const cent = c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 ? 's' : ''}`;
  return r === 0 ? cent : `${cent} ${sousCent(r)}`;
}

// Entiers de 0 à 999 999 999, pour les montants écrits en toutes lettres.
export function enLettres(n) {
  if (n === 0) return 'zéro';
  const millions = Math.floor(n / 1e6), milliers = Math.floor((n % 1e6) / 1000), reste = n % 1000;
  const parties = [];
  if (millions) parties.push(`${sousMille(millions)} million${millions > 1 ? 's' : ''}`);
  // devant « mille », cent et quatre-vingt perdent leur s
  if (milliers) parties.push(milliers === 1 ? 'mille' : `${sousMille(milliers).replace(/(cent|vingt)s$/, '$1')} mille`);
  if (reste) parties.push(sousMille(reste));
  return parties.join(' ');
}

// « deux millions de francs CFA », mais « trois millions six cent mille francs CFA ».
export function enFrancs(n) {
  return `${enLettres(n)} ${n > 0 && n % 1e6 === 0 ? 'de ' : ''}francs CFA`;
}

const enUTC = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

export function ajouterJours(iso, n) {
  return new Date(enUTC(iso) + n * 86400000).toISOString().slice(0, 10);
}

export function joursEntre(debut, fin) {
  return Math.round((enUTC(fin) - enUTC(debut)) / 86400000);
}

// 'AAAA-MM-JJ' d'un jour qui existe → la même chaîne ; sinon null.
export function dateValide(texte) {
  if (typeof texte !== 'string' || !/^(19|20)\d{2}-\d{2}-\d{2}$/.test(texte)) return null; // années 1900 à 2099
  return new Date(enUTC(texte)).toISOString().slice(0, 10) === texte ? texte : null;
}

export function dateFr(iso) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
}

export function aujourdHui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
