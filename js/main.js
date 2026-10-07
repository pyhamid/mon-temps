// Point d'entrée : l'application ne se charge qu'après la saisie du code.
import { unlock, isTrusted } from './lock.js';

await unlock();
document.body.classList.remove('locked');
try {
  await import('./ui.js');
} catch (e) {
  // fichiers incomplets (ancienne version gardée en mémoire) : proposer une réparation, sans toucher aux données
  document.getElementById('app').innerHTML = `<section class="card"><h2>Mise à jour incomplète</h2>
    <p>Une ancienne version est restée en mémoire. Tes données ne sont pas touchées.</p>
    <button class="btn primary big" id="repair">Réparer</button>
    <p class="muted small">${String(e.message).replace(/[<>&]/g, '')}</p></section>`;
  document.getElementById('repair').onclick = async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    location.reload();
  };
}

// Si l'appareil n'est pas « de confiance » : verrouille de nouveau après 2 minutes en arrière-plan.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (isTrusted()) return;
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 120000) location.reload();
});
