// Couche calendrier. V1 : import d'un fichier .ics (Google Agenda → Paramètres → Exporter).
// Google Agenda direct : voir google.js (même interface CalendarProvider).
import { dayKey, dayStartMs, addDays, uid } from './time.js';

/** Interface à implémenter par chaque fournisseur de calendrier. */
export class CalendarProvider {
  /** @returns {Promise<{uid:string,title:string,start:number,end:number}[]>} événements (ms) d'un jour */
  async getEvents(_dayKey) { throw new Error('non implémenté'); }
  /** Crée un événement de productivité dans le calendrier dédié de l'app. */
  async createEvent(_ev) { throw new Error('non implémenté'); }
}

function unfold(text) { return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); }

function parseDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { allDay: true, ms: new Date(+y, +mo - 1, +d).getTime() };
  return { ms: z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) : new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)).getTime() };
}

/** Lit les VEVENT simples. Les récurrences (RRULE) ne sont pas développées en V1. */
export function parseICS(text) {
  const events = [];
  let ev = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') {
      if (ev?.start && ev.end && !ev.start.allDay)
        events.push({ uid: ev.uid || uid(), title: ev.title || 'Événement', start: ev.start.ms, end: ev.end.ms, recurring: ev.rrule });
      ev = null;
    } else if (ev) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const name = line.slice(0, i).split(';')[0], val = line.slice(i + 1);
      if (name === 'DTSTART') ev.start = parseDate(val);
      else if (name === 'DTEND') ev.end = parseDate(val);
      else if (name === 'SUMMARY') ev.title = val.replace(/\\,/g, ',').replace(/\\n/gi, ' ');
      else if (name === 'UID') ev.uid = val;
      else if (name === 'RRULE') ev.rrule = true;
    }
  }
  return events;
}

/** Ajoute les événements comme contraintes fixes (Obligations) dans les jours concernés. */
export function importEvents(events, ensureDay, st, source = 'ics') {
  let n = 0;
  for (const e of events) {
    let key = dayKey(new Date(e.start));
    const last = dayKey(new Date(e.end - 1));
    for (let i = 0; i < 60 && key <= last; i++, key = addDays(key, 1)) {
      const s0 = dayStartMs(key);
      const start = Math.max(0, Math.round((e.start - s0) / 60000)), end = Math.min(1440, Math.round((e.end - s0) / 60000));
      if (end <= start) continue;
      const day = ensureDay(st, key), id = `${source}:${e.uid}:${key}`;
      day.plan = day.plan.filter(b => b.id !== id);
      day.plan.push({ id, start, end, ...(e.cat ? { cat: e.cat, ...(e.sub ? { sub: e.sub } : {}) } : { cat: 'prod', sub: 'trav' }), title: e.title, fixed: true, source, ...(e.unplanned ? { unplanned: true } : {}) });
      day.plan.sort((a, b) => a.start - b.start);
      n++;
    }
  }
  return n;
}

/** Retire les blocs importés d'une source sur une plage de jours (avant une nouvelle synchronisation). */
export function clearImported(ensureDay, st, source, fromKey, days) {
  let key = fromKey;
  for (let i = 0; i < days; i++, key = addDays(key, 1)) {
    const d = st.days[key];
    if (d) d.plan = d.plan.filter(b => b.source !== source);
  }
}

/** Lit un lien d'abonnement .ics (https:// ou webcal://). Échoue si le serveur n'autorise pas la lecture depuis un navigateur (CORS). */
export async function fetchICS(url) {
  const u = url.trim().replace(/^webcal:/i, 'https:');
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error(`le serveur répond ${r.status}`);
  const text = await r.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('ce lien ne contient pas de calendrier');
  return parseICS(text);
}
