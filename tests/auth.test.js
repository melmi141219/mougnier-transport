import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './aide.js';
import { html, brut } from '../src/html.js';
import { hacherMotDePasse, verifierMotDePasse, creerUtilisateur } from '../src/auth.js';
import { ouvrirBase } from '../src/db.js';

test('html échappe les valeurs, pas le gabarit', () => {
  assert.equal(String(html`<b>${'<script>"x"</script>'}</b>`), '<b>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</b>');
  assert.equal(String(html`<ul>${['a', 'b'].map(x => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(String(html`<p>${brut('<i>ok</i>')}${null}${undefined}${false}${0}</p>`), '<p><i>ok</i>0</p>');
  assert.equal(String(html`<a title="${"l'été"}">x</a>`), '<a title="l&#39;été">x</a>');
});

test('mot de passe : haché avec un sel, vérifié', () => {
  const h = hacherMotDePasse('correct horse 42');
  assert.ok(verifierMotDePasse('correct horse 42', h));
  assert.ok(!verifierMotDePasse('autre', h));
  assert.ok(!verifierMotDePasse('correct horse 42', 'nimporte quoi'));
  assert.notEqual(h, hacherMotDePasse('correct horse 42'));
});

test('creerUtilisateur refuse un mot de passe de moins de 10 caractères', () => {
  const db = ouvrirBase(':memory:');
  assert.throws(() => creerUtilisateur(db, { identifiant: 'a', nom: 'A', role: 'admin', motDePasse: 'court' }), /10 caractères/);
  assert.ok(creerUtilisateur(db, { identifiant: 'a', nom: 'A', role: 'admin', motDePasse: 'assez-long-1' }) > 0);
});

test('sans session, tout renvoie vers /connexion', async () => {
  const s = await demarrer();
  for (const chemin of ['/', '/clients', '/reglages']) {
    const r = await s.get(chemin);
    assert.equal(r.status, 302, chemin);
    assert.equal(r.headers.get('location'), '/connexion');
  }
  assert.equal((await s.get('/connexion')).status, 200);
  await s.fermer();
});

test('connexion réussie : cookie de session protégé, puis accès', async () => {
  const s = await demarrer();
  const ok = await s.post('/connexion', { identifiant: 'eric', mot_de_passe: 'motdepasse-admin' });
  assert.equal(ok.status, 302);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^mt_session=[0-9a-f]{64};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const accueil = await s.get('/', cookie.split(';')[0]);
  assert.equal(accueil.status, 200);
  assert.match(await accueil.text(), /Aujourd/);
  await s.fermer();
});

test('mauvais mot de passe ou identifiant inconnu : même refus', async () => {
  const s = await demarrer();
  const a = await s.post('/connexion', { identifiant: 'eric', mot_de_passe: 'faux' });
  const b = await s.post('/connexion', { identifiant: 'inconnu', mot_de_passe: 'faux' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.headers.get('set-cookie'), null);
  await s.fermer();
});

test('5 échecs bloquent l’identifiant', async () => {
  const s = await demarrer();
  for (let i = 0; i < 5; i++) await s.post('/connexion', { identifiant: 'eric', mot_de_passe: 'faux' });
  assert.equal((await s.post('/connexion', { identifiant: 'eric', mot_de_passe: 'motdepasse-admin' })).status, 429);
  assert.equal((await s.post('/connexion', { identifiant: 'collab', mot_de_passe: 'motdepasse-collab' })).status, 302);
  await s.fermer();
});

test('session expirée ou utilisateur désactivé = déconnecté', async () => {
  const s = await demarrer();
  s.db.prepare('UPDATE utilisateurs SET actif = 0 WHERE identifiant = ?').run('collab');
  assert.equal((await s.get('/', s.collab)).status, 302);
  s.db.prepare("UPDATE sessions SET expire_le = '2000-01-01'").run();
  assert.equal((await s.get('/', s.admin)).status, 302);
  await s.fermer();
});

test('déconnexion : la session ne marche plus', async () => {
  const s = await demarrer();
  assert.equal((await s.post('/deconnexion', {}, s.admin)).status, 302);
  assert.equal((await s.get('/', s.admin)).status, 302);
  await s.fermer();
});

test('un POST venu d’un autre site est refusé', async () => {
  const s = await demarrer();
  const r = await fetch(s.url + '/deconnexion', { method: 'POST', redirect: 'manual', headers: { cookie: s.admin, origin: 'https://ailleurs.example' } });
  assert.equal(r.status, 403);
  assert.equal((await s.get('/', s.admin)).status, 200); // la session n'a pas été fermée
  await s.fermer();
});

test('la base ne garde pas le jeton de session en clair', async () => {
  const s = await demarrer();
  const jeton = s.admin.split('=')[1];
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM sessions WHERE jeton = ?').get(jeton).n, 0);
  await s.fermer();
});

test('pages servies avec des en-têtes de protection', async () => {
  const s = await demarrer();
  const r = await s.get('/connexion');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
  await s.fermer();
});
