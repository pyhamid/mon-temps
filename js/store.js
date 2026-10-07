// État de l'application, persisté dans localStorage.
// Pour passer plus tard à une base cloud : remplacer load()/save() uniquement.
import { uid } from './time.js';
import { DEFAULT_COLORS, mergeColors } from './colors.js';

const KEY = 'temps-v1';

export const DEFAULT_SETTINGS = {
  wake: 7 * 60,            // réveil prévu par défaut (minutes)
  bed: 23 * 60 + 30,       // coucher prévu par défaut
  session: 90,             // durée de session préférée (min)
  breakAfter: 90,          // pause après ~ X min de travail
  breakLen: 15,            // durée de pause proposée
  bestTime: 'morning',     // morning | afternoon | evening
  hardFirst: true,         // matières difficiles d'abord
  minGap: 10,              // en dessous, un trou n'est pas signalé
  gcalClientId: '257653273814-jids63mf42ut4q1d3c58929hglrbsk6q.apps.googleusercontent.com',        // identifiant client OAuth Google (public, à créer dans Google Cloud)
  icsUrl: '',              // lien d'abonnement .ics (calendrier de l'université)
  icsSync: 0,              // dernière synchronisation (ms)
  icsMsg: '',              // résultat de la dernière synchronisation
  gcalId: '',
  overrides: {},           // corrections faites dans l'app sur des événements venant de Google : { 'gcal:ID': {cat, sub?, title} }
  recurring: [],           // objectifs répétés du lundi au vendredi : {id,title,target,hard}
  lastBackup: 0,           // dernière sauvegarde exportée (ms)
  gcalAuto: true,          // synchroniser Google automatiquement
  gcalLinked: false,       // le compte a déjà été autorisé sur cet appareil
  gcalSync: 0,
  gcalMsg: '',              // id du calendrier "Mon temps" créé par l'app
  colors: { ...DEFAULT_COLORS },   // code couleur (colorId Google par catégorie)
  notif: { reminder: true, late: true, unknown: true, end: true, reorg: true, pause: true },
};

export const newDay = () => ({ wakePlanned: null, wakeActual: null, sleepPlanned: null, goals: [], plan: [], log: [] });

const fresh = () => ({ v: 1, settings: structuredClone(DEFAULT_SETTINGS), days: {}, current: null, session: null, notified: {} });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) {
      s.settings = { ...DEFAULT_SETTINGS, ...s.settings, notif: { ...DEFAULT_SETTINGS.notif, ...(s.settings || {}).notif }, colors: mergeColors((s.settings || {}).colors) };
      s.days ||= {}; s.notified ||= {};
      return s;
    }
  } catch { /* données absentes ou illisibles */ }
  return fresh();
}

let state = load();
const listeners = new Set();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* stockage plein ou bloqué */ }
}

export const get = () => state;
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const ensureDay = (st, key) => (st.days[key] ||= newDay());

export function update(fn) {
  fn(state);
  save();
  listeners.forEach(f => f());
}

/** Marque une notification comme envoyée sans déclencher de rendu. */
export function markNotified(id, now) {
  state.notified[id] = now;
  for (const k of Object.keys(state.notified)) if (now - state.notified[k] > 3 * 86400000) delete state.notified[k];
  save();
}

export const exportJSON = () => JSON.stringify(state, null, 1);

export function importJSON(text) {
  const s = JSON.parse(text);
  if (!s || s.v !== 1 || typeof s.days !== 'object') throw new Error('Fichier de sauvegarde invalide');
  state = s;
  state.settings = { ...DEFAULT_SETTINGS, ...s.settings, notif: { ...DEFAULT_SETTINGS.notif, ...(s.settings || {}).notif }, colors: mergeColors((s.settings || {}).colors) };
  save();
  listeners.forEach(f => f());
}

export function resetAll() {
  state = fresh();
  save();
  listeners.forEach(f => f());
}

// ---- Actions du chronomètre ----------------------------------------------
// state.current = segment en cours (une entrée du journal non terminée)
// state.session = activité en cours (peut contenir plusieurs segments si pauses)

function closeCurrent(st, now) {
  const c = st.current;
  if (!c) return;
  if (now - c.start >= 30000) {
    const day = new Date(c.start);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    ensureDay(st, key).log.push({ ...c, end: now });
  }
  st.current = null;
}

export function startActivity({ cat, title, goalId = null, plannedMin = null, sub = null }) {
  update(st => {
    const now = Date.now();
    // Si le réveil n'a pas été indiqué, le premier chrono fait foi (évite de compter la matinée comme « non identifiée »).
    const d = new Date(now), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const day = ensureDay(st, key), m = d.getHours() * 60 + d.getMinutes();
    if (day.wakeActual == null && m >= (day.wakePlanned ?? st.settings.wake)) day.wakeActual = m;
    closeCurrent(st, now);
    const sid = uid();
    const kind = cat === 'prod' ? (sub || 'etu') : null;
    st.session = { id: sid, cat, title, goalId, sub: kind };
    st.current = { id: uid(), sid, cat, title, goalId, sub: kind, start: now, plannedMin: cat === 'pause' ? plannedMin : null };
  });
}

export function pauseSession() {
  update(st => {
    if (!st.current || !st.session || st.current.cat === 'pause') return;
    const now = Date.now();
    closeCurrent(st, now);
    st.current = { id: uid(), sid: st.session.id, cat: 'pause', title: 'Pause', goalId: null, start: now, plannedMin: st.settings.breakLen };
  });
}

export function resumeSession() {
  update(st => {
    if (!st.session) return;
    const now = Date.now(), s = st.session;
    closeCurrent(st, now);
    st.current = { id: uid(), sid: s.id, cat: s.cat, title: s.title, goalId: s.goalId, sub: s.sub || null, start: now, plannedMin: null };
  });
}

export function stopSession() {
  update(st => { closeCurrent(st, Date.now()); st.session = null; });
}

/** Termine le chrono en cours à une heure donnée (chrono oublié). */
export function stopSessionAt(endMs) {
  update(st => {
    const c = st.current;
    if (c) {
      const end = Math.max(c.start, Math.min(endMs, Date.now()));
      if (end - c.start >= 30000) {
        const d = new Date(c.start);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        ensureDay(st, key).log.push({ ...c, end });
      }
    }
    st.current = null; st.session = null;
  });
}
