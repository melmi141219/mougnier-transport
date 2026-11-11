import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { demarrer } from './aide.js';
import { typeFichier, enregistrerFichier, lireFichier, supprimerFichier } from '../src/fichiers.js';
import { lireDepot, deposer } from '../src/routes/fichiers.js';
import { entier } from '../src/saisie.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(50)]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
const MEGA = 1024 * 1024;
const NOM_STOCKE = /^[0-9a-f]{32}\.(jpg|png|webp|pdf)$/;

// Route jetable, comme celles des tâches 3 et 4 : ?offre= et ?piece= rattachent le fichier, ?images=1 refuse les PDF.
const routesDepot = (app, contexte) => {
  const route = (req, res) => res.json(deposer(req, contexte,
    { offreId: entier(req.query.offre), pieceId: entier(req.query.piece), imagesSeulement: req.query.images === '1' }));
  app.post('/essai-depot', lireDepot, route);
  app.post('/partenaire/essai-depot', lireDepot, route);
};
const demarrerAvecDepot = () => demarrer({ routesEnPlus: routesDepot });
const contenuDuDossier = s => (fs.existsSync(s.dossierFichiers) ? fs.readdirSync(s.dossierFichiers) : []);
const ligne = (s, id) => s.db.prepare('SELECT * FROM fichiers WHERE id = ?').get(id);

test('typeFichier reconnaît JPEG, PNG, WebP et PDF, et rien d’autre', () => {
  assert.deepEqual(typeFichier(JPEG), { mime: 'image/jpeg', extension: 'jpg' });
  assert.deepEqual(typeFichier(PNG), { mime: 'image/png', extension: 'png' });
  assert.deepEqual(typeFichier(WEBP), { mime: 'image/webp', extension: 'webp' });
  assert.deepEqual(typeFichier(PDF), { mime: 'application/pdf', extension: 'pdf' });
  for (const autre of [HTML, Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.alloc(0), Buffer.from([0xff, 0xd8]), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')])])
    assert.equal(typeFichier(autre), null);
});

test('un fichier refusé n’écrit rien', async () => {
  const s = await demarrerAvecDepot();
  const refus = [
    [HTML, 'photo.jpg', 'image/jpeg'],
    [Buffer.concat([JPEG, Buffer.alloc(7 * MEGA)]), 'grosse.jpg', 'image/jpeg'],
    [Buffer.concat([PDF, Buffer.alloc(16 * MEGA - PDF.length)]), 'gros.pdf', 'application/pdf'],
    [Buffer.alloc(0), 'vide.jpg', 'image/jpeg'],
  ];
  for (const [contenu, nom, type] of refus) {
    const r = await s.deposer('/essai-depot', contenu, nom, s.admin, type);
    assert.equal(r.status, 400, nom);
    assert.match(await r.text(), /class="alerte"/);
  }
  assert.match(await (await s.deposer('/essai-depot', Buffer.alloc(0), 'vide.jpg', s.admin, 'image/jpeg')).text(), /Le fichier est vide/);
  assert.equal((await s.deposer('/essai-depot?images=1', PDF, 'fiche.pdf', s.admin, 'application/pdf')).status, 400);
  assert.deepEqual(contenuDuDossier(s), []);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM fichiers').get().n, 0);
  await s.fermer();
});

test('un partenaire lit les refus de dépôt en anglais', async () => {
  const s = await demarrerAvecDepot();
  const r = await s.deposer('/partenaire/essai-depot', HTML, 'photo.jpg', s.ayaan, 'image/jpeg');
  const texte = await r.text();
  assert.equal(r.status, 400);
  assert.match(texte, /<html lang="en">/);
  assert.match(texte, /neither a photo .* nor a PDF/);
  await s.fermer();
});

test('un envoi de plus de 16 Mo est refusé proprement, sans erreur du serveur', async (t) => {
  const s = await demarrerAvecDepot();
  const erreurs = t.mock.method(console, 'error', () => {});
  const r = await s.deposer('/essai-depot', Buffer.concat([JPEG, Buffer.alloc(17 * MEGA)]), 'enorme.jpg', s.admin, 'image/jpeg');
  assert.equal(r.status, 413);
  assert.match(await r.text(), /class="alerte">Envoi trop volumineux/);
  assert.equal(erreurs.mock.callCount(), 0);
  assert.deepEqual(contenuDuDossier(s), []);
  await s.fermer();
});

test('le nom d’origine ne choisit jamais l’emplacement ni le type', async () => {
  const s = await demarrerAvecDepot();
  const envois = [
    [JPEG, '..\\..\\mechant.jpg', 'mechant.jpg', 'jpg'],
    [PNG, '../../x.png', 'x.png', 'png'],
    [PDF, 'C:\\x.pdf', 'x.pdf', 'pdf'],
    [PNG, 'photo.jpg', 'photo.jpg', 'png'], // l'extension vient du contenu
    [WEBP, `${'a'.repeat(200)}.webp`, 'a'.repeat(120), 'webp'],
  ];
  for (const [contenu, nom, attendu, extension] of envois) {
    const r = await s.deposer('/essai-depot', contenu, nom, s.admin, 'application/octet-stream');
    assert.equal(r.status, 200, nom);
    const fichier = ligne(s, (await r.json()).id);
    assert.equal(fichier.nom_origine, attendu);
    assert.match(fichier.nom_stocke, NOM_STOCKE);
    assert.equal(fichier.nom_stocke.split('.')[1], extension);
    assert.equal(fichier.taille, contenu.length);
    assert.deepEqual(fs.readFileSync(`${s.dossierFichiers}/${fichier.nom_stocke}`), contenu);
  }
  assert.equal(contenuDuDossier(s).length, envois.length); // tout est dans le dossier, rien à côté
  assert.ok(contenuDuDossier(s).every(nom => NOM_STOCKE.test(nom)));
  await s.fermer();
});

test('un nom illisible est refusé, un nom absent est remplacé', async () => {
  const s = await demarrerAvecDepot();
  const illisible = await fetch(`${s.url}/essai-depot`, { method: 'POST', body: JPEG,
    headers: { 'content-type': 'image/jpeg', 'x-nom-fichier': '%E0%A4%A', origin: s.url, cookie: s.admin } });
  assert.equal(illisible.status, 400);
  const sansNom = await fetch(`${s.url}/essai-depot`, { method: 'POST', body: JPEG,
    headers: { 'content-type': 'image/jpeg', origin: s.url, cookie: s.admin } });
  assert.equal(sansNom.status, 200);
  assert.equal(ligne(s, (await sansNom.json()).id).nom_origine, 'document.jpg');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM fichiers').get().n, 1);
  await s.fermer();
});

test('un nom avec guillemet, retour à la ligne, accents et émoji se relit sans casser l’en-tête', async () => {
  const s = await demarrerAvecDepot();
  const r = await s.deposer('/essai-depot', JPEG, 'a"b\r\nc été 😀.jpg', s.admin, 'image/jpeg');
  const { id } = await r.json();
  assert.equal(ligne(s, id).nom_origine, 'a"bc été 😀.jpg'); // caractères de contrôle retirés
  const lu = await s.get(`/fichiers/${id}`, s.admin);
  assert.equal(lu.status, 200);
  const disposition = lu.headers.get('content-disposition');
  assert.match(disposition, /^inline; filename="[\x20-\x7e]*"; filename\*=UTF-8''\S+$/);
  assert.doesNotMatch(disposition.match(/filename="([^"]*)"/)[1], /["\\\r\n]/);
  assert.equal(decodeURIComponent(disposition.match(/filename\*=UTF-8''(\S+)$/)[1]), 'a"bc été 😀.jpg');
  await s.fermer();
});

test('le 201e dépôt du jour est refusé, même après une suppression, pour ce compte seulement', async () => {
  const s = await demarrerAvecDepot();
  const deposerUn = (compte, jour) => enregistrerFichier(s.db, s.dossierFichiers,
    { contenu: JPEG, nomOrigine: 'p.jpg', deposePar: compte, aujourdhui: jour });
  const ids = Array.from({ length: 200 }, () => deposerUn(s.ayaanId, '2026-11-10').id);
  assert.throws(() => deposerUn(s.ayaanId, '2026-11-10'), e => e.statut === 429);
  supprimerFichier(s.db, s.dossierFichiers, ids[0], '2026-11-10');
  assert.throws(() => deposerUn(s.ayaanId, '2026-11-10'), e => e.statut === 429); // supprimer ne rend pas de place
  const parHttp = await s.deposer('/partenaire/essai-depot', JPEG, 'p.jpg', s.ayaan, 'image/jpeg');
  assert.equal(parHttp.status, 429);
  assert.match(await parHttp.text(), /200 files per day/);
  assert.ok(deposerUn(s.georgeId, '2026-11-10').id); // un autre compte n'est pas touché
  assert.ok(deposerUn(s.ayaanId, '2026-11-11').id);  // le lendemain repart de zéro
  assert.equal(contenuDuDossier(s).length, 201);    // 200 − 1 supprimé + George + le lendemain
  await s.fermer();
});

test('droits de lecture des fichiers', async () => {
  const s = await demarrerAvecDepot();
  const autre = Number(s.db.prepare("INSERT INTO utilisateurs (identifiant, nom, role, mot_de_passe) VALUES ('autre', 'Autre fournisseur', 'fournisseur', 'x')").run().lastInsertRowid);
  const offre = fournisseur => Number(s.db.prepare("INSERT INTO offres (fournisseur_id, marque, modele, prix_won, cree_le) VALUES (?, 'Kia', 'Sportage', 9000000, '2026-11-10')").run(fournisseur).lastInsertRowid);
  const conteneur = Number(s.db.prepare("INSERT INTO conteneurs (numero) VALUES ('ESSU1234567')").run().lastInsertRowid);
  const piece = Number(s.db.prepare("INSERT INTO pieces (conteneur_id, type, etat, maj_par, maj_le) VALUES (?, 'bietc', 'envoye', 'george', '2026-11-10')").run(conteneur).lastInsertRowid);
  const depot = async (chemin, contenu, cookie, type) => (await (await s.deposer(chemin, contenu, 'f', cookie, type)).json()).id;
  const photo = await depot(`/partenaire/essai-depot?offre=${offre(s.ayaanId)}`, JPEG, s.ayaan, 'image/jpeg');
  const photoAutre = await depot(`/essai-depot?offre=${offre(autre)}`, JPEG, s.admin, 'image/jpeg');
  const document = await depot(`/partenaire/essai-depot?piece=${piece}`, PDF, s.george, 'application/pdf');
  const interne = await depot('/essai-depot', PNG, s.admin, 'image/png');

  const sansSession = await s.get(`/fichiers/${photo}`);
  assert.deepEqual([sansSession.status, sansSession.headers.get('location')], [302, '/connexion']);
  const lu = await s.get(`/fichiers/${photo}`, s.ayaan);
  assert.equal(lu.status, 200);
  assert.equal(lu.headers.get('content-type'), 'image/jpeg');
  assert.equal(lu.headers.get('cache-control'), 'private, no-store');
  assert.equal(lu.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await lu.arrayBuffer()), JPEG);
  const statut = async (id, cookie) => (await s.get(`/fichiers/${id}`, cookie)).status;
  assert.equal(await statut(photo, s.george), 403);
  assert.equal(await statut(photoAutre, s.ayaan), 403);  // la proposition d'un autre fournisseur
  assert.equal(await statut(document, s.ayaan), 403);
  assert.equal(await statut(document, s.george), 200);
  assert.equal((await s.get(`/fichiers/${document}`, s.george)).headers.get('content-type'), 'application/pdf');
  for (const cookie of [s.ayaan, s.george]) assert.equal(await statut(interne, cookie), 403);
  for (const cookie of [s.admin, s.collab]) for (const id of [photo, photoAutre, document, interne]) assert.equal(await statut(id, cookie), 200);
  for (const inconnu of ['99999', 'abc', '1.5']) assert.equal(await statut(inconnu, s.admin), 404);
  await s.fermer();
});

test('un fichier supprimé ou une ligne trafiquée ne se lit plus', async () => {
  const s = await demarrerAvecDepot();
  const { id } = await (await s.deposer('/essai-depot', JPEG, 'a.jpg', s.admin, 'image/jpeg')).json();
  const { nom_stocke: nomStocke } = ligne(s, id);
  assert.ok(lireFichier(s.db, s.dossierFichiers, id));
  assert.equal(supprimerFichier(s.db, s.dossierFichiers, id, '2026-11-10'), true);
  assert.equal(lireFichier(s.db, s.dossierFichiers, id), null);
  assert.equal((await s.get(`/fichiers/${id}`, s.admin)).status, 404);
  assert.equal(fs.existsSync(`${s.dossierFichiers}/${nomStocke}`), false);
  assert.equal(ligne(s, id).supprime_le, '2026-11-10'); // la ligne reste : elle compte encore dans la limite du jour

  const autre = (await (await s.deposer('/essai-depot', JPEG, 'b.jpg', s.admin, 'image/jpeg')).json()).id;
  // Chemin détourné qui mène pourtant à un fichier existant : seul le contrôle du nom stocké le refuse.
  s.db.prepare("UPDATE fichiers SET nom_stocke = 'x/../' || nom_stocke WHERE id = ?").run(autre);
  assert.equal(lireFichier(s.db, s.dossierFichiers, autre), null);
  assert.equal((await s.get(`/fichiers/${autre}`, s.admin)).status, 404);
  await s.fermer();
});

test('une pièce de conteneur ne peut pas être enregistrée deux fois', async () => {
  const s = await demarrer({ donnees: true });
  const [v1, v2] = s.db.prepare('SELECT id FROM vehicules LIMIT 2').all().map(v => v.id);
  const inserer = s.db.prepare("INSERT INTO pieces (conteneur_id, vehicule_id, type, etat, maj_par, maj_le) VALUES (1, ?, ?, 'envoye', 'george', '2026-11-10')");
  inserer.run(null, 'bietc');
  assert.throws(() => inserer.run(null, 'bietc'), /UNIQUE/);
  inserer.run(v1, 'radiation');
  inserer.run(v2, 'radiation'); // même type, autre voiture : permis
  assert.throws(() => inserer.run(v1, 'radiation'), /UNIQUE/);
  assert.throws(() => s.db.prepare("INSERT INTO pieces (conteneur_id, type, etat, maj_par, maj_le) VALUES (1, 'telex', 'perdu', 'x', 'x')").run(), /CHECK/);
  await s.fermer();
});
