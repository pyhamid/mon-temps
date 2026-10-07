// Point d'entrée : l'application ne se charge qu'après la saisie du code.
import { unlock, isTrusted } from './lock.js';

await unlock();
document.body.classList.remove('locked');
await import('./ui.js');

// Si l'appareil n'est pas « de confiance » : verrouille de nouveau après 2 minutes en arrière-plan.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (isTrusted()) return;
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 120000) location.reload();
});
