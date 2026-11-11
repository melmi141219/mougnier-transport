CREATE TABLE IF NOT EXISTS utilisateurs (
  id INTEGER PRIMARY KEY, identifiant TEXT NOT NULL UNIQUE, nom TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','collaborateur','fournisseur','transporteur')),
  mot_de_passe TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions (
  jeton TEXT PRIMARY KEY, utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
  expire_le TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, nom TEXT NOT NULL, telephone TEXT,
  date_naissance TEXT, lieu_naissance TEXT, nationalite TEXT,
  piece_identite TEXT, piece_valable_jusqu TEXT, adresse TEXT, notes TEXT,
  cree_le TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conteneurs (
  id INTEGER PRIMARY KEY, numero TEXT NOT NULL UNIQUE, bl TEXT, reservation TEXT, navire TEXT,
  port_chargement TEXT NOT NULL DEFAULT 'Incheon', port_arrivee TEXT NOT NULL DEFAULT 'Libreville',
  lien_suivi TEXT, date_depart TEXT, eta TEXT, date_arrivee TEXT,
  date_facture TEXT, facture_transitaire INTEGER, notes TEXT,
  -- frais réels payés en Corée pour ce conteneur (chargement, cartes grises, stickers, kilométrage) : page Marges, admin seulement
  frais_coree_won INTEGER);
CREATE TABLE IF NOT EXISTS eta_historique (
  id INTEGER PRIMARY KEY, conteneur_id INTEGER NOT NULL REFERENCES conteneurs(id),
  ancienne TEXT, nouvelle TEXT, modifie_le TEXT NOT NULL, par TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS commandes (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
  mode TEXT NOT NULL DEFAULT 'deux' CHECK (mode IN ('deux','unique')),
  contrat_papier INTEGER NOT NULL DEFAULT 0, cree_le TEXT NOT NULL,
  delai_jours INTEGER);
CREATE TABLE IF NOT EXISTS vehicules (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('vente','perso','charge')),
  client_id INTEGER REFERENCES clients(id), commande_id INTEGER REFERENCES commandes(id),
  conteneur_id INTEGER REFERENCES conteneurs(id),
  marque TEXT NOT NULL, modele TEXT NOT NULL, version TEXT, annee INTEGER,
  couleur TEXT, energie_boite TEXT, chassis TEXT, kilometrage INTEGER,
  achat INTEGER, transport INTEGER, arrondi INTEGER NOT NULL DEFAULT 0, forfait INTEGER,
  verrou_hors_douane INTEGER, verrou_douane INTEGER, douane_reelle INTEGER,
  statut TEXT NOT NULL DEFAULT 'commandee'
    CHECK (statut IN ('commandee','achetee','chargee','en_mer','arrivee','dedouanee','remise')),
  annulee INTEGER NOT NULL DEFAULT 0, notes TEXT,
  -- coûts réels : visibles et modifiables par l'administrateur seulement (page Marges)
  achat_reel_won INTEGER, achat_reel_fcfa INTEGER, transport_reel INTEGER);
-- Ristournes : geste d'Eric quand la douane réelle a coûté moins que la douane facturée au client.
CREATE TABLE IF NOT EXISTS ristournes (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
  vehicule_id INTEGER NOT NULL REFERENCES vehicules(id),
  montant INTEGER NOT NULL CHECK (montant > 0), date TEXT NOT NULL, motif TEXT, saisi_par TEXT NOT NULL,
  annule INTEGER NOT NULL DEFAULT 0, motif_annulation TEXT);
-- Matelas : marchandise revendue à Libreville, arrivée dans les conteneurs avec les voitures.
CREATE TABLE IF NOT EXISTS matelas_arrivages (
  id INTEGER PRIMARY KEY, conteneur_id INTEGER NOT NULL REFERENCES conteneurs(id),
  type TEXT NOT NULL CHECK (type IN ('1','2','3')), quantite INTEGER NOT NULL CHECK (quantite > 0));
CREATE TABLE IF NOT EXISTS matelas_ventes (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('1','2','3')),
  quantite INTEGER NOT NULL CHECK (quantite > 0), prix_unitaire INTEGER NOT NULL CHECK (prix_unitaire > 0),
  acheteur TEXT, mode TEXT NOT NULL, saisi_par TEXT NOT NULL,
  annule INTEGER NOT NULL DEFAULT 0, motif_annulation TEXT);
CREATE TABLE IF NOT EXISTS versements_fournisseur (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, montant_won INTEGER NOT NULL CHECK (montant_won > 0),
  note TEXT, saisi_par TEXT NOT NULL,
  -- à qui est allé l'envoi : il compte dans le solde de ce partenaire (la note reste privée)
  destinataire TEXT NOT NULL DEFAULT 'fournisseur' CHECK (destinataire IN ('fournisseur','transporteur')));
CREATE TABLE IF NOT EXISTS etapes (
  id INTEGER PRIMARY KEY, vehicule_id INTEGER NOT NULL REFERENCES vehicules(id),
  statut TEXT NOT NULL, date TEXT NOT NULL, par TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mouvements (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
  sens TEXT NOT NULL CHECK (sens IN ('entree','sortie')),
  montant INTEGER NOT NULL CHECK (montant > 0), date TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('especes','compte','mobile_money','cheque')),
  reference TEXT, avec_frais INTEGER, note TEXT,
  saisi_par TEXT NOT NULL, saisi_le TEXT NOT NULL,
  annule INTEGER NOT NULL DEFAULT 0, motif_annulation TEXT, annule_par TEXT, annule_le TEXT);
CREATE TABLE IF NOT EXISTS penalites (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
  vehicule_id INTEGER REFERENCES vehicules(id), conteneur_id INTEGER REFERENCES conteneurs(id),
  nature TEXT NOT NULL CHECK (nature IN ('magasinage','surestaries','transitaire','malus','autre')),
  ligne TEXT CHECK (ligne IN ('solde','douane')),
  montant INTEGER NOT NULL CHECK (montant > 0), date TEXT NOT NULL,
  motif TEXT, justificatif TEXT, saisi_par TEXT NOT NULL,
  annule INTEGER NOT NULL DEFAULT 0, motif_annulation TEXT);
CREATE TABLE IF NOT EXISTS relances (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('solde','arrivee','douane','retard','groupe_depart','groupe_arrivee')),
  client_id INTEGER REFERENCES clients(id), conteneur_id INTEGER REFERENCES conteneurs(id),
  ligne TEXT, envoye_le TEXT NOT NULL, par TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('contrat','recu','pv')),
  numero TEXT NOT NULL UNIQUE,
  commande_id INTEGER REFERENCES commandes(id), mouvement_id INTEGER REFERENCES mouvements(id),
  vehicule_id INTEGER REFERENCES vehicules(id),
  etat TEXT NOT NULL DEFAULT 'emis' CHECK (etat IN ('emis','signe','remplace')),
  remplace_id INTEGER REFERENCES documents(id),
  donnees TEXT NOT NULL, cree_le TEXT NOT NULL, par TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalogue (
  id INTEGER PRIMARY KEY, marque TEXT NOT NULL, modele TEXT NOT NULL, version TEXT, annee INTEGER,
  achat INTEGER NOT NULL, transport INTEGER NOT NULL, notes TEXT);
-- Comptes partenaires. Propositions de voitures du fournisseur (prix en wons, jamais vus par la collaboratrice).
CREATE TABLE IF NOT EXISTS offres (
  id INTEGER PRIMARY KEY, fournisseur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
  marque TEXT NOT NULL, modele TEXT NOT NULL, version TEXT, annee INTEGER, kilometrage INTEGER,
  energie_boite TEXT, couleur TEXT, prix_won INTEGER NOT NULL CHECK (prix_won > 0), remarque TEXT,
  etat TEXT NOT NULL DEFAULT 'proposee' CHECK (etat IN ('proposee','retenue','refusee','retiree')),
  motif_refus TEXT, vehicule_id INTEGER REFERENCES vehicules(id), cree_le TEXT NOT NULL);
-- Documents de transport attendus du transporteur. Pas de ligne = « attendu » ; une ligne « attendu » = renvoyée par Eric.
CREATE TABLE IF NOT EXISTS pieces (
  id INTEGER PRIMARY KEY, conteneur_id INTEGER NOT NULL REFERENCES conteneurs(id),
  vehicule_id INTEGER REFERENCES vehicules(id), type TEXT NOT NULL,
  etat TEXT NOT NULL CHECK (etat IN ('attendu','envoye','valide')), remarque TEXT,
  maj_par TEXT NOT NULL, maj_le TEXT NOT NULL);
-- vehicule_id vaut NULL pour une pièce du conteneur : SQLite ne compare pas les NULL dans une contrainte UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS pieces_une_par_type ON pieces (conteneur_id, IFNULL(vehicule_id, 0), type);
-- Frais du transporteur, saisis par lui ligne par ligne, en wons ; seules les lignes validées par Eric sont dues.
CREATE TABLE IF NOT EXISTS frais_transporteur (
  id INTEGER PRIMARY KEY, conteneur_id INTEGER NOT NULL REFERENCES conteneurs(id),
  libelle TEXT NOT NULL, montant_won INTEGER NOT NULL CHECK (montant_won > 0),
  etat TEXT NOT NULL DEFAULT 'propose' CHECK (etat IN ('propose','valide','refuse')), remarque TEXT,
  saisi_par INTEGER NOT NULL REFERENCES utilisateurs(id), saisi_le TEXT NOT NULL);
-- Fichiers déposés : rangés sur le disque sous nom_stocke (aléatoire). Une ligne supprimée reste : elle compte
-- encore dans la limite de dépôts du jour.
CREATE TABLE IF NOT EXISTS fichiers (
  id INTEGER PRIMARY KEY, nom_stocke TEXT NOT NULL UNIQUE, nom_origine TEXT NOT NULL,
  type_mime TEXT NOT NULL, taille INTEGER NOT NULL,
  offre_id INTEGER REFERENCES offres(id), piece_id INTEGER REFERENCES pieces(id),
  depose_par INTEGER NOT NULL REFERENCES utilisateurs(id), depose_le TEXT NOT NULL, supprime_le TEXT);
