// Notifications locales. Sans serveur push, elles partent tant que l'app est ouverte
// ou en arrière-plan du navigateur (limite connue d'une PWA sans backend).
import { get, markNotified } from './store.js';
import { signals } from './signals.js';

export const supported = () => 'Notification' in window;

export async function askPermission() {
  if (!supported()) return 'unsupported';
  return Notification.requestPermission();
}

async function show(sig) {
  const opts = { body: sig.text, tag: sig.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) reg.showNotification('Mon temps', opts);
  else new Notification('Mon temps', opts);
}

/** À appeler régulièrement. Une notification n'est envoyée qu'une fois, et seulement si l'app n'est pas au premier plan. */
export function check(now = Date.now()) {
  if (!supported() || Notification.permission !== 'granted') return;
  const st = get();
  for (const sig of signals(st, now)) {
    if (!sig.notify || st.settings.notif[sig.type] === false || st.notified[sig.id]) continue;
    markNotified(sig.id, now);
    if (document.hidden) show(sig);   // visible à l'écran = déjà dans les alertes de l'app
  }
}
