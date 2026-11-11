// Marges : la seule partie de la plateforme qui montre les prix réels d'achat.
// Tout ici est réservé à l'administrateur. Aucune autre page n'affiche ces montants.
import { html, champ, choix, brut } from '../html.js';
import { soldeFournisseur } from '../partenaires.js';
import { reglage, definirReglage } from '../db.js';
import { margeVehicule, transportReelDetail } from '../calc.js';

import { stockMatelas } from '../matelas.js';

const VOITURES_PREVUES = 5; // pour une voiture pas encore dans un conteneur
import { fcfa, won, dateFr } from '../format.js';
import { exigerAdmin } from '../auth.js';
import { Refus, texte, entier, montantObligatoire, montantFacultatif, dateObligatoire, parmi } from '../saisie.js';
import { TYPES, libelleVoiture } from '../libelles.js';

const DESTINATAIRES = [['fournisseur', 'Fournisseur'], ['transporteur', 'Transporteur']];

export function routesMarges(app, { db, horloge }) {
  const taux = () => Number(reglage(db, 'taux_won')) || 0.4365;

  const couts = () => ({
    fretUsd: Number(reglage(db, 'fret_usd')), chargementWon: Number(reglage(db, 'chargement_won')),
    fraisVoitureWon: Number(reglage(db, 'frais_voiture_won')), tauxUsd: Number(reglage(db, 'taux_usd')), tauxWon: taux(),
  });

  app.get('/marges', exigerAdmin, (req, res) => {
    const t = taux();
    const c = couts();
    const lignes = db.prepare(`
      SELECT v.*, c.nom AS client_nom, ct.numero AS ct_numero, ct.frais_coree_won AS ct_frais,
        (SELECT COALESCE(SUM(r.montant), 0) FROM ristournes r WHERE r.vehicule_id = v.id AND r.annule = 0) AS ristournes FROM vehicules v
      LEFT JOIN clients c ON c.id = v.client_id LEFT JOIN conteneurs ct ON ct.id = v.conteneur_id
      WHERE v.annulee = 0 ORDER BY ct.numero IS NULL, ct.numero, v.id`).all();
    // Le fret et le chargement d'un conteneur se partagent entre toutes les voitures à bord, les miennes comprises.
    // Une voiture pas encore embarquée est comptée dans un conteneur de 5 voitures, en attendant.
    const aBord = id => lignes.filter(x => x.conteneur_id === id).length;
    const voitures = lignes.map(v => {
      const nb = v.conteneur_id ? aBord(v.conteneur_id) : VOITURES_PREVUES;
      const origine = v.transport_reel != null ? 'saisi' : !v.conteneur_id ? `prévision : ${nb} voitures`
        : `conteneur de ${nb} voitures${v.ct_frais != null ? ', frais réels' : ''}`;
      return { ...v, origine, m: margeVehicule(v, t, transportReelDetail({ ...c, nbVoitures: nb, fraisConteneurWon: v.ct_frais ?? null })) };
    });
    const ventes = voitures.filter(v => v.type === 'vente');
    const completes = ventes.filter(v => v.m.complet);
    const somme = (liste, f) => liste.reduce((s, x) => s + f(x), 0);
    const envois = db.prepare('SELECT * FROM versements_fournisseur ORDER BY date, id').all();
    // Les envois au transporteur ne comptent pas ici : ils paient ses frais (page Partenaires).
    const { du: achatsWon, paye: envoyeWon } = soldeFournisseur(db);
    const groupes = [...new Set(voitures.map(v => v.ct_numero ?? ''))];
    const matelas = stockMatelas(db).map(l => ({ ...l, total: l.enMer + l.disponible + l.vendus, coutFcfa: Math.round(l.coutWon * t) }));

    const ligne = v => html`<tr>
      <td><a href="/vehicules/${v.id}">${libelleVoiture(v)}</a><br><small class="discret">${v.client_nom ?? TYPES[v.type]}${v.type === 'charge' ? ' (à ma charge)' : ''}</small></td>
      <td class="montant">${v.m.prixClient === null ? '—' : fcfa(v.m.prixClient)}</td>
      <td class="montant">${v.m.achatReel === null ? '—' : html`${fcfa(v.m.achatReel)}${v.achat_reel_won ? html`<br><small class="discret">${won(v.achat_reel_won)}</small>` : ''}`}</td>
      <td class="montant">${v.m.transport === null ? '—' : html`${fcfa(v.m.transport)}<br><small class="discret">${v.origine}</small>`}</td>
      <td class="montant">${v.m.complet ? fcfa(v.m.frais) : '—'}</td>
      <td class="montant">${v.m.complet ? html`${fcfa(v.m.douane)}<br><small class="discret">${v.m.douaneReelle ? 'facture' : 'estimée'}</small>` : '—'}</td>
      <td class="montant">${v.m.complet ? fcfa(v.m.cout) : '—'}</td>
      <td class="montant">${v.m.marge === null ? (v.m.complet ? '—' : html`<span class="etat attention">manque : ${v.m.manque.join(', ')}</span>`) : html`<strong>${fcfa(v.m.marge)}</strong>`}</td>
      <td><form method="post" action="/marges/vehicules/${v.id}" class="saisie-cout">
        <input name="achat_reel_won" value="${v.achat_reel_won ?? ''}" placeholder="achat en wons" aria-label="Prix réel d’achat en wons">
        <input name="achat_reel_fcfa" value="${v.achat_reel_fcfa ?? ''}" placeholder="ou en F CFA" aria-label="Prix réel d’achat en francs CFA">
        <input name="transport_reel" value="${v.transport_reel ?? ''}" placeholder="transport réel" aria-label="Transport réel en francs CFA">
        <button class="bouton secondaire petit">OK</button></form></td>
    </tr>`;

    res.page('Marges', html`
      <p class="note">Page réservée à l’administrateur. Les prix réels d’achat ne s’affichent nulle part ailleurs : ni sur les fiches,
        ni sur les contrats, ni pour le collaborateur.</p>

      <section class="carte"><dl class="fiche">
        <dt>Marge sur les voitures vendues</dt><dd><strong>${fcfa(somme(completes, v => v.m.marge))}</strong>
          — ${completes.length} voiture(s) sur ${ventes.length}${completes.length < ventes.length ? html` <span class="etat attention">${ventes.length - completes.length} à compléter</span>` : ''}</dd>
        <dt>Achats réels en wons</dt><dd>${won(achatsWon)}, soit ${fcfa(Math.round(achatsWon * t))}</dd>
        <dt>Déjà envoyé au fournisseur</dt><dd>${won(envoyeWon)}, soit ${fcfa(Math.round(envoyeWon * t))}</dd>
        <dt>${achatsWon >= envoyeWon ? 'Reste à envoyer' : 'Avance chez le fournisseur'}</dt>
          <dd><strong>${won(Math.abs(achatsWon - envoyeWon))}</strong>, soit ${fcfa(Math.round(Math.abs(achatsWon - envoyeWon) * t))}</dd>
      </dl></section>

      <p class="discret">Marge = prix payé par le client − (achat réel + transport réel + 9 % d’envoi d’argent sur ces deux montants + douane).
        Transport réel d’une voiture = (fret + chargement du conteneur) ÷ nombre de voitures à bord + frais de la voiture en Corée.
        Les 9 % ne portent que sur l’argent envoyé en Corée : ils n’entrent pas dans la douane.
        Jusqu’à la facture du transitaire, la douane est estimée à 55 % de (achat réel + part du fret du conteneur), sans les frais payés en Corée.
        Cette estimation reste à confirmer : la douane taxe la valeur qu’elle retient pour la voiture, pas forcément le prix payé.</p>

      ${groupes.map(numero => {
        const groupe = voitures.filter(v => (v.ct_numero ?? '') === numero);
        const vendues = groupe.filter(v => v.m.marge !== null);
        return html`<h2>${numero ? `Conteneur ${numero}` : 'Pas encore dans un conteneur'}</h2>
        ${numero ? html`<form method="post" action="/marges/conteneurs/${groupe[0].conteneur_id}" class="actions">
          <label for="frais-${groupe[0].conteneur_id}">Frais réels payés en Corée pour ce conteneur (wons)</label>
          <input id="frais-${groupe[0].conteneur_id}" name="frais_coree_won" value="${groupe[0].ct_frais ?? ''}" placeholder="chargement + cartes grises + stickers + km">
          <button class="bouton secondaire petit">OK</button></form>` : ''}
        <div class="defile"><table>
          <thead><tr><th>Voiture</th><th class="montant">Prix client</th><th class="montant">Achat réel</th><th class="montant">Transport</th>
            <th class="montant">Envoi 9 %</th><th class="montant">Douane</th><th class="montant">Coût</th><th class="montant">Marge</th><th>Coûts réels</th></tr></thead>
          <tbody>${groupe.map(ligne)}
          ${vendues.length ? html`<tr class="total"><td colspan="7">Marge du groupe (voitures complètes)</td><td class="montant">${fcfa(somme(vendues, v => v.m.marge))}</td><td></td></tr>` : ''}</tbody>
        </table></div>`;
      })}

      <h2>Matelas</h2>
      <section class="carte"><dl class="fiche">
        <dt>Coût d’achat du stock complet</dt><dd>${won(somme(matelas, l => l.total * l.coutWon))}, soit ${fcfa(somme(matelas, l => l.total * l.coutFcfa))}
          <span class="discret">(${matelas.map(l => `${l.total} × ${l.libelle} à ${won(l.coutWon)}`).join(', ')})</span></dd>
        <dt>Ventes encaissées</dt><dd>${fcfa(somme(matelas, l => l.encaisse))} pour ${somme(matelas, l => l.vendus)} matelas</dd>
        <dt>Marge sur les matelas vendus</dt><dd><strong>${fcfa(somme(matelas, l => l.encaisse - l.vendus * l.coutFcfa))}</strong></dd>
        <dt>Reste à vendre, au prix minimum</dt><dd>${fcfa(somme(matelas, l => (l.total - l.vendus) * l.prixMinimum))} pour ${somme(matelas, l => l.total - l.vendus)} matelas</dd>
      </dl>
      <p class="discret">Coût d’achat seul : le transport et la douane des matelas ne sont pas comptés.</p></section>

      <h2>Taux du won</h2>
      <form method="post" action="/marges/taux" class="carte etroit">
        ${champ('Francs CFA pour 1 won', 'taux', String(t).replace('.', ','), { requis: true, aide: 'Exemple : 0,4365. Tous les prix en wons sont convertis à ce taux.' })}
        <p class="actions"><button class="bouton secondaire">Enregistrer le taux</button></p>
      </form>

      <h2>Coûts réels de transport</h2>
      <form method="post" action="/marges/transport" class="carte"><div class="grille">
        ${champ('Fret d’un conteneur (USD)', 'fret_usd', c.fretUsd, { requis: true })}
        ${champ('Francs CFA pour 1 dollar', 'taux_usd', String(c.tauxUsd).replace('.', ','), { requis: true })}
        ${champ('Chargement d’un conteneur (wons)', 'chargement_won', c.chargementWon, { requis: true })}
        ${champ('Frais par voiture en Corée (wons)', 'frais_voiture_won', c.fraisVoitureWon, { requis: true, aide: 'Carte grise + sticker + kilométrage' })}
      </div><p class="actions"><button class="bouton secondaire">Enregistrer les coûts de transport</button></p></form>

      <h2>Envois d’argent en Corée</h2>
      <p class="discret">Chaque envoi compte dans ce que vous devez à son destinataire. Le partenaire voit la date et le montant, jamais la note.</p>
      ${envois.length ? html`<div class="defile"><table>
        <thead><tr><th>Date</th><th class="montant">Montant</th><th>Destinataire</th><th>Note</th><th></th></tr></thead>
        <tbody>${envois.map(e => html`<tr><td>${dateFr(e.date)}</td><td class="montant">${won(e.montant_won)}</td>
          <td><form method="post" action="/marges/fournisseur/${e.id}/destinataire" class="saisie-cout">
            <select name="destinataire" aria-label="Destinataire de l’envoi">${DESTINATAIRES.map(([code, nom]) =>
              html`<option value="${code}" ${code === e.destinataire ? brut('selected') : ''}>${nom}</option>`)}</select>
            <button class="bouton secondaire petit">OK</button></form></td>
          <td>${e.note ?? ''}</td>
          <td><form method="post" action="/marges/fournisseur/${e.id}/supprimer" data-confirmer="Supprimer cet envoi ?"><button class="bouton danger petit">Supprimer</button></form></td></tr>`)}</tbody>
      </table></div>` : html`<p class="discret">Aucun envoi enregistré.</p>`}
      <form method="post" action="/marges/fournisseur" class="carte"><div class="grille">
        ${champ('Date', 'date', horloge(), { type: 'date', requis: true })}
        ${champ('Montant envoyé (wons)', 'montant_won', '', { requis: true })}
        ${choix('Destinataire', 'destinataire', DESTINATAIRES, 'fournisseur')}
        ${champ('Note (privée)', 'note')}
      </div><p class="actions"><button class="bouton secondaire">Ajouter l’envoi</button></p></form>
    `, { actif: '/marges' });
  });

  app.post('/marges/taux', exigerAdmin, (req, res) => {
    const t = Number(String(req.body.taux ?? '').trim().replace(',', '.'));
    if (!(t > 0.05 && t < 5)) throw new Refus(400, 'Taux illisible. Écrivez par exemple 0,4365 (francs CFA pour 1 won).');
    definirReglage(db, 'taux_won', t);
    res.redirect(302, '/marges');
  });

  app.post('/marges/transport', exigerAdmin, (req, res) => {
    const tauxUsd = Number(String(req.body.taux_usd ?? '').trim().replace(',', '.'));
    if (!(tauxUsd > 100 && tauxUsd < 2000)) throw new Refus(400, 'Taux du dollar illisible. Écrivez par exemple 585 (francs CFA pour 1 dollar).');
    const valeurs = {
      fret_usd: montantObligatoire(req.body.fret_usd, 'Fret du conteneur'),
      chargement_won: montantObligatoire(req.body.chargement_won, 'Chargement du conteneur'),
      frais_voiture_won: montantObligatoire(req.body.frais_voiture_won, 'Frais par voiture'),
      taux_usd: tauxUsd,
    };
    for (const [cle, valeur] of Object.entries(valeurs)) definirReglage(db, cle, valeur); // rien n'est écrit si une valeur est refusée
    res.redirect(302, '/marges');
  });

  // Total réellement payé en Corée pour un conteneur (hors matelas et autres marchandises). Vide = tarif habituel.
  app.post('/marges/conteneurs/:id', exigerAdmin, (req, res) => {
    const id = entier(req.params.id);
    if (!id || !db.prepare('SELECT 1 FROM conteneurs WHERE id = ?').get(id)) throw new Refus(404, 'Ce conteneur n’existe pas.');
    db.prepare('UPDATE conteneurs SET frais_coree_won = ? WHERE id = ?').run(montantFacultatif(req.body.frais_coree_won, 'Frais en Corée'), id);
    res.redirect(302, '/marges');
  });

  app.post('/marges/vehicules/:id', exigerAdmin, (req, res) => {
    const id = entier(req.params.id);
    if (!id || !db.prepare('SELECT 1 FROM vehicules WHERE id = ?').get(id)) throw new Refus(404, 'Cette voiture n’existe pas.');
    db.prepare('UPDATE vehicules SET achat_reel_won = ?, achat_reel_fcfa = ?, transport_reel = ? WHERE id = ?').run(
      montantFacultatif(req.body.achat_reel_won, 'Prix réel en wons'), montantFacultatif(req.body.achat_reel_fcfa, 'Prix réel en francs CFA'),
      montantFacultatif(req.body.transport_reel, 'Transport réel'), id);
    res.redirect(302, '/marges');
  });

  const destinataire = valeur => parmi(String(valeur ?? '').trim() || 'fournisseur', DESTINATAIRES.map(([code]) => code), 'Destinataire');

  app.post('/marges/fournisseur', exigerAdmin, (req, res) => {
    db.prepare('INSERT INTO versements_fournisseur (date, montant_won, note, saisi_par, destinataire) VALUES (?, ?, ?, ?, ?)').run(
      dateObligatoire(req.body.date), montantObligatoire(req.body.montant_won, 'Montant envoyé'), texte(req.body.note, 200),
      req.utilisateur.identifiant, destinataire(req.body.destinataire));
    res.redirect(302, '/marges');
  });

  app.post('/marges/fournisseur/:id/destinataire', exigerAdmin, (req, res) => {
    const id = entier(req.params.id);
    if (!id || !db.prepare('SELECT 1 FROM versements_fournisseur WHERE id = ?').get(id)) throw new Refus(404, 'Cet envoi n’existe pas.');
    db.prepare('UPDATE versements_fournisseur SET destinataire = ? WHERE id = ?').run(destinataire(req.body.destinataire), id);
    res.redirect(302, '/marges');
  });

  app.post('/marges/fournisseur/:id/supprimer', exigerAdmin, (req, res) => {
    db.prepare('DELETE FROM versements_fournisseur WHERE id = ?').run(entier(req.params.id));
    res.redirect(302, '/marges');
  });
}
