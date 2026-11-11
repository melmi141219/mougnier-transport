// Lancé par la tâche « MT Transport - serveur ». Il démarre la plateforme et la relance chaque fois qu'elle s'arrête.
// Une mise à jour (scripts/mettre-a-jour.ps1) copie le nouveau programme puis demande au serveur de s'arrêter :
// le superviseur le relance avec le nouveau code, sans droits administrateur.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVEUR = fileURLToPath(new URL('../src/server.js', import.meta.url));
let arretsRapides = 0;

function lancer() {
  const debut = Date.now();
  const serveur = spawn(process.execPath, [SERVEUR], { stdio: 'inherit' });
  serveur.on('exit', code => {
    // Un serveur qui s'arrête tout de suite, en boucle, est relancé de plus en plus lentement (une minute au plus).
    arretsRapides = Date.now() - debut < 10000 ? arretsRapides + 1 : 0;
    const attente = code === 0 && arretsRapides === 0 ? 500 : Math.min(60000, 1000 * 2 ** arretsRapides);
    console.log(`${new Date().toISOString()} serveur arrêté (code ${code}), relancé dans ${attente / 1000} s`);
    setTimeout(lancer, attente);
  });
}

lancer();
