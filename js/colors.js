// Code couleur commun à l'app et à Google Agenda.
// Google Agenda propose 11 couleurs d'événement (colorId 1 à 11) : chaque catégorie en reçoit une,
// et on s'en sert dans les deux sens (envoi vers Google, lecture depuis Google).

export const GOOGLE_COLORS = [
  { id: '1', name: 'Lavande', hex: '#7986cb' },
  { id: '2', name: 'Sauge', hex: '#33b679' },
  { id: '3', name: 'Raisin', hex: '#8e24aa' },
  { id: '4', name: 'Flamant', hex: '#e67c73' },
  { id: '5', name: 'Banane', hex: '#f6bf26' },
  { id: '6', name: 'Mandarine', hex: '#f4511e' },
  { id: '7', name: 'Paon', hex: '#039be5' },
  { id: '8', name: 'Graphite', hex: '#616161' },
  { id: '9', name: 'Myrtille', hex: '#3f51b5' },
  { id: '10', name: 'Basilic', hex: '#0b8043' },
  { id: '11', name: 'Tomate', hex: '#d50000' },
];

/** Ordre = priorité si deux catégories partagent la même couleur. */
export const COLOR_KEYS = ['obl', 'imp', 'lost', 'prod', 'pause', 'vie', 'loisir'];

export const COLOR_META = {
  obl:    { emoji: '🔴', label: 'Cours / obligations', hint: 'Événements importés sans couleur particulière' },
  imp:    { emoji: '⚡', label: 'Imprévus', hint: 'Ce qui n\'était pas prévu' },
  lost:   { emoji: '⬛', label: 'Temps perdu', hint: 'Temps passé à ne rien faire / non identifié' },
  prod:   { emoji: '📚', label: 'Productivité', hint: 'Sessions de travail' },
  pause:  { emoji: '🌿', label: 'Pause / repos', hint: '' },
  vie:    { emoji: '🧹', label: 'Vie quotidienne', hint: 'Repas, ménage, courses…' },
  loisir: { emoji: '🎮', label: 'Divertissement', hint: 'Loisir choisi' },
};

export const DEFAULT_COLORS = { obl: '9', imp: '6', lost: '8', prod: '10', pause: '2', vie: '7', loisir: '5' };

export const hexOf = id => (GOOGLE_COLORS.find(c => c.id === String(id)) || GOOGLE_COLORS[7]).hex;
export const nameOf = id => (GOOGLE_COLORS.find(c => c.id === String(id)) || { name: '?' }).name;

/** Catégories qui partagent la même couleur (Google ne pourrait pas les distinguer). */
export function duplicates(colors) {
  const seen = {}, dup = [];
  for (const k of COLOR_KEYS) {
    const c = colors[k];
    if (seen[c]) dup.push([seen[c], k]); else seen[c] = k;
  }
  return dup;
}

/** colorId Google (ou rien) → { cat, unplanned? } utilisable dans le planning. Sans couleur : cours/obligation. */
export function classifier(colors) {
  const kinds = { obl: { cat: 'obl' }, imp: { cat: 'obl', unplanned: true }, lost: { cat: 'unk' }, prod: { cat: 'prod' }, pause: { cat: 'pause' }, vie: { cat: 'vie' }, loisir: { cat: 'loisir' } };
  return id => kinds[id == null ? 'obl' : COLOR_KEYS.find(k => colors[k] === String(id))] || kinds.obl;
}
