// Page interne « Partenaires » : ce que le fournisseur propose. Les prix en wons et les boutons pour retenir
// ou refuser ne s'affichent qu'à l'administrateur ; la collaboratrice voit les propositions et leurs photos.
import { html, champ, choix } from '../html.js';
import { exigerAdmin } from '../auth.js';
import { transaction } from '../db.js';
import { creerVoiture } from './vehicules.js';
import { lireDepot, deposer } from './fichiers.js';
import { piecesAttendues, designerPiece, etatPiece, ecrirePiece, libellePiece, ETATS_PIECE, soldeFournisseur, soldeTransporteur } from '../partenaires.js';
import { won, dateFr } from '../format.js';
import { libelleVoiture, libelleStatut } from '../libelles.js';
import { Refus, texte, entier } from '../saisie.js';

const ETATS = { proposee: 'Proposée', retenue: 'Retenue', refusee: 'Refusée', retiree: 'Retirée par le fournisseur' };
const ETATS_FRAIS = { propose: 'À valider', valide: 'Validé', refuse: 'Refusé' };
const RETOUR = /^\/(partenaires|conteneurs\/\d+)$/;

// Documents de transport d'un conteneur encore à recevoir ou à vérifier, avec les actions des comptes internes.
// Sert sur la page Partenaires et sur la fiche du conteneur (retour = la page où revenir après une action).
export function documentsDuConteneur(db, ct, retour) {
  const pieces = piecesAttendues(db, ct.id);
  const ouvertes = pieces.filter(p => p.etat !== 'valide');
  const valides = pieces.length - ouvertes.length;
  const cles = p => html`<input type="hidden" name="conteneur_id" value="${ct.id}"><input type="hidden" name="type" value="${p.type}">
    <input type="hidden" name="vehicule_id" value="${p.vehiculeId ?? ''}"><input type="hidden" name="retour" value="${retour}">`;
  const joindre = p => `/partenaires/pieces/joindre?conteneur_id=${ct.id}&type=${p.type}${p.vehiculeId ? `&vehicule_id=${p.vehiculeId}` : ''}&retour=${retour}`;
  return html`<p class="discret">${valides} document(s) validé(s) sur ${pieces.length}.</p>
    ${ouvertes.length ? html`<div class="defile"><table>
      <thead><tr><th>Document</th><th>Voiture</th><th>État</th><th>Remarque</th><th>Fichiers</th><th>Actions</th></tr></thead>
      <tbody>${ouvertes.map(p => html`<tr>
        <td>${libellePiece(p.type)}</td><td>${p.libelleVoiture ?? '—'}</td><td>${ETATS_PIECE[p.etat][0]}</td><td>${p.remarque ?? ''}</td>
        <td>${p.fichiers.map(f => html`<a href="/fichiers/${f.id}">${f.nom_origine}</a> `)}</td>
        <td>
          <form method="post" action="/partenaires/pieces/valider">${cles(p)}<button class="lien">Valider</button></form>
          <form method="post" action="/partenaires/pieces/renvoyer">${cles(p)}
            <input type="text" name="remarque" aria-label="Remarque pour le transporteur" placeholder="Remarque (en anglais)" required>
            <button class="lien">Renvoyer</button></form>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Joindre ${libellePiece(p.type)}" data-depot="${joindre(p)}">
        </td></tr>`)}</tbody>
    </table></div>` : ''}`;
}
// La page qui affiche documentsDuConteneur charge une seule fois ce script (deux chargements = deux envois par fichier).
export const SCRIPT_DEPOT = html`<script src="/depot.js" defer></script>`;

export function routesPartenaires(app, { db, horloge, dossierFichiers }) {
  const retour = valeur => (RETOUR.test(String(valeur ?? '')) ? String(valeur) : '/partenaires');
  const trouverConteneur = valeur => {
    const id = entier(valeur);
    const ct = id && db.prepare('SELECT * FROM conteneurs WHERE id = ?').get(id);
    if (!ct) throw new Refus(404, 'Ce conteneur n’existe pas.');
    return ct;
  };
  const trouverFrais = req => {
    const id = entier(req.params.id);
    const ligne = id && db.prepare('SELECT * FROM frais_transporteur WHERE id = ?').get(id);
    if (!ligne) throw new Refus(404, 'Cette ligne de frais n’existe pas.');
    if (ligne.etat !== 'propose') throw new Refus(409, 'Cette ligne de frais a déjà été traitée.');
    return ligne;
  };
  const trouverOffre = req => {
    const id = entier(req.params.id);
    const offre = id && db.prepare('SELECT * FROM offres WHERE id = ?').get(id);
    if (!offre) throw new Refus(404, 'Cette proposition n’existe pas.');
    return offre;
  };
  const aTraiter = offre => {
    if (offre.etat !== 'proposee') throw new Refus(409, 'Cette proposition a déjà été traitée.');
    return offre;
  };
  const photosDe = offre => db.prepare('SELECT id, nom_origine FROM fichiers WHERE offre_id = ? AND supprime_le IS NULL ORDER BY id').all(offre.id);

  app.get('/partenaires', (req, res) => {
    const admin = req.utilisateur.role === 'admin';
    const offres = db.prepare('SELECT o.*, u.nom AS fournisseur FROM offres o JOIN utilisateurs u ON u.id = o.fournisseur_id ORDER BY o.id DESC').all();
    // Voitures qu'une proposition peut compléter : pas annulées, sans proposition déjà retenue.
    const voitures = admin ? db.prepare(`SELECT v.*, c.nom AS client FROM vehicules v LEFT JOIN clients c ON c.id = v.client_id
      WHERE v.annulee = 0 AND NOT EXISTS (SELECT 1 FROM offres o WHERE o.vehicule_id = v.id AND o.etat = 'retenue')
      ORDER BY c.nom, v.id`).all() : [];
    const commandes = admin ? db.prepare('SELECT c.id, k.nom FROM commandes c JOIN clients k ON k.id = c.client_id ORDER BY k.nom, c.id').all() : [];

    // Le prix affiché part avec le formulaire : si le fournisseur l'a changé depuis, la proposition n'est pas retenue.
    const prixVu = o => html`<input type="hidden" name="prix_won" value="${o.prix_won}">`;
    const formulaires = o => html`<details><summary>Retenir ou refuser</summary>
      <form method="post" action="/partenaires/offres/${o.id}/retenir" class="carte">${prixVu(o)}
        <p><strong>Pour une voiture déjà commandée.</strong> La proposition complète la voiture : prix réel en wons, année,
          kilométrage, couleur, énergie et photos. Le prix client ne change pas. Un prix réel déjà noté pour cette voiture est remplacé.</p>
        ${choix('Voiture', 'vehicule_id', [['', '— Choisir —'], ...voitures.map(v => [v.id, `${libelleVoiture(v)} — ${v.client ?? 'à moi'} — ${libelleStatut(v.statut)}${v.achat_reel_won ? ` — prix réel actuel ${won(v.achat_reel_won)}` : ''}`])])}
        <p class="actions"><button class="bouton">Retenir pour cette voiture</button></p>
      </form>
      <form method="post" action="/partenaires/offres/${o.id}/retenir" class="carte">${prixVu(o)}
        <p><strong>Comme nouvelle voiture pour un client.</strong> Indiquez le prix client : achat et transport facturés, ou un forfait.</p>
        <div class="grille">
          ${choix('Commande', 'commande_id', [['', '— Choisir —'], ...commandes.map(c => [c.id, `${c.nom} — commande n° ${c.id}`])])}
          ${champ('Prix d’achat facturé (F)', 'achat')}
          ${champ('Transport facturé (F)', 'transport')}
          ${champ('Ou forfait tout compris (F)', 'forfait')}
        </div>
        <p class="actions"><button class="bouton">Créer la voiture du client</button></p>
      </form>
      <form method="post" action="/partenaires/offres/${o.id}/retenir">${prixVu(o)}
        <input type="hidden" name="pour_moi" value="1">
        <p class="actions"><button class="bouton secondaire">Retenir comme voiture à moi</button></p>
      </form>
      <form method="post" action="/partenaires/offres/${o.id}/refuser" class="carte">
        ${champ('Motif du refus (le fournisseur le lira : écrivez-le en anglais)', 'motif', '', { requis: true })}
        <p class="actions"><button class="bouton danger">Refuser la proposition</button></p>
      </form></details>`;

    const carte = o => {
      const photos = photosDe(o);
      return html`<section class="carte">
        <h3>${libelleVoiture(o)}</h3>
        <p class="discret">Proposée le ${dateFr(o.cree_le)} par ${o.fournisseur}${admin ? html` — <strong>${won(o.prix_won)}</strong>` : ''}</p>
        <dl class="fiche">
          <dt>Kilométrage</dt><dd>${o.kilometrage ?? '—'}</dd>
          <dt>Énergie / boîte</dt><dd>${o.energie_boite ?? '—'}</dd>
          <dt>Couleur</dt><dd>${o.couleur ?? '—'}</dd>
          <dt>Remarque</dt><dd>${o.remarque ?? '—'}</dd>
        </dl>
        ${photos.length ? html`<div class="photos">${photos.map(p => html`<a href="/fichiers/${p.id}"><img class="vignette" src="/fichiers/${p.id}" alt="${p.nom_origine}"></a>`)}</div>`
          : html`<p class="discret">Pas encore de photo.</p>`}
        ${admin ? formulaires(o) : ''}
      </section>`;
    };

    const enAttente = offres.filter(o => o.etat === 'proposee');
    const traitees = offres.filter(o => o.etat !== 'proposee');
    const conteneurs = db.prepare("SELECT * FROM conteneurs ORDER BY COALESCE(date_depart, eta, '9999') DESC, id DESC").all();
    // Les frais du transporteur ne s'affichent qu'à l'administrateur : ni libellé ni montant pour la collaboratrice.
    const frais = admin ? db.prepare(`SELECT f.*, c.numero FROM frais_transporteur f JOIN conteneurs c ON c.id = f.conteneur_id
      ORDER BY f.etat = 'propose' DESC, f.id DESC`).all() : [];
    const ligneSolde = (nom, { du, paye, reste }, quoi) => html`<tr><td>${nom}</td><td>${quoi}</td>
      <td class="montant">${won(du)}</td><td class="montant">${won(paye)}</td>
      <td class="montant"><strong>${won(Math.abs(reste))}</strong>${reste < 0 ? html` <span class="discret">(avance)</span>` : ''}</td></tr>`;
    res.page('Partenaires', html`
      ${admin ? html`<h2>Ce que je dois</h2>
      <div class="defile"><table>
        <thead><tr><th>Partenaire</th><th>Dû pour</th><th>Dû</th><th>Payé</th><th>Reste</th></tr></thead>
        <tbody>${ligneSolde('Fournisseur', soldeFournisseur(db), 'prix réels des voitures')}${ligneSolde('Transporteur', soldeTransporteur(db), 'frais validés')}</tbody>
      </table></div>
      <p class="discret">Les envois d’argent et leur destinataire se saisissent sur la page <a href="/marges">Marges</a>.</p>` : ''}
      <h2>Documents de transport</h2>
      ${conteneurs.length ? conteneurs.map(ct => html`<h3><a href="/conteneurs/${ct.id}">${ct.numero}</a></h3>${documentsDuConteneur(db, ct, '/partenaires')}`)
        : html`<p class="discret">Aucun conteneur.</p>`}
      ${SCRIPT_DEPOT}
      ${admin ? html`<h2>Frais du transporteur</h2>
      ${frais.length ? html`<div class="defile"><table>
        <thead><tr><th>Conteneur</th><th>Frais</th><th>Montant</th><th>Saisi le</th><th>État</th><th>Actions</th></tr></thead>
        <tbody>${frais.map(f => html`<tr><td>${f.numero}</td><td>${f.libelle}</td><td class="montant">${won(f.montant_won)}</td>
          <td>${dateFr(f.saisi_le)}</td><td>${ETATS_FRAIS[f.etat]}${f.remarque ? html` — ${f.remarque}` : ''}</td>
          <td>${f.etat === 'propose' ? html`<form method="post" action="/partenaires/frais/${f.id}/valider"><button class="lien">Valider</button></form>
            <form method="post" action="/partenaires/frais/${f.id}/refuser">
              <input type="text" name="remarque" aria-label="Motif du refus" placeholder="Motif (en anglais)" required>
              <button class="lien">Refuser</button></form>` : ''}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="discret">Aucune ligne de frais saisie par le transporteur.</p>`}` : ''}

      <h2>Propositions du fournisseur à traiter</h2>
      ${enAttente.length ? enAttente.map(carte) : html`<p class="discret">Aucune proposition en attente.</p>`}
      ${traitees.length ? html`<h2>Propositions traitées</h2>
      <div class="defile"><table>
        <thead><tr><th>Voiture</th><th>État</th><th>Proposée le</th>${admin ? html`<th>Prix</th>` : ''}</tr></thead>
        <tbody>${traitees.map(o => html`<tr>
          <td>${libelleVoiture(o)}</td>
          <td>${o.etat === 'retenue' && o.vehicule_id ? html`<a href="/vehicules/${o.vehicule_id}">Retenue</a>` : ETATS[o.etat]}${o.etat === 'refusee' ? html` — ${o.motif_refus}` : ''}</td>
          <td>${dateFr(o.cree_le)}</td>
          ${admin ? html`<td class="montant">${won(o.prix_won)}</td>` : ''}
        </tr>`)}</tbody>
      </table></div>` : ''}`, { actif: '/partenaires' });
  });

  // Retenir : pour une voiture existante, comme nouvelle voiture d'un client (avec son prix), ou pour Eric. Tout ou rien.
  app.post('/partenaires/offres/:id/retenir', exigerAdmin, (req, res) => {
    const offre = aTraiter(trouverOffre(req));
    const modes = ['vehicule_id', 'commande_id', 'pour_moi'].filter(nom => String(req.body[nom] ?? '').trim() !== '');
    if (modes.length !== 1)
      throw new Refus(400, 'Choisissez une seule façon de retenir cette proposition : une voiture déjà commandée, une nouvelle voiture pour un client, ou une voiture à vous.');
    if (String(req.body.prix_won ?? '') !== String(offre.prix_won))
      throw new Refus(409, `Le fournisseur a modifié cette proposition depuis l’affichage de la page : son prix est maintenant de ${won(offre.prix_won)}. Rechargez la page avant de la retenir.`);
    const vehiculeId = transaction(db, () => {
      let id;
      if (modes[0] === 'vehicule_id') {
        const v = entier(req.body.vehicule_id) && db.prepare('SELECT id FROM vehicules WHERE id = ? AND annulee = 0').get(entier(req.body.vehicule_id));
        if (!v) throw new Refus(400, 'Cette voiture n’existe pas ou elle est annulée.');
        if (db.prepare("SELECT 1 FROM offres WHERE vehicule_id = ? AND etat = 'retenue'").get(v.id))
          throw new Refus(409, 'Une autre proposition est déjà retenue pour cette voiture.');
        // Le prix réel en wons remplace un prix réel noté en francs, qui le masquerait sur la page Marges.
        // Les caractéristiques ne remplissent que les cases vides ; le prix client et les verrous ne bougent pas.
        db.prepare(`UPDATE vehicules SET achat_reel_won = ?, achat_reel_fcfa = NULL, annee = COALESCE(annee, ?),
          kilometrage = COALESCE(kilometrage, ?), couleur = COALESCE(couleur, ?), energie_boite = COALESCE(energie_boite, ?) WHERE id = ?`)
          .run(offre.prix_won, offre.annee, offre.kilometrage, offre.couleur, offre.energie_boite, v.id);
        id = v.id;
      } else {
        const { marque, modele, version, annee, kilometrage, couleur, energie_boite } = offre;
        id = creerVoiture(db, modes[0] === 'commande_id' ? 'vente' : 'perso', {
          marque, modele, version, annee, kilometrage, couleur, energie_boite,
          commande_id: req.body.commande_id, achat: req.body.achat, transport: req.body.transport, forfait: req.body.forfait,
        }).id;
        db.prepare('UPDATE vehicules SET achat_reel_won = ? WHERE id = ?').run(offre.prix_won, id);
      }
      db.prepare("UPDATE offres SET etat = 'retenue', vehicule_id = ? WHERE id = ?").run(id, offre.id);
      return id;
    });
    res.redirect(302, `/vehicules/${vehiculeId}`);
  });

  // Documents de transport : les deux comptes internes valident, renvoient avec une remarque, ou joignent un fichier reçu.
  // Valider marche depuis tout état, même sans fichier (document reçu hors de la plateforme).
  app.post('/partenaires/pieces/valider', (req, res) => {
    const ct = trouverConteneur(req.body.conteneur_id);
    const piece = designerPiece(db, ct.id, req.body);
    transaction(db, () => ecrirePiece(db, ct.id, piece, { etat: 'valide', par: req.utilisateur.identifiant, le: horloge() }));
    res.redirect(302, retour(req.body.retour));
  });

  app.post('/partenaires/pieces/renvoyer', (req, res) => {
    const ct = trouverConteneur(req.body.conteneur_id);
    const piece = designerPiece(db, ct.id, req.body);
    const remarque = texte(req.body.remarque, 300);
    if (!remarque) throw new Refus(400, 'Indiquez ce qui ne va pas : le transporteur lira la remarque.');
    transaction(db, () => ecrirePiece(db, ct.id, piece, { etat: 'attendu', remarque, par: req.utilisateur.identifiant, le: horloge() }));
    res.redirect(302, retour(req.body.retour));
  });

  app.post('/partenaires/pieces/joindre', lireDepot, (req, res) => {
    const ct = trouverConteneur(req.query.conteneur_id);
    const piece = designerPiece(db, ct.id, req.query);
    transaction(db, () => {
      const etat = etatPiece(db, ct.id, piece) === 'valide' ? 'valide' : 'envoye'; // un document validé le reste
      const pieceId = ecrirePiece(db, ct.id, piece, { etat, par: req.utilisateur.identifiant, le: horloge() });
      deposer(req, { db, horloge, dossierFichiers }, { pieceId });
    });
    res.redirect(302, retour(req.query.retour));
  });

  // Frais du transporteur : l'administrateur seul valide ou refuse.
  app.post('/partenaires/frais/:id/valider', exigerAdmin, (req, res) => {
    db.prepare("UPDATE frais_transporteur SET etat = 'valide' WHERE id = ?").run(trouverFrais(req).id);
    res.redirect(302, '/partenaires');
  });

  app.post('/partenaires/frais/:id/refuser', exigerAdmin, (req, res) => {
    const ligne = trouverFrais(req);
    const remarque = texte(req.body.remarque, 300);
    if (!remarque) throw new Refus(400, 'Indiquez le motif du refus : le transporteur le lira.');
    db.prepare("UPDATE frais_transporteur SET etat = 'refuse', remarque = ? WHERE id = ?").run(remarque, ligne.id);
    res.redirect(302, '/partenaires');
  });

  app.post('/partenaires/offres/:id/refuser', exigerAdmin, (req, res) => {
    const offre = aTraiter(trouverOffre(req));
    const motif = texte(req.body.motif, 300);
    if (!motif) throw new Refus(400, 'Indiquez le motif du refus : le fournisseur le lira.');
    db.prepare("UPDATE offres SET etat = 'refusee', motif_refus = ? WHERE id = ?").run(motif, offre.id);
    res.redirect(302, '/partenaires');
  });
}
