// Trois petits gestes, sans rien d'autre : copier un message, imprimer, revenir en arrière.
document.addEventListener('click', evenement => {
  const copier = evenement.target.closest('[data-copier]');
  if (copier) {
    navigator.clipboard.writeText(copier.dataset.copier).then(
      () => { copier.textContent = 'Copié'; },
      () => { copier.textContent = 'Copie impossible : sélectionnez le texte'; });
  }
  if (evenement.target.closest('[data-imprimer]')) window.print();
  if (evenement.target.closest('[data-retour]')) history.back();
});

// Demande confirmation avant une action qu'on ne refait pas (annuler, supprimer).
document.addEventListener('submit', evenement => {
  const formulaire = evenement.target;
  const question = formulaire.dataset.confirmer;
  if (question && !window.confirm(question)) { evenement.preventDefault(); return; }
  // Un double clic ne doit pas envoyer deux fois le même versement.
  if (formulaire.method === 'post') {
    for (const bouton of formulaire.querySelectorAll('button:not([type="button"])')) {
      setTimeout(() => { bouton.disabled = true; }, 0);
      setTimeout(() => { bouton.disabled = false; }, 8000); // si l'envoi a échoué, on peut réessayer
    }
  }
});
