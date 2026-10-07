// Génération du planning : objectifs + contraintes + préférences → blocs proposés.
// Ne modifie jamais l'état : renvoie une proposition que l'utilisateur accepte ou non.
import { dayKey, dayStartMs, minuteOf, ceil5, uid } from './time.js';
import { dayWindow, goalProgress, blockDone } from './analysis.js';

const MIN_PART = 25;          // plus petite session qu'on accepte de placer
const PREF_START = { morning: 8 * 60, afternoon: 14 * 60, evening: 19 * 60 };

function freeSlots(from, to, busy) {
  const sorted = busy.filter(b => b.end > from && b.start < to).sort((a, b) => a.start - b.start);
  const slots = [];
  let cur = from;
  for (const b of sorted) {
    if (b.start > cur) slots.push([cur, b.start]);
    cur = Math.max(cur, b.end);
  }
  if (cur < to) slots.push([cur, to]);
  return slots.filter(([a, z]) => z - a >= MIN_PART);
}

function chunks(rem, session) {
  const out = [];
  while (rem >= session + 20) { out.push(session); rem -= session; }
  out.push(Math.round(rem / 5) * 5);
  return out;
}

/**
 * @returns {{remove: string[], add: object[], unplaced: {title:string,min:number}[], from:number}}
 * remove = ids des blocs auto à retirer ; add = nouveaux blocs.
 */
export function propose(state, key, nowMs = Date.now()) {
  const s = state.settings, day = state.days[key] || { goals: [], plan: [], log: [] };
  const { wake, bed } = dayWindow(state, key);
  const today = dayKey(new Date(nowMs));
  const nowM = key === today ? minuteOf(nowMs, key) : key < today ? 1440 : -1;
  const from = key < today ? bed : key === today ? Math.max(wake, ceil5(nowM)) : wake;

  const remove = [], kept = [];
  for (const b of day.plan) {
    if (b.source === 'auto') {
      const done = b.cat === 'prod' && blockDone(state, key, b, nowMs) >= (b.end - b.start) / 2;
      const drop = b.cat === 'pause'
        ? b.start >= from
        : !done && (b.start >= from || b.start < wake || b.end <= nowM);
      if (drop) { remove.push(b.id); continue; }
    }
    kept.push(b);
  }

  const prog = goalProgress(state, key, nowMs);
  let goals = day.goals.filter(g => !g.settled);
  if (s.hardFirst) goals = [...goals.filter(g => g.hard), ...goals.filter(g => !g.hard)];

  const queue = [];
  for (const g of goals) {
    let rem = g.target - (prog[g.id] || 0);
    for (const b of kept) if (b.source === 'auto' && b.goalId === g.id && b.end > from) rem -= b.end - Math.max(b.start, from);
    if (rem < 15) continue;
    for (const c of chunks(rem, s.session)) queue.push({ goal: g, min: c });
  }

  const pref = PREF_START[s.bestTime] ?? 480;
  const slots = freeSlots(from, bed, kept).sort((a, b) => Math.abs(a[0] - pref) - Math.abs(b[0] - pref));
  const add = [];
  for (const [a, z] of slots) {
    let cur = a, lastLen = 0;
    while (queue.length) {
      const gap = lastLen >= s.breakAfter ? s.breakLen : 0;
      const start = cur + gap, avail = z - start, c = queue[0];
      if (avail < MIN_PART) break;
      const len = Math.floor(Math.min(c.min, avail) / 5) * 5;
      if (gap) add.push({ id: uid(), start: cur, end: start, cat: 'pause', title: 'Pause', fixed: false, source: 'auto' });
      add.push({ id: uid(), start, end: start + len, cat: 'prod', title: c.goal.title, goalId: c.goal.id, fixed: false, source: 'auto' });
      c.min -= len;
      if (c.min < 15) queue.shift();
      cur = start + len; lastLen = len;
    }
  }

  const un = {};
  for (const c of queue) if (c.min >= 15) un[c.goal.title] = (un[c.goal.title] || 0) + c.min;
  const unplaced = Object.entries(un).map(([title, min]) => ({ title, min }));
  add.sort((a, b) => a.start - b.start);
  return { remove, add, unplaced, from };
}

export function applyProposal(day, p) {
  day.plan = day.plan.filter(b => !p.remove.includes(b.id)).concat(p.add).sort((a, b) => a.start - b.start);
}

export { dayStartMs };
