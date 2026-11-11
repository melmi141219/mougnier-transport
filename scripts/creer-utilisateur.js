// Crée un compte : node scripts/creer-utilisateur.js <identifiant> "<nom>" <admin|collaborateur|fournisseur|transporteur>
// Le mot de passe est demandé au clavier et ne s'affiche pas.
import readline from 'node:readline';
import { config } from '../src/config.js';
import { ouvrirBase } from '../src/db.js';
import { creerUtilisateur } from '../src/auth.js';

function demanderSecret(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    rl._writeToOutput = () => {}; // n'affiche pas la frappe
    rl.question('', reponse => { rl.close(); process.stdout.write('\n'); resolve(reponse); });
  });
}

const [identifiant, nom, role] = process.argv.slice(2);
if (!identifiant || !nom || !role) {
  console.error('Usage : node scripts/creer-utilisateur.js <identifiant> "<nom>" <admin|collaborateur|fournisseur|transporteur>');
  process.exit(1);
}
try {
  const motDePasse = await demanderSecret('Mot de passe (10 caractères au moins) : ');
  if (motDePasse !== await demanderSecret('Encore une fois : ')) throw new Error('Les deux saisies sont différentes.');
  creerUtilisateur(ouvrirBase(config.fichierBase), { identifiant, nom, role, motDePasse });
  console.log(`Compte « ${identifiant} » créé (${role}).`);
} catch (erreur) {
  console.error(`Compte non créé : ${erreur.message}`);
  process.exit(1);
}
