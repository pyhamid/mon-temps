// Créneaux fixes qui se répètent (comme « Répéter » dans Google Agenda) : une règle, et un bloc par jour concerné.

export const REPEAT_LABEL = { week: 'Chaque semaine (même jour)', weekdays: 'Du lundi au vendredi', daily: 'Tous les jours' };
const dow = key => new Date(key.replace(/-/g, '/')).getDay();

/** La règle s'applique-t-elle à ce jour ? (après son début, avant sa fin éventuelle, hors occurrences supprimées) */
export function ruleMatches(rule, key) {
  if (key < rule.from || (rule.until && key > rule.until) || (rule.skip || []).includes(key)) return false;
  const d = dow(key);
  return rule.mode === 'daily' || (rule.mode === 'weekdays' && d >= 1 && d <= 5) || (rule.mode === 'week' && d === rule.dow);
}

export const blockId = (rule, key) => `${rule.id}:${key}`;

/** Le bloc du planning pour un jour donné. */
export function blockFor(rule, key) {
  return { id: blockId(rule, key), start: rule.start, end: rule.end, cat: rule.cat, ...(rule.sub ? { sub: rule.sub } : {}), title: rule.title, fixed: true, source: 'user', recurId: rule.id };
}

export const newRule = (id, { title, start, end, cat, sub }, mode, fromKey) =>
  ({ id, title, start, end, cat, ...(sub ? { sub } : {}), mode, dow: dow(fromKey), from: fromKey, until: '', skip: [] });
