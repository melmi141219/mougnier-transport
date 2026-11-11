// Contrats, reçus, procès-verbaux : chacun est numéroté et garde une copie figée de ses données.
import { reglage, transaction } from './db.js';
import { compteClient } from './compte.js';
import { prixVehicule } from './calc.js';
import { Refus } from './saisie.js';
import { libelleVoiture } from './libelles.js';

const PREFIXES = { contrat: 'MT-C', recu: 'MT-R', pv: 'MT-PV' };

export function prochainNumero(db, type, annee) {
  const debut = `${PREFIXES[type]}-${annee}-`;
  const dernier = db.prepare(
    'SELECT numero FROM documents WHERE type = ? AND numero LIKE ? ORDER BY LENGTH(numero) DESC, numero DESC LIMIT 1')
    .get(type, `${debut}%`);
  const rang = dernier ? Number(dernier.numero.slice(debut.length)) + 1 : 1;
  return debut + String(rang).padStart(3, '0');
}

export function entreprise(db) {
  return {
    tel: reglage(db, 'entreprise_tel'), adresse: reglage(db, 'entreprise_adresse'),
    rccm: reglage(db, 'rccm'), nif: reglage(db, 'nif'),
  };
}

function inserer(db, { type, numero, donnees, utilisateur, aujourdhui, commandeId = null, mouvementId = null, vehiculeId = null, remplaceId = null }) {
  const id = Number(db.prepare(`
    INSERT INTO documents (type, numero, commande_id, mouvement_id, vehicule_id, remplace_id, donnees, cree_le, par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(type, numero, commandeId, mouvementId, vehiculeId, remplaceId, JSON.stringify(donnees), aujourdhui, utilisateur.identifiant)
    .lastInsertRowid);
  return { id, numero };
}

const VOITURES_DE_LA_COMMANDE = `
  SELECT v.*, ct.numero AS ct_numero, ct.bl AS ct_bl FROM vehicules v LEFT JOIN conteneurs ct ON ct.id = v.conteneur_id
  WHERE v.commande_id = ? AND v.type = 'vente' AND v.annulee = 0 ORDER BY v.id`;

const ficheClient = c => ({
  id: c.id, nom: c.nom, telephone: c.telephone, date_naissance: c.date_naissance, lieu_naissance: c.lieu_naissance,
  nationalite: c.nationalite, piece_identite: c.piece_identite, piece_valable_jusqu: c.piece_valable_jusqu, adresse: c.adresse,
});

const designation = v => ({
  libelle: libelleVoiture(v), marque: v.marque, modele: v.modele, version: v.version, annee: v.annee, couleur: v.couleur,
  energie_boite: v.energie_boite, chassis: v.chassis, kilometrage: v.kilometrage, conteneur: v.ct_numero ?? null, bl: v.ct_bl ?? null,
});

// Émet le contrat d'une commande : verrouille le prix client de chaque voiture, remplace le contrat précédent
// s'il y en a un, et fige toutes les données dans le document.
export function emettreContrat(db, commandeId, utilisateur, aujourdhui) {
  const commande = db.prepare('SELECT * FROM commandes WHERE id = ?').get(commandeId);
  if (!commande) throw new Refus(404, 'Cette commande n’existe pas.');
  if (commande.contrat_papier)
    throw new Refus(409, 'Cette commande a déjà un contrat papier signé : la plateforme le suit tel quel et n’en émet pas d’autre.');
  if (!db.prepare(VOITURES_DE_LA_COMMANDE).all(commandeId).length)
    throw new Refus(409, 'Ajoutez d’abord une voiture à cette commande.');

  return transaction(db, () => {
    // le prix se recalcule à partir des coûts actuels, puis il est verrouillé
    for (const v of db.prepare(VOITURES_DE_LA_COMMANDE).all(commandeId)) {
      const prix = prixVehicule({ ...v, verrou_hors_douane: null, verrou_douane: null });
      db.prepare('UPDATE vehicules SET verrou_hors_douane = ?, verrou_douane = ? WHERE id = ?').run(prix.horsDouane, prix.douane, v.id);
    }
    const voitures = db.prepare(VOITURES_DE_LA_COMMANDE).all(commandeId).map(v => ({ ...v, prix: prixVehicule(v) }));
    const ancien = db.prepare("SELECT id, numero FROM documents WHERE commande_id = ? AND type = 'contrat' AND etat <> 'remplace' ORDER BY id DESC LIMIT 1").get(commandeId);
    if (ancien) db.prepare("UPDATE documents SET etat = 'remplace' WHERE id = ?").run(ancien.id);

    const compte = compteClient(db, commande.client_id, aujourdhui);
    const total = voitures.reduce((s, v) => s + v.prix.total, 0);
    const horsDouane = voitures.reduce((s, v) => s + v.prix.horsDouane, 0);
    const douane = total - horsDouane;
    // les versements du client couvrent d'abord ses commandes les plus anciennes
    const commandesAvant = compte.vehicules.filter(v => v.commande_id < commandeId).reduce((s, v) => s + v.prix.total, 0);
    const acompte = Math.max(0, Math.min(total, compte.recu - commandesAvant));

    const echeancier = [];
    if (acompte > 0) echeancier.push({ libelle: 'Acompte', montant: acompte, moment: 'Déjà versé à la signature du présent acte' });
    if (commande.mode === 'deux' && douane > 0) {
      echeancier.push({ libelle: 'Solde', montant: Math.max(0, horsDouane - acompte), moment: 'À l\'arrivée du véhicule à Libreville' });
      echeancier.push({ libelle: 'Douane', montant: douane - Math.max(0, acompte - horsDouane), moment: 'Dès la fin des démarches du transitaire, avant la remise du véhicule' });
    } else {
      echeancier.push({ libelle: 'Solde', montant: total - acompte, moment: 'À l\'arrivée du véhicule à Libreville, avant sa remise' });
    }

    // Le délai de paiement écrit dans ce contrat reste celui de la commande, même si le réglage change ensuite.
    const delaiJours = Number(reglage(db, 'delai_jours')) || 10;
    db.prepare('UPDATE commandes SET delai_jours = ? WHERE id = ?').run(delaiJours, commandeId);

    const numero = prochainNumero(db, 'contrat', Number(aujourdhui.slice(0, 4)));
    return inserer(db, {
      type: 'contrat', numero, utilisateur, aujourdhui, commandeId, remplaceId: ancien?.id ?? null,
      donnees: {
        numero, date: aujourdhui, remplace: ancien?.numero ?? null, entreprise: entreprise(db), client: ficheClient(compte.client),
        mode: commande.mode === 'deux' && douane > 0 ? 'deux' : 'unique',
        delaiJours,
        vehicules: voitures.map(v => ({
          ...designation(v), forfait: v.prix.forfait, achat: v.achat, transport: v.transport,
          douane: v.prix.douane, fraisService: v.prix.forfait ? null : v.prix.horsDouane - (v.achat ?? 0) - (v.transport ?? 0), total: v.prix.total,
        })),
        total, acompte, echeancier,
      },
    });
  });
}

// Un contrat signé sur papier, hors de la plateforme : on verrouille les prix actuels et on n'émet plus de contrat ici.
export function marquerContratPapier(db, commandeId) {
  const commande = db.prepare('SELECT * FROM commandes WHERE id = ?').get(commandeId);
  if (!commande) throw new Refus(404, 'Cette commande n’existe pas.');
  const voitures = db.prepare(VOITURES_DE_LA_COMMANDE).all(commandeId);
  if (!voitures.length) throw new Refus(409, 'Ajoutez d’abord une voiture à cette commande.');
  if (db.prepare("SELECT 1 FROM documents WHERE commande_id = ? AND type = 'contrat' AND etat <> 'remplace'").get(commandeId))
    throw new Refus(409, 'Un contrat émis par la plateforme existe déjà pour cette commande.');
  transaction(db, () => {
    for (const v of voitures) {
      const prix = prixVehicule(v);
      db.prepare('UPDATE vehicules SET verrou_hors_douane = ?, verrou_douane = ? WHERE id = ?').run(prix.horsDouane, prix.douane, v.id);
    }
    db.prepare('UPDATE commandes SET contrat_papier = 1 WHERE id = ?').run(commandeId);
  });
  return commande;
}

export function emettrePV(db, vehiculeId, utilisateur, date) {
  const v = db.prepare(`SELECT v.*, ct.numero AS ct_numero, ct.bl AS ct_bl FROM vehicules v
    LEFT JOIN conteneurs ct ON ct.id = v.conteneur_id WHERE v.id = ?`).get(vehiculeId);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(v.client_id);
  const contrat = db.prepare("SELECT numero FROM documents WHERE commande_id = ? AND type = 'contrat' AND etat <> 'remplace' ORDER BY id DESC LIMIT 1").get(v.commande_id);
  const numero = prochainNumero(db, 'pv', Number(date.slice(0, 4)));
  return inserer(db, {
    type: 'pv', numero, utilisateur, aujourdhui: date, vehiculeId,
    donnees: { numero, date, entreprise: entreprise(db), client: ficheClient(client), vehicule: designation(v), contrat: contrat?.numero ?? null, par: utilisateur.nom },
  });
}

// À appeler juste après l'enregistrement du versement : le reçu fige le reste à cet instant.
export function emettreRecu(db, mouvementId, utilisateur, aujourdhui) {
  const m = db.prepare('SELECT * FROM mouvements WHERE id = ?').get(mouvementId);
  const compte = compteClient(db, m.client_id, aujourdhui);
  const numero = prochainNumero(db, 'recu', Number(m.date.slice(0, 4)));
  return inserer(db, {
    type: 'recu', numero, utilisateur, aujourdhui, mouvementId,
    donnees: {
      numero, date: m.date, entreprise: entreprise(db), par: utilisateur.nom,
      client: { id: compte.client.id, nom: compte.client.nom, telephone: compte.client.telephone },
      montant: m.montant, mode: m.mode, reference: m.reference, avecFrais: m.avec_frais === 1, note: m.note,
      totalRecu: compte.recu, ristournes: compte.totalRistournes, reste: compte.reste, credit: compte.credit,
    },
  });
}
