// Espace des partenaires (fournisseur, transporteur). Écrans en anglais. Ces pages ne lisent jamais les clients,
// leurs versements, les contrats ni les marges, et n'affichent aucun montant en francs CFA.
import { html, champ } from '../html.js';
import { exigerRole } from '../auth.js';
import { supprimerFichier } from '../fichiers.js';
import { lireDepot, deposer } from './fichiers.js';
import { won, parseMontant } from '../format.js';
import { Refus, texte, entier } from '../saisie.js';
import { transaction } from '../db.js';
import { piecesAttendues, designerPiece, etatPiece, ecrirePiece, libellePiece, ETATS_PIECE, soldeFournisseur, soldeTransporteur } from '../partenaires.js';

const ACCUEIL = {
  fournisseur: 'Here you offer cars, with photos and a price in won, and follow the ordered cars and the payments made to you.',
  transporteur: 'Here you send the documents of each container, enter your fees, and follow the payments made to you.',
};
const RACCOURCIS = {
  fournisseur: html`<p class="actions"><a class="bouton" href="/partenaire/offres/nouvelle">Offer a car</a>
    <a class="bouton secondaire" href="/partenaire/offres">My offers</a>
    <a class="bouton secondaire" href="/partenaire/voitures">Ordered cars</a></p>`,
};

const PHOTOS_MAX = 12;
const ETATS_OFFRE = { proposee: 'Offered', retenue: 'Accepted', refusee: 'Declined', retiree: 'Withdrawn' };
const ETAPES = {
  commandee: 'Ordered', achetee: 'Bought', chargee: 'Loaded in a container', en_mer: 'At sea',
  arrivee: 'Arrived in Libreville', dedouanee: 'Cleared by customs', remise: 'Delivered',
};
const nomVoiture = v => [v.marque, v.modele, v.version, v.annee].filter(Boolean).join(' ');
const ETATS_FRAIS = { propose: 'Waiting for Eric', valide: 'Validated', refuse: 'Refused' };

// Les aides de saisie de la plateforme répondent en français : le fournisseur lit des refus en anglais.
function nombre(valeur, nom) {
  if (String(valeur ?? '').trim() === '') return null;
  const n = entier(valeur);
  if (n === null) throw new Refus(400, `${nom}: write a whole number.`);
  return n;
}

function lireOffre(corps) {
  const o = {
    marque: texte(corps.marque, 60), modele: texte(corps.modele, 60), version: texte(corps.version, 60),
    annee: nombre(corps.annee, 'Year'), kilometrage: nombre(corps.kilometrage, 'Mileage'),
    energie_boite: texte(corps.energie_boite, 60), couleur: texte(corps.couleur, 40),
    prix_won: parseMontant(String(corps.prix_won ?? '')), remarque: texte(corps.remarque, 1000),
  };
  if (!o.marque || !o.modele) throw new Refus(400, 'Make and model are required.');
  if (o.annee !== null && (o.annee < 1950 || o.annee > 2099)) throw new Refus(400, 'Year: between 1950 and 2099.');
  if (!o.prix_won) throw new Refus(400, 'Price in won: write a whole number, for example 4 500 000.');
  return o;
}

const champsOffre = (o = {}) => html`<div class="grille">
  ${champ('Make', 'marque', o.marque, { requis: true })}
  ${champ('Model', 'modele', o.modele, { requis: true })}
  ${champ('Version', 'version', o.version, { aide: 'basic, full option…' })}
  ${champ('Year', 'annee', o.annee)}
  ${champ('Mileage (km)', 'kilometrage', o.kilometrage)}
  ${champ('Fuel and gearbox', 'energie_boite', o.energie_boite)}
  ${champ('Colour', 'couleur', o.couleur)}
  ${champ('Price (won)', 'prix_won', o.prix_won, { requis: true, aide: 'for example 4 500 000' })}
  ${champ('Remark', 'remarque', o.remarque)}
</div>`;

export function routesPartenaire(app, { db, horloge, dossierFichiers }) {
  app.get('/partenaire', (req, res) => res.page('Welcome', html`
    <p>This is your space on the MOUGNIER TRANSPORT platform. ${ACCUEIL[req.utilisateur.role]}</p>
    ${RACCOURCIS[req.utilisateur.role] ?? ''}`, { actif: '/partenaire' }));

  // ---------- Les deux partenaires : ce qu'Eric leur a payé et ce qui reste ----------
  // Chacun ne voit que son compte. La note d'un envoi est privée (elle peut nommer un client) : jamais affichée ici.
  app.get('/partenaire/paiements', (req, res) => {
    const role = req.utilisateur.role;
    const { du, paye, reste } = role === 'fournisseur' ? soldeFournisseur(db) : soldeTransporteur(db);
    const envois = db.prepare('SELECT date, montant_won FROM versements_fournisseur WHERE destinataire = ? ORDER BY date, id').all(role);
    res.page('Payments', html`
      <section class="carte"><dl class="fiche">
        <dt>${role === 'fournisseur' ? 'Price of the cars ordered from you' : 'Your validated fees'}</dt><dd>${won(du)}</dd>
        <dt>Paid by Eric</dt><dd>${won(paye)}</dd>
        <dt>${reste >= 0 ? 'Remaining to be paid to you' : 'Paid in advance by Eric'}</dt><dd><strong>${won(Math.abs(reste))}</strong></dd>
      </dl></section>
      <h2>Payments received</h2>
      ${envois.length ? html`<div class="defile"><table>
        <thead><tr><th>Date</th><th>Amount</th></tr></thead>
        <tbody>${envois.map(e => html`<tr><td>${e.date}</td><td class="montant">${won(e.montant_won)}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="discret">No payment recorded yet.</p>`}`, { actif: '/partenaire/paiements' });
  });

  // ---------- Fournisseur : ses propositions de voitures ----------
  app.use(['/partenaire/offres', '/partenaire/voitures'], exigerRole('fournisseur'));

  // La proposition demandée, si elle appartient au fournisseur connecté ; celle d'un autre n'existe pas pour lui.
  const trouverOffre = req => {
    const id = entier(req.params.id);
    const offre = id && db.prepare('SELECT * FROM offres WHERE id = ? AND fournisseur_id = ?').get(id, req.utilisateur.id);
    if (!offre) throw new Refus(404, 'This offer does not exist.');
    return offre;
  };
  const modifiable = offre => {
    if (offre.etat !== 'proposee') throw new Refus(409, 'This offer can no longer be changed.');
    return offre;
  };
  const photosDe = offre => db.prepare('SELECT id, nom_origine FROM fichiers WHERE offre_id = ? AND supprime_le IS NULL ORDER BY id').all(offre.id);

  app.get('/partenaire/offres', (req, res) => {
    const offres = db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM fichiers f WHERE f.offre_id = o.id AND f.supprime_le IS NULL) AS photos
      FROM offres o WHERE o.fournisseur_id = ? ORDER BY o.id DESC`).all(req.utilisateur.id);
    res.page('My offers', html`
      <p class="actions"><a class="bouton" href="/partenaire/offres/nouvelle">Offer a car</a></p>
      ${offres.length ? html`<div class="defile"><table>
        <thead><tr><th>Car</th><th>Price</th><th>Photos</th><th>Status</th><th>Offered on</th></tr></thead>
        <tbody>${offres.map(o => html`<tr>
          <td><a href="/partenaire/offres/${o.id}">${nomVoiture(o)}</a></td>
          <td class="montant">${won(o.prix_won)}</td><td>${o.photos}</td>
          <td>${ETATS_OFFRE[o.etat]}</td><td>${o.cree_le}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="discret">No offer yet.</p>`}`, { actif: '/partenaire/offres' });
  });

  app.get('/partenaire/offres/nouvelle', (req, res) => res.page('Offer a car', html`
    <form method="post" action="/partenaire/offres" class="carte">
      ${champsOffre()}
      <p class="discret">You add the photos on the next page (${PHOTOS_MAX} at most).</p>
      <p class="actions"><button class="bouton">Save and add photos</button></p>
    </form>`, { actif: '/partenaire/offres' }));

  app.post('/partenaire/offres', (req, res) => {
    const o = lireOffre(req.body);
    const id = db.prepare(`INSERT INTO offres (fournisseur_id, marque, modele, version, annee, kilometrage, energie_boite, couleur, prix_won, remarque, cree_le)
      VALUES (:fournisseur_id, :marque, :modele, :version, :annee, :kilometrage, :energie_boite, :couleur, :prix_won, :remarque, :cree_le)`)
      .run({ ...o, fournisseur_id: req.utilisateur.id, cree_le: horloge() }).lastInsertRowid;
    res.redirect(302, `/partenaire/offres/${id}`);
  });

  app.get('/partenaire/offres/:id', (req, res) => {
    const offre = trouverOffre(req);
    const photos = photosDe(offre);
    const ouverte = offre.etat === 'proposee';
    res.page(nomVoiture(offre), html`
      <section class="carte"><dl class="fiche">
        <dt>Status</dt><dd>${ETATS_OFFRE[offre.etat]}</dd>
        ${offre.etat === 'refusee' ? html`<dt>Reason</dt><dd>${offre.motif_refus}</dd>` : ''}
        <dt>Price</dt><dd>${won(offre.prix_won)}</dd>
        <dt>Mileage</dt><dd>${offre.kilometrage ?? '—'}</dd>
        <dt>Fuel and gearbox</dt><dd>${offre.energie_boite ?? '—'}</dd>
        <dt>Colour</dt><dd>${offre.couleur ?? '—'}</dd>
        <dt>Remark</dt><dd>${offre.remarque ?? '—'}</dd>
      </dl></section>

      <h2>Photos (${photos.length} / ${PHOTOS_MAX})</h2>
      ${photos.length ? html`<div class="photos">${photos.map(p => html`<figure>
        <a href="/fichiers/${p.id}"><img class="vignette" src="/fichiers/${p.id}" alt="${p.nom_origine}"></a>
        ${ouverte ? html`<form method="post" action="/partenaire/offres/${offre.id}/photos/${p.id}/supprimer">
          <button class="lien">Remove</button></form>` : ''}</figure>`)}</div>` : html`<p class="discret">No photo yet.</p>`}
      ${ouverte && photos.length < PHOTOS_MAX ? html`<label class="champ"><span>Add photos</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-depot="/partenaire/offres/${offre.id}/photos"></label>
        <script src="/depot.js" defer></script>` : ''}

      ${ouverte ? html`<h2>Change this offer</h2>
      <form method="post" action="/partenaire/offres/${offre.id}" class="carte">
        ${champsOffre(offre)}
        <p class="actions"><button class="bouton">Save</button></p>
      </form>
      <form method="post" action="/partenaire/offres/${offre.id}/retirer" data-confirmer="Withdraw this offer?">
        <button class="bouton danger">Withdraw this offer</button></form>` : ''}`, { actif: '/partenaire/offres' });
  });

  app.post('/partenaire/offres/:id', (req, res) => {
    const offre = modifiable(trouverOffre(req));
    const o = lireOffre(req.body);
    db.prepare(`UPDATE offres SET marque = :marque, modele = :modele, version = :version, annee = :annee, kilometrage = :kilometrage,
      energie_boite = :energie_boite, couleur = :couleur, prix_won = :prix_won, remarque = :remarque WHERE id = :id`).run({ ...o, id: offre.id });
    res.redirect(302, `/partenaire/offres/${offre.id}`);
  });

  app.post('/partenaire/offres/:id/photos', lireDepot, (req, res) => {
    const offre = modifiable(trouverOffre(req));
    if (photosDe(offre).length >= PHOTOS_MAX) throw new Refus(400, `${PHOTOS_MAX} photos at most for one offer.`);
    deposer(req, { db, horloge, dossierFichiers }, { offreId: offre.id, imagesSeulement: true });
    res.redirect(302, `/partenaire/offres/${offre.id}`);
  });

  app.post('/partenaire/offres/:id/photos/:fichier/supprimer', (req, res) => {
    const offre = modifiable(trouverOffre(req));
    const photo = photosDe(offre).find(p => p.id === entier(req.params.fichier));
    if (!photo) throw new Refus(404, 'This photo does not exist.');
    supprimerFichier(db, dossierFichiers, photo.id, horloge());
    res.redirect(302, `/partenaire/offres/${offre.id}`);
  });

  app.post('/partenaire/offres/:id/retirer', (req, res) => {
    const offre = modifiable(trouverOffre(req));
    db.prepare("UPDATE offres SET etat = 'retiree' WHERE id = ?").run(offre.id);
    res.redirect(302, '/partenaire/offres');
  });

  // Voitures commandées : ni client, ni conteneur, ni type de voiture, aucun montant en francs.
  app.get('/partenaire/voitures', (req, res) => {
    const voitures = db.prepare(`SELECT v.id, v.marque, v.modele, v.version, v.annee, v.chassis, v.statut, v.achat_reel_won,
        EXISTS (SELECT 1 FROM offres o WHERE o.vehicule_id = v.id AND o.etat = 'retenue') AS retenue
      FROM vehicules v WHERE v.annulee = 0 AND v.achat_reel_won IS NOT NULL ORDER BY v.id`).all();
    res.page('Ordered cars', html`
      <p class="discret">"Planned" marks the price noted in advance for a car not bought yet.</p>
      <div class="defile"><table>
        <thead><tr><th>Car</th><th>Chassis number</th><th>Stage</th><th>Price</th></tr></thead>
        <tbody>${voitures.map(v => html`<tr>
          <td>${nomVoiture(v)}</td><td>${v.chassis ?? '—'}</td><td>${ETAPES[v.statut] ?? v.statut}</td>
          <td class="montant">${won(v.achat_reel_won)}${v.statut === 'commandee' && !v.retenue ? html` <span class="discret">(planned)</span>` : ''}</td>
        </tr>`)}</tbody>
      </table></div>`, { actif: '/partenaire/voitures' });
  });

  // ---------- Transporteur : documents de chaque conteneur et ses frais ----------
  app.use(['/partenaire/conteneurs', '/partenaire/frais'], exigerRole('transporteur'));

  // Seulement les colonnes que le transporteur peut voir : ni notes, ni facture du transitaire, ni frais réels.
  const trouverConteneur = req => {
    const id = entier(req.params.id);
    const ct = id && db.prepare(`SELECT id, numero, bl, navire, port_chargement, port_arrivee, date_depart, eta, date_arrivee
      FROM conteneurs WHERE id = ?`).get(id);
    if (!ct) throw new Refus(404, 'This container does not exist.');
    return ct;
  };

  app.get('/partenaire/conteneurs', (req, res) => {
    const conteneurs = db.prepare(`SELECT id, numero, navire, date_depart, eta, date_arrivee FROM conteneurs
      ORDER BY COALESCE(date_depart, eta, '9999') DESC, id DESC`).all();
    res.page('Containers', html`<div class="defile"><table>
      <thead><tr><th>Container</th><th>Vessel</th><th>Departure</th><th>Expected arrival</th><th>Arrived</th><th>Documents missing</th></tr></thead>
      <tbody>${conteneurs.map(ct => html`<tr>
        <td><a href="/partenaire/conteneurs/${ct.id}">${ct.numero}</a></td><td>${ct.navire ?? '—'}</td>
        <td>${ct.date_depart ?? '—'}</td><td>${ct.eta ?? '—'}</td><td>${ct.date_arrivee ?? '—'}</td>
        <td>${piecesAttendues(db, ct.id).filter(p => p.etat === 'attendu').length}</td></tr>`)}</tbody>
    </table></div>`, { actif: '/partenaire/conteneurs' });
  });

  app.get('/partenaire/conteneurs/:id', (req, res) => {
    const ct = trouverConteneur(req);
    const voitures = db.prepare('SELECT marque, modele, version, annee, chassis FROM vehicules WHERE conteneur_id = ? AND annulee = 0 ORDER BY id').all(ct.id);
    const pieces = piecesAttendues(db, ct.id);
    const frais = db.prepare('SELECT * FROM frais_transporteur WHERE conteneur_id = ? AND saisi_par = ? ORDER BY id').all(ct.id, req.utilisateur.id);
    const envoi = p => {
      const cible = `/partenaire/conteneurs/${ct.id}/pieces`;
      return html`<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Attach ${libellePiece(p.type, true)}"
          data-depot="${cible}?type=${p.type}${p.vehiculeId ? `&vehicule_id=${p.vehiculeId}` : ''}">
        <form method="post" action="${cible}"><input type="hidden" name="type" value="${p.type}">
          <input type="hidden" name="vehicule_id" value="${p.vehiculeId ?? ''}"><input type="hidden" name="envoye" value="1">
          <button class="lien">Sent by WhatsApp</button></form>`;
    };
    res.page(`Container ${ct.numero}`, html`
      <section class="carte"><dl class="fiche">
        <dt>Bill of lading</dt><dd>${ct.bl ?? '—'}</dd>
        <dt>Vessel</dt><dd>${ct.navire ?? '—'}</dd>
        <dt>Route</dt><dd>${ct.port_chargement} → ${ct.port_arrivee}</dd>
        <dt>Departure</dt><dd>${ct.date_depart ?? '—'}</dd>
        <dt>Expected arrival</dt><dd>${ct.eta ?? '—'}</dd>
        <dt>Arrived</dt><dd>${ct.date_arrivee ?? '—'}</dd>
      </dl></section>

      <h2>Cars on board</h2>
      ${voitures.length ? html`<ul>${voitures.map(v => html`<li>${nomVoiture(v)}${v.chassis ? html` — ${v.chassis}` : ''}</li>`)}</ul>`
        : html`<p class="discret">No car on board yet.</p>`}

      <h2>Documents</h2>
      <div class="defile"><table>
        <thead><tr><th>Document</th><th>Car</th><th>Status</th><th>Remark from Eric</th><th>Files</th><th>Send</th></tr></thead>
        <tbody>${pieces.map(p => html`<tr>
          <td>${libellePiece(p.type, true)}</td><td>${p.libelleVoiture ?? '—'}</td><td>${ETATS_PIECE[p.etat][1]}</td>
          <td>${p.remarque ?? ''}</td>
          <td>${p.fichiers.map(f => html`<a href="/fichiers/${f.id}">${f.nom_origine}</a> `)}</td>
          <td>${p.etat === 'valide' ? '' : envoi(p)}</td></tr>`)}</tbody>
      </table></div>
      <script src="/depot.js" defer></script>

      <h2>My fees for this container</h2>
      ${frais.length ? html`<div class="defile"><table>
        <thead><tr><th>Fee</th><th>Amount</th><th>Status</th><th>Remark from Eric</th><th></th></tr></thead>
        <tbody>${frais.map(f => html`<tr><td>${f.libelle}</td><td class="montant">${won(f.montant_won)}</td>
          <td>${ETATS_FRAIS[f.etat]}</td><td>${f.remarque ?? ''}</td>
          <td>${f.etat === 'propose' ? html`<form method="post" action="/partenaire/frais/${f.id}/supprimer"><button class="lien">Delete</button></form>` : ''}</td>
        </tr>`)}</tbody></table></div>` : html`<p class="discret">No fee entered yet.</p>`}
      <form method="post" action="/partenaire/conteneurs/${ct.id}/frais" class="carte"><div class="grille">
        ${champ('Fee', 'libelle', '', { requis: true, aide: 'for example: Loading fee, Sticker x 3' })}
        ${champ('Amount (won)', 'montant_won', '', { requis: true, aide: 'for example 500 000' })}
      </div><p class="actions"><button class="bouton">Add this fee</button></p></form>`, { actif: '/partenaire/conteneurs' });
  });

  // Un document : le fichier en corps brut (type et voiture dans l'adresse), ou un formulaire « envoyé par WhatsApp ».
  app.post('/partenaire/conteneurs/:id/pieces', lireDepot, (req, res) => {
    const ct = trouverConteneur(req);
    const fichier = Buffer.isBuffer(req.body);
    const source = fichier ? req.query : req.body;
    const piece = designerPiece(db, ct.id, source, true);
    if (etatPiece(db, ct.id, piece) === 'valide') throw new Refus(409, 'Eric has already validated this document. Ask him if it must change.');
    if (!fichier && source.envoye !== '1') throw new Refus(400, 'Attach the file, or tell that you sent it by WhatsApp.');
    transaction(db, () => {
      const pieceId = ecrirePiece(db, ct.id, piece, { etat: 'envoye', par: req.utilisateur.identifiant, le: horloge() });
      if (fichier) deposer(req, { db, horloge, dossierFichiers }, { pieceId });
    });
    res.redirect(302, `/partenaire/conteneurs/${ct.id}`);
  });

  app.post('/partenaire/conteneurs/:id/frais', (req, res) => {
    const ct = trouverConteneur(req);
    const libelle = texte(req.body.libelle, 120);
    if (!libelle) throw new Refus(400, 'Write what the fee is for.');
    const montant = parseMontant(String(req.body.montant_won ?? ''));
    if (!montant) throw new Refus(400, 'Amount in won: write a whole number, for example 500 000.');
    db.prepare('INSERT INTO frais_transporteur (conteneur_id, libelle, montant_won, saisi_par, saisi_le) VALUES (?, ?, ?, ?, ?)')
      .run(ct.id, libelle, montant, req.utilisateur.id, horloge());
    res.redirect(302, `/partenaire/conteneurs/${ct.id}`);
  });

  app.post('/partenaire/frais/:id/supprimer', (req, res) => {
    const id = entier(req.params.id);
    const ligne = id && db.prepare('SELECT * FROM frais_transporteur WHERE id = ? AND saisi_par = ?').get(id, req.utilisateur.id);
    if (!ligne) throw new Refus(404, 'This fee does not exist.');
    if (ligne.etat !== 'propose') throw new Refus(409, 'Eric has already validated or refused this fee: it can no longer be deleted.');
    db.prepare('DELETE FROM frais_transporteur WHERE id = ?').run(ligne.id);
    res.redirect(302, `/partenaire/conteneurs/${ligne.conteneur_id}`);
  });
}
