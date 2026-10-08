// Signaux = alertes affichées dans l'app ET (si autorisé) envoyées en notification.
// Chaque signal a un id stable pour ne notifier qu'une seule fois.
import { dayKey, minuteOf, fmtDur, fmtHM } from './time.js';
import { analyse, blockDone, entriesOf, sessionElapsed } from './analysis.js';

export function signals(state, nowMs = Date.now()) {
  const key = dayKey(new Date(nowMs)), day = state.days[key] || { plan: [], goals: [], log: [] };
  const a = analyse(state, key, nowMs), nowM = minuteOf(nowMs, key), cur = state.current, out = [];
  // Chrono oublié : tourne depuis très longtemps, ou pendant la nuit
  if (cur && cur.cat !== 'pause') {
    const el = (nowMs - cur.start) / 60000;
    if (el >= 240 || (el >= 60 && (nowM < a.wake || nowM >= a.bed)))
      out.push({ id: `stale:${cur.id}`, type: 'end', icon: '⏱️', notify: false, action: 'stale',
        text: `Le chrono « ${cur.title} » tourne depuis ${fmtDur(el)}. Tu as oublié de l'arrêter ?` });
  }
  if (nowM < a.wake || nowM >= a.bed) return out;        // pas d'autre alerte pendant le sommeil

  // Pause plus longue que prévu
  if (cur?.cat === 'pause' && cur.plannedMin && nowMs >= cur.start + cur.plannedMin * 60000)
    out.push({ id: `pause:${cur.id}`, type: 'pause', icon: '🌿', notify: true, action: 'resume',
      text: `Ta pause prévue de ${fmtDur(cur.plannedMin)} est terminée (${fmtDur((nowMs - cur.start) / 60000)} écoulées). On reprend quand tu veux.` });

  // Fin de session
  const isG = x => x.cat === 'prod' || (x.cat === 'obl' && !!x.goalId);
  if (cur && isG(cur)) {
    const cm = minuteOf(cur.start, key);
    const b = day.plan.find(x => isG(x) && x.start <= cm + 5 && cm < x.end && (!x.goalId || x.goalId === cur.goalId));
    const long = sessionElapsed(state, nowMs) / 60000 >= state.settings.session;
    if ((b && nowM >= b.end) || (!b && long))
      out.push({ id: `end:${cur.sid}:${b?.id || ''}`, type: 'end', icon: '⏰', notify: true, action: 'stop',
        text: 'Ta session est terminée. Veux-tu continuer ou passer à l\'activité suivante ?' });
  }

  // Rappels de début et retards (uniquement si rien de productif n'est en cours)
  if (!cur || cur.cat === 'pause') {
    for (const b of day.plan) {
      if (!isG(b) || b.end <= nowM || (b.fixed && b.sub === 'trav')) continue;
      const started = blockDone(state, key, b, nowMs) > 0;
      if (started) continue;
      if (nowM >= b.start && nowM < b.start + 10)
        out.push({ id: `rem:${b.id}`, type: 'reminder', icon: '📚', notify: true, action: 'start-block', ref: b.id,
          text: `Il est temps de commencer : ${b.title} (${fmtHM(b.start)}–${fmtHM(b.end)}).` });
      else if (nowM >= b.start + 10)
        out.push({ id: `late:${b.id}`, type: 'late', icon: '⚠️', notify: true, action: 'start-block', ref: b.id,
          text: `Tu avais prévu de commencer ${b.title} à ${fmtHM(b.start)}. Tu n'as pas encore commencé. Veux-tu commencer maintenant ?` });
    }
  }

  // Temps non identifié
  const bucket = Math.floor(nowMs / 7200000);
  a.gaps.slice(-3).forEach((g, i, l) => out.push({
    id: `unk:${key}:${bucket}:${g.start}`, type: 'unknown', icon: '❓', action: 'gap', ref: `${g.start}-${g.end}`,
    notify: i === l.length - 1 && a.unkPending >= 45,
    text: a.unkPending >= 45 && i === l.length - 1
      ? `Il y a ${fmtDur(a.unkPending)} non identifiées dans ta journée. Que faisais-tu ?`
      : `Une activité de ${fmtDur(g.end - g.start)} n'est pas identifiée (${fmtHM(g.start)}–${fmtHM(g.end)}).`,
  }));

  // Planning perturbé
  const bad = day.plan.filter(b => b.source === 'auto' && isG(b) && b.end > 0 &&
    ((b.end <= nowM && blockDone(state, key, b, nowMs) < (b.end - b.start) / 2) || (b.start < a.wake && b.end > nowM)));
  if (bad.length)
    out.push({ id: `reorg:${key}:${bad.map(b => b.id).join(',')}`, type: 'reorg', icon: '⚠️', notify: true, action: 'reorg',
      text: 'Ton planning a été perturbé. Veux-tu que je propose une réorganisation du reste de la journée ?' });

  return out;
}
