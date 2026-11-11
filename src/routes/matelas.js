// Vente des matelas. Cette page ne montre jamais leur coût d'achat : il est sur la page Marges.
import { html, champ, choix } from '../html.js';
import { stockMatelas, TYPES_MATELAS } from '../matelas.js';
import { fcfa, dateFr } from '../format.js';
import { exigerAdmin } from '../auth.js';
import { Refus, texte, entier, montantObligatoire, dateObligatoire, parmi } from '../saisie.js';
import { MODES_PAIEMENT, libelleMode } from '../libelles.js';

export function routesMatelas(app, { db, horloge }) {
  const libelle = type => TYPES_MATELAS.find(([code]) => code === type)?.[1] ?? type;

  app.get('/matelas', (req, res) => {
    const stock = stockMatelas(db);
    const ventes = db.prepare('SELECT * FROM matelas_ventes ORDER BY date DESC, id DESC').all();
    const admin = req.utilisateur.role === 'admin';
    const somme = champSomme => stock.reduce((s, l) => s + l[champSomme], 0);
    res.page('Matelas', html`
      <div class="defile"><table>
        <thead><tr><th>Matelas</th><th class="montant">En mer</th><th class="montant">Disponibles</th><th class="montant">Vendus</th>
          <th class="montant">Prix de vente minimum</th><th class="montant">Encaissé</th></tr></thead>
        <tbody>${stock.map(l => html`<tr><td>${l.libelle}</td><td class="montant">${l.enMer}</td><td class="montant"><strong>${l.disponible}</strong></td>
          <td class="montant">${l.vendus}</td><td class="montant">${fcfa(l.prixMinimum)}</td><td class="montant">${fcfa(l.encaisse)}</td></tr>`)}
        <tr class="total"><td>Total</td><td class="montant">${somme('enMer')}</td><td class="montant">${somme('disponible')}</td>
          <td class="montant">${somme('vendus')}</td><td></td><td class="montant">${fcfa(somme('encaisse'))}</td></tr></tbody>
      </table></div>
      <p class="discret">Un matelas devient disponible quand l’arrivée de son conteneur est enregistrée.</p>

      <h2>Enregistrer une vente</h2>
      <form method="post" action="/matelas/ventes" class="carte"><div class="grille">
        ${choix('Matelas', 'type', TYPES_MATELAS)}
        ${champ('Quantité', 'quantite', '1', { requis: true })}
        ${champ('Prix de vente à l’unité (F)', 'prix_unitaire', '', { requis: true, aide: 'Pas en dessous du prix minimum.' })}
        ${champ('Date', 'date', horloge(), { type: 'date', requis: true })}
        ${choix('Mode de paiement', 'mode', MODES_PAIEMENT)}
        ${champ('Acheteur', 'acheteur')}
      </div><p class="actions"><button class="bouton">Enregistrer la vente</button></p></form>

      <h2>Ventes</h2>
      ${ventes.length ? html`<div class="defile"><table>
        <thead><tr><th>Date</th><th>Matelas</th><th class="montant">Quantité</th><th class="montant">Prix à l’unité</th><th class="montant">Total</th>
          <th>Acheteur</th><th>Paiement</th><th>Saisi par</th>${admin ? html`<th></th>` : ''}</tr></thead>
        <tbody>${ventes.map(v => html`<tr class="${v.annule ? 'annule' : ''}">
          <td>${dateFr(v.date)}</td><td>${libelle(v.type)}</td><td class="montant">${v.quantite}</td><td class="montant">${fcfa(v.prix_unitaire)}</td>
          <td class="montant">${fcfa(v.quantite * v.prix_unitaire)}</td>
          <td class="clair">${v.acheteur ?? ''}${v.annule ? html` <strong>Annulée : ${v.motif_annulation}</strong>` : ''}</td>
          <td>${libelleMode(v.mode)}</td><td>${v.saisi_par}</td>
          ${admin ? html`<td class="clair">${v.annule ? '' : html`<form method="post" action="/matelas/ventes/${v.id}/annuler" class="actions" data-confirmer="Annuler cette vente ?">
            <input name="motif" placeholder="Motif" required aria-label="Motif de l’annulation"><button class="bouton danger petit">Annuler</button></form>`}</td>` : ''}
        </tr>`)}</tbody>
      </table></div>` : html`<p class="discret">Aucune vente enregistrée.</p>`}`, { actif: '/matelas' });
  });

  app.post('/matelas/ventes', (req, res) => {
    const type = parmi(req.body.type, TYPES_MATELAS.map(([code]) => code), 'Type de matelas');
    const quantite = entier(req.body.quantite);
    if (!quantite) throw new Refus(400, 'Quantité illisible.');
    const prix = montantObligatoire(req.body.prix_unitaire, 'Prix de vente');
    const date = dateObligatoire(req.body.date);
    const mode = parmi(req.body.mode, MODES_PAIEMENT.map(([code]) => code), 'Mode de paiement');
    const ligne = stockMatelas(db).find(l => l.type === type);
    if (quantite > ligne.disponible)
      throw new Refus(400, `Il n’y a que ${ligne.disponible} matelas ${ligne.libelle} disponible(s). Les autres sont encore en mer ou déjà vendus.`);
    if (prix < ligne.prixMinimum && req.utilisateur.role !== 'admin')
      throw new Refus(400, `Le prix minimum d’un matelas ${ligne.libelle} est de ${fcfa(ligne.prixMinimum)}. Seul l’administrateur peut vendre en dessous.`);
    db.prepare('INSERT INTO matelas_ventes (date, type, quantite, prix_unitaire, acheteur, mode, saisi_par) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(date, type, quantite, prix, texte(req.body.acheteur, 120), mode, req.utilisateur.identifiant);
    res.redirect(302, '/matelas');
  });

  app.post('/matelas/ventes/:id/annuler', exigerAdmin, (req, res) => {
    const vente = entier(req.params.id) && db.prepare('SELECT * FROM matelas_ventes WHERE id = ?').get(entier(req.params.id));
    if (!vente) throw new Refus(404, 'Cette vente n’existe pas.');
    const motif = texte(req.body.motif, 300);
    if (!motif) throw new Refus(400, 'Indiquez le motif de l’annulation.');
    db.prepare('UPDATE matelas_ventes SET annule = 1, motif_annulation = ? WHERE id = ?').run(motif, vente.id);
    res.redirect(302, '/matelas');
  });
}
