import { html, champ, choix } from '../html.js';
import { transaction } from '../db.js';
import { compteClient } from '../compte.js';
import { prixVehicule } from '../calc.js';
import { msgRistourne } from '../messages.js';
import { lienWhatsApp } from '../telephone.js';
import { emettreRecu } from '../documents.js';
import { fcfa, dateFr } from '../format.js';
import { exigerAdmin } from '../auth.js';
import { Refus, texte, entier, montantObligatoire, dateObligatoire, parmi } from '../saisie.js';
import { MODES_PAIEMENT, NATURES_PENALITE, libelleMode, libelleNature, libelleVoiture } from '../libelles.js';

// Ce qu'il reste à appliquer du malus calculé sur une échéance en retard.
export function malusRestant(db, clientId, ligne) {
  const deja = db.prepare(`SELECT COALESCE(SUM(montant), 0) AS total FROM penalites
    WHERE client_id = ? AND nature = 'malus' AND annule = 0 AND ligne = ? AND conteneur_id IS ?`)
    .get(clientId, ligne.type, ligne.conteneurId).total;
  return Math.max(0, ligne.malus - deja);
}

// Ce qu'il est encore possible de rendre au client sur la douane de cette voiture : douane facturée − douane réelle
// − ristournes déjà accordées. null si la voiture est au forfait ou si la facture du transitaire n'est pas saisie.
export function ristournePossible(db, v) {
  const prix = prixVehicule(v);
  if (prix.forfait || prix.douane <= 0 || v.douane_reelle == null) return null;
  const deja = db.prepare('SELECT COALESCE(SUM(montant), 0) AS total FROM ristournes WHERE vehicule_id = ? AND annule = 0').get(v.id).total;
  return Math.max(0, prix.douane - v.douane_reelle - deja);
}

export function routesArgent(app, { db, horloge }) {
  const recents = new Map(); // mouvements saisis dans la dernière minute, pour refuser les doublons
  const client = req => {
    const id = entier(req.params.id);
    const c = id && db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!c) throw new Refus(404, 'Ce client n’existe pas.');
    return c;
  };
  const motif = req => {
    const m = texte(req.body.motif, 300);
    if (!m) throw new Refus(400, 'Indiquez le motif de l’annulation.');
    return m;
  };

  app.post('/clients/:id/mouvements', (req, res) => {
    const c = client(req);
    const m = {
      client_id: c.id,
      sens: parmi(req.body.sens, ['entree', 'sortie'], 'Nature du mouvement'),
      montant: montantObligatoire(req.body.montant, 'Montant'),
      date: dateObligatoire(req.body.date),
      mode: parmi(req.body.mode, MODES_PAIEMENT.map(([code]) => code), 'Mode de paiement'),
      reference: texte(req.body.reference, 120), note: texte(req.body.note, 300),
      avec_frais: req.body.avec_frais === '1' ? 1 : 0,
      saisi_par: req.utilisateur.identifiant, saisi_le: horloge(),
    };
    if (m.sens === 'sortie') {
      const recuNet = compteClient(db, c.id, horloge()).recu;
      if (m.montant > recuNet) throw new Refus(400, `On ne peut pas rembourser plus que ce que le client a versé (${fcfa(Math.max(0, recuNet))}).`);
    }
    // Double clic ou page renvoyée : le même mouvement, par la même personne, dans la même minute.
    const empreinte = [req.utilisateur.id, c.id, m.sens, m.montant, m.date, m.mode].join('|');
    const maintenant = Date.now();
    if (maintenant - (recents.get(empreinte) ?? 0) < 60000)
      throw new Refus(409, 'Ce mouvement vient d’être enregistré. S’il y en a vraiment un deuxième identique, attendez une minute avant de le saisir.');
    if (recents.size > 500) recents.clear();
    recents.set(empreinte, maintenant);
    const recu = transaction(db, () => {
      const id = Number(db.prepare(`
        INSERT INTO mouvements (client_id, sens, montant, date, mode, reference, avec_frais, note, saisi_par, saisi_le)
        VALUES (:client_id, :sens, :montant, :date, :mode, :reference, :avec_frais, :note, :saisi_par, :saisi_le)`).run(m).lastInsertRowid);
      return m.sens === 'entree' ? emettreRecu(db, id, req.utilisateur, horloge()) : null;
    });
    res.redirect(302, recu ? `/documents/${recu.id}` : `/clients/${c.id}`);
  });

  app.post('/mouvements/:id/annuler', exigerAdmin, (req, res) => {
    const m = entier(req.params.id) && db.prepare('SELECT * FROM mouvements WHERE id = ?').get(entier(req.params.id));
    if (!m) throw new Refus(404, 'Ce mouvement n’existe pas.');
    if (m.annule) throw new Refus(409, 'Ce mouvement est déjà annulé.');
    db.prepare('UPDATE mouvements SET annule = 1, motif_annulation = ?, annule_par = ?, annule_le = ? WHERE id = ?')
      .run(motif(req), req.utilisateur.identifiant, horloge(), m.id);
    res.redirect(302, `/clients/${m.client_id}`);
  });

  app.post('/clients/:id/penalites', (req, res) => {
    const c = client(req);
    const nature = parmi(req.body.nature, NATURES_PENALITE.map(([code]) => code), 'Nature du frais');
    const montant = montantObligatoire(req.body.montant, 'Montant');
    const date = dateObligatoire(req.body.date);
    let voiture = null;
    if (String(req.body.vehicule_id ?? '').trim() !== '') {
      voiture = db.prepare('SELECT id, conteneur_id FROM vehicules WHERE id = ? AND client_id = ?').get(entier(req.body.vehicule_id), c.id);
      if (!voiture) throw new Refus(400, 'Cette voiture n’appartient pas à ce client.');
    }
    db.prepare(`INSERT INTO penalites (client_id, vehicule_id, conteneur_id, nature, montant, date, motif, justificatif, saisi_par)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(c.id, voiture?.id ?? null, voiture?.conteneur_id ?? null, nature, montant, date,
        texte(req.body.motif, 300), texte(req.body.justificatif, 200), req.utilisateur.identifiant);
    res.redirect(302, `/clients/${c.id}`);
  });

  app.post('/penalites/:id/annuler', exigerAdmin, (req, res) => {
    const p = entier(req.params.id) && db.prepare('SELECT * FROM penalites WHERE id = ?').get(entier(req.params.id));
    if (!p) throw new Refus(404, 'Cette pénalité n’existe pas.');
    if (p.annule) throw new Refus(409, 'Cette pénalité est déjà annulée.');
    db.prepare('UPDATE penalites SET annule = 1, motif_annulation = ? WHERE id = ?').run(motif(req), p.id);
    res.redirect(302, `/clients/${p.client_id}`);
  });

  // Ristourne : quand la facture du transitaire est plus basse que la douane facturée au client,
  // l'administrateur peut lui en rendre une partie. Jamais plus que l'écart réel.
  app.post('/vehicules/:id/ristourne', exigerAdmin, (req, res) => {
    const v = entier(req.params.id) && db.prepare("SELECT * FROM vehicules WHERE id = ? AND type = 'vente' AND annulee = 0").get(entier(req.params.id));
    if (!v) throw new Refus(404, 'Cette voiture n’existe pas.');
    const montant = montantObligatoire(req.body.montant, 'Ristourne');
    const possible = ristournePossible(db, v);
    if (possible === null) throw new Refus(400, 'Pas de ristourne possible : il faut une douane détaillée dans le prix et la facture du transitaire saisie.');
    if (montant > possible) throw new Refus(400, `La ristourne ne peut pas dépasser l’écart restant sur la douane : ${fcfa(possible)}.`);
    db.prepare('INSERT INTO ristournes (client_id, vehicule_id, montant, date, motif, saisi_par) VALUES (?, ?, ?, ?, ?, ?)')
      .run(v.client_id, v.id, montant, horloge(), texte(req.body.motif, 300), req.utilisateur.identifiant);
    res.redirect(302, `/clients/${v.client_id}`);
  });

  app.post('/ristournes/:id/annuler', exigerAdmin, (req, res) => {
    const r = entier(req.params.id) && db.prepare('SELECT * FROM ristournes WHERE id = ?').get(entier(req.params.id));
    if (!r) throw new Refus(404, 'Cette ristourne n’existe pas.');
    if (r.annule) throw new Refus(409, 'Cette ristourne est déjà annulée.');
    db.prepare('UPDATE ristournes SET annule = 1, motif_annulation = ? WHERE id = ?').run(motif(req), r.id);
    res.redirect(302, `/clients/${r.client_id}`);
  });

  // Le malus est calculé par la plateforme, mais c'est l'administrateur qui décide de l'appliquer, en tout ou en partie.
  app.post('/clients/:id/malus', exigerAdmin, (req, res) => {
    const c = client(req);
    const type = parmi(req.body.ligne, ['solde', 'douane'], 'Échéance');
    const conteneurId = entier(req.body.conteneur_id);
    const montant = montantObligatoire(req.body.montant, 'Malus');
    const ligne = compteClient(db, c.id, horloge()).lignes
      .find(l => l.type === type && l.conteneurId === conteneurId && l.etat === 'en_retard');
    if (!ligne) throw new Refus(400, 'Cette échéance n’est pas en retard : aucun malus à appliquer.');
    const restant = malusRestant(db, c.id, ligne);
    if (montant > restant) throw new Refus(400, `Le malus restant à appliquer est de ${fcfa(restant)} au plus.`);
    db.prepare(`INSERT INTO penalites (client_id, conteneur_id, nature, ligne, montant, date, motif, saisi_par)
      VALUES (?, ?, 'malus', ?, ?, ?, ?, ?)`)
      .run(c.id, conteneurId, type, montant, horloge(), `${ligne.joursRetard} jour(s) de retard`, req.utilisateur.identifiant);
    res.redirect(302, `/clients/${c.id}`);
  });
}

// Les parties « argent » de la fiche client.
export function sectionsArgent(db, compte, utilisateur, aujourdhui) {
  const id = compte.client.id;
  const admin = utilisateur.role === 'admin';
  const mouvements = db.prepare(`
    SELECT m.*, d.id AS doc_id, d.numero AS doc_numero FROM mouvements m
    LEFT JOIN documents d ON d.mouvement_id = m.id WHERE m.client_id = ? ORDER BY m.date, m.id`).all(id);
  const penalites = db.prepare('SELECT * FROM penalites WHERE client_id = ? ORDER BY date, id').all(id);
  const ristournes = db.prepare(`SELECT r.*, v.marque, v.modele, v.version, v.annee FROM ristournes r
    JOIN vehicules v ON v.id = r.vehicule_id WHERE r.client_id = ? ORDER BY r.date, r.id`).all(id);
  const eligibles = compte.vehicules.map(v => ({ ...v, possible: ristournePossible(db, v) })).filter(v => v.possible > 0);
  // Le message annonce le geste et ce qui reste à payer ; il ne cite aucun montant de douane.
  const annonce = r => {
    const message = msgRistourne({ nom: compte.client.nom, vehicules: libelleVoiture(r), montant: r.montant, reste: compte.reste });
    const lien = lienWhatsApp(compte.client.telephone, message);
    return html`${lien ? html`<a class="bouton petit" href="${lien}" target="_blank" rel="noopener">Annoncer par WhatsApp</a>` : ''}
      <button type="button" class="bouton secondaire petit" data-copier="${message}">Copier le message</button>`;
  };

  const annuler = (action, question) => html`<form method="post" action="${action}" class="actions" data-confirmer="${question}">
    <input name="motif" placeholder="Motif de l’annulation" required aria-label="Motif de l’annulation">
    <button class="bouton danger petit">Annuler</button></form>`;

  return html`
    <h2>Versements et remboursements</h2>
    ${mouvements.length ? html`<div class="defile"><table>
      <thead><tr><th>Date</th><th>Nature</th><th class="montant">Montant</th><th>Mode</th><th>Détail</th><th>Saisi par</th><th>Reçu</th>${admin ? html`<th></th>` : ''}</tr></thead>
      <tbody>${mouvements.map(m => html`<tr class="${m.annule ? 'annule' : ''}">
        <td>${dateFr(m.date)}</td>
        <td>${m.sens === 'entree' ? 'Versement reçu' : 'Remboursement au client'}</td>
        <td class="montant">${m.sens === 'sortie' ? '−' : ''}${fcfa(m.montant)}</td>
        <td>${libelleMode(m.mode)}${m.avec_frais ? ' — avec frais' : ''}</td>
        <td class="clair">${[m.reference, m.note].filter(Boolean).join(' — ')}${m.annule ? html` <strong>Annulé : ${m.motif_annulation}</strong>` : ''}</td>
        <td>${m.saisi_par}</td>
        <td class="clair">${m.doc_id ? html`<a href="/documents/${m.doc_id}">${m.doc_numero}</a>` : '—'}</td>
        ${admin ? html`<td class="clair">${m.annule ? '' : annuler(`/mouvements/${m.id}/annuler`, 'Annuler ce mouvement ?')}</td>` : ''}
      </tr>`)}</tbody>
    </table></div>` : html`<p class="discret">Aucun versement enregistré.</p>`}

    <form method="post" action="/clients/${id}/mouvements" class="carte">
      <p class="note">Entrez la somme réellement reçue. 5 000 000 avec frais = 5 450 000 reçus.</p>
      <div class="grille">
        ${choix('Nature', 'sens', [['entree', 'Versement reçu du client'], ['sortie', 'Remboursement au client']])}
        ${champ('Somme (F)', 'montant', '', { requis: true })}
        ${champ('Date', 'date', aujourdhui, { type: 'date', requis: true })}
        ${choix('Mode de paiement', 'mode', MODES_PAIEMENT)}
        ${champ('Référence', 'reference', '', { aide: 'N° de transaction, de chèque…' })}
        ${choix('Frais de 90 000 F par million', 'avec_frais', [['0', 'Sans frais'], ['1', 'Avec frais (compris dans la somme)']])}
        ${champ('Note', 'note')}
      </div>
      <p class="actions"><button class="bouton">Enregistrer</button></p>
    </form>

    <h2>Pénalités et malus de retard</h2>
    ${penalites.length ? html`<div class="defile"><table>
      <thead><tr><th>Date</th><th>Nature</th><th class="montant">Montant</th><th>Motif</th><th>Justificatif</th><th>Saisi par</th>${admin ? html`<th></th>` : ''}</tr></thead>
      <tbody>${penalites.map(p => html`<tr class="${p.annule ? 'annule' : ''}">
        <td>${dateFr(p.date)}</td><td>${libelleNature(p.nature)}</td><td class="montant">${fcfa(p.montant)}</td>
        <td class="clair">${p.motif ?? ''}${p.annule ? html` <strong>Annulée : ${p.motif_annulation}</strong>` : ''}</td>
        <td>${p.justificatif ?? ''}</td><td>${p.saisi_par}</td>
        ${admin ? html`<td class="clair">${p.annule ? '' : annuler(`/penalites/${p.id}/annuler`, 'Annuler cette pénalité ?')}</td>` : ''}
      </tr>`)}</tbody>
    </table></div>` : html`<p class="discret">Aucune pénalité.</p>`}

    <form method="post" action="/clients/${id}/penalites" class="carte">
      <p class="discret">Frais causés par le retard de ce client : ils s’ajoutent à ce qu’il doit.</p>
      <div class="grille">
        ${choix('Nature du frais', 'nature', NATURES_PENALITE)}
        ${champ('Montant (F)', 'montant', '', { requis: true })}
        ${champ('Date', 'date', aujourdhui, { type: 'date', requis: true })}
        ${choix('Voiture concernée', 'vehicule_id', [['', '—'], ...compte.vehicules.map(v => [v.id, libelleVoiture(v)])])}
        ${champ('Motif', 'motif')}
        ${champ('Justificatif', 'justificatif', '', { aide: 'N° de facture du port ou du transitaire' })}
      </div>
      <p class="actions"><button class="bouton secondaire">Ajouter la pénalité</button></p>
    </form>

    ${ristournes.length || (admin && eligibles.length) ? html`<h2>Ristournes sur la douane</h2>
    ${ristournes.length ? html`<div class="defile"><table>
      <thead><tr><th>Date</th><th>Voiture</th><th class="montant">Montant</th><th>Motif</th><th>Accordée par</th><th></th></tr></thead>
      <tbody>${ristournes.map(r => html`<tr class="${r.annule ? 'annule' : ''}">
        <td>${dateFr(r.date)}</td><td>${libelleVoiture(r)}</td><td class="montant">${fcfa(r.montant)}</td>
        <td class="clair">${r.motif ?? ''}${r.annule ? html` <strong>Annulée : ${r.motif_annulation}</strong>` : ''}</td><td>${r.saisi_par}</td>
        <td class="clair">${r.annule ? '' : html`<div class="actions">${annonce(r)}
          ${admin ? annuler(`/ristournes/${r.id}/annuler`, 'Annuler cette ristourne ?') : ''}</div>`}</td>
      </tr>`)}</tbody>
    </table></div>` : ''}
    ${admin ? eligibles.map(v => html`<form method="post" action="/vehicules/${v.id}/ristourne" class="carte"
      data-confirmer="Accorder cette ristourne ? Elle baisse ce que le client doit encore.">
      <p>${libelleVoiture(v)} : douane facturée ${fcfa(v.prix.douane)}, facture du transitaire ${fcfa(v.douane_reelle)}.
        Écart encore disponible : <strong>${fcfa(v.possible)}</strong>.</p>
      <div class="grille">${champ('Ristourne (F)', 'montant', v.possible, { requis: true })}${champ('Motif', 'motif')}</div>
      <p class="actions"><button class="bouton secondaire">Accorder la ristourne</button></p>
    </form>`) : ''}` : ''}`;
}
