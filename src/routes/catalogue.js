// La gamme : les modèles qu'Eric propose, avec leur prix en Corée et le transport habituel.
import { html, champ } from '../html.js';
import { prixVehicule } from '../calc.js';
import { fcfa } from '../format.js';
import { msgCatalogue } from '../messages.js';
import { exigerAdmin } from '../auth.js';
import { Refus, texte, entier, entierFacultatif, montantObligatoire } from '../saisie.js';
import { libelleVoiture } from '../libelles.js';

export function routesCatalogue(app, { db }) {
  const trouver = req => {
    const id = entier(req.params.id);
    const ligne = id && db.prepare('SELECT * FROM catalogue WHERE id = ?').get(id);
    if (!ligne) throw new Refus(404, 'Cette ligne de la gamme n’existe pas.');
    return ligne;
  };

  const lire = corps => {
    const l = {
      marque: texte(corps.marque, 60), modele: texte(corps.modele, 60), version: texte(corps.version, 60),
      annee: entierFacultatif(corps.annee, 'Année'), notes: texte(corps.notes, 300),
    };
    if (!l.marque || !l.modele) throw new Refus(400, 'La marque et le modèle sont obligatoires.');
    l.achat = montantObligatoire(corps.achat, 'Prix d’achat en Corée');
    l.transport = montantObligatoire(corps.transport, 'Transport');
    return l;
  };

  const champs = l => html`<div class="grille">
    ${champ('Marque', 'marque', l.marque, { requis: true })}
    ${champ('Modèle', 'modele', l.modele, { requis: true })}
    ${champ('Version', 'version', l.version, { aide: 'simple, full option…' })}
    ${champ('Année', 'annee', l.annee)}
    ${champ('Prix d’achat en Corée (F)', 'achat', l.achat, { requis: true })}
    ${champ('Transport jusqu’à Libreville (F)', 'transport', l.transport, { requis: true })}
    ${champ('Notes', 'notes', l.notes)}
  </div>`;

  app.get('/catalogue', (req, res) => {
    const lignes = db.prepare('SELECT * FROM catalogue ORDER BY marque, modele, version, annee').all()
      .map(l => ({ ...l, rendu: prixVehicule(l).total }));
    res.page('Gamme de prix', html`
      <p class="discret">Prix rendu à Libreville = achat + transport + frais de 9 % + douane estimée à 55 %.
        Le message à copier peut être collé dans le groupe WhatsApp.</p>
      <div class="defile"><table>
        <thead><tr><th>Voiture</th><th class="montant">Achat en Corée</th><th class="montant">Transport</th><th class="montant">Rendu à Libreville</th><th></th></tr></thead>
        <tbody>${lignes.map(l => html`<tr>
          <td><a href="/catalogue/${l.id}">${libelleVoiture(l)}</a>${l.notes ? html`<br><small class="discret">${l.notes}</small>` : ''}</td>
          <td class="montant">${fcfa(l.achat)}</td><td class="montant">${fcfa(l.transport)}</td><td class="montant"><strong>${fcfa(l.rendu)}</strong></td>
          <td><button type="button" class="bouton secondaire petit"
            data-copier="${msgCatalogue({ libelle: libelleVoiture(l), achat: l.achat, transport: l.transport, rendu: l.rendu })}">Copier le message</button></td>
        </tr>`)}</tbody>
      </table></div>
      <h2>Ajouter un modèle</h2>
      <form method="post" action="/catalogue" class="carte">${champs({})}
        <p class="actions"><button class="bouton">Ajouter à la gamme</button></p></form>`, { actif: '/catalogue' });
  });

  app.post('/catalogue', (req, res) => {
    db.prepare(`INSERT INTO catalogue (marque, modele, version, annee, achat, transport, notes)
      VALUES (:marque, :modele, :version, :annee, :achat, :transport, :notes)`).run(lire(req.body));
    res.redirect(302, '/catalogue');
  });

  app.get('/catalogue/:id', (req, res) => {
    const l = trouver(req);
    res.page(libelleVoiture(l), html`
      <form method="post" action="/catalogue/${l.id}" class="carte">${champs(l)}
        <p class="actions"><button class="bouton">Enregistrer</button> <a href="/catalogue">Retour à la gamme</a></p></form>
      ${req.utilisateur.role === 'admin' ? html`<form method="post" action="/catalogue/${l.id}/supprimer" data-confirmer="Retirer ce modèle de la gamme ?">
        <button class="bouton danger">Retirer de la gamme</button></form>` : ''}`, { actif: '/catalogue' });
  });

  app.post('/catalogue/:id', (req, res) => {
    const ancienne = trouver(req);
    db.prepare(`UPDATE catalogue SET marque = :marque, modele = :modele, version = :version, annee = :annee,
      achat = :achat, transport = :transport, notes = :notes WHERE id = :id`).run({ ...lire(req.body), id: ancienne.id });
    res.redirect(302, '/catalogue');
  });

  app.post('/catalogue/:id/supprimer', exigerAdmin, (req, res) => {
    db.prepare('DELETE FROM catalogue WHERE id = ?').run(trouver(req).id);
    res.redirect(302, '/catalogue');
  });
}
