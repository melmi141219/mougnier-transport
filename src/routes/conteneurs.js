import { html, champ, choix } from '../html.js';
import { transaction } from '../db.js';
import { prixVehicule } from '../calc.js';
import { fcfa, dateFr, parseMontant } from '../format.js';
import { exigerAdmin } from '../auth.js';
import { Refus, texte, entier, montantObligatoire, dateObligatoire, dateFacultative } from '../saisie.js';
import { RANG_STATUT, TYPES, libelleStatut, libelleVoiture } from '../libelles.js';
import { documentsDuConteneur, SCRIPT_DEPOT } from './partenaires.js';

function lienHttps(lien) {
  try { return new URL(lien).protocol === 'https:'; } catch { return false; }
}

export function routesConteneurs(app, { db, horloge }) {
  const trouver = req => {
    const id = entier(req.params.id);
    const ct = id && db.prepare('SELECT * FROM conteneurs WHERE id = ?').get(id);
    if (!ct) throw new Refus(404, 'Ce conteneur n’existe pas.');
    return ct;
  };

  const lire = corps => {
    const numero = String(corps.numero ?? '').replace(/\s/g, '').toUpperCase().slice(0, 20);
    if (!numero) throw new Refus(400, 'Le numéro du conteneur est obligatoire.');
    const lien = texte(corps.lien_suivi, 500);
    if (lien && !lienHttps(lien)) throw new Refus(400, 'Le lien de suivi doit commencer par https://');
    return {
      numero, bl: texte(corps.bl, 40), reservation: texte(corps.reservation, 40), navire: texte(corps.navire, 80),
      lien_suivi: lien, eta: dateFacultative(corps.eta, 'Date d’arrivée prévue'), notes: texte(corps.notes, 1000),
    };
  };

  const numeroLibre = (numero, saufId = 0) => {
    if (db.prepare('SELECT 1 FROM conteneurs WHERE numero = ? AND id <> ?').get(numero, saufId))
      throw new Refus(409, `Le conteneur ${numero} existe déjà.`);
  };

  const noterEta = (conteneurId, ancienne, nouvelle, utilisateur) => {
    if (ancienne !== nouvelle) db.prepare('INSERT INTO eta_historique (conteneur_id, ancienne, nouvelle, modifie_le, par) VALUES (?, ?, ?, ?, ?)')
      .run(conteneurId, ancienne, nouvelle, horloge(), utilisateur.identifiant);
  };

  // Fait avancer les voitures à bord jusqu'à ce statut. Une voiture déjà plus loin ne recule pas.
  const avancer = (conteneurId, statut, date, utilisateur) => {
    for (const v of db.prepare('SELECT id, statut FROM vehicules WHERE conteneur_id = ? AND annulee = 0').all(conteneurId)) {
      if (RANG_STATUT[v.statut] >= RANG_STATUT[statut]) continue;
      db.prepare('UPDATE vehicules SET statut = ? WHERE id = ?').run(statut, v.id);
      db.prepare('INSERT INTO etapes (vehicule_id, statut, date, par) VALUES (?, ?, ?, ?)').run(v.id, statut, date, utilisateur.identifiant);
    }
  };

  const champsConteneur = ct => html`<div class="grille">
    ${champ('Numéro du conteneur', 'numero', ct.numero, { requis: true, aide: 'Exemple : TSTU0000003' })}
    ${champ('Connaissement (BL)', 'bl', ct.bl)}
    ${champ('Réservation', 'reservation', ct.reservation)}
    ${champ('Navire et voyage', 'navire', ct.navire)}
    ${champ('Lien de suivi', 'lien_suivi', ct.lien_suivi, { type: 'url', aide: 'Collez le lien de la page de suivi MSC (https://…)' })}
    ${champ('Arrivée prévue à Libreville', 'eta', ct.eta, { type: 'date' })}
    ${champ('Notes', 'notes', ct.notes)}
  </div>`;

  app.get('/conteneurs', (req, res) => {
    const liste = db.prepare(`SELECT ct.*, (SELECT COUNT(*) FROM vehicules v WHERE v.conteneur_id = ct.id AND v.annulee = 0) AS nb
      FROM conteneurs ct ORDER BY COALESCE(ct.date_arrivee, ct.eta, '9999') DESC, ct.id DESC`).all();
    res.page('Conteneurs', html`
      <p class="actions"><a class="bouton" href="/conteneurs/nouveau">Nouveau conteneur</a></p>
      <div class="defile"><table>
        <thead><tr><th>Conteneur</th><th>Navire</th><th>Voitures</th><th>Départ</th><th>Arrivée prévue</th><th>Arrivée</th></tr></thead>
        <tbody>${liste.map(ct => html`<tr>
          <td><a href="/conteneurs/${ct.id}">${ct.numero}</a></td><td>${ct.navire ?? '—'}</td><td>${ct.nb}</td>
          <td>${dateFr(ct.date_depart) || '—'}</td><td>${dateFr(ct.eta) || 'à saisir'}</td><td>${dateFr(ct.date_arrivee) || '—'}</td>
        </tr>`)}</tbody>
      </table></div>`, { actif: '/conteneurs' });
  });

  app.get('/conteneurs/nouveau', (req, res) => res.page('Nouveau conteneur', html`
    <form method="post" action="/conteneurs" class="carte">${champsConteneur({})}
      <p class="actions"><button class="bouton">Enregistrer</button></p></form>`, { actif: '/conteneurs' }));

  app.post('/conteneurs', (req, res) => {
    const ct = lire(req.body);
    numeroLibre(ct.numero);
    const id = transaction(db, () => {
      const nouveau = Number(db.prepare(`INSERT INTO conteneurs (numero, bl, reservation, navire, lien_suivi, eta, notes)
        VALUES (:numero, :bl, :reservation, :navire, :lien_suivi, :eta, :notes)`).run(ct).lastInsertRowid);
      noterEta(nouveau, null, ct.eta, req.utilisateur);
      return nouveau;
    });
    res.redirect(302, `/conteneurs/${id}`);
  });

  app.get('/conteneurs/:id', (req, res) => {
    const ct = trouver(req);
    const aBord = db.prepare(`SELECT v.*, c.nom AS client_nom FROM vehicules v LEFT JOIN clients c ON c.id = v.client_id
      WHERE v.conteneur_id = ? AND v.annulee = 0 ORDER BY v.id`).all(ct.id).map(v => {
      const estimee = prixVehicule(v).douaneEstimee;
      // Le prix client est fixe : l'écart entre la douane prévue et la douane réelle est pour Eric.
      const gain = v.type === 'vente' && estimee !== null && v.douane_reelle !== null ? estimee - v.douane_reelle : null;
      return { ...v, estimee, gain };
    });
    const gains = aBord.filter(v => v.gain !== null);
    const libres = db.prepare(`SELECT v.*, c.nom AS client_nom FROM vehicules v LEFT JOIN clients c ON c.id = v.client_id
      WHERE v.conteneur_id IS NULL AND v.annulee = 0 AND v.statut <> 'remise' ORDER BY v.id`).all();
    const historique = db.prepare('SELECT * FROM eta_historique WHERE conteneur_id = ? ORDER BY id').all(ct.id);
    const pour = v => (v.client_id ? html`<a href="/clients/${v.client_id}">${v.client_nom}</a>${v.type === 'charge' ? ' (à ma charge)' : ''}` : TYPES[v.type]);

    res.page(`Conteneur ${ct.numero}`, html`
      <section class="carte"><dl class="fiche">
        <dt>Navire</dt><dd>${ct.navire ?? '—'}</dd>
        <dt>Connaissement</dt><dd>${ct.bl ?? '—'}${ct.reservation ? ` — réservation ${ct.reservation}` : ''}</dd>
        <dt>Trajet</dt><dd>${ct.port_chargement} → ${ct.port_arrivee}</dd>
        <dt>Suivi</dt><dd>${ct.lien_suivi ? html`<a href="${ct.lien_suivi}" target="_blank" rel="noopener">Ouvrir le suivi du conteneur</a>` : 'lien à saisir'}</dd>
        <dt>Départ</dt><dd>${dateFr(ct.date_depart) || '—'}</dd>
        <dt>Arrivée prévue</dt><dd>${dateFr(ct.eta) || 'à saisir'}</dd>
        <dt>Arrivée</dt><dd>${dateFr(ct.date_arrivee) || '—'}</dd>
        <dt>Facture du transitaire</dt><dd>${ct.date_facture ? `${fcfa(ct.facture_transitaire)} le ${dateFr(ct.date_facture)}` : '—'}</dd>
        ${ct.notes ? html`<dt>Notes</dt><dd>${ct.notes}</dd>` : ''}
      </dl></section>

      <h2>Voitures à bord</h2>
      <div class="defile"><table>
        <thead><tr><th>Voiture</th><th>Pour</th><th>N° de châssis</th><th>Statut</th><th class="montant">Douane prévue</th><th class="montant">Douane réelle</th><th class="montant">Gain ou perte</th><th></th></tr></thead>
        <tbody>${aBord.map(v => html`<tr>
          <td><a href="/vehicules/${v.id}">${libelleVoiture(v)}</a></td><td>${pour(v)}</td><td>${v.chassis ?? '—'}</td><td>${libelleStatut(v.statut)}</td>
          <td class="montant">${v.estimee === null ? '—' : fcfa(v.estimee)}</td>
          <td class="montant">${v.douane_reelle === null ? '—' : fcfa(v.douane_reelle)}</td>
          <td class="montant">${v.gain === null ? '—' : fcfa(v.gain)}</td>
          <td><form method="post" action="/conteneurs/${ct.id}/voitures/${v.id}/retirer" data-confirmer="Retirer cette voiture du conteneur ?"><button class="bouton secondaire petit">Retirer</button></form></td>
        </tr>`)}
        ${gains.length ? html`<tr class="total"><td colspan="6">Gain ou perte sur la douane (voitures vendues)</td><td class="montant">${fcfa(gains.reduce((s, v) => s + v.gain, 0))}</td><td></td></tr>` : ''}
        </tbody>
      </table></div>
      ${libres.length ? html`<form method="post" action="/conteneurs/${ct.id}/voitures" class="carte">
        ${choix('Ajouter une voiture à ce conteneur', 'vehicule_id', libres.map(v => [v.id, `${libelleVoiture(v)} — ${v.client_nom ?? TYPES[v.type]}`]))}
        <p class="actions"><button class="bouton secondaire">Ajouter</button></p></form>` : ''}

      <h2>Suivi du voyage</h2>
      <div class="grille">
        <form method="post" action="/conteneurs/${ct.id}/depart" class="carte" data-confirmer="Enregistrer le DÉPART du navire ? Les voitures à bord passent « en mer ».">
          ${champ('Le navire est parti le', 'date', ct.date_depart ?? horloge(), { type: 'date', requis: true })}
          <p class="actions"><button class="bouton secondaire">Enregistrer le départ</button></p></form>
        <form method="post" action="/conteneurs/${ct.id}/arrivee" class="carte" data-confirmer="Enregistrer l’ARRIVÉE à Libreville ? Les soldes deviennent à payer et les clients sont à prévenir.">
          ${champ('Le navire est arrivé le', 'date', ct.date_arrivee ?? horloge(), { type: 'date', requis: true })}
          <p class="actions"><button class="bouton secondaire">Enregistrer l’arrivée</button></p></form>
      </div>
      ${req.utilisateur.role === 'admin' && (ct.date_arrivee || ct.date_facture) ? html`<div class="actions">
        ${ct.date_facture ? html`<form method="post" action="/conteneurs/${ct.id}/facture/annuler" data-confirmer="Annuler la facture du transitaire ? Les parts de douane saisies sont effacées.">
          <button class="bouton danger petit">Annuler la facture du transitaire</button></form>`
        : html`<form method="post" action="/conteneurs/${ct.id}/arrivee/annuler" data-confirmer="Annuler l’arrivée ? Les voitures repassent « en mer » et les annonces d’arrivée sont retirées.">
          <button class="bouton danger petit">Annuler l’arrivée (saisie par erreur)</button></form>`}
      </div>` : ''}
      ${historique.length ? html`<p class="discret">Dates d’arrivée prévues successives :
        ${historique.map(h => `${dateFr(h.nouvelle) || 'aucune'} (saisie le ${dateFr(h.modifie_le)} par ${h.par})`).join(' → ')}</p>` : ''}

      <h2>Facture du transitaire</h2>
      <form method="post" action="/conteneurs/${ct.id}/facture" class="carte" data-confirmer="Enregistrer la facture du transitaire ? La douane devient à payer pour les clients concernés.">
        <p class="discret">Entrez le total de la facture, puis la part de chaque voiture. Les parts doivent faire le total.
          Les clients concernés sont ensuite à prévenir pour la douane.</p>
        <div class="grille">
          ${champ('Date de la facture', 'date', ct.date_facture ?? horloge(), { type: 'date', requis: true })}
          ${champ('Total de la facture (F)', 'montant', ct.facture_transitaire ?? '', { requis: true })}
          ${aBord.map(v => champ(`${libelleVoiture(v)} (F)`, `douane_${v.id}`, v.douane_reelle ?? v.estimee ?? '', { requis: true }))}
        </div>
        <p class="actions"><button class="bouton">Enregistrer la facture</button></p>
      </form>

      <h2>Documents de transport</h2>
      ${documentsDuConteneur(db, ct, `/conteneurs/${ct.id}`)}
      ${SCRIPT_DEPOT}

      <h2>Modifier le conteneur</h2>
      <form method="post" action="/conteneurs/${ct.id}" class="carte">${champsConteneur(ct)}
        <p class="actions"><button class="bouton">Enregistrer</button></p></form>
    `, { actif: '/conteneurs' });
  });

  app.post('/conteneurs/:id', (req, res) => {
    const ancien = trouver(req);
    const ct = lire(req.body);
    numeroLibre(ct.numero, ancien.id);
    transaction(db, () => {
      db.prepare(`UPDATE conteneurs SET numero = :numero, bl = :bl, reservation = :reservation, navire = :navire,
        lien_suivi = :lien_suivi, eta = :eta, notes = :notes WHERE id = :id`).run({ ...ct, id: ancien.id });
      noterEta(ancien.id, ancien.eta, ct.eta, req.utilisateur);
    });
    res.redirect(302, `/conteneurs/${ancien.id}`);
  });

  app.post('/conteneurs/:id/voitures', (req, res) => {
    const ct = trouver(req);
    const v = entier(req.body.vehicule_id) && db.prepare('SELECT id, statut FROM vehicules WHERE id = ? AND annulee = 0').get(entier(req.body.vehicule_id));
    if (!v) throw new Refus(400, 'Choisissez une voiture à ajouter.');
    transaction(db, () => {
      db.prepare('UPDATE vehicules SET conteneur_id = ? WHERE id = ?').run(ct.id, v.id);
      if (RANG_STATUT[v.statut] < RANG_STATUT.chargee) {
        db.prepare("UPDATE vehicules SET statut = 'chargee' WHERE id = ?").run(v.id);
        db.prepare("INSERT INTO etapes (vehicule_id, statut, date, par) VALUES (?, 'chargee', ?, ?)").run(v.id, horloge(), req.utilisateur.identifiant);
      }
    });
    res.redirect(302, `/conteneurs/${ct.id}`);
  });

  app.post('/conteneurs/:id/voitures/:voiture/retirer', (req, res) => {
    const ct = trouver(req);
    db.prepare('UPDATE vehicules SET conteneur_id = NULL WHERE id = ? AND conteneur_id = ?').run(entier(req.params.voiture), ct.id);
    res.redirect(302, `/conteneurs/${ct.id}`);
  });

  app.post('/conteneurs/:id/depart', (req, res) => {
    const ct = trouver(req);
    const date = dateObligatoire(req.body.date, 'Date de départ');
    transaction(db, () => {
      db.prepare('UPDATE conteneurs SET date_depart = ? WHERE id = ?').run(date, ct.id);
      avancer(ct.id, 'en_mer', date, req.utilisateur);
    });
    res.redirect(302, `/conteneurs/${ct.id}`);
  });

  app.post('/conteneurs/:id/arrivee', (req, res) => {
    const ct = trouver(req);
    const date = dateObligatoire(req.body.date, 'Date d’arrivée');
    transaction(db, () => {
      db.prepare('UPDATE conteneurs SET date_arrivee = ? WHERE id = ?').run(date, ct.id);
      avancer(ct.id, 'arrivee', date, req.utilisateur);
    });
    res.redirect(302, `/conteneurs/${ct.id}`);
  });

  // Arrivée ou facture enregistrée par erreur : l'administrateur revient en arrière, et les délais de paiement
  // que ces événements avaient lancés (messages marqués envoyés) sont retirés avec eux.
  const reculer = (conteneurId, de, vers) =>
    db.prepare('UPDATE vehicules SET statut = ? WHERE conteneur_id = ? AND statut = ?').run(vers, conteneurId, de);

  app.post('/conteneurs/:id/arrivee/annuler', exigerAdmin, (req, res) => {
    const ct = trouver(req);
    if (ct.date_facture) throw new Refus(409, 'Annulez d’abord la facture du transitaire.');
    transaction(db, () => {
      db.prepare('UPDATE conteneurs SET date_arrivee = NULL WHERE id = ?').run(ct.id);
      reculer(ct.id, 'arrivee', ct.date_depart ? 'en_mer' : 'chargee');
      db.prepare("DELETE FROM relances WHERE conteneur_id = ? AND type IN ('arrivee', 'groupe_arrivee', 'retard')").run(ct.id);
    });
    res.redirect(302, `/conteneurs/${ct.id}`);
  });

  app.post('/conteneurs/:id/facture/annuler', exigerAdmin, (req, res) => {
    const ct = trouver(req);
    transaction(db, () => {
      db.prepare('UPDATE conteneurs SET date_facture = NULL, facture_transitaire = NULL WHERE id = ?').run(ct.id);
      db.prepare('UPDATE vehicules SET douane_reelle = NULL WHERE conteneur_id = ?').run(ct.id);
      reculer(ct.id, 'dedouanee', ct.date_arrivee ? 'arrivee' : 'en_mer');
      db.prepare("DELETE FROM relances WHERE conteneur_id = ? AND type = 'douane'").run(ct.id);
    });
    res.redirect(302, `/conteneurs/${ct.id}`);
  });

  app.post('/conteneurs/:id/facture', (req, res) => {
    const ct = trouver(req);
    const date = dateObligatoire(req.body.date, 'Date de la facture');
    const total = montantObligatoire(req.body.montant, 'Total de la facture');
    const parts = db.prepare('SELECT id, marque, modele FROM vehicules WHERE conteneur_id = ? AND annulee = 0').all(ct.id).map(v => {
      const saisi = String(req.body[`douane_${v.id}`] ?? '').trim();
      const part = /^0+$/.test(saisi) ? 0 : parseMontant(saisi);
      if (part === null) throw new Refus(400, `Part de douane illisible pour ${v.marque} ${v.modele}.`);
      return { id: v.id, part };
    });
    const somme = parts.reduce((s, p) => s + p.part, 0);
    if (somme !== total)
      throw new Refus(400, `Les parts font ${fcfa(somme)}, mais la facture fait ${fcfa(total)}. Rien n’a été enregistré.`);
    transaction(db, () => {
      db.prepare('UPDATE conteneurs SET date_facture = ?, facture_transitaire = ? WHERE id = ?').run(date, total, ct.id);
      for (const p of parts) db.prepare('UPDATE vehicules SET douane_reelle = ? WHERE id = ?').run(p.part, p.id);
      avancer(ct.id, 'dedouanee', date, req.utilisateur);
    });
    res.redirect(302, `/conteneurs/${ct.id}`);
  });
}
