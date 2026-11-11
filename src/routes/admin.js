// Réglages de l'entreprise et comptes des utilisateurs.
import { html, champ, choix } from '../html.js';
import { reglage, definirReglage, transaction } from '../db.js';
import { exigerAdmin, estPartenaire, creerUtilisateur, validerMotDePasse, hacherMotDePasse, verifierMotDePasse, fermerAutresSessions } from '../auth.js';
import { Refus, texte, entier } from '../saisie.js';

const TEXTES = ['entreprise_tel', 'entreprise_adresse', 'adresse_locaux', 'rccm', 'nif'];
const ROLES = [['collaborateur', 'Collaborateur'], ['admin', 'Administrateur'], ['fournisseur', 'Fournisseur'], ['transporteur', 'Transporteur']];
const NOM_ROLE = Object.fromEntries(ROLES);
// Où un compte laisse sa trace : par son identifiant (texte) ou par son numéro.
const TRACES_IDENTIFIANT = [['mouvements', 'saisi_par'], ['mouvements', 'annule_par'], ['penalites', 'saisi_par'], ['relances', 'par'],
  ['documents', 'par'], ['etapes', 'par'], ['eta_historique', 'par'], ['ristournes', 'saisi_par'], ['matelas_ventes', 'saisi_par'],
  ['versements_fournisseur', 'saisi_par'], ['pieces', 'maj_par']];
const TRACES_NUMERO = [['offres', 'fournisseur_id'], ['fichiers', 'depose_par'], ['frais_transporteur', 'saisi_par']];
// La page « Mon mot de passe » sert aussi aux partenaires, qui la lisent en anglais.
const MOT_DE_PASSE = {
  fr: { titre: 'Mon mot de passe', actuel: 'Mot de passe actuel', nouveau: 'Nouveau mot de passe', aide: '10 caractères au moins',
    bouton: 'Changer mon mot de passe', incorrect: 'Le mot de passe actuel est incorrect.' },
  en: { titre: 'My password', actuel: 'Current password', nouveau: 'New password', aide: 'At least 10 characters',
    bouton: 'Change my password', incorrect: 'The current password is incorrect.' },
};

// creerUtilisateur et validerMotDePasse lèvent des erreurs simples : on en fait des refus lisibles.
const ouRefus = action => {
  try { return action(); } catch (erreur) { throw erreur instanceof Refus ? erreur : new Refus(400, erreur.message); }
};

export function routesAdmin(app, { db }) {
  const compte = req => {
    const id = entier(req.params.id);
    const u = id && db.prepare('SELECT id, identifiant, nom, role, actif FROM utilisateurs WHERE id = ?').get(id);
    if (!u) throw new Refus(404, 'Ce compte n’existe pas.');
    return u;
  };

  app.get('/reglages', exigerAdmin, (req, res) => res.page('Réglages', html`
    <form method="post" action="/reglages" class="carte">
      <div class="grille">
        ${champ('Délai de paiement après l’annonce de l’arrivée (jours)', 'delai_jours', reglage(db, 'delai_jours'), { requis: true, aide: 'Article 5.3 du contrat. Passé ce délai, le client est en retard.' })}
        ${champ('Adresse des locaux', 'adresse_locaux', reglage(db, 'adresse_locaux'), { aide: 'Indiquée au client quand il doit apporter la douane.' })}
        ${champ('Téléphone / WhatsApp de l’entreprise', 'entreprise_tel', reglage(db, 'entreprise_tel'))}
        ${champ('Adresse postale', 'entreprise_adresse', reglage(db, 'entreprise_adresse'))}
        ${champ('RCCM', 'rccm', reglage(db, 'rccm'))}
        ${champ('NIF', 'nif', reglage(db, 'nif'))}
        ${choix('Cachet et signature du directeur sur les documents', 'cachet_actif', [['1', 'Oui, sur les contrats, reçus et procès-verbaux'], ['0', 'Non, signature à la main']], reglage(db, 'cachet_actif'))}
      </div>
      <p class="discret">Ces informations figurent en tête des contrats, des reçus et des procès-verbaux émis à partir de maintenant.</p>
      <p class="actions"><button class="bouton">Enregistrer</button></p>
    </form>`, { actif: '/reglages' }));

  app.post('/reglages', exigerAdmin, (req, res) => {
    const delai = entier(req.body.delai_jours);
    if (delai === null || delai < 1 || delai > 90) throw new Refus(400, 'Le délai de paiement doit être un nombre de jours entre 1 et 90.');
    definirReglage(db, 'delai_jours', delai);
    for (const cle of TEXTES) definirReglage(db, cle, texte(req.body[cle], 200) ?? '');
    definirReglage(db, 'cachet_actif', req.body.cachet_actif === '0' ? '0' : '1');
    res.redirect(302, '/reglages');
  });

  app.get('/utilisateurs', exigerAdmin, (req, res) => {
    const comptes = db.prepare('SELECT id, identifiant, nom, role, actif FROM utilisateurs ORDER BY identifiant').all();
    res.page('Comptes', html`
      <div class="defile"><table>
        <thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th>État</th><th>Nouveau mot de passe</th><th></th></tr></thead>
        <tbody>${comptes.map(u => html`<tr>
          <td>${u.identifiant}</td><td>${u.nom}</td><td>${NOM_ROLE[u.role]}</td>
          <td><span class="etat ${u.actif ? 'ok' : 'retard'}">${u.actif ? 'Actif' : 'Désactivé'}</span></td>
          <td><form method="post" action="/utilisateurs/${u.id}/mot-de-passe" class="actions">
            <input type="password" name="nouveau" minlength="10" required aria-label="Nouveau mot de passe de ${u.identifiant}" autocomplete="new-password">
            <button class="bouton secondaire petit">Changer</button></form></td>
          <td><form method="post" action="/utilisateurs/${u.id}/actif" data-confirmer="${u.actif ? 'Désactiver ce compte ? La personne sera déconnectée.' : 'Réactiver ce compte ?'}">
            <input type="hidden" name="actif" value="${u.actif ? '0' : '1'}">
            <button class="bouton ${u.actif ? 'danger' : 'secondaire'} petit">${u.actif ? 'Désactiver' : 'Réactiver'}</button></form>
            ${u.id === req.utilisateur.id ? '' : html`<form method="post" action="/utilisateurs/${u.id}/supprimer"
              data-confirmer="Supprimer définitivement le compte ${u.identifiant} ? Seul un compte qui n’a jamais rien saisi peut être supprimé.">
              <button class="bouton danger petit">Supprimer</button></form>`}</td>
        </tr>`)}</tbody>
      </table></div>
      <h2>Nouveau compte</h2>
      <form method="post" action="/utilisateurs" class="carte">
        <div class="grille">
          ${champ('Identifiant', 'identifiant', '', { requis: true })}
          ${champ('Nom', 'nom', '', { requis: true })}
          ${choix('Rôle', 'role', [['', '— Choisir le rôle —'], ...ROLES])}
          ${champ('Mot de passe', 'mot_de_passe', '', { type: 'password', requis: true, aide: '10 caractères au moins' })}
        </div>
        <p class="discret">Le collaborateur peut tout consulter et tout saisir. Seul l’administrateur supprime, annule un versement,
          applique un malus et gère les comptes. Le fournisseur et le transporteur sont les partenaires en Corée : ils n’ont accès
          qu’à leur espace, en anglais, sans aucun client, prix de vente ni montant en francs CFA.</p>
        <p class="actions"><button class="bouton">Créer le compte</button></p>
      </form>`, { actif: '/utilisateurs' });
  });

  app.post('/utilisateurs', exigerAdmin, (req, res) => {
    ouRefus(() => creerUtilisateur(db, {
      identifiant: texte(req.body.identifiant, 40), nom: texte(req.body.nom, 80), role: req.body.role, motDePasse: req.body.mot_de_passe,
    }));
    res.redirect(302, '/utilisateurs');
  });

  app.post('/utilisateurs/:id/mot-de-passe', exigerAdmin, (req, res) => {
    const u = compte(req);
    ouRefus(() => validerMotDePasse(req.body.nouveau));
    db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?').run(hacherMotDePasse(req.body.nouveau), u.id);
    db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(u.id); // il devra se reconnecter
    res.redirect(302, '/utilisateurs');
  });

  app.post('/utilisateurs/:id/actif', exigerAdmin, (req, res) => {
    const u = compte(req);
    const actif = req.body.actif === '1' ? 1 : 0;
    if (!actif && u.role === 'admin'
      && db.prepare("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'admin' AND actif = 1 AND id <> ?").get(u.id).n === 0)
      throw new Refus(409, 'C’est le dernier administrateur actif : il ne peut pas être désactivé.');
    db.prepare('UPDATE utilisateurs SET actif = ? WHERE id = ?').run(actif, u.id);
    if (!actif) db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(u.id);
    res.redirect(302, '/utilisateurs');
  });

  // Supprimer un compte qui n'a jamais servi (créé par erreur). Un compte qui a laissé une trace se désactive :
  // l'historique garde son auteur, et un futur compte du même identifiant n'en hériterait pas.
  app.post('/utilisateurs/:id/supprimer', exigerAdmin, (req, res) => {
    const u = compte(req);
    if (u.id === req.utilisateur.id) throw new Refus(409, 'Vous ne pouvez pas supprimer votre propre compte.');
    const traceTexte = TRACES_IDENTIFIANT.some(([table, colonne]) =>
      db.prepare(`SELECT 1 FROM ${table} WHERE ${colonne} = ? LIMIT 1`).get(u.identifiant));
    const traceNumero = TRACES_NUMERO.some(([table, colonne]) =>
      db.prepare(`SELECT 1 FROM ${table} WHERE ${colonne} = ? LIMIT 1`).get(u.id));
    if (traceTexte || traceNumero)
      throw new Refus(409, 'Ce compte a déjà servi (versements, documents, dépôts…) : désactivez-le plutôt, pour garder la trace de qui a fait quoi.');
    transaction(db, () => {
      db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(u.id);
      db.prepare('DELETE FROM utilisateurs WHERE id = ?').run(u.id);
    });
    res.redirect(302, '/utilisateurs');
  });

  app.get('/mon-mot-de-passe', (req, res) => {
    const t = MOT_DE_PASSE[estPartenaire(req.utilisateur) ? 'en' : 'fr'];
    res.page(t.titre, html`
    <form method="post" action="/mon-mot-de-passe" class="carte etroit">
      ${champ(t.actuel, 'actuel', '', { type: 'password', requis: true })}
      ${champ(t.nouveau, 'nouveau', '', { type: 'password', requis: true, aide: t.aide })}
      <p class="actions"><button class="bouton">${t.bouton}</button></p>
    </form>`);
  });

  app.post('/mon-mot-de-passe', (req, res) => {
    const anglais = estPartenaire(req.utilisateur);
    const stocke = db.prepare('SELECT mot_de_passe FROM utilisateurs WHERE id = ?').get(req.utilisateur.id).mot_de_passe;
    if (!verifierMotDePasse(String(req.body.actuel ?? ''), stocke)) throw new Refus(400, MOT_DE_PASSE[anglais ? 'en' : 'fr'].incorrect);
    ouRefus(() => validerMotDePasse(req.body.nouveau, anglais));
    db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?').run(hacherMotDePasse(req.body.nouveau), req.utilisateur.id);
    fermerAutresSessions(db, req); // les autres appareils devront se reconnecter
    res.redirect(302, '/');
  });
}
