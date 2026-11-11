// Les mots affichés pour les codes rangés en base.
export const STATUTS = [
  ['commandee', 'Commandée'], ['achetee', 'Achetée en Corée'], ['chargee', 'Chargée dans un conteneur'],
  ['en_mer', 'En mer'], ['arrivee', 'Arrivée à Libreville'], ['dedouanee', 'Dédouanée'], ['remise', 'Remise'],
];
export const RANG_STATUT = Object.fromEntries(STATUTS.map(([code], i) => [code, i]));
export const libelleStatut = code => STATUTS.find(([c]) => c === code)?.[1] ?? code;

export const TYPES = { vente: 'Vente', perso: 'À moi', charge: 'À ma charge' };

// état d'une échéance → [texte, classe CSS]
export const ETATS = {
  payee: ['Payé', 'ok'], sans_date: ['Date d’arrivée inconnue', ''], a_venir: ['À venir', ''],
  a_relancer: ['À relancer', 'attention'], exigible: ['À payer', 'attention'], en_retard: ['En retard', 'retard'],
};
export const LIGNES = { solde: 'Solde avant l’arrivée', douane: 'Douane', penalite: 'Pénalité' };

export const MODES_PAIEMENT = [
  ['especes', 'Espèces'], ['compte', 'Compte d’Eric'], ['mobile_money', 'Mobile money'], ['cheque', 'Chèque'],
];
export const libelleMode = code => MODES_PAIEMENT.find(([c]) => c === code)?.[1] ?? code;

export const NATURES_PENALITE = [
  ['magasinage', 'Magasinage au port'], ['surestaries', 'Surestaries du conteneur'],
  ['transitaire', 'Pénalité du transitaire'], ['autre', 'Autre frais de retard'],
];
export const libelleNature = code => (code === 'malus' ? 'Malus de retard' : NATURES_PENALITE.find(([c]) => c === code)?.[1] ?? code);

export const libelleVoiture = v => [v.marque, v.modele, v.version, v.annee].filter(Boolean).join(' ');
