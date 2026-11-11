import { html, champ, choix } from '../html.js';
import { compteClient } from '../compte.js';
import { fcfa, dateFr } from '../format.js';
import { numeroWhatsApp } from '../telephone.js';
import { exigerAdmin } from '../auth.js';
import { Refus, texte, entier, dateFacultative, parmi } from '../saisie.js';
import { ETATS, LIGNES, libelleStatut, libelleVoiture } from '../libelles.js';
import { sectionsArgent, malusRestant } from './argent.js';

const NOMS_RELANCES = { solde: 'Relance du solde avant l’arrivée', arrivee: 'Annonce de l’arrivée', douane: 'Demande de la douane', retard: 'Relance de retard' };
const NOMS_DOCUMENTS ={ contrat: 'Contrat de vente', recu: 'Reçu', pv: 'Procès-verbal de livraison' };
const MODES_COMMANDE =[['deux', 'Deux paiements : solde avant l’arrivée, puis douane'], ['unique', 'Un seul solde à l’arrivée (forfait)']];

export function routesClients(app, { db, horloge }) {
  const trouver = req => {
    const id = entier(req.params.id);
    const client = id && db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) throw new Refus(404, 'Ce client n’existe pas.');
    return client;
  };

  const lire = corps => {
    const nom = texte(corps.nom, 120);
    if (!nom) throw new Refus(400, 'Le nom du client est obligatoire.');
    return {
      nom, telephone: texte(corps.telephone, 40),
      date_naissance: dateFacultative(corps.date_naissance, 'Date de naissance'),
      lieu_naissance: texte(corps.lieu_naissance, 120), nationalite: texte(corps.nationalite, 80),
      piece_identite: texte(corps.piece_identite, 120),
      piece_valable_jusqu: dateFacultative(corps.piece_valable_jusqu, 'Validité de la pièce'),
      adresse: texte(corps.adresse, 200), notes: texte(corps.notes, 1000),
    };
  };

  const formulaire = (c, action) => html`<form method="post" action="${action}" class="carte">
    <div class="grille">
      ${champ('Nom et prénom(s)', 'nom', c.nom, { requis: true })}
      ${champ('Téléphone / WhatsApp', 'telephone', c.telephone, { aide: 'Exemple : 077 22 99 98' })}
      ${champ('Né(e) le', 'date_naissance', c.date_naissance, { type: 'date' })}
      ${champ('Lieu de naissance', 'lieu_naissance', c.lieu_naissance)}
      ${champ('Nationalité', 'nationalite', c.nationalite)}
      ${champ('Pièce d’identité (nature et n°)', 'piece_identite', c.piece_identite)}
      ${champ('Pièce valable jusqu’au', 'piece_valable_jusqu', c.piece_valable_jusqu, { type: 'date' })}
      ${champ('Adresse', 'adresse', c.adresse)}
      ${champ('Notes', 'notes', c.notes)}
    </div>
    <p class="actions"><button class="bouton">Enregistrer</button></p>
  </form>`;

  app.get('/clients', (req, res) => {
    const comptes = db.prepare('SELECT id FROM clients').all().map(c => compteClient(db, c.id, horloge()));
    comptes.sort((a, b) => b.reste - a.reste || a.client.nom.localeCompare(b.client.nom, 'fr'));
    const somme = champSomme => comptes.reduce((s, c) => s + c[champSomme], 0);
    res.page('Clients', html`
      <p class="actions"><a class="bouton" href="/clients/nouveau">Nouveau client</a></p>
      <div class="defile"><table>
        <thead><tr><th>Client</th><th>Téléphone</th><th class="montant">Prix total</th><th class="montant">Reçu</th><th class="montant">Reste</th></tr></thead>
        <tbody>
        ${comptes.map(c => html`<tr>
          <td><a href="/clients/${c.client.id}">${c.client.nom}</a></td>
          <td>${c.client.telephone ?? ''}</td>
          <td class="montant">${c.total ? fcfa(c.total + c.totalPenalites) : '—'}</td>
          <td class="montant">${c.recu ? fcfa(c.recu) : '—'}</td>
          <td class="montant">${c.reste ? fcfa(c.reste) : c.credit ? html`crédit ${fcfa(c.credit)}` : '—'}</td>
        </tr>`)}
        <tr class="total"><td colspan="2">Total</td>
          <td class="montant">${fcfa(somme('total') + somme('totalPenalites'))}</td>
          <td class="montant">${fcfa(somme('recu'))}</td>
          <td class="montant">${fcfa(somme('reste'))}</td></tr>
        </tbody>
      </table></div>`, { actif: '/clients' });
  });

  app.get('/clients/nouveau', (req, res) => res.page('Nouveau client', formulaire({}, '/clients'), { actif: '/clients' }));

  app.post('/clients', (req, res) => {
    const c = lire(req.body);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO clients (nom, telephone, date_naissance, lieu_naissance, nationalite, piece_identite, piece_valable_jusqu, adresse, notes, cree_le)
      VALUES (:nom, :telephone, :date_naissance, :lieu_naissance, :nationalite, :piece_identite, :piece_valable_jusqu, :adresse, :notes, :cree_le)`)
      .run({ ...c, cree_le: horloge() });
    res.redirect(302, `/clients/${lastInsertRowid}`);
  });

  app.get('/clients/:id', (req, res) => {
    const client = trouver(req);
    const compte = compteClient(db, client.id, horloge());
    const commandes = db.prepare('SELECT * FROM commandes WHERE client_id = ? ORDER BY id').all(client.id);
    const aCharge = db.prepare("SELECT * FROM vehicules WHERE client_id = ? AND type = 'charge' AND annulee = 0").all(client.id);
    const numeroConteneur = id => compte.vehicules.find(v => v.conteneur_id === id)?.conteneur.numero;
    const documents = db.prepare(`
      SELECT d.id, d.type, d.numero, d.etat, d.cree_le FROM documents d
      LEFT JOIN mouvements m ON m.id = d.mouvement_id LEFT JOIN commandes c ON c.id = d.commande_id
      LEFT JOIN vehicules v ON v.id = d.vehicule_id
      WHERE m.client_id = :id OR c.client_id = :id OR v.client_id = :id ORDER BY d.id DESC`).all({ id: client.id });
    const contrats = db.prepare("SELECT id, numero, commande_id FROM documents WHERE type = 'contrat' AND etat <> 'remplace'").all();
    const contratDe = commandeId => contrats.find(d => d.commande_id === commandeId);
    const relances = db.prepare(`SELECT r.*, ct.numero FROM relances r LEFT JOIN conteneurs ct ON ct.id = r.conteneur_id
      WHERE r.client_id = ? ORDER BY r.envoye_le DESC, r.id DESC`).all(client.id);
    // Retard : le malus est calculé ici, et l'administrateur choisit de l'appliquer.
    const celluleMalus = l => {
      const restant = malusRestant(db, client.id, l);
      return html`<br><small>${l.joursRetard} jour(s) de retard — malus calculé : ${fcfa(l.malus)}${restant < l.malus ? `, déjà appliqué : ${fcfa(l.malus - restant)}` : ''}</small>
        ${req.utilisateur.role === 'admin' && restant > 0 ? html`<form method="post" action="/clients/${client.id}/malus" class="actions">
          <input type="hidden" name="conteneur_id" value="${l.conteneurId ?? ''}"><input type="hidden" name="ligne" value="${l.type}">
          <input name="montant" value="${restant}" aria-label="Malus à appliquer (F)">
          <button class="bouton danger petit">Appliquer le malus</button></form>` : ''}`;
    };

    res.page(client.nom, html`
      <section class="carte">
        <dl class="fiche">
          <dt>Téléphone</dt><dd>${client.telephone ?? '—'}
            ${numeroWhatsApp(client.telephone) ? '' : html` <span class="etat retard">numéro WhatsApp manquant</span>`}</dd>
          <dt>Né(e) le</dt><dd>${dateFr(client.date_naissance) || '—'}${client.lieu_naissance ? ` à ${client.lieu_naissance}` : ''}</dd>
          <dt>Nationalité</dt><dd>${client.nationalite ?? '—'}</dd>
          <dt>Pièce d’identité</dt><dd>${client.piece_identite ?? '—'}${client.piece_valable_jusqu ? ` (valable jusqu’au ${dateFr(client.piece_valable_jusqu)})` : ''}</dd>
          <dt>Adresse</dt><dd>${client.adresse ?? '—'}</dd>
          ${client.notes ? html`<dt>Notes</dt><dd>${client.notes}</dd>` : ''}
        </dl>
      </section>

      <h2>Compte</h2>
      <div class="defile"><table>
        <tr><td>Prix total des voitures</td><td class="montant">${fcfa(compte.total)}</td></tr>
        ${compte.totalPenalites ? html`<tr><td>Pénalités et malus de retard</td><td class="montant">${fcfa(compte.totalPenalites)}</td></tr>` : ''}
        ${compte.totalRistournes ? html`<tr><td>Ristournes accordées</td><td class="montant">−${fcfa(compte.totalRistournes)}</td></tr>` : ''}
        <tr><td>Reçu</td><td class="montant">${fcfa(compte.recu)}</td></tr>
        <tr class="total"><td>${compte.credit ? 'Crédit du client' : 'Reste à payer'}</td>
          <td class="montant">${fcfa(compte.credit || compte.reste)}</td></tr>
      </table></div>

      <h2>Commandes et voitures</h2>
      ${commandes.map(cmd => html`<section class="carte">
        <p><strong>Commande n° ${cmd.id}</strong> — ${cmd.mode === 'unique' ? 'un seul solde à l’arrivée' : 'solde avant l’arrivée, puis douane'}
          ${cmd.contrat_papier ? html` <span class="etat">contrat papier signé</span>` : ''}</p>
        <div class="defile"><table>
          <thead><tr><th>Voiture</th><th>Statut</th><th>Conteneur</th><th class="montant">Hors douane</th><th class="montant">Douane</th><th class="montant">Prix client</th></tr></thead>
          <tbody>${compte.vehicules.filter(v => v.commande_id === cmd.id).map(v => html`<tr>
            <td><a href="/vehicules/${v.id}">${libelleVoiture(v)}</a></td>
            <td>${libelleStatut(v.statut)}</td>
            <td>${v.conteneur ? html`<a href="/conteneurs/${v.conteneur.id}">${v.conteneur.numero}</a>` : '—'}</td>
            <td class="montant">${fcfa(v.prix.horsDouane)}</td>
            <td class="montant">${v.prix.forfait ? 'comprise' : fcfa(v.prix.douane)}</td>
            <td class="montant">${fcfa(v.prix.total)}</td>
          </tr>`)}</tbody>
        </table></div>
        <div class="actions"><a class="bouton secondaire petit" href="/vehicules/nouveau?commande=${cmd.id}">Ajouter une voiture</a>
          ${cmd.contrat_papier || !compte.vehicules.some(v => v.commande_id === cmd.id) ? '' : html`<form method="post" action="/commandes/${cmd.id}/contrat"
            data-confirmer="${contratDe(cmd.id) ? 'Émettre un nouveau contrat ? Il remplacera le précédent et reprendra les prix actuels.' : 'Émettre le contrat ? Le prix client sera verrouillé.'}">
            <button class="bouton petit">${contratDe(cmd.id) ? 'Émettre un nouveau contrat' : 'Émettre le contrat'}</button></form>`}
          ${contratDe(cmd.id) ? html`<a href="/documents/${contratDe(cmd.id).id}">Contrat n° ${contratDe(cmd.id).numero}</a>` : ''}
          ${cmd.contrat_papier || contratDe(cmd.id) || !compte.vehicules.some(v => v.commande_id === cmd.id) ? '' : html`<form method="post" action="/commandes/${cmd.id}/papier"
            data-confirmer="Un contrat papier est déjà signé pour cette commande ? Le prix client sera verrouillé et la plateforme n’émettra pas de contrat.">
            <button class="bouton secondaire petit">Contrat papier déjà signé</button></form>`}
        </div>
      </section>`)}
      ${aCharge.length ? html`<section class="carte"><p><strong>À ma charge</strong> — sans solde ni relance</p>
        <ul>${aCharge.map(v => html`<li><a href="/vehicules/${v.id}">${libelleVoiture(v)}</a> — ${libelleStatut(v.statut)}</li>`)}</ul></section>` : ''}
      <form method="post" action="/clients/${client.id}/commandes" class="carte">
        ${choix('Nouvelle commande', 'mode', MODES_COMMANDE)}
        <p class="actions"><button class="bouton secondaire">Créer la commande</button></p>
      </form>

      ${compte.lignes.length ? html`<h2>Échéances</h2>
      <div class="defile"><table>
        <thead><tr><th>Échéance</th><th>Conteneur</th><th>À payer le</th><th class="montant">Montant</th><th class="montant">Payé</th><th class="montant">Reste</th><th>État</th></tr></thead>
        <tbody>${compte.lignes.map(l => html`<tr>
          <td>${LIGNES[l.type]}</td>
          <td>${l.conteneurId ? numeroConteneur(l.conteneurId) : '—'}</td>
          <td>${dateFr(l.exigibleLe) || '—'}</td>
          <td class="montant">${fcfa(l.montant)}</td><td class="montant">${fcfa(l.paye)}</td><td class="montant">${fcfa(l.reste)}</td>
          <td><span class="etat ${ETATS[l.etat][1]}">${ETATS[l.etat][0]}</span>
            ${l.etat === 'en_retard' ? celluleMalus(l) : ''}</td>
        </tr>`)}</tbody>
      </table></div>` : ''}

      ${sectionsArgent(db, compte, req.utilisateur, horloge())}

      ${relances.length ? html`<h2>Messages envoyés</h2>
      <ul>${relances.map(r => html`<li>${dateFr(r.envoye_le)} — ${NOMS_RELANCES[r.type] ?? r.type}${r.numero ? ` — conteneur ${r.numero}` : ''} <span class="discret">(${r.par})</span>
        ${req.utilisateur.role === 'admin' ? html`<form method="post" action="/relances/${r.id}/supprimer" class="actions"
          data-confirmer="Retirer ce message de la liste ? À faire seulement s’il a été marqué envoyé par erreur."><button class="bouton danger petit">Marqué par erreur</button></form>` : ''}</li>`)}</ul>` : ''}

      ${documents.length ? html`<h2>Documents</h2>
      <ul>${documents.map(d => html`<li><a href="/documents/${d.id}">${NOMS_DOCUMENTS[d.type]} n° ${d.numero}</a>
        — ${dateFr(d.cree_le)}${d.etat === 'remplace' ? ' — remplacé' : d.etat === 'signe' ? ' — signé' : ''}</li>`)}</ul>` : ''}

      <h2>Modifier la fiche</h2>
      ${formulaire(client, `/clients/${client.id}`)}
      ${req.utilisateur.role === 'admin' ? html`<form method="post" action="/clients/${client.id}/supprimer" data-confirmer="Supprimer ce client ?">
        <button class="bouton danger">Supprimer ce client</button></form>` : ''}
    `, { actif: '/clients' });
  });

  app.post('/clients/:id', (req, res) => {
    const client = trouver(req);
    db.prepare(`UPDATE clients SET nom = :nom, telephone = :telephone, date_naissance = :date_naissance,
      lieu_naissance = :lieu_naissance, nationalite = :nationalite, piece_identite = :piece_identite,
      piece_valable_jusqu = :piece_valable_jusqu, adresse = :adresse, notes = :notes WHERE id = :id`)
      .run({ ...lire(req.body), id: client.id });
    res.redirect(302, `/clients/${client.id}`);
  });

  app.post('/clients/:id/supprimer', exigerAdmin, (req, res) => {
    const client = trouver(req);
    const lie = db.prepare(`SELECT (SELECT COUNT(*) FROM mouvements WHERE client_id = :id) + (SELECT COUNT(*) FROM vehicules WHERE client_id = :id)
      + (SELECT COUNT(*) FROM penalites WHERE client_id = :id) AS n`).get({ id: client.id }).n;
    if (lie > 0) throw new Refus(409, 'Ce client a des voitures ou des mouvements d’argent : il ne peut pas être supprimé.');
    db.prepare('DELETE FROM relances WHERE client_id = ?').run(client.id);
    db.prepare('DELETE FROM commandes WHERE client_id = ?').run(client.id);
    db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
    res.redirect(302, '/clients');
  });

  app.post('/clients/:id/commandes', (req, res) => {
    const client = trouver(req);
    const mode = parmi(req.body.mode ?? 'deux', ['deux', 'unique'], 'Mode de paiement');
    const { lastInsertRowid } = db.prepare('INSERT INTO commandes (client_id, mode, cree_le) VALUES (?, ?, ?)').run(client.id, mode, horloge());
    res.redirect(302, `/vehicules/nouveau?commande=${lastInsertRowid}`);
  });
}
