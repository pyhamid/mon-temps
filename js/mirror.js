// Relecture du calendrier « Mon temps » (miroir de l'app dans Google Agenda).
// Tu peux y changer la couleur (= le type), l'heure, le titre, ou supprimer un événement :
// l'import applique ces changements aux activités de l'app, jours passés compris.
import { dayKey, dayStartMs } from './time.js';

/** Retire l'emoji de tête que l'app ajoute aux titres (« 📚 Signal » → « Signal »). */
export const stripEmoji = t => (t || '').replace(/^[\p{Extended_Pictographic}‍️]+\s*/u, '').trim();

const isLogItem = i => i.startsWith('log:') || i.startsWith('imp:');

/**
 * @param st        état (modifié sur place, à appeler dans update())
 * @param events    événements du calendrier « Mon temps » : { id, title, start, end, colorId }
 * @param classify  colorId → { cat, sub?, unplanned? }
 * @param opts      { fromMs, toMs, uid } : période relue (pour savoir ce qui a été supprimé)
 * @returns         { updated, created, removed }
 */
export function applyMirror(st, events, classify, { fromMs, toMs, uid }) {
  // événements que tu as supprimés dans l'app : on ne les réapprend pas (ils seront supprimés dans Google au prochain envoi)
  const dead = new Set(st.settings?.tombstones || []);
  events = events.filter(e => !dead.has(e.id));
  const stat = { updated: 0, created: 0, removed: 0 };
  // une correction faite dans l'app APRÈS la dernière modification dans Google l'emporte (elle sera envoyée au prochain « Envoyer »)
  const appWins = (item, e) => !!item.editedAt && item.editedAt > (e.updated ?? Infinity);
  const kind = e => (e.colorId == null ? { cat: 'prod', sub: 'etu' } : classify(e.colorId));
  const ensure = k => (st.days[k] ||= { wakePlanned: null, wakeActual: null, sleepPlanned: null, goals: [], plan: [], log: [] });

  // événement Google → élément de l'app (pour les éléments déjà envoyés par l'app)
  const rev = {};
  for (const [dk, d] of Object.entries(st.days)) for (const [item, ev] of Object.entries(d.gcal || {})) rev[ev] = { dk, item };
  // Anciens événements « ⬛ Non identifié » créés par l'app avant les repères internes (et inconnus de l'app) : ce ne sont pas des activités.
  // (s'il a été recolorié, c'est devenu une vraie activité : on le garde)
  events = events.filter(e => e.mt || rev[e.id] || !/^\s*⬛/.test(e.title || '') || kind(e).cat !== 'unk');
  const seen = new Set(events.map(e => e.id));
  for (const e of events) if (e.mt && e.mt.includes('|')) {        // repère inscrit dans l'événement : fonctionne depuis n'importe quel appareil
    const p = e.mt.indexOf('|');
    rev[e.id] = { dk: e.mt.slice(0, p), item: e.mt.slice(p + 1) };
  }

  const locate = id => {
    for (const [dk, d] of Object.entries(st.days)) {
      const i = d.log.findIndex(x => x.id === id);
      if (i >= 0) return { dk, i, en: d.log[i] };
    }
    return null;
  };
  const same = (en, e, k) => en.start === e.start && en.end === e.end && en.cat === k.cat && (en.sub || undefined) === (k.sub || undefined)
    && !!en.unplanned === !!k.unplanned && (stripEmoji(e.title) ? en.title === stripEmoji(e.title) : true);
  const apply = (en, e, k) => {
    en.start = e.start; en.end = e.end; en.cat = k.cat;
    if (k.sub) en.sub = k.sub; else delete en.sub;
    if (k.unplanned) en.unplanned = true; else delete en.unplanned;
    if (k.cat === 'unk') en.dontKnow = true; else delete en.dontKnow;
    const t = stripEmoji(e.title); if (t) en.title = t;
  };
  const rehome = loc => {            // l'entrée appartient au jour où elle commence
    const nk = dayKey(new Date(loc.en.start));
    if (nk !== loc.dk) { st.days[loc.dk].log.splice(loc.i, 1); ensure(nk).log.push(loc.en); }
  };
  const minutes = (ms, dk) => Math.max(0, Math.min(1440, Math.round((ms - dayStartMs(dk)) / 60000)));
  const newEntry = (e, k, id) => {
    const en = { id, cat: k.cat, title: stripEmoji(e.title) || 'Activité', goalId: null, start: e.start, end: e.end };
    apply(en, e, k);
    ensure(dayKey(new Date(e.start))).log.push(en);
    return en;
  };

  // activité qui n'existe que dans Google (créée à la main, ou envoyée par un autre appareil) : on l'apprend / on la met à jour
  const learn = (e, k) => {
    const loc = locate(`g:${e.id}`);
    if (loc) { if (!appWins(loc.en, e) && !same(loc.en, e, k)) { apply(loc.en, e, k); rehome(loc); stat.updated++; } }
    else { newEntry(e, k, `g:${e.id}`); stat.created++; }
  };
  for (const e of events) {
    const k = kind(e), r = rev[e.id];
    if (!r) { learn(e, k); continue; }
    const d = st.days[r.dk] || ensure(r.dk), item = r.item;
    if (isLogItem(item)) {
      const loc = locate(item.replace(/^(log|imp):/, ''));
      if (!loc) { if (k.cat !== 'unk') learn(e, k); }      // envoyée par un autre appareil
      else if (!appWins(loc.en, e) && !same(loc.en, e, k)) { apply(loc.en, e, k); rehome(loc); stat.updated++; }
    } else if (item.startsWith('lost:')) {              // « je ne sais plus » : recolorié = identifié
      const loc = locate(item.slice(5));
      if (loc && k.cat !== 'unk') { apply(loc.en, e, k); rehome(loc); delete d.gcal[item]; stat.updated++; }
    } else if (item.startsWith('gap:')) {               // trou noir recolorié = identifié
      if (k.cat !== 'unk') { newEntry(e, k, `g:${e.id}`); delete d.gcal[item]; stat.created++; }
    } else {                                            // session planifiée
      const b = d.plan.find(x => x.id === item);
      if (!b || appWins(b, e)) continue;
      if (k.cat === 'prod' || b.fixed) {
        const nk = dayKey(new Date(e.start)), s = minutes(e.start, nk), z = minutes(e.end, nk);
        const t = stripEmoji(e.title) || b.title;
        if (nk === r.dk) {
          if (b.start !== s || b.end !== z || b.sub !== k.sub || b.cat !== k.cat || b.title !== t || !!b.unplanned !== !!k.unplanned) {
            Object.assign(b, { start: s, end: z, cat: k.cat, title: t });
            if (k.sub) b.sub = k.sub; else delete b.sub;
            if (k.unplanned) b.unplanned = true; else delete b.unplanned;
            stat.updated++;
          }
        } else {                                        // déplacée un autre jour
          d.plan = d.plan.filter(x => x !== b);
          const nb = { ...b, start: s, end: z, cat: k.cat, title: t }; if (k.sub) nb.sub = k.sub; else delete nb.sub;
          const nd = ensure(nk); nd.plan.push(nb);
          nd.plan.sort((x, y) => x.start - y.start);
          nd.gcal = { ...(nd.gcal || {}), [item]: e.id }; delete d.gcal[item]; stat.updated++;
        }
      } else {                                          // changée en pause / loisir… = c'est devenu une activité faite
        d.plan = d.plan.filter(x => x !== b); delete d.gcal[item];
        newEntry(e, k, `g:${e.id}`); stat.created++;
      }
    }
  }

  // supprimé dans Google (uniquement sur la période relue)
  for (const [dk, d] of Object.entries(st.days)) {
    const t0 = dayStartMs(dk);
    if (t0 < fromMs || t0 >= toMs) continue;
    for (const [item, ev] of Object.entries({ ...(d.gcal || {}) })) {
      if (seen.has(ev)) continue;
      if (isLogItem(item)) { const loc = locate(item.replace(/^(log|imp):/, '')); if (loc) { st.days[loc.dk].log.splice(loc.i, 1); stat.removed++; } }
      else if (!item.startsWith('gap:') && !item.startsWith('lost:')) { d.plan = d.plan.filter(x => x.id !== item); stat.removed++; }
      delete d.gcal[item];
    }
    d.log = d.log.filter(en => { const gone = en.id.startsWith('g:') && !seen.has(en.id.slice(2)) && en.start >= fromMs && en.start < toMs; if (gone) stat.removed++; return !gone; });
  }
  return stat;
}
