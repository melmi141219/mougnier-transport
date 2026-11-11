# Plateforme MOUGNIER TRANSPORT

Gestion des clients, des versements, des conteneurs, des relances WhatsApp et des contrats pour l'import de voitures Corée → Libreville.

Les documents de conception restent sur le PC, dans le dossier `docs/` (ils ne sont pas sur GitHub, car ils nomment les clients) :

- Ce que fait la plateforme et pourquoi : `docs/2026-11-10-plateforme-design.md`
- Comment elle a été construite : `docs/superpowers/plans/2026-11-10-plateforme-mt.md`

## Mettre à jour la plateforme

Après une modification du programme : double-clic sur `scripts\mettre-a-jour.cmd`, sans droits administrateur. Il lance tous les tests (rien n'est touché s'il y a un échec), copie le programme dans `C:\MT\transport\app`, fait redémarrer le serveur, et vérifie qu'un nouveau serveur répond. La plateforme est coupée quelques secondes. La base, les fichiers et les sauvegardes ne sont pas touchés.

Le redémarrage passe par le superviseur (`scripts\superviseur.js`), lancé par la tâche « MT Transport - serveur » : il relance la plateforme chaque fois qu'elle s'arrête. `scripts\installer.cmd` (droits administrateur) ne sert plus que pour une première installation, pour changer les tâches planifiées, ou si le superviseur lui-même change.

## Mise en service (une seule fois)

Ouvre PowerShell dans le dossier du projet.

1. Installer ce dont la plateforme a besoin :

   ```bash
   npm install
   ```

2. Créer ton compte administrateur. Le mot de passe est demandé au clavier et ne s'affiche pas (10 caractères au moins) :

   ```bash
   node scripts/creer-utilisateur.js eric "Eric Patrick MOUGNIER" admin
   ```

3. Pour un essai seulement : charger un jeu d'exemple (noms et numéros inventés). Ne jamais le lancer sur la vraie base, déjà chargée ; le script refuse d'ailleurs une base qui a des clients :

   ```bash
   node scripts/charger-donnees.js
   ```

4. Ouvrir PowerShell **en tant qu'administrateur**, avec ton compte Windows habituel (celui qui a OneDrive), revenir dans le dossier du projet, puis lancer la mise en service :

   ```bash
   powershell -ExecutionPolicy Bypass -File scripts\installer-windows.ps1
   ```

   Le script copie le programme dans `C:\MT\transport\app`, crée le démarrage automatique et la sauvegarde de 20 h, puis vérifie lui-même que la plateforme répond et qu'une sauvegarde s'écrit. S'il s'arrête sur une erreur, il indique le journal à regarder dans `C:\MT\transport\logs`.

   **À relancer après chaque mise à jour du code** : c'est lui qui recopie le programme.

5. Ouvrir <http://127.0.0.1:3210> sur le PC et te connecter.

6. Dans **Comptes**, créer le compte de ton collaborateur. Dans **Réglages**, saisir l'adresse de tes locaux, ton RCCM et ton NIF.

> Les étapes 2 et 3 écrivent dans `C:\MT\transport\data`. Si tu les lances avant l'étape 4, c'est le même dossier : rien à déplacer.

## Accès à distance avec Tailscale

La plateforme n'écoute que sur le PC lui-même (`127.0.0.1`). Pour l'ouvrir à ton téléphone et à ton collaborateur, sans rien exposer sur Internet :

1. Installer Tailscale sur le PC serveur, sur ton téléphone et sur l'appareil de ton collaborateur, avec le même compte Tailscale (ou en l'invitant dans ton réseau).
2. Sur le PC serveur, lancer une fois :

   ```bash
   tailscale serve --bg 3210
   ```

3. Tailscale affiche une adresse du type `https://mt-srv01.xxxx.ts.net`. C'est l'adresse à ouvrir sur le téléphone et chez le collaborateur.

À vérifier au premier essai depuis le téléphone : la connexion, puis l'enregistrement d'un versement d'essai sur un client de test.

Deux réglages pour que la plateforme reste joignable après une coupure de courant :

- Dans Tailscale sur le PC serveur, activer **« Run unattended »** (fonctionner sans session ouverte). Sinon Tailscale ne se connecte que lorsque quelqu'un a ouvert sa session Windows.
- Dans Windows, laisser la mise en veille désactivée sur le PC serveur.

## Adresse publique : https://transport.mougniertech.com (Cloudflare)

Mise en place le 11 novembre 2026. La plateforme s'ouvre depuis n'importe quel appareil, sans Tailscale, à l'adresse **https://transport.mougniertech.com**.

- **Deux portes.** D'abord Cloudflare demande une adresse e-mail autorisée et envoie un code par mail (valable 24 heures sur l'appareil). Ensuite vient la page de connexion de la plateforme, avec l'identifiant et le mot de passe habituels.
- **Les données restent sur le PC.** Le service Windows « Cloudflared agent » relie le PC au tunnel « mt-srv01-transport » du compte Cloudflare ; il démarre avec Windows. Le PC doit rester allumé.
- **Installé par** `scripts\installer-tunnel.cmd` (double-clic, réponse « Oui » à Windows). À relancer seulement si le tunnel est recréé.

Autoriser quelqu'un (ta femme, Ayaan, George…) :

1. Tableau de bord Cloudflare → **Zero Trust** → **Contrôles d'accès** → **Applications** → **MOUGNIER TRANSPORT** → politique **« Acces MOUGNIER TRANSPORT »** → ajouter son adresse e-mail.
2. Lui créer son compte sur la plateforme, page **Comptes**, avec le bon rôle.

Retirer quelqu'un : enlever son adresse de la politique, et désactiver son compte dans **Comptes**.

Couper l'accès public d'urgence : dans Windows, **Services** → « Cloudflared agent » → **Arrêter** (ou supprimer la route du tunnel dans Cloudflare). L'accès par Tailscale reste possible.

## Comptes des partenaires (Ayaan et George)

Ayaan (fournisseur) et George (transporteur) ont chacun un espace en anglais. Ayaan propose des voitures avec photos et prix en wons, suit les voitures commandées et ses paiements. George envoie les documents de chaque conteneur, saisit ses frais et suit ses paiements. Ils ne voient jamais un client, un prix de vente, une marge ni un montant en francs.

Leur ouvrir l'accès :

1. Page **Comptes** : créer `ayaan` avec le rôle **Fournisseur**, et `george` avec le rôle **Transporteur**, chacun avec un mot de passe d'au moins 10 caractères.
2. Cloudflare : ajouter leur adresse e-mail à la politique « Acces MOUGNIER TRANSPORT » (partie « Adresse publique » ci-dessus).
3. Leur envoyer séparément l'adresse https://transport.mougniertech.com, puis l'identifiant et le mot de passe. Ils pourront changer leur mot de passe en cliquant sur leur nom.
4. Avant de les envoyer, essayer soi-même : passer le code Cloudflare avec ta propre adresse, se connecter avec le compte `ayaan`, regarder ce qu'il voit, puis se déconnecter. Pareil avec `george`.

Côté Eric :

- Page **Partenaires** : ce que tu dois à chacun, les documents de transport à recevoir ou à valider (aussi sur la fiche de chaque conteneur), les frais de George à valider ou refuser, les propositions d'Ayaan à retenir ou refuser. La collaboratrice voit les documents et les propositions, sans aucun montant en wons ni ligne de frais.
- Page **Aujourd'hui** : les documents manquants d'un conteneur arrivé ou attendu dans 15 jours ou moins.
- Page **Marges** : chaque envoi d'argent en Corée a un destinataire (fournisseur ou transporteur). Le partenaire voit la date et le montant, jamais la note.

Important : ne jamais revenir à une ancienne version de la plateforme tant que des comptes partenaires existent. L'ancienne version ne connaît pas ces comptes et les laisserait tout voir. En cas de doute, désactiver d'abord leurs comptes dans **Comptes**.

## Au quotidien

- **Aujourd'hui** : les relances et annonces à envoyer. « Ouvrir WhatsApp » ouvre la conversation avec le message déjà écrit ; « Marquer comme envoyé » la retire de la liste. Rien ne part tout seul.
- **Conteneurs** : colle le lien de suivi MSC et saisis la date d'arrivée prévue. Les relances de solde apparaissent 10 jours avant.
- **Clients** : versements (un reçu numéroté est créé à chaque fois), pénalités de retard, contrat.
- Pour que WhatsApp s'ouvre sur le bon compte, connecte le WhatsApp Business (077 22 99 98) sur WhatsApp Web dans le navigateur.

## Sauvegardes

- La base est dans `C:\MT\transport\data\transport.db`, volontairement hors de OneDrive.
- Chaque soir à 20 h, une copie part dans `OneDrive\Sauvegardes\MT-Transport\transport-AAAA-MM-JJ.db`. Les 30 derniers jours sont gardés.
- Les photos et documents déposés (propositions du fournisseur, documents du transporteur) sont dans `C:\MT\transport\fichiers`, sous des noms tirés au hasard (le vrai nom est gardé dans la base). Chaque soir, les nouveaux fichiers sont copiés dans `OneDrive\Sauvegardes\MT-Transport\fichiers`. Rien n'y est jamais effacé : un fichier supprimé de la plateforme reste dans la sauvegarde. Ce dossier se règle par la variable `MT_FILES_DIR` (l'installateur la fixe).
- Si aucune sauvegarde n'a été écrite depuis plus de 2 jours, la page **Aujourd'hui** l'affiche en rouge à l'administrateur.
- Les journaux du serveur et de la sauvegarde sont dans `C:\MT\transport\logs`.
- Pour faire une copie tout de suite :

  ```bash
  node scripts/sauvegarde.js
  ```

### Restaurer une sauvegarde

1. Dans le Planificateur de tâches, arrêter « MT Transport - serveur ».
2. Copier le fichier voulu vers `C:\MT\transport\data\transport.db`. Supprimer `transport.db-wal` et `transport.db-shm` s'ils existent. Si des photos ou documents manquent, recopier le contenu de `OneDrive\Sauvegardes\MT-Transport\fichiers` dans `C:\MT\transport\fichiers`.
3. Relancer la tâche « MT Transport - serveur ».

## Pour le développeur

```bash
npm test
```

Les règles d'argent sont dans `src/calc.js`. Le test `tests/donnees.test.js` vérifie les soldes validés par Eric : 45 110 000 F au 10/11/2026, puis 48 260 000 F après la mise à jour du 11/11 (voitures de Gaston). Il doit rester vert après toute modification.

Les vrais prix d'achat (`scripts/prix-reels.js`) et les tests qui vérifient ces montants (marges et soldes des partenaires) restent sur le PC, hors GitHub. Sur le PC, `npm test` les lance avec les autres.

Réglages par variables d'environnement : `MT_PORT` (3210), `MT_DATA_DIR`, `MT_BACKUP_DIR`, `MT_HTTPS=1` pour forcer le cookie sécurisé.
