import { html, champ, choix } from '../html.js';
import { transaction } from '../db.js';
import { compteClient } from '../compte.js';
import { emettrePV } from '../documents.js';
import { prixVehicule } from '../calc.js';
import { fcfa, dateFr } from '../format.js';
import { exigerAdmin } from '../auth.js';
import { Refus, texte, entier, entierFacultatif, montantFacultatif, montantSigne, dateObligatoire, parmi } from '../saisie.js';
import { STATUTS, TYPES, libelleStatut, libelleVoiture } from '../libelles.js';

const STATUTS_SAISISSABLES = STATUTS.filter(([code]) => code !== 'remise'); // la remise a sa propre route

function lire(corps, type) {
  const v = {
    marque: texte(corps.marque, 60), modele: texte(corps.modele, 60), version: texte(corps.version, 60),
    annee: entierFacultatif(corps.annee, 'Année'), couleur: texte(corps.couleur, 40),
    energie_boite: texte(corps.energie_boite, 60), chassis: texte(corps.chassis, 40),
    kilometrage: entierFacultatif(corps.kilometrage, 'Kilométrage'),
    achat: montantFacultatif(corps.achat, 'Prix d’achat'), transport: montantFacultatif(corps.transport, 'Transport'),
    arrondi: montantSigne(corps.arrondi, 'Arrondi ou remise'), forfait: montantFacultatif(corps.forfait, 'Forfait'),
    notes: texte(corps.notes, 1000),
  };
  if (!v.marque || !v.modele) throw new Refus(400, 'La marque et le modèle sont obligatoires.');
  if (type === 'vente' && v.forfait === null && (v.achat === null || v.transport === null))
    throw new Refus(400, 'Pour une vente, indiquez le prix d’achat et le transport, ou bien un forfait.');
  if (type === 'vente' && prixVehicule(v).horsDouane <= 0)
    throw new Refus(400, 'Avec cette remise, le prix de la voiture serait nul ou négatif. Vérifiez le montant de la remise.');
  return v;
}
// Une voiture au forfait a tout son prix dans le solde d'avant l'arrivée (douane comprise) :
// il n'y a rien à changer au mode de paiement de la commande ni aux échéances des autres voitures.

// Crée une voiture : formulaire « Nouvelle voiture », et proposition du fournisseur retenue comme nouvelle voiture.
export function creerVoiture(db, type, corps) {
  let clientId = null, commandeId = null;
  if (type === 'vente') {
    const commande = entier(corps.commande_id) && db.prepare('SELECT * FROM commandes WHERE id = ?').get(entier(corps.commande_id));
    if (!commande) throw new Refus(400, 'Une voiture vendue doit appartenir à la commande d’un client.');
    commandeId = commande.id; clientId = commande.client_id;
  } else if (type === 'charge') {
    const client = entier(corps.client_id) && db.prepare('SELECT id FROM clients WHERE id = ?').get(entier(corps.client_id));
    if (!client) throw new Refus(400, 'Indiquez pour qui est cette voiture.');
    clientId = client.id;
  }
  const v = lire(corps, type);
  const id = db.prepare(`
    INSERT INTO vehicules (type, client_id, commande_id, marque, modele, version, annee, couleur, energie_boite, chassis, kilometrage, achat, transport, arrondi, forfait, notes)
    VALUES (:type, :client_id, :commande_id, :marque, :modele, :version, :annee, :couleur, :energie_boite, :chassis, :kilometrage, :achat, :transport, :arrondi, :forfait, :notes)`)
    .run({ ...v, type, client_id: clientId, commande_id: commandeId }).lastInsertRowid;
  return { id: Number(id), clientId };
}

export function routesVehicules(app, { db, horloge }) {
  const trouver = req => {
    const id = entier(req.params.id);
    const voiture = id && db.prepare('SELECT * FROM vehicules WHERE id = ?').get(id);
    if (!voiture) throw new Refus(404, 'Cette voiture n’existe pas.');
    return voiture;
  };

  const champsVoiture = v => html`<div class="grille">
    ${champ('Marque', 'marque', v.marque, { requis: true })}
    ${champ('Modèle', 'modele', v.modele, { requis: true })}
    ${champ('Version', 'version', v.version, { aide: 'simple, full option…' })}
    ${champ('Année', 'annee', v.annee)}
    ${champ('Couleur', 'couleur', v.couleur)}
    ${champ('Énergie / boîte', 'energie_boite', v.energie_boite)}
    ${champ('N° de châssis', 'chassis', v.chassis)}
    ${champ('Kilométrage', 'kilometrage', v.kilometrage)}
    ${champ('Prix d’achat en Corée (F)', 'achat', v.achat)}
    ${champ('Transport jusqu’à Libreville (F)', 'transport', v.transport)}
    ${champ('Arrondi ou remise (F)', 'arrondi', v.arrondi || '', { aide: 'Négatif pour une remise : -8 000' })}
    ${champ('Ou forfait tout compris (F)', 'forfait', v.forfait, { aide: 'Laisser vide si le prix est calculé' })}
    ${champ('Notes', 'notes', v.notes)}
  </div>`;

  app.get('/vehicules', (req, res) => {
    const type = Object.hasOwn(TYPES, req.query.type) ? req.query.type : null;
    const voitures = db.prepare(`
      SELECT v.*, c.nom AS client_nom, ct.numero AS ct_numero FROM vehicules v
      LEFT JOIN clients c ON c.id = v.client_id LEFT JOIN conteneurs ct ON ct.id = v.conteneur_id
      WHERE v.annulee = 0 AND (:type IS NULL OR v.type = :type) ORDER BY v.id DESC`).all({ type });
    res.page('Voitures', html`
      <p class="actions">
        <a class="bouton secondaire petit" href="/vehicules">Toutes</a>
        ${Object.entries(TYPES).map(([code, nom]) => html`<a class="bouton secondaire petit" href="/vehicules?type=${code}">${nom}</a>`)}
        <a class="bouton" href="/vehicules/nouveau?type=perso">Ajouter une voiture à moi</a>
      </p>
      <p class="discret">Pour une voiture vendue, passez par la fiche du client.</p>
      <div class="defile"><table>
        <thead><tr><th>Voiture</th><th>Pour</th><th>Client</th><th>Conteneur</th><th>Statut</th><th>N° de châssis</th></tr></thead>
        <tbody>${voitures.map(v => html`<tr>
          <td><a href="/vehicules/${v.id}">${libelleVoiture(v)}</a></td>
          <td>${TYPES[v.type]}</td>
          <td>${v.client_id ? html`<a href="/clients/${v.client_id}">${v.client_nom}</a>` : '—'}</td>
          <td>${v.conteneur_id ? html`<a href="/conteneurs/${v.conteneur_id}">${v.ct_numero}</a>` : '—'}</td>
          <td>${libelleStatut(v.statut)}</td>
          <td>${v.chassis ?? '—'}</td>
        </tr>`)}</tbody>
      </table></div>`, { actif: '/vehicules' });
  });

  app.get('/vehicules/nouveau', (req, res) => {
    const commande = entier(req.query.commande) && db.prepare(
      'SELECT c.*, k.nom AS client_nom FROM commandes c JOIN clients k ON k.id = c.client_id WHERE c.id = ?').get(entier(req.query.commande));
    const type = commande ? 'vente' : req.query.type === 'charge' ? 'charge' : 'perso';
    const clients = type === 'charge' ? db.prepare('SELECT id, nom FROM clients ORDER BY nom').all() : [];
    const modele = entier(req.query.catalogue) && db.prepare('SELECT marque, modele, version, annee, achat, transport FROM catalogue WHERE id = ?').get(entier(req.query.catalogue));
    const gamme = db.prepare('SELECT * FROM catalogue ORDER BY marque, modele, version, annee').all();
    res.page(commande ? `Nouvelle voiture pour ${commande.client_nom}` : `Nouvelle voiture — ${TYPES[type].toLowerCase()}`, html`
      ${gamme.length ? html`<form method="get" action="/vehicules/nouveau" class="carte">
        ${commande ? html`<input type="hidden" name="commande" value="${commande.id}">` : html`<input type="hidden" name="type" value="${type}">`}
        ${choix('Modèle de la gamme', 'catalogue', gamme.map(g => [g.id, `${libelleVoiture(g)} — ${fcfa(g.achat)} en Corée`]), req.query.catalogue)}
        <p class="actions"><button class="bouton secondaire">Préremplir depuis la gamme</button></p>
      </form>` : ''}
      <form method="post" action="/vehicules" class="carte">
        <input type="hidden" name="type" value="${type}">
        ${commande ? html`<input type="hidden" name="commande_id" value="${commande.id}">` : ''}
        ${type === 'charge' ? choix('Pour qui', 'client_id', clients.map(c => [c.id, c.nom])) : ''}
        ${champsVoiture(modele ?? {})}
        <p class="actions"><button class="bouton">Enregistrer la voiture</button></p>
      </form>
      ${type === 'perso' ? html`<p><a href="/vehicules/nouveau?type=charge">Plutôt une voiture à ma charge pour quelqu’un</a></p>` : ''}`,
      { actif: '/vehicules' });
  });

  app.post('/vehicules', (req, res) => {
    const { clientId } = creerVoiture(db, parmi(req.body.type, Object.keys(TYPES), 'Type de voiture'), req.body);
    res.redirect(302, clientId ? `/clients/${clientId}` : '/vehicules');
  });

  app.get('/vehicules/:id', (req, res) => {
    const v = trouver(req);
    const client = v.client_id && db.prepare('SELECT id, nom FROM clients WHERE id = ?').get(v.client_id);
    const conteneur = v.conteneur_id && db.prepare('SELECT id, numero FROM conteneurs WHERE id = ?').get(v.conteneur_id);
    const etapes = db.prepare('SELECT * FROM etapes WHERE vehicule_id = ? ORDER BY date, id').all(v.id);
    const photos = db.prepare(`SELECT f.id, f.nom_origine FROM fichiers f JOIN offres o ON o.id = f.offre_id
      WHERE o.vehicule_id = ? AND o.etat = 'retenue' AND f.supprime_le IS NULL ORDER BY f.id`).all(v.id);
    const prix = prixVehicule(v);
    const admin = req.utilisateur.role === 'admin';
    const commandes = admin && v.type === 'vente' ? db.prepare(
      'SELECT c.id, k.nom FROM commandes c JOIN clients k ON k.id = c.client_id ORDER BY k.nom, c.id').all() : [];

    res.page(libelleVoiture(v), html`
      ${v.annulee ? html`<p class="alerte">Cette voiture est annulée : elle ne compte plus dans aucun solde.</p>` : ''}
      <section class="carte"><dl class="fiche">
        <dt>Pour</dt><dd>${TYPES[v.type]}${client ? html` — <a href="/clients/${client.id}">${client.nom}</a>` : ''}</dd>
        <dt>Statut</dt><dd>${libelleStatut(v.statut)}</dd>
        <dt>Conteneur</dt><dd>${conteneur ? html`<a href="/conteneurs/${conteneur.id}">${conteneur.numero}</a>` : 'pas encore dans un conteneur'}</dd>
        <dt>N° de châssis</dt><dd>${v.chassis ?? '—'}</dd>
        <dt>Kilométrage</dt><dd>${v.kilometrage ?? '—'}</dd>
      </dl></section>
      ${photos.length ? html`<h2>Photos du fournisseur</h2>
      <p class="photos">${photos.map(p => html`<a href="/fichiers/${p.id}"><img class="vignette" src="/fichiers/${p.id}" alt="${p.nom_origine}"></a>`)}</p>` : ''}

      ${v.type === 'vente' ? html`<h2>Prix client</h2>
      ${prix.verrouille ? html`<p class="note">Prix client verrouillé par le contrat : il ne change plus, même si les coûts ci-dessous sont modifiés.</p>` : ''}
      <div class="defile"><table>
        ${prix.forfait ? html`<tr><td>Forfait tout compris (douane comprise)</td><td class="montant">${fcfa(prix.total)}</td></tr>` : html`
        <tr><td>Achat en Corée</td><td class="montant">${v.achat === null ? '—' : fcfa(v.achat)}</td></tr>
        <tr><td>Transport</td><td class="montant">${v.transport === null ? '—' : fcfa(v.transport)}</td></tr>
        <tr><td>Hors douane (achat + transport + frais de 9 % ± arrondi)</td><td class="montant">${fcfa(prix.horsDouane)}</td></tr>
        <tr><td>Douane (55 % de l’achat et du transport)</td><td class="montant">${fcfa(prix.douane)}</td></tr>`}
        <tr class="total"><td>Prix client</td><td class="montant">${fcfa(prix.total)}</td></tr>
      </table></div>` : ''}

      <h2>Étapes</h2>
      ${etapes.length ? html`<ul>${etapes.map(e => html`<li>${dateFr(e.date)} — ${libelleStatut(e.statut)} <span class="discret">(${e.par})</span></li>`)}</ul>`
        : html`<p class="discret">Aucune étape enregistrée.</p>`}
      <form method="post" action="/vehicules/${v.id}/statut" class="carte"><div class="grille">
        ${choix('Nouvelle étape', 'statut', STATUTS_SAISISSABLES, v.statut)}
        ${champ('Date', 'date', horloge(), { type: 'date', requis: true })}
      </div><p class="actions"><button class="bouton secondaire">Enregistrer l’étape</button></p></form>
      ${v.statut !== 'remise' && !v.annulee ? html`<form method="post" action="/vehicules/${v.id}/remise" class="carte"><div class="grille">
        ${champ(v.type === 'vente' ? 'Remise au client le' : 'Voiture récupérée le', 'date', horloge(), { type: 'date', requis: true })}
      </div><p class="discret">${v.type === 'vente' ? 'Possible seulement quand la voiture est dédouanée et entièrement payée. Un procès-verbal de livraison est alors créé.' : 'Aucun document n’est créé pour une voiture qui n’est pas vendue.'}</p>
      <p class="actions"><button class="bouton">${v.type === 'vente' ? 'Remettre la voiture au client' : 'Marquer comme récupérée'}</button></p></form>` : ''}

      <h2>Modifier la voiture</h2>
      <form method="post" action="/vehicules/${v.id}" class="carte">
        ${champsVoiture(v)}
        <p class="actions"><button class="bouton">Enregistrer</button></p>
      </form>

      ${admin && !v.annulee ? html`<h2>Administrateur</h2>
      ${commandes.length ? html`<form method="post" action="/vehicules/${v.id}/reaffecter" class="carte">
        ${choix('Passer cette voiture à la commande de', 'commande_id', commandes.map(c => [c.id, `${c.nom} — commande n° ${c.id}`]), v.commande_id)}
        <p class="actions"><button class="bouton secondaire">Réaffecter</button></p></form>` : ''}
      <form method="post" action="/vehicules/${v.id}/annuler" data-confirmer="Annuler cette voiture ? Elle ne comptera plus dans le solde du client.">
        <button class="bouton danger">Annuler cette voiture</button></form>` : ''}
    `, { actif: '/vehicules' });
  });

  app.post('/vehicules/:id', (req, res) => {
    const ancienne = trouver(req);
    const v = lire(req.body, ancienne.type);
    db.prepare(`UPDATE vehicules SET marque = :marque, modele = :modele, version = :version, annee = :annee, couleur = :couleur,
      energie_boite = :energie_boite, chassis = :chassis, kilometrage = :kilometrage, achat = :achat, transport = :transport,
      arrondi = :arrondi, forfait = :forfait, notes = :notes WHERE id = :id`).run({ ...v, id: ancienne.id });
    res.redirect(302, `/vehicules/${ancienne.id}`);
  });

  app.post('/vehicules/:id/statut', (req, res) => {
    const v = trouver(req);
    const statut = parmi(req.body.statut, STATUTS_SAISISSABLES.map(([code]) => code), 'Étape');
    const date = dateObligatoire(req.body.date);
    db.prepare('UPDATE vehicules SET statut = ? WHERE id = ?').run(statut, v.id);
    db.prepare('INSERT INTO etapes (vehicule_id, statut, date, par) VALUES (?, ?, ?, ?)').run(v.id, statut, date, req.utilisateur.identifiant);
    res.redirect(302, `/vehicules/${v.id}`);
  });

  // Remise au client : seulement une voiture dédouanée et entièrement payée (article 3 du contrat).
  app.post('/vehicules/:id/remise', (req, res) => {
    const v = trouver(req);
    if (v.statut === 'remise') throw new Refus(409, 'Cette voiture est déjà remise.');
    const date = dateObligatoire(req.body.date, 'Date de remise');
    if (v.type === 'vente') {
      if (v.statut !== 'dedouanee') throw new Refus(409, 'Cette voiture n’est pas encore dédouanée : elle ne peut pas être remise.');
      const du = compteClient(db, v.client_id, horloge()).lignes
        .filter(l => l.reste > 0 && (l.type === 'penalite' || l.conteneurId === v.conteneur_id))
        .reduce((s, l) => s + l.reste, 0);
      if (du > 0) throw new Refus(409, `Il reste ${fcfa(du)} à payer pour cette voiture : elle ne peut pas encore être remise.`);
    }
    const pv = transaction(db, () => {
      db.prepare("UPDATE vehicules SET statut = 'remise' WHERE id = ?").run(v.id);
      db.prepare("INSERT INTO etapes (vehicule_id, statut, date, par) VALUES (?, 'remise', ?, ?)").run(v.id, date, req.utilisateur.identifiant);
      return v.type === 'vente' ? emettrePV(db, v.id, req.utilisateur, date) : null;
    });
    res.redirect(302, pv ? `/documents/${pv.id}` : `/vehicules/${v.id}`);
  });

  app.post('/vehicules/:id/annuler', exigerAdmin, (req, res) => {
    const v = trouver(req);
    db.prepare('UPDATE vehicules SET annulee = 1 WHERE id = ?').run(v.id);
    res.redirect(302, v.client_id ? `/clients/${v.client_id}` : '/vehicules');
  });

  app.post('/vehicules/:id/reaffecter', exigerAdmin, (req, res) => {
    const v = trouver(req);
    const commande = entier(req.body.commande_id) && db.prepare('SELECT * FROM commandes WHERE id = ?').get(entier(req.body.commande_id));
    if (v.type !== 'vente' || !commande) throw new Refus(400, 'Choisissez la commande du client qui reprend cette voiture.');
    db.prepare('UPDATE vehicules SET commande_id = ?, client_id = ? WHERE id = ?').run(commande.id, commande.client_id, v.id);
    res.redirect(302, `/clients/${commande.client_id}`);
  });
}
