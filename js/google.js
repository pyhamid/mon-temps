// Liaison Google Agenda (API v3) via Google Identity Services, sans serveur.
// Droits demandés (minimum nécessaire) :
//  - calendar.readonly       : lire tes événements existants (cours, rendez-vous…)
//  - calendar.app.created    : créer et gérer UNIQUEMENT le calendrier "Mon temps" créé par l'app
// Le jeton reste en mémoire (1 h) ; rien n'est envoyé ailleurs qu'à Google.
import { CalendarProvider } from './calendar.js';
import { dayStartMs } from './time.js';

const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.app.created';
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
        out.push({ uid: e.id, title: e.summary || 'Événement', start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), ...classify(e.colorId) });
      }
    }
    return out;
  }

  /** Événements du calendrier « Mon temps » (le miroir de l'app), avec leur couleur. */
  async getMirrorEvents(fromMs, toMs) {
    if (!this.calId) return [];
    try {
      return (await this.listEvents(this.calId, fromMs, toMs)).map(e => ({ id: e.id, title: e.summary || '', start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), colorId: e.colorId ?? null }));
    } catch (e) { if (e.status === 404 || e.status === 410) return []; throw e; }
  }

  /** Retourne l'id du calendrier "Mon temps" (le crée s'il n'existe pas). */
  async ensureCalendar() {
    if (this.calId) {
      try { await api(`/calendars/${encodeURIComponent(this.calId)}`); return this.calId; }
      catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
    }
    const c = await api('/calendars', { method: 'POST', body: JSON.stringify({ summary: CAL_NAME, description: 'Sessions de productivité planifiées par Mon temps', timeZone: tz() }) });
    this.calId = c.id;
    return c.id;
  }

  /**
   * Synchronise des plages d'un jour (sessions prévues, temps perdu) : crée / met à jour / supprime.
   * @param key jour 'YYYY-MM-DD' ; @param items [{id,start,end,summary,colorId?}] ; @param map { idElément: idÉvénement } mémorisé par l'app
   * @returns nouvelle map + compteurs
   */
  async pushDay(key, items, map = {}) {
    const cal = encodeURIComponent(await this.ensureCalendar()), s0 = dayStartMs(key);
    const next = {}, n = { created: 0, updated: 0, deleted: 0 };
    const body = b => JSON.stringify({
      summary: b.summary,
      ...(b.colorId ? { colorId: b.colorId } : {}),
      start: { dateTime: new Date(s0 + b.start * 60000).toISOString(), timeZone: tz() },
      end: { dateTime: new Date(s0 + b.end * 60000).toISOString(), timeZone: tz() },
    });
    for (const b of items) {
      if (map[b.id]) {
        try { await api(`/calendars/${cal}/events/${map[b.id]}`, { method: 'PUT', body: body(b) }); next[b.id] = map[b.id]; n.updated++; continue; }
        catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
      }
      const ev = await api(`/calendars/${cal}/events`, { method: 'POST', body: body(b) });
      next[b.id] = ev.id; n.created++;
    }
    for (const [bid, eid] of Object.entries(map)) {
      if (next[bid]) continue;
      try { await api(`/calendars/${cal}/events/${eid}`, { method: 'DELETE' }); n.deleted++; } catch { /* déjà supprimé */ }
    }
    return { map: next, calId: this.calId, ...n };
  }
}
