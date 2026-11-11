import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';
import { compteClient } from '../src/compte.js';

const idClient = (s, nom) => s.db.prepare('SELECT id FROM clients WHERE nom = ?').get(nom).id;
const reste = (s, nom) => compteClient(s.db, idClient(s, nom), s.aujourdhui).reste;
const versement = (extra = {}) => ({ sens: 'entree', montant: '1 000 000', date: '2026-11-20', mode: 'especes', ...extra });

test('un versement baisse le reste et produit un reçu numéroté', async () => {
  const s = await demarrer({ donnees: true });
  const id = idClient(s, 'Brigitte');
  const r = await s.post(`/clients/${id}/mouvements`, versement(), s.collab);
  assert.equal(r.status, 302);
  assert.equal(reste(s, 'Brigitte'), 3766000);
  const recu = await (await s.get(r.headers.get('location'), s.collab)).text();
  for (const attendu of ['MT-R-2026-001', '1 000 000 F', 'un million', '3 766 000 F', 'Brigitte', '20/11/2026'])
    assert.ok(recu.includes(attendu), attendu);
  const r2 = await s.post(`/clients/${id}/mouvements`, versement({ montant: '500000', date: '2026-11-21', mode: 'mobile_money' }), s.collab);
  assert.match(await (await s.get(r2.headers.get('location'), s.collab)).text(), /MT-R-2026-002/);
  // le premier reçu est figé : il garde le reste du jour où il a été émis
  assert.ok((await (await s.get(r.headers.get('location'), s.collab)).text()).includes('3 766 000 F'));
  assert.equal(s.db.prepare("SELECT saisi_par FROM mouvements WHERE date = '2026-11-20'").get().saisi_par, 'collab');
  await s.fermer();
});

test('saisies refusées : rien n’est enregistré', async () => {
  const s = await demarrer({ donnees: true });
  const id = idClient(s, 'Alice');
  const avant = s.db.prepare('SELECT COUNT(*) n FROM mouvements').get().n;
  for (const m of ['', 'abc', '0', '-5', '4.5'])
    assert.equal((await s.post(`/clients/${id}/mouvements`, versement({ montant: m }), s.collab)).status, 400, m);
  assert.equal((await s.post(`/clients/${id}/mouvements`, versement({ date: '20/11/2026' }), s.collab)).status, 400);
  assert.equal((await s.post(`/clients/${id}/mouvements`, versement({ mode: 'bitcoin' }), s.collab)).status, 400);
  assert.equal((await s.post(`/clients/${id}/mouvements`, versement({ sens: 'cadeau' }), s.collab)).status, 400);
  assert.equal((await s.post('/clients/9999/mouvements', versement(), s.collab)).status, 404);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM mouvements').get().n, avant);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM documents').get().n, 0);
  await s.fermer();
});

test('annuler un versement : admin seulement, motif obligatoire, le reste remonte, la ligne reste visible', async () => {
  const s = await demarrer({ donnees: true });
  const alice = idClient(s, 'Alice');
  const m = s.db.prepare('SELECT id FROM mouvements WHERE client_id = ? AND montant = 3000000').get(alice).id;
  assert.equal((await s.post(`/mouvements/${m}/annuler`, { motif: 'erreur' }, s.collab)).status, 403);
  assert.equal((await s.post(`/mouvements/${m}/annuler`, { motif: '  ' }, s.admin)).status, 400);
  assert.equal(reste(s, 'Alice'), 7718000);
  assert.equal((await s.post(`/mouvements/${m}/annuler`, { motif: 'saisi deux fois' }, s.admin)).status, 302);
  assert.equal(reste(s, 'Alice'), 10718000);
  assert.equal((await s.post(`/mouvements/${m}/annuler`, { motif: 'encore' }, s.admin)).status, 409);
  assert.deepEqual({ ...s.db.prepare('SELECT annule, motif_annulation, annule_par FROM mouvements WHERE id = ?').get(m) },
    { annule: 1, motif_annulation: 'saisi deux fois', annule_par: 'eric' });
  assert.match(await (await s.get('/clients/' + alice, s.admin)).text(), /saisi deux fois/);
  await s.fermer();
});

test('un remboursement augmente le reste et ne produit pas de reçu', async () => {
  const s = await demarrer({ donnees: true });
  const r = await s.post(`/clients/${idClient(s, 'Fabrice')}/mouvements`, versement({ sens: 'sortie', montant: '500 000' }), s.collab);
  assert.equal(r.status, 302);
  assert.equal(reste(s, 'Fabrice'), 4000000);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM documents').get().n, 0);
  await s.fermer();
});

test('une pénalité de retard s’ajoute au reste ; elle s’annule avec un motif', async () => {
  const s = await demarrer({ donnees: true });
  const lucien = idClient(s, 'Lucien');
  const aveo = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Aveo'").get().id;
  const avante = s.db.prepare("SELECT id FROM vehicules WHERE modele = 'Avante'").get().id;
  const corps = { nature: 'magasinage', montant: '75 000', date: '2026-12-20', motif: '5 jours au port', justificatif: 'Facture OPRAG 123', vehicule_id: aveo };
  assert.equal((await s.post(`/clients/${lucien}/penalites`, { ...corps, nature: 'malus' }, s.collab)).status, 400);
  assert.equal((await s.post(`/clients/${lucien}/penalites`, { ...corps, vehicule_id: avante }, s.collab)).status, 400); // voiture d'un autre client
  assert.equal((await s.post(`/clients/${lucien}/penalites`, { ...corps, montant: 'gratuit' }, s.collab)).status, 400);
  assert.equal((await s.post(`/clients/${lucien}/penalites`, corps, s.collab)).status, 302);
  assert.equal(reste(s, 'Lucien'), 1675000);
  assert.match(await (await s.get('/clients/' + lucien, s.collab)).text(), /Magasinage au port[\s\S]*?75 000 F[\s\S]*?Facture OPRAG 123/);
  const p = s.db.prepare('SELECT id FROM penalites').get().id;
  assert.equal((await s.post(`/penalites/${p}/annuler`, { motif: 'erreur' }, s.collab)).status, 403);
  assert.equal((await s.post(`/penalites/${p}/annuler`, { motif: '' }, s.admin)).status, 400);
  assert.equal((await s.post(`/penalites/${p}/annuler`, { motif: 'geste commercial' }, s.admin)).status, 302);
  assert.equal(reste(s, 'Lucien'), 1600000);
  await s.fermer();
});

test('malus : admin seulement, plafonné au malus calculé, pas deux fois', async () => {
  const s = await demarrer({ donnees: true });
  const fabrice = idClient(s, 'Fabrice');
  const ct = s.db.prepare("SELECT id FROM conteneurs WHERE numero = 'TSTU0000003'").get().id;
  const corps = { conteneur_id: ct, ligne: 'solde' };
  // le malus n'existe que pour un client qui a le contrat de la plateforme (clause de l'article 5)
  await s.post(`/commandes/${s.db.prepare('SELECT id FROM commandes WHERE client_id = ?').get(fabrice).id}/contrat`, {}, s.collab);
  s.db.prepare("UPDATE conteneurs SET eta = '2026-12-10', date_arrivee = '2026-12-10' WHERE id = ?").run(ct);
  s.aujourdhui = '2026-12-15';
  assert.equal((await s.post(`/clients/${fabrice}/malus`, { ...corps, montant: '1000' }, s.admin)).status, 400); // pas encore en retard
  s.db.prepare("INSERT INTO relances (type, client_id, conteneur_id, envoye_le, par) VALUES ('arrivee', ?, ?, '2026-12-10', 'eric')").run(fabrice, ct);
  s.aujourdhui = '2026-12-25'; // 5 jours de retard : malus calculé 87 500
  assert.match(await (await s.get('/clients/' + fabrice, s.admin)).text(), /87 500 F/);
  assert.equal((await s.post(`/clients/${fabrice}/malus`, { ...corps, montant: '87500' }, s.collab)).status, 403);
  assert.equal((await s.post(`/clients/${fabrice}/malus`, { ...corps, montant: '90000' }, s.admin)).status, 400);
  assert.equal((await s.post(`/clients/${fabrice}/malus`, { ...corps, ligne: 'douane', montant: '1000' }, s.admin)).status, 400);
  assert.equal((await s.post(`/clients/${fabrice}/malus`, { ...corps, montant: '50000' }, s.admin)).status, 302);
  assert.equal(reste(s, 'Fabrice'), 3550000);
  assert.equal((await s.post(`/clients/${fabrice}/malus`, { ...corps, montant: '50000' }, s.admin)).status, 400); // il ne reste que 37 500
  assert.equal((await s.post(`/clients/${fabrice}/malus`, { ...corps, montant: '37500' }, s.admin)).status, 302);
  assert.deepEqual({ ...s.db.prepare("SELECT COUNT(*) n, SUM(montant) total FROM penalites WHERE nature = 'malus'").get() }, { n: 2, total: 87500 });
  await s.fermer();
});

test('document inconnu : 404 ; un reçu ne se lit pas sans connexion', async () => {
  const s = await demarrer({ donnees: true });
  const r = await s.post(`/clients/${idClient(s, 'Estelle')}/mouvements`, versement(), s.collab);
  assert.equal((await s.get(r.headers.get('location'))).status, 302);
  assert.equal((await s.get('/documents/9999', s.collab)).status, 404);
  await s.fermer();
});
