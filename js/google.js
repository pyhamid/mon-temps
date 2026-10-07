// Liaison Google Agenda (API v3) via Google Identity Services, sans serveur.
// Droits demandés :
//  - calendar.readonly       : lire la liste de tes calendriers et tes événements (cours, rendez-vous…)
//  - calendar.app.created    : créer et gérer le calendrier "Mon temps" créé par l'app
//  - calendar.events         : modifier un événement existant (couleur, titre, heure) quand tu le changes dans l'app
// Le jeton reste en mémoire (1 h) ; rien n'est envoyé ailleurs qu'à Google.
import { CalendarProvider } from './calendar.js';
import { dayStartMs } from './time.js';

const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';
const CAL_NAME = 'Mon temps';
let token = null, expires = 0;

export const isConnected = () => !!token && Date.now() < expires;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function preload() {
  if (window.google?.accounts?.oauth2 || document.getElementById('gis')) return;
  const s = document.createElement('script');
  s.id = 'gis'; s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  document.head.appendChild(s);
}

/** À appeler directement depuis un clic (la fenêtre Google ne doit pas être bloquée). */
export function connect(clientId, { silent = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!clientId) return reject(new Error('Renseigne d\'abord l\'identifiant client Google.'));
    if (!window.google?.accounts?.oauth2) { preload(); return reject(new Error('Service Google pas encore chargé (connexion ?). Réessaie dans un instant.')); }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPES,
      callback: r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = r.access_token; expires = Date.now() + (r.expires_in - 60) * 1000; resolve();
      },
      error_callback: e => reject(new Error(e.type === 'popup_closed' ? 'Connexion annulée.' : (e.message || e.type))),
    });
    // '' : Google ne redemande l'accord qu'à la toute première connexion ; 'none' : jamais de fenêtre
    client.requestAccessToken({ prompt: silent ? 'none' : '' });
  });
}

async function api(path, opt = {}) {
  if (!isConnected()) throw new Error('Non connecté à Google.');
  const r = await fetch(API + path, { ...opt, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error?.message || msg; } catch { /* corps vide */ }
    const e = new Error(`Google Agenda : ${msg}`); e.status = r.status; throw e;
  }
  return r.status === 204 ? null : r.json();
}

export class GoogleCalendarProvider extends CalendarProvider {
  constructor(calId) { super(); this.calId = calId; }

  /** Événements d'un calendrier entre deux dates (ms), tels que renvoyés par Google (événements ponctuels, sans les journées entières). */
  async listEvents(calId, fromMs, toMs) {
    const out = [];
    let pageToken = '';
    for (let i = 0; i < 8; i++) {
      const q = new URLSearchParams({ timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      if (pageToken) q.set('pageToken', pageToken);
      const res = await api(`/calendars/${encodeURIComponent(calId)}/events?${q}`);
      for (const e of res.items || []) {
        if (e.status === 'cancelled' || !e.start?.dateTime) continue;
        out.push(e);
      }
      if (!(pageToken = res.nextPageToken)) break;
    }
    return out;
  }

  /** Événements de tous tes calendriers (sauf « Mon temps ») entre deux dates (ms). */
  async getEvents(fromMs, toMs, classify = () => ({})) {
    const list = await api('/users/me/calendarList?minAccessRole=reader');
    const out = [];
    for (const cal of list.items) {
      if (cal.id === this.calId || cal.selected === false) continue;
      for (const e of await this.listEvents(cal.id, fromMs, toMs)) {
        if (e.transparency === 'transparent') continue;
        if ((e.attendees || []).some(a => a.self && a.responseStatus === 'declined')) continue;
        out.push({ uid: e.id, title: e.summary || 'Événement', start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), calId: cal.id, writable: ['owner', 'writer'].includes(cal.accessRole), ...classify(e.colorId) });
      }
    }
    return out;
  }

  /** Événements du calendrier « Mon temps » (le miroir de l'app), avec leur couleur. */
  async getMirrorEvents(fromMs, toMs) {
    if (!this.calId) return [];
    try {
      return (await this.listEvents(this.calId, fromMs, toMs)).map(e => ({ id: e.id, title: e.summary || '', start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), colorId: e.colorId ?? null, mt: e.extendedProperties?.private?.mt || '', updated: Date.parse(e.updated) || 0 }));
    } catch (e) { if (e.status === 404 || e.status === 410) return []; throw e; }
  }

  /** Modifie un événement existant dans son calendrier d'origine. it : { summary, colorId, start, end } (minutes depuis minuit du jour s0). */
  async patchEvent(calId, eventId, it, s0) {
    const body = { summary: it.summary, colorId: it.colorId };
    if (it.start != null) {
      body.start = { dateTime: new Date(s0 + it.start * 60000).toISOString(), timeZone: tz() };
      body.end = { dateTime: new Date(s0 + it.end * 60000).toISOString(), timeZone: tz() };
    }
    return api(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  /** Tous les calendriers « Mon temps » de ce compte (il peut y en avoir plusieurs si l'app a été utilisée sur plusieurs appareils). */
  async findCalendars() {
    const list = await api('/users/me/calendarList?minAccessRole=owner');
    return (list.items || []).filter(c => c.summary === CAL_NAME).map(c => c.id);
  }

  /** Retourne l'id du calendrier « Mon temps » : réutilise celui qui existe déjà (même créé depuis un autre appareil), sinon le crée. */
  async ensureCalendar() {
    if (this.calId) {
      try { await api(`/calendars/${encodeURIComponent(this.calId)}`); return this.calId; }
      catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
    }
    const found = await this.findCalendars();
    if (found.length) { this.calId = found[0]; return this.calId; }
    const c = await api('/calendars', { method: 'POST', body: JSON.stringify({ summary: CAL_NAME, description: 'Mon temps : ce que tu fais, jour par jour', timeZone: tz() }) });
    this.calId = c.id;
    return c.id;
  }

  /**
   * Synchronise un jour avec le calendrier « Mon temps ». Chaque événement de l'app porte un repère interne (jour + élément),
   * ce qui permet de retrouver l'existant depuis n'importe quel appareil : jamais de doublon, les changements de l'app
   * mettent à jour l'événement, et ce qui n'existe plus dans l'app est supprimé.
   * @param items [{id,start,end,summary,colorId?}] (minutes depuis minuit) ; @param map { idÉlément: idÉvénement } (mémoire locale)
   * @param keep ids d'événements Google à ne jamais supprimer (activités venant de Google)
   */
  async pushDay(key, items, map = {}, keep = []) {
    const calId = await this.ensureCalendar(), cal = encodeURIComponent(calId), s0 = dayStartMs(key);
    const n = { created: 0, updated: 0, deleted: 0 }, out = {}, keepSet = new Set(keep);
    const mtOf = e => e.extendedProperties?.private?.mt || '';
    const sig = (summary, a, b) => `${summary}|${a}|${b}`;
    const ms = (it, f) => s0 + it[f] * 60000;
    const body = (it, mt) => JSON.stringify({
      summary: it.summary,
      ...(it.colorId ? { colorId: it.colorId } : {}),
      extendedProperties: { private: { mt } },
      start: { dateTime: new Date(ms(it, 'start')).toISOString(), timeZone: tz() },
      end: { dateTime: new Date(ms(it, 'end')).toISOString(), timeZone: tz() },
    });
    const del = async e => { try { await api(`/calendars/${cal}/events/${e.id}`, { method: 'DELETE' }); n.deleted++; } catch (err) { if (err.status !== 404 && err.status !== 410) throw err; } };

    const want = new Map(items.map(it => [`${key}|${it.id}`, it]));
    const bySig = new Map(items.map(it => [sig(it.summary, ms(it, 'start'), ms(it, 'end')), `${key}|${it.id}`]));
    const groups = new Map(), legacy = [];
    for (const e of await this.listEvents(calId, s0, s0 + 86400000)) {
      let mt = mtOf(e);
      if (!mt) mt = bySig.get(sig(e.summary, Date.parse(e.start.dateTime), Date.parse(e.end.dateTime))) || '';   // ancien événement sans repère : on l'adopte
      if (mt) { if (!groups.has(mt)) groups.set(mt, []); groups.get(mt).push(e); }
      else if (/^\s*⬛/.test(e.summary || '')) legacy.push(e);                                                      // ancien « temps perdu » devenu inutile
    }
    for (const e of legacy) await del(e);
    for (const [mt, it] of want) {
      const list = groups.get(mt) || [];
      if (!list.length) {
        const ev = await api(`/calendars/${cal}/events`, { method: 'POST', body: body(it, mt) });
        out[it.id] = ev.id; n.created++;
        continue;
      }
      const [first, ...dups] = list;
      const stale = first.summary !== it.summary || (first.colorId || '') !== (it.colorId || '') || mtOf(first) !== mt
        || Date.parse(first.start.dateTime) !== ms(it, 'start') || Date.parse(first.end.dateTime) !== ms(it, 'end');
      if (stale) { await api(`/calendars/${cal}/events/${first.id}`, { method: 'PUT', body: body(it, mt) }); n.updated++; }
      out[it.id] = first.id;
      for (const d of dups) await del(d);                  // doublons
    }
    for (const [mt, list] of groups)                       // supprimé dans l'app = supprimé dans Google
      if (!want.has(mt) && mt.startsWith(`${key}|`)) for (const e of list) if (!keepSet.has(e.id)) await del(e);
    return { map: out, calId, ...n };
  }

  /** Nettoyage : garde un seul calendrier « Mon temps », supprime les autres et les événements en double. */
  async cleanup(preferId = '') {
    const cals = await this.findCalendars(), res = { calendars: 0, events: 0, calId: '' };
    if (!cals.length) return res;
    const keep = cals.includes(preferId) ? preferId : cals[0];
    for (const id of cals) if (id !== keep) { await api(`/calendars/${encodeURIComponent(id)}`, { method: 'DELETE' }); res.calendars++; }
    const now = Date.now(), seen = new Set();
    for (const e of await this.listEvents(keep, now - 90 * 86400000, now + 30 * 86400000)) {
      const k = `${e.summary}|${e.start.dateTime}|${e.end.dateTime}`;
      const legacyBlack = !e.extendedProperties?.private?.mt && /^\s*⬛/.test(e.summary || '');   // anciens « temps perdu » sans repère
      if (seen.has(k) || legacyBlack) { try { await api(`/calendars/${encodeURIComponent(keep)}/events/${e.id}`, { method: 'DELETE' }); res.events++; } catch { /* déjà supprimé */ } }
      else seen.add(k);
    }
    this.calId = keep; res.calId = keep;
    return res;
  }
}
