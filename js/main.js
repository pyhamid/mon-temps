// Point d'entrée : l'application ne se charge qu'après la saisie du code.
import { unlock } from './lock.js';

await unlock();
document.body.classList.remove('locked');
await import('./ui.js');

// Verrouille de nouveau après 2 minutes en arrière-plan (le chrono en cours n'est pas interrompu).
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 120000) location.reload();
});
