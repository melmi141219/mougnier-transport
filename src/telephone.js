// Numéro au format attendu par wa.me : chiffres seuls, indicatif compris, sans « + ».
// Gabon : 066123456 → 24166123456 (on enlève le 0 de tête).
export function numeroWhatsApp(texte) {
  if (typeof texte !== 'string') return null;
  const t = texte.replace(/[\s.\-()]/g, '');
  const international = /^(?:\+|00)(\d{8,15})$/.exec(t);
  // « +241 077… » : le 0 de tête recopié après l'indicatif du Gabon est en trop
  if (international) return international[1].replace(/^2410(\d{8})$/, '241$1');
  if (/^241\d{8}$/.test(t)) return t; // indicatif sans « + », comme sur les connaissements
  if (/^0\d{8}$/.test(t)) return '241' + t.slice(1);
  if (/^\d{8}$/.test(t)) return '241' + t;
  return null;
}

export function lienWhatsApp(telephone, texte) {
  const numero = numeroWhatsApp(telephone);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texte)}` : null;
}
