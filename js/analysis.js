// Calcul du temps : fonctions pures sur l'état (aucun accès DOM / stockage).
import { dayKey, dayStartMs, addDays, minuteOf, fmtDur, fmtHM, fmtPct } from './time.js';

export const CATS = {
  sleep:  { emoji: '😴', label: 'Sommeil' },
  obl:    { emoji: '🔴', label: 'Obligations' },
  vie:    { emoji: '🧹', label: 'Vie quotidienne' },
  prod:   { emoji: '🎯', label: 'Productivité' },
  etu:    { emoji: '📚', label: 'Études' },
  prep:   { emoji: '🗂️', label: 'Préparation études' },
  trav:   { emoji: '💼', label: 'Travail' },
  pause:  { emoji: '🌿', label: 'Pause / repos' },
  loisir: { emoji: '🎮', label: 'Divertissement volontaire' },
  unk:    { emoji: '⬛', label: 'Non identifié' },
  imp:    { emoji: '⚡', label: 'Imprévus' },
};
export const PICKABLE = ['etu', 'prep', 'trav', 'obl', 'vie', 'pause', 'loisir'];

const EMPTY = { goals: [], plan: [], log: [] };

/** Fenêtre d'éveil du jour : [réveil, coucher] en minutes. */
export function dayWindow(state, key) {
  const d = state.days[key] || {}, s = state.settings;
  let wake = d.wakeActual ?? d.wakePlanned ?? s.wake;
  // réveil confirmé mais un cours / ton travail commence avant : tu étais forcément réveillé à ce moment-là
  if (d.wakeActual != null)
    for (const b of d.plan || []) if (b.fixed && (b.cat === 'obl' || (b.cat === 'prod' && b.sub === 'trav')) && b.start < wake) wake = b.start;
  let bed = d.sleepPlanned ?? s.bed;
  if (bed <= wake) bed = 1440;
  // tu as continué après l'heure de coucher prévue : la journée dure jusqu'à ta dernière activité (sinon elle serait ignorée dans les calculs)
  const s0 = dayStartMs(key);
  for (const e of d.log || []) bed = Math.max(bed, Math.min(1440, Math.round((e.end - s0) / 60000)));
  return { wake, bed: Math.min(bed, 1440) };
}

/** Entrées du journal pouvant toucher ce jour (veille incluse) + segment en cours. */
export function entriesOf(state, key, nowMs) {
  const list = [...(state.days[addDays(key, -1)]?.log || []), ...(state.days[key]?.log || [])];
  // Le chrono en cours passe EN PREMIER : il compte seulement là où aucune activité enregistrée ne couvre déjà la minute.
  // (Sinon un chrono oublié effaçait les activités ajoutées après coup sur la même période.)
  if (state.current) list.unshift({ ...state.current, end: nowMs, open: true });
  return list;
}

export function hasData(state, key) {
  const d = state.days[key];
  return !!d && (d.log.length > 0 || d.wakeActual != null || d.goals.length > 0 || d.plan.length > 0);
}

/** Minutes passées sur chaque objectif (par id) ce jour-là. */
export function goalProgress(state, key, nowMs) {
  const s0 = dayStartMs(key), s1 = s0 + 86400000, out = {};
  for (const e of entriesOf(state, key, nowMs)) {
    if ((e.cat !== 'prod' && e.cat !== 'obl') || !e.goalId) continue;
    const t = Math.min(e.end, s1) - Math.max(e.start, s0);
    if (t > 0) out[e.goalId] = (out[e.goalId] || 0) + t / 60000;
  }
  return out;
}

/** Minutes réellement passées sur un bloc planifié (même catégorie / même objectif). */
export function blockDone(state, key, b, nowMs) {
  const s0 = dayStartMs(key), A = s0 + b.start * 60000, Z = s0 + b.end * 60000;
  let t = 0;
  for (const e of entriesOf(state, key, nowMs)) {
    if (e.cat !== b.cat) continue;
    if (b.goalId && e.goalId !== b.goalId) continue;
    t += Math.max(0, Math.min(e.end, Z) - Math.max(e.start, A));
  }
  return t / 60000;
}

/** Temps productif cumulé de la session en cours (hors pauses). */
export function sessionElapsed(state, nowMs) {
  const s = state.session;
  if (!s) return 0;
  const today = dayKey(new Date(nowMs));
  let t = 0;
  for (const e of [...(state.days[addDays(today, -1)]?.log || []), ...(state.days[today]?.log || [])])
    if (e.sid === s.id && e.cat === s.cat) t += e.end - e.start;
  if (state.current && state.current.sid === s.id && state.current.cat === s.cat) t += nowMs - state.current.start;
  return t;
}

/**
 * Analyse complète d'une journée.
 * Chaque minute éveillée reçoit une catégorie : journal (le plus récent l'emporte),
 * sinon bloc fixe passé d'obligation/vie quotidienne (supposé), sinon "trou" non identifié.
 */
export function analyse(state, key, nowMs = Date.now()) {
  const s0 = dayStartMs(key), day = state.days[key] || EMPTY;
  let { wake, bed } = dayWindow(state, key);
  if (state.current && key === dayKey(new Date(nowMs))) bed = Math.min(1440, Math.max(bed, minuteOf(nowMs, key)));   // chrono en cours après l'heure de coucher prévue
  // Aujourd'hui, tant que le réveil n'est pas confirmé, on ne compte aucun temps inconnu.
  // (pendant 30 min après l'heure prévue seulement : ensuite on suppose le réveil à l'heure prévue, et les trous sont signalés)
  const unconfirmed = state.days[key]?.wakeActual == null && key === dayKey(new Date(nowMs)) && minuteOf(nowMs, key) < wake + 30;
  const upto = unconfirmed ? wake : Math.max(wake, Math.min(minuteOf(nowMs, key), bed));
  const fixed = new Array(1440).fill(null), arr = new Array(1440).fill(null), lost = new Array(1440).fill(false);
  const fixedLost = new Array(1440).fill(false), impArr = new Array(1440).fill(false), subArr = new Array(1440).fill('etu');

  // blocs fixes (cours, imprévus, temps perdu… venant du calendrier ou saisis à la main)
  for (const b of day.plan)
    if (b.fixed && (['obl', 'vie', 'pause', 'loisir', 'unk', 'prep', 'prod'].includes(b.cat)))
      for (let m = Math.max(0, b.start); m < Math.min(b.end, 1440); m++) {
        fixed[m] = b.cat === 'prod' ? (b.sub === 'trav' ? 'trav' : 'etuf') : b.cat;
        if (b.cat === 'unk') fixedLost[m] = true;
        if (b.unplanned) impArr[m] = true;
        if (b.sub) subArr[m] = b.sub;
      }
  // blocs fixes déjà passés : supposés réalisés (le journal les remplace si besoin)
  const fixedWork = new Array(1440).fill(false);       // cours / travail "supposés faits" (calendrier)
  for (let m = 0; m < upto; m++) {
    arr[m] = fixed[m] === 'trav' || fixed[m] === 'etuf' ? 'prod' : fixed[m];
    if (fixed[m] === 'trav' || fixed[m] === 'etuf') { fixedWork[m] = true; subArr[m] = fixed[m] === 'trav' ? 'trav' : 'etu'; }
    if (fixedLost[m]) lost[m] = true;
  }
  const futureFixed = fixed;

  const pauseOver = [];
  for (const e of entriesOf(state, key, nowMs)) {
    const a = Math.max(0, Math.round((e.start - s0) / 60000)), z = Math.min(1440, Math.round((e.end - s0) / 60000));
    for (let m = a; m < z; m++) { arr[m] = e.cat; lost[m] = !!e.dontKnow; impArr[m] = !!e.unplanned; subArr[m] = e.sub || 'etu'; fixedWork[m] = false; }
    const dur = (e.end - e.start) / 60000;
    if (e.cat === 'pause' && e.plannedMin && !e.open && dur > e.plannedMin + 10 && a >= 0 && a < 1440)
      pauseOver.push({ planned: e.plannedMin, actual: dur });
  }

  const cat = { prod: 0, obl: 0, vie: 0, prep: 0, pause: 0, loisir: 0, unk: 0 };
  let unkPending = 0, unkLost = 0, impMin = 0, gapStart = null;
  const sub = { etu: 0, trav: 0 };
  let focus = 0;                                        // temps productif réellement chronométré
  const gaps = [], part = { am: { prod: 0, avail: 0 }, pm: { prod: 0, avail: 0 } };
  const closeGap = m => {
    if (gapStart != null && m - gapStart >= state.settings.minGap) gaps.push({ start: gapStart, end: m });
    gapStart = null;
  };
  for (let m = wake; m < upto; m++) {
    const c = arr[m];
    if (c != null && impArr[m]) impMin++;
    if (c == null) { unkPending++; cat.unk++; if (gapStart == null) gapStart = m; }
    else {
      closeGap(m);
      if (c === 'unk') { cat.unk++; if (lost[m]) unkLost++; else unkPending++; }
      else if (c in cat) { cat[c]++; if (c === 'prod') { sub[subArr[m]] = (sub[subArr[m]] || 0) + 1; if (!fixedWork[m]) focus++; } }
    }
    if (c !== 'obl' && c !== 'vie' && !(c === 'prod' && subArr[m] === 'trav')) {
      const p = m < 720 ? part.am : part.pm;
      p.avail++; if (c === 'prod') p.prod++;
    }
  }
  closeGap(upto);

  let futObl = 0, futVie = 0, futTrav = 0;
  for (let m = upto; m < bed; m++) { if (futureFixed[m] === 'obl') futObl++; else if (futureFixed[m] === 'vie') futVie++; else if (futureFixed[m] === 'trav') futTrav++; }

  // segments « perdus » : trous non identifiés + périodes déclarées « je ne sais plus »
  const lostSegs = gaps.map(g => ({ id: `gap:${g.start}`, start: g.start, end: g.end, title: 'Non identifié' }));
  for (const e of entriesOf(state, key, nowMs)) {
    if (e.cat !== 'unk' || !e.dontKnow) continue;
    const a = Math.max(0, Math.round((e.start - s0) / 60000)), z = Math.min(1440, Math.round((e.end - s0) / 60000));
    if (z > a) lostSegs.push({ id: `lost:${e.id}`, start: a, end: z, title: e.title && e.title !== 'Non identifié' ? e.title : 'Temps perdu' });
  }
  lostSegs.sort((x, y) => x.start - y.start);

  const awake = Math.max(0, upto - wake);
  // Temps disponible = éveillé, hors cours & travail, obligations et vie quotidienne
  const availSoFar = Math.max(0, awake - cat.obl - cat.vie - sub.trav);
  const availTotal = Math.max(0, (bed - wake) - cat.obl - futObl - cat.vie - futVie - sub.trav - futTrav);
  const used = sub.etu + cat.prep + cat.pause + cat.loisir + cat.unk;

  // objectifs
  const prog = goalProgress(state, key, nowMs);
  const goals = day.goals.map(g => {
    const done = prog[g.id] || 0;
    return { ...g, done, missing: Math.max(0, g.target - done) };
  });
  const active = goals.filter(g => g.settled !== 'abandoned');
  const target = active.reduce((a, g) => a + g.target, 0);
  const goalDone = active.reduce((a, g) => a + g.done, 0);

  return {
    wake, bed, upto, awake, cat, gaps, lostSegs, pauseOver, sub, focus, goalDone, unplanned: impMin, goals, target, part,
    unkPending, unkLost, availSoFar, availTotal,
    availRemaining: Math.max(0, availTotal - used),
    sleepMin: wake + 1440 - Math.min(state.days[key]?.sleepPlanned ?? state.settings.bed, 1440),
  };
}

/** Phrases d'analyse du jour (ton neutre, factuel). */
export function insights(a) {
  const out = [];
  const p = a.focus;
  if (a.target > 0) {
    out.push(`Tu as été productif ${fmtDur(p)} aujourd'hui (chronométré). Sur tes objectifs, tu as fait ${fmtDur(a.goalDone)} sur ${fmtDur(a.target)} : atteint à ${Math.round(a.goalDone / a.target * 100)} %.`);
  } else if (p > 0) out.push(`Tu as été productif ${fmtDur(p)} aujourd'hui (aucun objectif fixé ce jour-là).`);
  if (a.availSoFar > 0)
    out.push(`Tu avais ${fmtDur(a.availSoFar)} de temps réellement disponible (hors obligations, travail et vie quotidienne). Études : ${fmtDur(a.sub.etu)}. Repos / divertissement volontaire : ${fmtDur(a.cat.pause + a.cat.loisir)}. Temps non identifié : ${fmtDur(a.cat.unk)}.`);
  for (const o of a.pauseOver)
    out.push(`Ta pause prévue était de ${fmtDur(o.planned)}. Elle a duré ${fmtDur(o.actual - o.planned)} de plus.`);
  return out;
}

/** Tendances récurrentes sur les 14 derniers jours (≥ 3 jours d'observations). */
export function patterns(state, key, nowMs = Date.now()) {
  const wakeGaps = [], delays = [];
  const share = { am: { prod: 0, avail: 0 }, pm: { prod: 0, avail: 0 }, n: 0 };
  for (let i = 0; i < 14; i++) {
    const k = addDays(key, -i), d = state.days[k];
    if (!d || !d.log.length) continue;
    const a = analyse(state, k, nowMs);
    share.n++;
    for (const w of ['am', 'pm']) { share[w].prod += a.part[w].prod; share[w].avail += a.part[w].avail; }
    const prods = d.log.filter(e => e.cat === 'prod');
    if (d.wakeActual != null && prods.length) {
      const first = Math.min(...prods.map(e => minuteOf(e.start, k)));
      if (first >= d.wakeActual) wakeGaps.push(first - d.wakeActual);
    }
    for (const b of d.plan) {
      if (b.source !== 'auto' || b.cat !== 'prod' || !b.goalId) continue;
      const es = d.log.filter(e => e.goalId === b.goalId && minuteOf(e.start, k) >= b.start - 60);
      if (es.length) delays.push(Math.max(0, minuteOf(Math.min(...es.map(e => e.start)), k) - b.start));
    }
  }
  const avg = l => l.reduce((x, y) => x + y, 0) / l.length;
  const out = [];
  if (wakeGaps.length >= 3 && avg(wakeGaps) >= 45)
    out.push(`⚠️ Tu perds régulièrement du temps entre ton réveil et ta première activité (en moyenne ${fmtDur(avg(wakeGaps))}).`);
  if (delays.length >= 3 && avg(delays) >= 15)
    out.push(`Tu commences souvent tes sessions avec environ ${fmtDur(avg(delays))} de retard.`);
  if (share.n >= 3 && share.am.avail >= 120 && share.pm.avail >= 120) {
    const ra = share.am.prod / share.am.avail, rp = share.pm.prod / share.pm.avail;
    if (ra - rp >= 0.15) out.push('Tes sessions du matin sont généralement plus productives que celles de l\'après-midi.');
    else if (rp - ra >= 0.15) out.push('Tes sessions de l\'après-midi sont généralement plus productives que celles du matin.');
  }
  return out;
}

/** Taux d'étude = temps d'études ÷ temps réellement disponible (en %), ou null s'il n'y a pas assez de temps disponible pour que ce soit parlant. */
/** Taux de préparation = temps de préparation des études ÷ temps réellement disponible (en %). Calculé à part : n'entre jamais dans le taux d'étude. */
export const prepRate = a => (a && a.availSoFar >= 30 ? a.cat.prep / a.availSoFar * 100 : null);
export const studyRate = a => (a && a.availSoFar >= 30 ? a.sub.etu / a.availSoFar * 100 : null);

export { fmtHM, fmtPct };
