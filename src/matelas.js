// Stock de matelas : ce qui est encore en mer, ce qui est disponible à Libreville, ce qui est vendu.
import { reglage } from './db.js';

export const TYPES_MATELAS = [['1', '1 place'], ['2', '2 places'], ['3', '3 places']];

export function stockMatelas(db) {
  const arrivages = db.prepare(`
    SELECT a.type, SUM(CASE WHEN ct.date_arrivee IS NULL THEN a.quantite ELSE 0 END) AS en_mer,
           SUM(CASE WHEN ct.date_arrivee IS NULL THEN 0 ELSE a.quantite END) AS arrives
    FROM matelas_arrivages a JOIN conteneurs ct ON ct.id = a.conteneur_id GROUP BY a.type`).all();
  const ventes = db.prepare(`
    SELECT type, SUM(quantite) AS vendus, SUM(quantite * prix_unitaire) AS encaisse
    FROM matelas_ventes WHERE annule = 0 GROUP BY type`).all();
  return TYPES_MATELAS.map(([type, libelle]) => {
    const a = arrivages.find(x => x.type === type) ?? { en_mer: 0, arrives: 0 };
    const v = ventes.find(x => x.type === type) ?? { vendus: 0, encaisse: 0 };
    return {
      type, libelle, enMer: a.en_mer, vendus: v.vendus, encaisse: v.encaisse,
      disponible: a.arrives - v.vendus,
      prixMinimum: Number(reglage(db, `matelas_prix_${type}`)),
      coutWon: Number(reglage(db, `matelas_cout_${type}`)), // réservé à la page Marges
    };
  });
}
