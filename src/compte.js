// Le compte d'un client : ce qu'il doit, ce qu'il a versé, ses échéances.
import { prixVehicule, echeances } from './calc.js';
import { reglage } from './db.js';
import { aujourdHui } from './format.js';

export function compteClient(db, clientId, aujourdhui = aujourdHui()) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return null;

  // Date à laquelle le client a été prévenu, par conteneur : la plus ancienne relance compte.
  const notifications = db.prepare(`
    SELECT type, conteneur_id, MIN(envoye_le) AS le FROM relances
    WHERE client_id = ? AND type IN ('arrivee', 'douane') GROUP BY type, conteneur_id`).all(clientId);
  const prevenuLe = (type, conteneurId) =>
    notifications.find(n => n.type === type && n.conteneur_id === conteneurId)?.le ?? null;

  const vehicules = db.prepare(`
    SELECT v.*, c.mode, c.contrat_papier, c.delai_jours AS delai_contrat,
           EXISTS (SELECT 1 FROM documents d WHERE d.commande_id = c.id AND d.type = 'contrat' AND d.etat <> 'remplace') AS contrat_emis,
           ct.numero AS ct_numero, ct.navire AS ct_navire, ct.bl AS ct_bl,
           ct.eta AS ct_eta, ct.date_arrivee AS ct_date_arrivee, ct.date_facture AS ct_date_facture
    FROM vehicules v
    JOIN commandes c ON c.id = v.commande_id
    LEFT JOIN conteneurs ct ON ct.id = v.conteneur_id
    WHERE v.client_id = ? AND v.type = 'vente' AND v.annulee = 0
    ORDER BY v.id`).all(clientId).map(v => ({
    ...v,
    prix: prixVehicule(v),
    delaiJours: v.delai_contrat ?? undefined, // figé à l'émission du contrat
    malusPrevu: v.contrat_emis === 1,         // la clause de malus n'existe que dans le contrat de la plateforme
    conteneur: v.conteneur_id === null ? null : {
      id: v.conteneur_id, numero: v.ct_numero, navire: v.ct_navire, bl: v.ct_bl,
      eta: v.ct_eta, date_arrivee: v.ct_date_arrivee, date_facture: v.ct_date_facture,
    },
    notifArrivee: prevenuLe('arrivee', v.conteneur_id),
    notifDouane: prevenuLe('douane', v.conteneur_id),
  }));

  const penalites = db.prepare(
    'SELECT * FROM penalites WHERE client_id = ? AND annule = 0 ORDER BY date, id').all(clientId);
  const recu = db.prepare(`
    SELECT COALESCE(SUM(CASE sens WHEN 'entree' THEN montant ELSE -montant END), 0) AS recu
    FROM mouvements WHERE client_id = ? AND annule = 0`).get(clientId).recu;

  // Une ristourne baisse ce que le client doit, comme un versement, mais ce n'est pas de l'argent reçu.
  const totalRistournes = db.prepare(
    'SELECT COALESCE(SUM(montant), 0) AS total FROM ristournes WHERE client_id = ? AND annule = 0').get(clientId).total;

  const total = vehicules.reduce((s, v) => s + v.prix.total, 0);
  const totalPenalites = penalites.reduce((s, p) => s + p.montant, 0);
  const du = total + totalPenalites - totalRistournes;

  return {
    client, vehicules, penalites, total, totalPenalites, totalRistournes, recu,
    dontDouane: vehicules.reduce((s, v) => s + v.prix.douane, 0),
    reste: Math.max(0, du - recu),
    credit: Math.max(0, recu - du),
    lignes: echeances({
      vehicules, penalites, recu: recu + totalRistournes, aujourdhui,
      delaiJours: Number(reglage(db, 'delai_jours')) || 10,
    }),
  };
}
