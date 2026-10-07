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
export function connect(clientId) {
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
    client.requestAccessToken({ prompt: token ? '' : 'consent' });
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

  /** Événements de tous tes calendriers (sauf "Mon temps") entre deux dates (ms). */
  async getEvents(fromMs, toMs) {
    const list = await api('/users/me/calendarList?minAccessRole=reader');
    const out = [];
    for (const cal of list.items) {
      if (cal.id === this.calId || cal.selected === false) continue;
      let pageToken = '';
      for (let i = 0; i < 4; i++) {
        const q = new URLSearchParams({ timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
        if (pageToken) q.set('pageToken', pageToken);
        const res = await api(`/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
        for (const e of res.items || []) {
          if (e.status === 'cancelled' || !e.start?.dateTime || e.transparency === 'transparent') continue;
          if ((e.attendees || []).some(a => a.self && a.responseStatus === 'declined')) continue;
          out.push({ uid: e.id, title: e.summary || 'Événement', start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime) });
        }
        if (!(pageToken = res.nextPageToken)) break;
      }
    }
    return out;
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
   * Synchronise les sessions de productivité d'un jour : crée / met à jour / supprime.
   * @param key jour 'YYYY-MM-DD' ; @param blocks blocs prod ; @param map { idBloc: idÉvénement } mémorisé par l'app
   * @returns nouvelle map + compteurs
   */
  async pushDay(key, blocks, map = {}) {
    const cal = encodeURIComponent(await this.ensureCalendar()), s0 = dayStartMs(key);
    const next = {}, n = { created: 0, updated: 0, deleted: 0 };
    const body = b => JSON.stringify({
      summary: `📚 ${b.title}`,
      start: { dateTime: new Date(s0 + b.start * 60000).toISOString(), timeZone: tz() },
      end: { dateTime: new Date(s0 + b.end * 60000).toISOString(), timeZone: tz() },
    });
    for (const b of blocks) {
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
