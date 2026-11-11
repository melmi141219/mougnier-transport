// Lecture des formulaires : tout ce qui vient du navigateur est vérifié ici avant d'être enregistré.
import { parseMontant, dateValide } from './format.js';

// Une saisie refusée : le gestionnaire d'erreurs en fait une page avec ce message et ce code HTTP.
export class Refus extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}

export function texte(valeur, max = 200) {
  const t = String(valeur ?? '').trim().slice(0, max);
  return t === '' ? null : t;
}

export function entier(valeur) {
  const t = String(valeur ?? '').replace(/\s/g, '');
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}

const vide = valeur => String(valeur ?? '').trim() === '';

export function entierFacultatif(valeur, nom) {
  if (vide(valeur)) return null;
  const n = entier(valeur);
  if (n === null) throw new Refus(400, `${nom} : nombre illisible.`);
  return n;
}

export function montantObligatoire(valeur, nom) {
  const n = parseMontant(String(valeur ?? ''));
  if (n === null) throw new Refus(400, `${nom} : montant illisible. Écrivez par exemple 5 450 000.`);
  return n;
}

export function montantFacultatif(valeur, nom) {
  return vide(valeur) ? null : montantObligatoire(valeur, nom);
}

// Pour l'arrondi ou la remise : peut être négatif, vide = 0.
export function montantSigne(valeur, nom) {
  const t = String(valeur ?? '').trim();
  if (t === '' || /^-?0$/.test(t)) return 0;
  const n = montantObligatoire(t.replace(/^-\s*/, ''), nom);
  return t.startsWith('-') ? -n : n;
}

export function dateObligatoire(valeur, nom = 'Date') {
  const d = dateValide(String(valeur ?? ''));
  if (!d) throw new Refus(400, `${nom} : date illisible.`);
  return d;
}

export function dateFacultative(valeur, nom = 'Date') {
  return vide(valeur) ? null : dateObligatoire(valeur, nom);
}

export function parmi(valeur, permis, nom) {
  if (!permis.includes(valeur)) throw new Refus(400, `${nom} : choix inconnu.`);
  return valeur;
}
