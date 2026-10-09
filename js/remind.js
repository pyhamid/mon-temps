// Rappels envoyés via Google Agenda : l'app ne peut pas notifier quand elle est fermée (pas de serveur),
// mais l'application Google Agenda du téléphone, elle, le fait. On y met donc des événements avec un rappel.

/** Minutes (dans la journée) des « points rapides » restants : toutes les `every` minutes, entre le réveil et le coucher, hors cours / travail. */
export function checkIns({ nowM, wake, bed, every, busy = [] }) {
  const out = [];
  if (!(every >= 30)) return out;
  for (let m = Math.ceil((wake + 60) / every) * every; m <= bed - 30; m += every) {
    if (m < nowM + 5) continue;
    if (busy.some(b => m >= b.start && m < b.end)) continue;
    out.push(m);
  }
  return out;
}
