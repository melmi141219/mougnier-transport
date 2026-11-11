// Charge un jeu d'exemple (noms et numéros inventés, prix de vente des vrais dossiers du 10/11/2026) pour les tests et les essais.
// Les vrais prix d'achat sont à part, dans scripts/prix-reels.js, qui reste sur le PC.
// Jamais sur la vraie base : elle est déjà chargée, et le script refuse une base qui a des clients.
import { ouvrirBase, transaction } from '../src/db.js';
import { aujourdHui } from '../src/format.js';
import { config } from '../src/config.js';

const M = 1000000;

export function chargerDonnees(db, { date = aujourdHui() } = {}) {
  if (db.prepare('SELECT COUNT(*) AS n FROM clients').get().n > 0)
    throw new Error('Des clients existent déjà : les données de départ ne se chargent qu’une fois.');

  transaction(db, () => {
    const client = nom =>
      Number(db.prepare('INSERT INTO clients (nom, cree_le) VALUES (?, ?)').run(nom, date).lastInsertRowid);
    const commande = (clientId, mode = 'deux', papier = 0) => Number(db.prepare(
      'INSERT INTO commandes (client_id, mode, contrat_papier, cree_le) VALUES (?, ?, ?, ?)')
      .run(clientId, mode, papier, date).lastInsertRowid);
    const conteneur = (numero, bl, reservation, navire) => Number(db.prepare(
      'INSERT INTO conteneurs (numero, bl, reservation, navire) VALUES (?, ?, ?, ?)')
      .run(numero, bl, reservation, navire).lastInsertRowid);
    const insererVoiture = db.prepare(`
      INSERT INTO vehicules (type, client_id, commande_id, conteneur_id, marque, modele, version, annee, couleur,
        energie_boite, chassis, achat, transport, arrondi, forfait, verrou_hors_douane, verrou_douane, statut, notes)
      VALUES (:type, :client_id, :commande_id, :conteneur_id, :marque, :modele, :version, :annee, :couleur,
        :energie_boite, :chassis, :achat, :transport, :arrondi, :forfait, :verrou_hors_douane, :verrou_douane, :statut, :notes)`);
    const voiture = v => insererVoiture.run({
      type: 'vente', client_id: null, commande_id: null, conteneur_id: null, version: null, annee: null,
      couleur: null, energie_boite: null, chassis: null, achat: null, transport: null, arrondi: 0, forfait: null,
      verrou_hors_douane: null, verrou_douane: null, notes: null,
      ...v,
      statut: v.conteneur_id ? 'chargee' : 'commandee',
    });
    const insererVersement = db.prepare(`
      INSERT INTO mouvements (client_id, sens, montant, date, mode, avec_frais, note, saisi_par, saisi_le)
      VALUES (?, 'entree', ?, ?, ?, ?, ?, 'saisie initiale', ?)`);
    const versement = (clientId, montant, extra = {}) => insererVersement.run(
      clientId, montant, extra.date ?? date, extra.mode ?? 'especes', extra.avecFrais ? 1 : 0,
      extra.note ?? 'saisie initiale', date);

    const starex = conteneur('TSTU0000001', 'BLESSAI00001', 'RESA00000001', 'MSC LANA IV - HR643A');
    const korea = conteneur('TSTU0000003', 'BLESSAI00003', 'RESA00000003', 'MSC KOREA III - HR644A');

    const alice = client('Alice'), cAlice = commande(alice);
    voiture({ client_id: alice, commande_id: cAlice, marque: 'Hyundai', modele: 'Avante', achat: 1.8 * M, transport: 0.8 * M });
    voiture({ client_id: alice, commande_id: cAlice, marque: 'Hyundai', modele: 'Santa Fe', achat: 3 * M, transport: 1.6 * M });
    versement(alice, 3 * M);
    versement(alice, 1090000, { avecFrais: true, note: 'saisie initiale — 1 million avec frais, à confirmer' });

    const directrice = client('Directrice (Entreprise A)');
    voiture({ client_id: directrice, commande_id: commande(directrice), marque: 'À préciser', modele: 'Pick-up', achat: 5 * M, transport: 1.6 * M });
    versement(directrice, 5450000, { avecFrais: true });

    const brigitte = client('Brigitte');
    voiture({ client_id: brigitte, commande_id: commande(brigitte), marque: 'Kia', modele: 'Sportage', version: 'full option', achat: 3.3 * M, transport: 1.6 * M });
    versement(brigitte, 3270000, { avecFrais: true });

    const carole = client('Carole Mba'), cCarole = commande(carole);
    voiture({ client_id: carole, commande_id: cCarole, conteneur_id: korea, marque: 'Hyundai', modele: 'Maxcruz', annee: 2017, chassis: 'ESSAI000000000001', achat: 3.9 * M, transport: 1.6 * M });
    for (let i = 0; i < 2; i++) // transport de 1 600 000 partagé entre les deux
      voiture({ client_id: carole, commande_id: cCarole, marque: 'Hyundai', modele: 'i30 GDI', version: 'simple', achat: 2.5 * M, transport: 0.8 * M });
    versement(carole, 4.5 * M);
    versement(carole, 2 * M);

    const delphine = client('Delphine'), cDelphine = commande(delphine);
    voiture({ client_id: delphine, commande_id: cDelphine, conteneur_id: korea, marque: 'SsangYong', modele: 'Tivoli', annee: 2017, chassis: 'ESSAI000000000002', achat: 2.8 * M, transport: 0.8 * M });
    voiture({ client_id: delphine, commande_id: cDelphine, marque: 'SsangYong', modele: 'Tivoli', achat: 2.8 * M, transport: 0.8 * M });
    versement(delphine, 5 * M);

    // Lucien a signé un contrat papier le 10/11/2026 : prix fixé à 3 600 000, un seul solde à l'arrivée.
    const lucien = client('Lucien');
    voiture({ client_id: lucien, commande_id: commande(lucien, 'unique', 1), marque: 'Chevrolet', modele: 'Aveo', version: 'LS', annee: 2015,
      couleur: 'Noire', energie_boite: 'Essence / automatique', achat: 1.4 * M, transport: 0.8 * M, arrondi: -8000,
      verrou_hors_douane: 2390000, verrou_douane: 1210000, notes: 'N° de châssis : voir le contrat papier.' });
    versement(lucien, 2 * M, { date: '2026-11-10', note: 'acompte à la signature du contrat papier' });

    const estelle = client('Estelle');
    voiture({ client_id: estelle, commande_id: commande(estelle, 'unique'), marque: 'Hyundai', modele: 'i30', version: 'ancien modèle', forfait: 4 * M });
    versement(estelle, 2 * M);

    const fabrice = client('Fabrice');
    voiture({ client_id: fabrice, commande_id: commande(fabrice, 'unique'), conteneur_id: korea, marque: 'Kia', modele: 'K5', annee: 2017, chassis: 'ESSAI000000000003', forfait: 5.5 * M });
    versement(fabrice, 2 * M, { mode: 'compte', note: 'saisie initiale — avance versée sur le compte d’Eric' });

    const gaston = client('Gaston'); // a versé, voiture pas encore connue
    for (const montant of [1350000, 1 * M, 2.5 * M]) versement(gaston, montant);

    const helene = client('Hélène');
    voiture({ type: 'charge', client_id: helene, conteneur_id: korea, marque: 'Hyundai', modele: 'Veloster', annee: 2017, chassis: 'ESSAI000000000004' });

    for (const chassis of ['ESSAI000000000005', 'ESSAI000000000006', 'ESSAI000000000007'])
      voiture({ type: 'perso', conteneur_id: starex, marque: 'Hyundai', modele: 'Grand Starex', annee: 2017, chassis });
    voiture({ type: 'perso', conteneur_id: korea, marque: 'Kia', modele: 'Pride', annee: 2017, chassis: 'ESSAI000000000008' });
    voiture({ type: 'perso', marque: 'Hyundai', modele: 'i30 GDI', version: 'full option' });
    voiture({ type: 'perso', marque: 'Hyundai', modele: 'i30 GDI', version: 'simple' });

    const gamme = db.prepare('INSERT INTO catalogue (marque, modele, version, achat, transport) VALUES (?, ?, ?, ?, ?)');
    for (const [marque, modele, version, achat, transport] of [
      ['Hyundai', 'Avante', null, 1.8, 0.8], ['Hyundai', 'Santa Fe', null, 3, 1.6], ['Hyundai', 'Maxcruz', null, 3.9, 1.6],
      ['Hyundai', 'i30 GDI', 'simple', 2.5, 0.8], ['SsangYong', 'Tivoli', null, 2.8, 0.8], ['À préciser', 'Pick-up', null, 5, 1.6],
      ['Kia', 'Sportage', 'full option', 3.3, 1.6], ['Chevrolet', 'Aveo', 'LS', 1.4, 0.8]])
      gamme.run(marque, modele, version, achat * M, transport * M);
  });
}

// Ce qu'Eric a confirmé le 11/11/2026, d'après ses échanges avec le transporteur et le suivi MSC :
// le conteneur 2 et ses six voitures, les deux i30 de Gaston, les dates de départ et d'arrivée prévue.
// Les voitures restantes (2e i30 de Carole, 2e Tivoli de Delphine, Sportage, Santa Fe, pick-up, Aveo,
// i30 GDI simple d'Eric) partiront dans les conteneurs 4 et 5 : elles restent « commandées ».
export function appliquerSuiviDu11Novembre(db, { date = aujourdHui() } = {}) {
  transaction(db, () => {
    const idClient = nom => db.prepare('SELECT id FROM clients WHERE nom = ?').get(nom).id;
    const un = (sql, ...parametres) => db.prepare(sql).get(...parametres).id;
    const ct2 = Number(db.prepare('INSERT INTO conteneurs (numero, bl, navire, notes) VALUES (?, ?, ?, ?)')
      .run('TSTU0000002', 'BLESSAI00002', 'MSC LANA IV - HR643A', 'BIETC n° 0000002. 6 voitures + 1 lot de matelas, 9 425 kg.').lastInsertRowid);

    const embarquer = (voitureId, couleur = null) =>
      db.prepare('UPDATE vehicules SET conteneur_id = ?, couleur = COALESCE(?, couleur) WHERE id = ?').run(ct2, couleur, voitureId);
    embarquer(un("SELECT id FROM vehicules WHERE client_id = ? AND modele = 'Avante'", idClient('Alice')));
    embarquer(un("SELECT MIN(id) AS id FROM vehicules WHERE client_id = ? AND modele = 'i30 GDI'", idClient('Carole Mba')), 'Rouge');
    embarquer(un("SELECT id FROM vehicules WHERE client_id = ? AND modele = 'i30'", idClient('Estelle')));
    embarquer(un("SELECT id FROM vehicules WHERE type = 'perso' AND modele = 'i30 GDI' AND version = 'full option'"), 'Blanche');

    const gaston = idClient('Gaston');
    const commande = Number(db.prepare("INSERT INTO commandes (client_id, mode, cree_le) VALUES (?, 'unique', ?)").run(gaston, date).lastInsertRowid);
    for (let i = 0; i < 2; i++)
      db.prepare(`INSERT INTO vehicules (type, client_id, commande_id, conteneur_id, marque, modele, version, forfait)
        VALUES ('vente', ?, ?, ?, 'Hyundai', 'i30', 'ancien modèle', 4000000)`).run(gaston, commande, ct2);

    db.prepare("UPDATE vehicules SET couleur = 'Bleue' WHERE client_id = ? AND modele = 'Tivoli' AND conteneur_id IS NULL").run(idClient('Delphine'));
    db.prepare(`UPDATE vehicules SET energie_boite = 'Diesel', notes = 'Modèle 2014-2015, en cours d’achat. Partira dans le conteneur 4 ou 5.'
      WHERE client_id = ? AND modele = 'Sportage'`).run(idClient('Brigitte'));

    const suivi = [ // numéro, chargé à Incheon, arrivée prévue à Libreville (suivi MSC du 11/11/2026), note
      ['TSTU0000001', '2026-10-31', '2027-01-05', 'BIETC à confirmer : brouillon n° 0000001 reçu le 09/11/2026 (pour ce conteneur ou pour TSTU0000003 ?).'],
      ['TSTU0000002', '2026-10-31', '2027-01-05', null],
      ['TSTU0000003', '2026-11-08', '2027-01-09', 'BIETC pas encore prêt au 04/11/2026.'],
    ];
    for (const [numero, depart, eta, note] of suivi) {
      const id = un('SELECT id FROM conteneurs WHERE numero = ?', numero);
      db.prepare('UPDATE conteneurs SET date_depart = ?, eta = ?, lien_suivi = ?, notes = COALESCE(?, notes) WHERE id = ?')
        .run(depart, eta, `https://www.msc.com/en/track-a-shipment?trackingNumber=${numero}&trackingMode=0`, note, id);
      db.prepare("INSERT INTO eta_historique (conteneur_id, ancienne, nouvelle, modifie_le, par) VALUES (?, NULL, ?, ?, 'saisie initiale')").run(id, eta, date);
      for (const v of db.prepare('SELECT id FROM vehicules WHERE conteneur_id = ?').all(id)) {
        db.prepare("UPDATE vehicules SET statut = 'en_mer' WHERE id = ?").run(v.id);
        db.prepare("INSERT INTO etapes (vehicule_id, statut, date, par) VALUES (?, 'en_mer', ?, 'saisie initiale')").run(v.id, depart);
      }
    }
  });
}

// Matelas chargés dans les trois conteneurs, d'après les listes du transporteur (17 et 20/10/2026).
// Marchandise à revendre à Libreville : ils ne comptent pas dans le transport des voitures.
export function chargerMatelas(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM matelas_arrivages').get().n > 0)
    throw new Error('Les matelas sont déjà chargés.');
  transaction(db, () => {
    const ajouter = db.prepare('INSERT INTO matelas_arrivages (conteneur_id, type, quantite) VALUES ((SELECT id FROM conteneurs WHERE numero = ?), ?, ?)');
    for (const [numero, type, quantite] of [
      ['TSTU0000001', '2', 35],
      ['TSTU0000002', '1', 4], ['TSTU0000002', '2', 14], ['TSTU0000002', '3', 3],
      ['TSTU0000003', '1', 2], ['TSTU0000003', '2', 19], ['TSTU0000003', '3', 2]])
      ajouter.run(numero, type, quantite);
  });
}

if (import.meta.main) {
  const db = ouvrirBase(config.fichierBase);
  chargerDonnees(db);
  appliquerSuiviDu11Novembre(db);
  chargerMatelas(db);
  console.log(`Données de départ chargées dans ${config.fichierBase} (état au 11/11/2026 : 3 conteneurs en mer).`);
}
