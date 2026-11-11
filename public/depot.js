// Dépôt de fichiers : <input type="file" data-depot="/adresse"> (multiple permis), chargé par <script src="/depot.js" defer>.
// Chaque photo est réduite à 1 600 px de large au plus et réenregistrée en JPEG, ce qui retire aussi la position GPS ;
// un PDF part tel quel. Les fichiers partent un par un ; au premier refus, le message du serveur s'affiche ;
// quand tout est parti, la page se recharge.
const ANGLAIS = document.documentElement.lang === 'en';
const TEXTES = ANGLAIS
  ? {
    envoi: 'Sending', echec: 'Sending failed', photo: 'This photo cannot be read. Send it as JPEG or PNG.',
    session: 'Your session has expired. Log in again, then send the file again.',
    reseau: 'The file did not reach the platform (connection lost or session expired). Reload the page and try again.',
    partiels: (n, total) => `${n} of ${total} files were sent before this error: reload the page to see them before sending the rest.`,
  }
  : {
    envoi: 'Envoi', echec: 'Échec de l’envoi', photo: 'Cette photo est illisible. Envoyez-la en JPEG ou en PNG.',
    session: 'Votre session a expiré. Reconnectez-vous, puis renvoyez le fichier.',
    reseau: 'Le fichier n’est pas arrivé (connexion coupée ou session expirée). Rechargez la page et recommencez.',
    partiels: (n, total) => `${n} fichier(s) sur ${total} sont partis avant cette erreur : rechargez la page pour les voir avant d’envoyer les autres.`,
  };
const LARGEUR_MAX = 1600;
const CHAMPS = [...document.querySelectorAll('input[type="file"][data-depot]')];

// createImageBitmap plutôt qu'une <img> : la politique de sécurité de la plateforme interdit les images « blob: ».
async function preparer(fichier) {
  if (!fichier.type.startsWith('image/')) return { corps: fichier, type: fichier.type || 'application/octet-stream', nom: fichier.name };
  let image;
  try { image = await createImageBitmap(fichier); } catch { throw new Error(TEXTES.photo); }
  const echelle = Math.min(1, LARGEUR_MAX / image.width); // jamais agrandie
  const toile = document.createElement('canvas');
  toile.width = Math.round(image.width * echelle);
  toile.height = Math.round(image.height * echelle);
  toile.getContext('2d').drawImage(image, 0, 0, toile.width, toile.height);
  image.close();
  const corps = await new Promise(fin => toile.toBlob(fin, 'image/jpeg', 0.8));
  if (!corps) throw new Error(TEXTES.photo);
  return { corps, type: 'image/jpeg', nom: fichier.name.replace(/\.[^.]*$/, '') + '.jpg' };
}

async function envoyer(adresse, fichier) {
  const { corps, type, nom } = await preparer(fichier);
  let reponse;
  try {
    reponse = await fetch(adresse, { method: 'POST', body: corps, headers: { 'Content-Type': type, 'X-Nom-Fichier': encodeURIComponent(nom) } });
  } catch {
    throw new Error(TEXTES.reseau); // par exemple la porte de Cloudflare qui redemande le code
  }
  // Session expirée : le serveur renvoie vers la page de connexion, que fetch suit comme une réussite.
  if (reponse.redirected && new URL(reponse.url).pathname === '/connexion') throw new Error(TEXTES.session);
  if (reponse.ok) return;
  const page = new DOMParser().parseFromString(await reponse.text(), 'text/html');
  throw new Error(page.querySelector('.alerte')?.textContent.trim() || `${TEXTES.echec} (${reponse.status})`);
}

for (const champ of CHAMPS) {
  const etat = document.createElement('p');
  etat.setAttribute('role', 'status');
  champ.after(etat);
  champ.addEventListener('change', async () => {
    const fichiers = [...champ.files];
    if (!fichiers.length) return;
    // Un seul envoi à la fois sur la page : le rechargement de la fin couperait un autre envoi en cours.
    for (const c of CHAMPS) c.disabled = true;
    etat.className = 'discret';
    let envoyes = 0;
    try {
      for (const fichier of fichiers) {
        etat.textContent = `${TEXTES.envoi} ${envoyes + 1} / ${fichiers.length}…`;
        await envoyer(champ.dataset.depot, fichier);
        envoyes++;
      }
      location.reload();
    } catch (erreur) {
      etat.className = 'alerte';
      etat.textContent = envoyes ? `${erreur.message} ${TEXTES.partiels(envoyes, fichiers.length)}` : erreur.message;
      for (const c of CHAMPS) c.disabled = false;
      champ.value = '';
    }
  });
}
