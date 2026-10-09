import {
  get, update, subscribe, ensureDay, newDay, startActivity, pauseSession, resumeSession, stopSession, stopSessionAt,
  exportJSON, importJSON, resetAll,
} from './store.js';
import {
  dayKey, dayStartMs, addDays, dayLabel, dayShort, minuteOf, fmtHM, fmtDur, fmtPct, fmtClock, toInput, fromInput, uid, ceil5,
} from './time.js';
import { CATS, PICKABLE, analyse, insights, patterns, hasData, sessionElapsed, studyRate, blockDone, dayWindow, entriesOf } from './analysis.js';
import { checkIns } from './remind.js';
import { propose, applyProposal } from './planner.js';
import { signals } from './signals.js';
import { classify } from './classify.js';
import { parseICS, importEvents, clearImported, fetchICS } from './calendar.js';
import * as gg from './google.js';
import * as notify from './notify.js';
import * as lock from './lock.js';
import { applyMirror } from './mirror.js';
import { COLOR_KEYS, COLOR_META, GOOGLE_COLORS, hexOf, nameOf, duplicates, classifier } from './colors.js';

const app = document.getElementById('app'), modalEl = document.getElementById('modal'), tabsEl = document.getElementById('tabs');
const ui = { tab: 'home', viewDay: dayKey(), modal: null, open: {} };
// L'onglet et le jour affichés survivent à un rechargement (adresse #plan, #bilan…)
try { const t = location.hash.slice(1); if (['home', 'plan', 'bilan', 'week', 'settings'].includes(t)) ui.tab = t; const v = sessionStorage.getItem('temps-vd'); if (/^\d{4}-\d\d-\d\d$/.test(v || '')) ui.viewDay = v; } catch { /* ignoré */ }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHORT = { unk: 'Temps perdu', etu: 'Études', prep: 'Préparation', trav: 'Travail', obl: 'Obligation', vie: 'Quotidien', pause: 'Pause', loisir: 'Loisir' };
/** Choix du sélecteur ('etu' | 'trav' | autre) → catégorie interne + type de travail productif. */
const splitCat = v => (v === 'etu' || v === 'trav') ? { cat: 'prod', sub: v } : { cat: v };
const goalBlock = b => b.cat === 'prod' || (b.cat === 'obl' && !!b.goalId);   // session d'objectif (études, travail ou obligation)
const subOf = x => (x.cat === 'prod' ? (x.sub || 'etu') : x.cat);       // clé de couleur / d'emoji
const emojiOf = x => CATS[subOf(x)].emoji;
const catChip = c => `${CATS[c].emoji} ${CATS[c].label}`;
const IMPORTED = ['ics', 'gcal', 'sub'];
const nowM = () => minuteOf(Date.now(), dayKey());

// ---------------------------------------------------------------- Accueil
function renderHome() {
  const st = get(), now = Date.now(), key = dayKey(), a = analyse(st, key, now), day = st.days[key] || newDay();
  const nm = nowM(), cur = st.current, sess = st.session;
  let html = '';

  if (day.wakeActual == null && nm >= a.wake && nm < a.bed)
    html += `<section class="card"><h2>☀️ Bonjour</h2><p>À quelle heure t'es-tu réveillé ? <span class="muted">(prévu ${fmtHM(a.wake)})</span></p>
      <form class="row" data-submit="wake"><input type="time" name="t" value="${toInput(a.wake)}" required>
      <button class="btn primary">Valider</button><button type="button" class="btn" data-act="wake-ontime">À l'heure prévue</button></form></section>`;

  const empty = !Object.keys(st.days).some(k => hasData(st, k));
  if (empty) html += `<section class="card"><h2>👋 Pour commencer</h2><ol class="steps"><li>Onglet <b>Planning</b> : ajoute tes objectifs du jour.</li><li>Appuie sur <b>✨ Proposer un planning</b>.</li><li>Reviens ici et lance le chrono : <b>▶ Commencer</b>.</li></ol><button class="btn primary" data-act="tab-plan">Ouvrir le Planning</button></section>`;

  // Maintenant
  if (cur && sess) {
    const paused = cur.cat === 'pause' && sess.cat !== 'pause';
    const goal = sess.goalId && day.goals.find(g => g.id === sess.goalId);
    const prog = goal ? analyse(st, key, now).goals.find(g => g.id === goal.id) : null;
    html += `<section class="card now ${paused ? 'paused' : ''}"><h2>Maintenant</h2>
      <div class="act">${emojiOf(sess)} ${esc(sess.title)}</div>
      <div class="clock" data-clock>${fmtClock(paused ? now - cur.start : sessionElapsed(st, now))}</div>
      ${paused ? `<p class="muted">En pause${cur.plannedMin ? ` (prévue ${fmtDur(cur.plannedMin)})` : ''}</p>` : ''}
      ${prog ? `<p class="muted">Objectif ${fmtDur(prog.target)} · réalisé ${fmtDur(prog.done)}${prog.missing ? ` · manque ${fmtDur(prog.missing)}` : ' · atteint ✓'}</p>` : ''}
      <div class="row">
        ${paused ? '<button class="btn primary" data-act="resume">▶ Reprendre</button>'
          : sess.cat !== 'pause' ? '<button class="btn" data-act="pause">⏸ Pause</button>' : ''}
        <button class="btn ${paused ? '' : 'primary'}" data-act="stop">⏹ Terminer</button>
        <button class="btn" data-act="start-open">Changer</button>
      </div></section>`;
  } else {
    html += `<section class="card now"><h2>Maintenant</h2><div class="act muted">Rien en cours</div>
      <div class="row"><button class="btn primary big" data-act="start-open">▶ Commencer</button></div></section>`;
  }

  // Prochaine activité
  const next = day.plan.find(b => b.start > nm && b.cat !== 'pause') || day.plan.find(b => b.start > nm);
  html += `<section class="card"><h2>Prochaine activité</h2>${next
    ? `<div class="act">${emojiOf(next)} ${esc(next.title)}</div><p class="muted">${fmtHM(next.start)}–${fmtHM(next.end)}</p>
       ${goalBlock(next) ? `<button class="btn" data-act="start-block" data-id="${next.id}">▶ Commencer maintenant</button>` : ''}`
    : '<p class="muted">Rien de prévu pour la suite. <a href="#" data-act="tab" data-tab="plan">Planifier</a></p>'}</section>`;

  // Aujourd'hui
  const ratio = a.target ? Math.min(100, a.goalDone / a.target * 100) : 0;
  html += `<section class="card"><h2>Aujourd'hui</h2>${rateBlock(a)}
    <div class="stats"><div><b>${fmtDur(a.target ? a.goalDone : a.focus)}</b><span>${a.target ? 'Fait' : 'Productif'}</span></div>
    <div><b>${a.target ? fmtDur(a.target) : '—'}</b><span>Objectif</span></div>
    <div><b>${fmtDur(a.availRemaining)}</b><span>Temps disponible restant</span></div></div>
    ${a.target ? `<div class="bar"><i style="width:${ratio}%"></i></div>` : ''}</section>`;

  // Alertes
  const sigs = signals(st, now);
  if (!empty && !day.goals.length && !day.plan.length && nm < a.bed)
    sigs.push({ icon: '🗒️', text: 'Aucun objectif pour aujourd\'hui. Définis-les dans l\'onglet Planning pour obtenir un planning proposé.', action: 'tab-plan' });
  if (ui.gcalTap) sigs.unshift({ icon: '📅', text: 'Google Agenda n\'est pas à jour. Un appui pour synchroniser.', action: 'gcal-sync' });
  const used = Object.keys(st.days).filter(k => st.days[k].log.length).length;
  if (used >= 3 && Date.now() - st.settings.lastBackup > 14 * 86400000)
    sigs.push({ icon: '💾', text: 'Sauvegarde conseillée : tes données ne sont que sur cet appareil (Réglages, puis Exporter).', action: 'tab-settings' });
  sigs.sort((x, y) => (y.type === 'unknown') - (x.type === 'unknown'));            // le temps non identifié d'abord
  const shown = sigs.slice(0, 4), more = sigs.length - shown.length;
  html += `<section class="card"><h2>Alertes</h2>${shown.length ? shown.map(alertRow).join('') + (more > 0 ? `<p class="muted small">+ ${more} autre(s) alerte(s) à traiter d'abord.</p>` : '') : '<p class="muted">Rien à signaler 👍</p>'}
    <p class="muted small">${day.wakeActual == null && nm < a.wake + 30 ? '❓ Confirme ton réveil ci-dessus : sans ça je ne cherche pas encore le temps non identifié.' : a.gaps.length ? '' : `❓ Temps non identifié : aucun trou de plus de ${st.settings.minGap} min en ce moment (tout est couvert par tes activités et tes créneaux fixes).`}</p></section>`;

  html += `<div class="row"><button class="btn" data-act="unplanned">⚡ Imprévu</button><button class="btn" data-act="entry-open">＋ Activité passée</button></div>`;
  return html;
}

/** Le chiffre clé : études ÷ temps disponible. */
function rateBlock(a) {
  const r = studyRate(a);
  return `<div class="rate"><b>${r == null ? '—' : Math.round(r) + ' %'}</b><span>📚 du temps disponible consacré aux études</span>
    <small>${r == null ? 'Pas encore assez de temps disponible pour calculer.' : `${fmtDur(a.sub.etu)} d'études sur ${fmtDur(a.availSoFar)} disponibles`}</small>
    ${r == null ? '' : `<div class="bar"><i style="width:${Math.min(100, r)}%"></i></div>`}</div>`;
}

function alertRow(s) {
  const btn = {
    gap: ['Identifier', 'gap'], reorg: ['Réorganiser', 'reorg'], 'start-block': ['Commencer', 'start-block'],
    resume: ['Reprendre', 'resume'], stop: ['Terminer', 'stop'], 'tab-plan': ['Ouvrir', 'tab-plan'], 'gcal-sync': ['Synchroniser', 'gcal-sync'], stale: ['Corriger', 'stale'], 'tab-settings': ['Ouvrir', 'tab-settings'],
  }[s.action];
  return `<div class="alert"><span>${s.icon} ${esc(s.text)}</span>${btn
    ? `<button class="btn small" data-act="${btn[1]}" data-id="${esc(s.ref || '')}" data-ref="${esc(s.ref || '')}">${btn[0]}</button>` : ''}</div>`;
}

// -------------------------------------------------------------- Planning
function dayNav() {
  const today = dayKey();
  return `<div class="daynav"><button class="btn small" data-act="day-prev" aria-label="Jour précédent">‹</button>
    <b>${dayLabel(ui.viewDay)}${ui.viewDay === today ? ' · aujourd\'hui' : ''}</b>
    <button class="btn small" data-act="day-next" aria-label="Jour suivant">›</button>
    ${ui.viewDay !== today ? '<button class="btn small" data-act="day-today">Aujourd\'hui</button>' : ''}</div>`;
}

/** Le message « il reste X » n'apparaît que quand plus rien n'est prévu pour cet objectif. */
function shortfallDue(g, key) {
  const st = get(), today = dayKey();
  if (key > today) return false;
  if (key < today) return true;
  if (st.session?.goalId === g.id) return false;
  const nm = nowM();
  return !(st.days[key]?.plan || []).some(b => b.goalId === g.id && b.end > nm);
}

function goalRow(g, key, editable) {
  const gone = g.settled;
  return `<div class="goal ${gone ? 'settled' : ''}">
    <div><b>${esc(g.title)}</b>${g.sub === 'trav' ? ' <span class="tag">💼 travail</span>' : g.sub === 'obl' ? ' <span class="tag">🔴 obligation</span>' : ''}${g.hard ? ' <span class="tag">difficile</span>' : ''}
    <div class="muted">Objectif ${fmtDur(g.target)} · Réalisé ${fmtDur(g.done)}${g.missing && !gone ? ` · Manque ${fmtDur(g.missing)}` : ''}
    ${gone === 'tomorrow' ? ' · reporté à demain' : gone === 'moved' ? ' · reporté à aujourd\'hui' : gone === 'abandoned' ? ' · abandonné' : ''}</div></div>
    <div class="row tight">${editable && !gone ? `<button class="btn small" data-act="start-goal" data-id="${g.id}">▶</button>
      <button class="btn small" data-act="goal-edit" data-id="${g.id}">✎</button>` : ''}</div>
    ${g.missing > 0 && !gone && shortfallDue(g, key)
      ? `<div class="shortfall">Il reste ${fmtDur(g.missing)} sur cet objectif. Veux-tu les reprogrammer aujourd'hui, demain ou les abandonner ?
         <div class="row tight"><button class="btn small" data-act="goal-today" data-id="${g.id}">Aujourd'hui</button>
         <button class="btn small" data-act="goal-tomorrow" data-id="${g.id}">Demain</button>
         <button class="btn small" data-act="goal-abandon" data-id="${g.id}">Abandonner</button></div></div>` : ''}</div>`;
}

function renderPlan() {
  const st = get(), key = ui.viewDay, now = Date.now(), a = analyse(st, key, now), day = st.days[key] || newDay();
  const past = key < dayKey(), s = st.settings;
  const wakeP = day.wakePlanned ?? s.wake, bedP = day.sleepPlanned ?? s.bed;
  let html = dayNav();
  html += `<section class="card"><h2>😴 Sommeil et éveil</h2>
    <div class="grid3"><label>Coucher prévu<input type="time" data-dayfield="sleepPlanned" value="${toInput(bedP)}"></label>
    <label>Réveil prévu<input type="time" data-dayfield="wakePlanned" value="${toInput(wakeP)}"></label>
    <label>Réveil réel<input type="time" data-dayfield="wakeActual" value="${day.wakeActual != null ? toInput(day.wakeActual) : ''}"></label></div>
    <p class="muted">Sommeil prévu ${fmtHM(bedP)} → ${fmtHM(wakeP)} (${fmtDur(a.sleepMin)}). Éveillé : ${fmtDur(a.bed - a.wake)}.</p></section>`;

  html += `<section class="card"><h2>🎯 Objectifs du jour</h2>
    ${a.goals.length ? a.goals.map(g => goalRow(g, key, !past)).join('') : '<p class="muted">Aucun objectif.</p>'}
    <div class="row"><button class="btn" data-act="goal-add">＋ Objectif</button>
    ${!a.goals.length ? '<button class="btn" data-act="goals-copy">Copier ceux de la veille</button>' : ''}</div></section>`;

  html += `<section class="card"><h2>🗓️ Planning</h2>
    ${day.plan.length ? day.plan.map(b => {
      const done = goalBlock(b) ? blockDone(st, key, b, now) : 0;
      return `<div class="block c-${subOf(b)}"><div class="t">${fmtHM(b.start)}<br>${fmtHM(b.end)}</div>
        <div class="grow"><b>${emojiOf(b)} ${esc(b.title)}</b>
        <div class="muted">${b.fixed ? (IMPORTED.includes(b.source) ? 'calendrier' : 'créneau fixe') : 'proposé'}${b.dirty ? ' · ⏳ à envoyer' : ''}${b.ro ? ' · lecture seule' : ''}${done > 0 ? ` · fait ${fmtDur(done)}` : ''}</div></div>
        <div class="row tight">${!past && goalBlock(b) && key === dayKey() ? `<button class="btn small" data-act="start-block" data-id="${b.id}">▶</button>` : ''}
        <button class="btn small" data-act="block-edit" data-id="${b.id}">✎</button></div></div>`;
    }).join('') : '<p class="muted">Planning vide.</p>'}
    <div class="row"><button class="btn" data-act="block-add">＋ Créneau fixe</button>
    ${!past ? '<button class="btn primary" data-act="plan-gen">✨ Proposer un planning</button>' : ''}
    ${s.gcalClientId && key <= dayKey() && (day.plan.some(b => goalBlock(b) || b.dirty) || day.log.length || a.lostSegs.length) ? '<button class="btn" data-act="gcal-push">📅 Envoyer vers Google Agenda</button>' : ''}</div>
    <p class="muted small">Les créneaux fixes (cours, rendez-vous, transport, travail…) sont respectés : l'app planifie tes études autour. Rien n'est déplacé sans ton accord.</p></section>`;
  return html;
}

// ------------------------------------------------------------------ Bilan
function renderBilan() {
  const st = get(), key = ui.viewDay, now = Date.now(), a = analyse(st, key, now);
  let html = dayNav();
  if (!hasData(st, key) && key !== dayKey()) return html + '<section class="card"><p class="muted">Pas de données pour ce jour.</p></section>';
  html += `<section class="card"><h2>Journée du ${dayLabel(key)}</h2>${rateBlock(a)}<p>Temps éveillé : <b>${fmtDur(a.awake)}</b></p>
    ${['etu', 'prep', 'trav', 'obl', 'vie', 'pause', 'loisir', 'unk'].map(c => { const v = c === 'etu' ? a.sub.etu : c === 'trav' ? a.sub.trav : a.cat[c]; return `
      <div class="line c-${c}"><div class="lh"><span>${catChip(c)}</span><b>${fmtDur(v)} — ${fmtPct(v, a.awake)}</b></div>
      <div class="bar"><i style="width:${a.awake ? v / a.awake * 100 : 0}%"></i></div></div>`; }).join('')}
    ${a.unplanned ? `<div class="line c-imp"><div class="lh"><span>⚡ dont imprévus</span><b>${fmtDur(a.unplanned)} — ${fmtPct(a.unplanned, a.awake)}</b></div><div class="bar"><i style="width:${a.awake ? a.unplanned / a.awake * 100 : 0}%"></i></div></div>` : ''}
    <p class="muted">Temps réellement disponible (éveillé − obligations − travail − vie quotidienne) : <b>${fmtDur(a.availSoFar)}</b>.
    ${a.unkPending ? ` Dont ${fmtDur(a.unkPending)} à identifier.` : ''}${a.unkLost ? ` ${fmtDur(a.unkLost)} déclarés « je ne sais plus » (temps perdu estimé).` : ''}</p></section>`;

  const ins = insights(a), pat = patterns(st, key, now);
  html += `<section class="card"><h2>Analyse</h2>${ins.map(t => `<p>${esc(t)}</p>`).join('') || '<p class="muted">Pas encore assez de données.</p>'}
    ${pat.length ? `<h3>Tendances récurrentes</h3>${pat.map(t => `<p>${esc(t)}</p>`).join('')}` : ''}</section>`;

  if (a.goals.length)
    html += `<section class="card"><h2>🎯 Objectifs</h2>${a.goals.map(g => goalRow(g, key, false)).join('')}</section>`;

  if (get().settings.gcalClientId && key <= dayKey() && (a.lostSegs.length || (st.days[key]?.log.length)))
    html += `<section class="card"><h2>📅 Google Agenda</h2><p class="muted">Envoie ce que tu as fait ce jour-là${a.lostSegs.length ? ` et ${fmtDur(a.lostSegs.reduce((t, g) => t + g.end - g.start, 0))} de temps perdu (en noir)` : ''} dans le calendrier « Mon temps ». Tu pourras y changer couleurs et heures, puis importer pour mettre à jour tes statistiques.</p>
      <button class="btn primary" data-act="gcal-push">📅 Envoyer vers Google Agenda</button></section>`;

  if (a.gaps.length)
    html += `<section class="card"><h2>❓ À identifier</h2>${a.gaps.map(g => `<div class="alert"><span>${fmtHM(g.start)}–${fmtHM(g.end)} (${fmtDur(g.end - g.start)})</span>
      <button class="btn small" data-act="gap" data-ref="${g.start}-${g.end}">Identifier</button></div>`).join('')}</section>`;

  const day = st.days[key], log = (day?.log || []).slice().sort((x, y) => x.start - y.start);
  // créneaux fixes déjà passés : supposées faites, elles apparaissent dans le journal (✎ pour les corriger)
  const t0 = dayStartMs(key), hm = m => fmtHM(m);
  const cut = key === dayKey() ? Math.min(minuteOf(now, key), a.bed) : key < dayKey() ? a.bed : 0;
  const assumed = (day?.plan || []).filter(b => b.fixed && b.cat !== 'unk' && b.start < cut).map(b => ({ b, s: t0 + b.start * 60000 }));
  const rows = [...log.map(e => ({ e, s: e.start })), ...assumed].sort((x, y) => x.s - y.s);
  html += `<section class="card"><h2>Journal</h2>${rows.length ? rows.map(r => r.b ? `<div class="alert"><span>${hm(r.b.start)}–${hm(Math.min(r.b.end, cut))}
    · ${emojiOf(r.b)} ${esc(r.b.title)} (${fmtDur(Math.min(r.b.end, cut) - r.b.start)}) <span class="tag">créneau fixe · supposé fait</span></span>
    <span class="row tight"><button class="btn small" data-act="block-edit" data-id="${r.b.id}" aria-label="Modifier">✎</button></span></div>`
    : (e => `<div class="alert"><span>${new Date(e.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}–${new Date(e.end).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
    · ${emojiOf(e)} ${esc(e.title)} (${fmtDur((e.end - e.start) / 60000)})</span>
    <span class="row tight"><button class="btn small" data-act="entry-edit" data-id="${e.id}" aria-label="Modifier">✎</button><button class="btn small" data-act="entry-del" data-id="${e.id}" aria-label="Supprimer">✕</button></span></div>`)(r.e)).join('') : '<p class="muted">Aucune activité enregistrée.</p>'}
    <div class="row"><button class="btn" data-act="entry-open">＋ Ajouter une activité</button></div></section>`;
  return html;
}

// ---------------------------------------------------------------- Semaine
/** Évolution du taux d'étude sur 14 jours, avec moyenne des 7 derniers jours vs les 7 précédents. */
function rateWeek(st, now, today) {
  const rows = Array.from({ length: 14 }, (_, i) => { const k = addDays(today, i - 13); return { k, r: hasData(st, k) ? studyRate(analyse(st, k, now)) : null }; });
  const avg = l => { const v = l.filter(x => x.r != null).map(x => x.r); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const cur = avg(rows.slice(7)), prev = avg(rows.slice(0, 7));
  const trend = cur == null || prev == null ? '' : Math.abs(cur - prev) < 3 ? 'Stable par rapport aux 7 jours précédents.'
    : cur > prev ? `En hausse : +${Math.round(cur - prev)} points par rapport aux 7 jours précédents.` : `En baisse : −${Math.round(prev - cur)} points par rapport aux 7 jours précédents.`;
  return `<section class="card"><h2>📚 Taux d'étude</h2>
    <div class="rate"><b>${cur == null ? '—' : Math.round(cur) + ' %'}</b><span>moyenne des 7 derniers jours (études ÷ temps disponible)</span><small>${trend}</small></div>
    ${rows.map(({ k, r }) => `<div class="wk"><span class="d">${dayShort(k)}</span><div class="track">${r != null ? `<i class="p" style="width:${Math.min(100, r)}%"></i>` : ''}</div><b>${r != null ? Math.round(r) + ' %' : '—'}</b></div>`).join('')}
    <p class="muted small">Un jour est compté seulement s'il a au moins 30 min de temps disponible.</p></section>`;
}

function renderWeek() {
  const st = get(), now = Date.now(), today = dayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const rows = days.map(k => ({ k, a: hasData(st, k) ? analyse(st, k, now) : null }));
  const have = rows.filter(r => r.a);
  const sum = f => have.reduce((x, r) => x + f(r.a), 0);
  const maxProd = Math.max(60, ...have.map(r => Math.max(r.a.focus, r.a.target)));
  let html = rateWeek(st, now, today) + `<section class="card"><h2>Heures productives</h2>${rows.map(({ k, a }) => `
    <div class="wk"><span class="d">${dayShort(k)}</span>
    <div class="track">${a ? `<i class="p" style="width:${a.focus / maxProd * 100}%"></i>${a.target ? `<u style="left:${a.target / maxProd * 100}%" title="objectif"></u>` : ''}` : ''}</div>
    <b>${a ? fmtDur(a.focus) : '—'}</b></div>`).join('')}
    <p class="muted small">Le trait vertical indique l'objectif du jour.</p></section>`;

  html += `<section class="card"><h2>Détail par jour</h2>${rows.map(({ k, a }) => a ? `<div class="wd"><div class="wdh"><b>${dayShort(k)}</b>
      <span>🎯 ${fmtDur(a.focus)}${a.target ? ` <small>(${Math.round(a.goalDone / a.target * 100)} %)</small>` : ''}</span></div>
      <div class="wdc"><span>📚 ${fmtDur(a.sub.etu)}</span><span>🗂️ ${fmtDur(a.cat.prep)}</span><span>💼 ${fmtDur(a.sub.trav)}</span><span>Dispo ${fmtDur(a.availSoFar)}</span><span>❓ ${fmtDur(a.cat.unk)}</span><span>🔴 ${fmtDur(a.cat.obl)}</span><span>🌿 ${fmtDur(a.cat.pause)}</span><span>🎮 ${fmtDur(a.cat.loisir)}</span>${a.unplanned ? `<span>⚡ ${fmtDur(a.unplanned)}</span>` : ''}</div></div>`
      : `<div class="wd muted"><div class="wdh"><b>${dayShort(k)}</b><span>—</span></div></div>`).join('')}</section>`;

  // tendances
  const lines = [];
  if (have.length >= 2) {
    const prods = have.map(r => r.a.focus), half = Math.floor(prods.length / 2);
    const avg = l => l.reduce((x, y) => x + y, 0) / (l.length || 1);
    const first = avg(prods.slice(0, half)), last = avg(prods.slice(half));
    const diff = last - first;
    lines.push(`Moyenne : ${fmtDur(avg(prods))} productives par jour. ${Math.abs(diff) < 15 ? 'Rythme stable.' : diff > 0 ? `En hausse récemment (+${fmtDur(diff)} par jour).` : `En baisse récemment (−${fmtDur(-diff)} par jour).`}`);
    const best = have.reduce((b, r) => (r.a.focus > b.a.focus ? r : b));
    lines.push(`Meilleur jour : ${dayShort(best.k)} (${fmtDur(best.a.focus)}).`);
    const withGoal = have.filter(r => r.a.target);
    if (withGoal.length) lines.push(`Objectifs atteints (≥ 100 %) : ${withGoal.filter(r => r.a.goalDone >= r.a.target).length} jour(s) sur ${withGoal.length}.`);
    const unkPct = sum(a => a.cat.unk) / (sum(a => a.awake) || 1);
    lines.push(`Temps non identifié : ${fmtDur(sum(a => a.cat.unk))} sur la période (${fmtPct(sum(a => a.cat.unk), sum(a => a.awake))}).${unkPct > 0.2 ? ' Identifier ces plages donnerait une image plus juste.' : ''}`);
  }
  const pat = patterns(st, today, now);
  html += `<section class="card"><h2>Tendances</h2>${[...lines, ...pat].map(t => `<p>${esc(t)}</p>`).join('') || '<p class="muted">Utilise l\'app quelques jours pour voir apparaître des tendances.</p>'}</section>`;
  return html;
}

// --------------------------------------------------------------- Réglages
function renderSettings() {
  return get().settings && renderSettingsRaw().replace(/<section class="card"><h2>(.*?)<\/h2>/g, (m, t) => `<details class="card sec" data-sec="${t}" ${ui.open[t] ? 'open' : ''}><summary>${t}</summary>`).replace(/<\/section>/g, '</details>');
}
function renderSettingsRaw() {
  const s = get().settings, n = s.notif;
  const perm = notify.supported() ? Notification.permission : 'unsupported';
  const chk = (k, label) => `<label class="check"><input type="checkbox" data-setting="notif.${k}" ${n[k] ? 'checked' : ''}> ${label}</label>`;
  return `<section class="card"><h2>Journée type</h2><div class="grid3">
    <label>Réveil par défaut<input type="time" data-setting="wake" value="${toInput(s.wake)}"></label>
    <label>Coucher par défaut<input type="time" data-setting="bed" value="${toInput(s.bed)}"></label></div></section>
    <section class="card"><h2>Préférences de planning</h2>
    <label>Je travaille mieux<select data-setting="bestTime">${[['morning', 'le matin'], ['afternoon', 'l\'après-midi'], ['evening', 'le soir']].map(([v, l]) => `<option value="${v}" ${s.bestTime === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="grid3"><label>Session (min)<input type="number" min="20" max="240" step="5" data-setting="session" value="${s.session}"></label>
    <label>Pause après (min)<input type="number" min="20" max="240" step="5" data-setting="breakAfter" value="${s.breakAfter}"></label>
    <label>Durée pause (min)<input type="number" min="5" max="60" step="5" data-setting="breakLen" value="${s.breakLen}"></label></div>
    <label class="check"><input type="checkbox" data-setting="hardFirst" ${s.hardFirst ? 'checked' : ''}> Commencer par les matières difficiles</label>
    <label>Ignorer les trous de moins de (min)<input type="number" min="1" max="60" data-setting="minGap" value="${s.minGap}"></label></section>
    <section class="card"><h2>Notifications</h2>
    ${perm === 'granted' ? '<p class="muted">Autorisées ✓</p>' : perm === 'unsupported' ? '<p class="muted">Non disponibles sur cet appareil/navigateur.</p>'
      : '<button class="btn primary" data-act="notif-perm">Autoriser les notifications</button>'}
    ${perm === 'granted' ? '<div class="row"><button class="btn" data-act="notif-test">🔔 Tester une notification</button></div>' : ''}
    ${chk('reminder', 'Rappel de début d\'activité')}${chk('late', 'Retard')}${chk('unknown', 'Temps non identifié')}
    ${chk('end', 'Fin de session')}${chk('pause', 'Pause plus longue que prévu')}${chk('reorg', 'Réorganisation')}
    <p class="muted small">Ces notifications-ci ne partent que tant que l'app est ouverte ou récemment ouverte (limite d'une app web sans serveur). Pour être prévenu app fermée, utilise les rappels via Google Agenda (section Google Agenda).</p></section>
    <section class="card"><h2>📅 Abonnement au calendrier</h2>
    <p class="muted">Colle le lien d'abonnement de l'université (.ics ou webcal://). L'app le relit toute seule toutes les 30 minutes quand elle est ouverte : cours déplacés, ajoutés ou supprimés sont mis à jour.</p>
    <label>Lien d'abonnement<input type="text" data-setting="icsUrl" value="${esc(s.icsUrl)}" placeholder="https://… ou webcal://…" autocomplete="off" spellcheck="false"></label>
    <div class="row"><button class="btn primary" data-act="ics-sync" ${s.icsUrl ? '' : 'disabled'}>Synchroniser maintenant</button></div>
    ${s.icsSync ? `<p class="muted small">Dernière synchronisation : ${new Date(s.icsSync).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${esc(s.icsMsg)}</p>` : ''}</section>
    <section class="card"><h2>🎨 Code couleur</h2>
    <p class="muted">Ces couleurs sont les mêmes dans l'app et dans Google Agenda. Envoyé vers Google, chaque élément prend la couleur de sa catégorie. À l'import, la couleur d'un événement Google (clic droit sur l'événement, puis une couleur) le classe dans la bonne catégorie pour tes statistiques. Sans couleur : obligation (tes cours universitaires).</p>
    ${COLOR_KEYS.map(k => `<div class="cc"><div class="ccl">${COLOR_META[k].emoji} ${COLOR_META[k].label}${COLOR_META[k].hint ? `<small>${COLOR_META[k].hint}</small>` : ''}</div>
      <div class="sw">${GOOGLE_COLORS.map(c => `<button type="button" class="swatch ${s.colors[k] === c.id ? 'on' : ''}" style="background:${c.hex}" data-act="color-set" data-key="${k}" data-id="${c.id}" aria-label="${c.name}" title="${c.name}"></button>`).join('')}</div>
      <span class="muted small">${nameOf(s.colors[k])}</span></div>`).join('')}
    <p class="muted small">Dans Google, survole les pastilles pour voir leur nom : seules ces 11 couleurs sont reconnues (Tomate, Flamant, Mandarine, Banane, Sauge, Basilic, Paon, Myrtille, Lavande, Raisin, Graphite). Les autres teintes sont traitées comme « sans couleur ».</p>
    ${duplicates(s.colors).length ? `<p class="warn">⚠️ ${duplicates(s.colors).map(([x, y]) => `${COLOR_META[x].label} et ${COLOR_META[y].label}`).join(' ; ')} ont la même couleur : Google ne pourra pas les distinguer.</p>` : ''}</section>
    <section class="card"><h2>Google Agenda</h2>
    <p class="muted">Lecture de tes événements (cours, rendez-vous…) comme créneaux fixes ; envoi des sessions de productivité dans un calendrier séparé « Mon temps », seulement quand tu le demandes.</p>
    <label>Identifiant client Google <span class="small">(voir LISEZMOI)</span><input type="text" data-setting="gcalClientId" value="${esc(s.gcalClientId)}" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false"></label>
    <div class="row"><button class="btn primary" data-act="gcal-connect" ${s.gcalClientId ? '' : 'disabled'}>${gg.isConnected() ? 'Connecté ✓' : s.gcalLinked && !ui.gcalTap ? 'Compte lié ✓ (reconnexion automatique…)' : s.gcalLinked ? 'Se reconnecter à Google' : 'Se connecter à Google'}</button>
    <button class="btn" data-act="gcal-import" ${s.gcalClientId ? '' : 'disabled'}>Importer maintenant</button>
    <button class="btn" data-act="gcal-push-week" ${s.gcalClientId ? '' : 'disabled'}>Envoyer les 7 derniers jours</button>
    <button class="btn" data-act="gcal-cleanup" ${s.gcalClientId ? '' : 'disabled'}>Nettoyer les doublons dans Google</button></div>
    <p class="muted small">Ce que tu as fait (études, travail, pauses…) est envoyé dans le calendrier « Mon temps », avec la couleur de sa catégorie. Tu peux y changer la <b>couleur</b> (= le type), l'<b>heure</b>, le <b>titre</b>, ou <b>supprimer</b> un événement, y compris ceux de hier. Puis clique sur « Importer maintenant » : l'app met à jour tes statistiques (30 derniers jours). Un trou noir recolorié devient une activité identifiée.</p>
    <label class="check"><input type="checkbox" data-setting="gcalAuto" ${s.gcalAuto ? 'checked' : ''}> Synchroniser automatiquement (importer + envoyer : à l'ouverture, toutes les 15 min, et 30 s après chaque modification)</label>
    <label class="check"><input type="checkbox" data-setting="gcalRemind" ${s.gcalRemind ? 'checked' : ''}> Me rappeler via Google Agenda (notifications sur le téléphone, même app fermée)</label>
    <label>Point rapide « que fais-tu ? » <select data-setting="checkEvery">${[[0, 'jamais'], [60, 'toutes les heures'], [120, 'toutes les 2 h'], [180, 'toutes les 3 h']].map(([v, l]) => `<option value="${v}" ${s.checkEvery === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="muted small">Les rappels sont des événements du calendrier « Mon temps » avec une notification : l'app Google Agenda de ton téléphone les affiche même quand Mon temps est fermée. Vérifie que ce calendrier est coché et que les notifications de Google Agenda sont autorisées.</p>
    ${Object.keys(s.overrides || {}).length ? `<div class="row"><span class="muted small">${Object.keys(s.overrides).length} correction(s) locale(s) / événement(s) masqué(s)</span><button class="btn small" data-act="overrides-reset">↩ Tout rétablir</button></div>` : ''}
    ${s.gcalSync ? `<p class="muted small">Dernière synchro Google : ${new Date(s.gcalSync).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${esc(s.gcalMsg)}</p>` : ''}
    <p class="muted small">Sans identifiant, tu peux importer un fichier .ics :</p>
    <label class="btn file">Importer un .ics<input type="file" accept=".ics,text/calendar" data-file="ics" hidden></label></section>
    <section class="card"><h2>🔒 Sécurité</h2><p class="muted">Le code n'est demandé qu'une fois sur cet appareil si tu as coché « Rester connecté ». « Verrouiller maintenant » le redemandera.</p>
    <div class="row"><button class="btn" data-act="lock-now">Verrouiller maintenant</button></div></section>
    <section class="card"><h2>Données</h2><p class="muted">Tout reste sur cet appareil. Exporte régulièrement une sauvegarde.</p>
    <div class="row"><button class="btn" data-act="export">Exporter</button>
    <label class="btn file">Importer<input type="file" accept="application/json" data-file="backup" hidden></label>
    <button class="btn danger" data-act="reset">Tout effacer</button></div></section>`;
}

// ----------------------------------------------------------------- Rendu
const views = { home: renderHome, plan: renderPlan, bilan: renderBilan, week: renderWeek, settings: renderSettings };
function applyColors() {
  const c = get().settings.colors, r = document.documentElement.style;
  for (const k of COLOR_KEYS) r.setProperty(`--c-${k === 'lost' ? 'unk' : k}`, hexOf(c[k]));
  r.setProperty('--c-prod', hexOf(c.etu));
}
function render() {
  applyColors();
  try {
    if (location.hash.slice(1) !== ui.tab) history[location.hash ? 'pushState' : 'replaceState'](null, '', '#' + ui.tab);   // le bouton « retour » du téléphone revient à l'onglet précédent
    sessionStorage.setItem('temps-vd', ui.viewDay);
  } catch { /* ignoré */ }
  app.innerHTML = views[ui.tab]();
  tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
}

function tick() {
  const st = get(), el = document.querySelector('[data-clock]');
  if (el && st.current) {
    const now = Date.now(), paused = st.current.cat === 'pause' && st.session?.cat !== 'pause';
    el.textContent = fmtClock(paused ? now - st.current.start : sessionElapsed(st, now));
  }
}

// ---------------------------------------------------------------- Modales
const catRadios = (sel, cats = PICKABLE) => `<div class="cats">${cats.map(c => `<label><input type="radio" name="cat" value="${c}" ${c === sel ? 'checked' : ''}><span>${CATS[c].emoji} ${SHORT[c] || CATS[c].label}</span></label>`).join('')}</div>`;
function openModal(title, body, onSubmit) {
  ui.modal = { onSubmit };
  modalEl.innerHTML = `<div class="sheet"><div class="sh"><h2>${title}</h2><button class="btn small" data-act="modal-close" aria-label="Fermer">✕</button></div>${body}</div>`;
  modalEl.hidden = false;
  modalEl.querySelector('input[type=text],input[type=number]')?.focus({ preventScroll: true });
}
function closeModal() { ui.modal = null; modalEl.hidden = true; modalEl.innerHTML = ''; render(); }
const gapParse = r => r.split('-').map(Number);

function modalStart(pre = {}) {
  const st = get(), key = dayKey(), goals = (st.days[key]?.goals || []).filter(g => !g.settled);
  const titles = new Set(goals.map(g => g.title)), seen = new Set(), recents = [];
  for (let i = 0; i < 14 && recents.length < 5; i++)
    for (const e of [...(st.days[addDays(key, -i)]?.log || [])].reverse()) {
      const k = `${e.cat}|${e.title}`;
      if (e.goalId || ['unk', 'pause'].includes(e.cat) || titles.has(e.title) || seen.has(k) || recents.length >= 5) continue;
      seen.add(k); recents.push(e);
    }
  const chip = (c, t, g, emoji, sub = '') => `<button type="button" class="chip" data-act="quick-start" data-cat="${c}" data-sub="${sub}" data-title="${esc(t)}" data-goal="${g || ''}">${emoji} ${esc(t)}</button>`;
  openModal('Commencer', `<form data-submit="start">
    ${goals.length ? `<p class="muted small">Un appui pour démarrer :</p><div class="chips">${goals.map(g => chip(g.sub === 'obl' ? 'obl' : 'prod', g.title, g.id, g.sub === 'trav' ? '💼' : g.sub === 'obl' ? '🔴' : '📚', g.sub === 'obl' ? '' : g.sub || 'etu')).join('')}</div>` : ''}
    ${recents.length ? `<p class="muted small">Récents :</p><div class="chips">${recents.map(e => chip(e.cat, e.title, '', emojiOf(e), e.sub || '')).join('')}</div>` : ''}
    <p class="muted small">${goals.length || recents.length ? 'Ou autre chose :' : 'Que commences-tu ?'}</p>
    ${catRadios(pre.cat || 'etu')}
    <label>Nom<input type="text" name="title" value="${esc(pre.title || '')}" placeholder="Ex. Traitement du signal" required></label>
    <label class="plen">Durée de pause prévue (min)<input type="number" name="plannedMin" value="${st.settings.breakLen}" min="1"></label>
    <button class="btn primary big">▶ Commencer</button></form>`, f => {
    startActivity({ ...splitCat(f.cat), title: f.title.trim(), goalId: f.goalId || null, plannedMin: +f.plannedMin || null });
  });
}

function modalEntry({ unplanned = false, gap = null, cat = 'etu', title = '' } = {}) {
  const ik = ui.tab === 'home' ? dayKey() : ui.viewDay;
  const nm = Math.min(nowM(), 1439);
  const [gs, ge] = gap ? gapParse(gap) : [Math.max(0, nm - 60), nm];
  if (unplanned) {
    openModal('⚡ Imprévu', `<form data-submit="unplanned"><label>Que s'est-il passé ? <span class="muted">(facultatif)</span><input type="text" name="title" placeholder="Ex. Appel, dépannage…"></label>
      <label>Combien de temps a-t-il duré ? (minutes)<input type="number" name="min" value="30" min="5" max="600" required></label>
      <div class="chips">${[15, 30, 45, 60, 90].map(m => `<button type="button" class="chip" data-act="set-min" data-min="${m}">${m} min</button>`).join('')}</div>
      <p class="muted small">Enregistré comme terminé à l'instant. Je te proposerai ensuite de réorganiser la suite de la journée : rien ne bouge sans ton accord.</p>
      <button class="btn primary big">Ajouter</button></form>`, f => {
      const end = Date.now(), start = end - f.min * 60000;
      update(st => { ensureDay(st, dayKey(new Date(start))).log.push({ id: uid(), cat: 'obl', title: f.title.trim() || 'Imprévu', goalId: null, start, end, unplanned: true }); });
      setTimeout(modalReorg, 0);
    });
    return;
  }
  if (gap) {
    openModal('❓ Que faisais-tu ?', `<form data-submit="entry" data-day="${ik}"><input type="hidden" name="gapref" value="${gs}-${ge}">
      <p><b>${fmtHM(gs)}–${fmtHM(ge)}</b> <span class="muted">· ${fmtDur(ge - gs)}</span></p>
      <label>En quelques mots <span class="muted">(facultatif)</span><input type="text" name="title" placeholder="Ex. je préparais à manger"></label>
      <p class="muted small">Touche ce qui correspond :</p>
      <div class="quick">${PICKABLE.map(c => `<button class="btn qbtn" name="cat" value="${c}">${CATS[c].emoji} ${SHORT[c]}</button>`).join('')}</div>
      <button type="button" class="btn" data-act="gap-unknown" style="width:100%;margin-top:8px">⬛ Temps perdu <span class="muted">(réseaux sociaux, je ne sais plus…)</span></button>
      <details class="adj"><summary>Ajuster les heures</summary><div class="grid3"><label>De<input type="time" name="from" value="${toInput(gs)}" required></label><label>À<input type="time" name="to" value="${toInput(ge)}" required></label></div></details></form>`,
      f => saveEntry(f, ik));
    return;
  }
  openModal('Ajouter une activité', `<form data-submit="entry" data-day="${ik}">
    <label>Nom<input type="text" name="title" required></label>
    <div class="grid3"><label>De<input type="time" name="from" value="${toInput(gs)}" required></label><label>À<input type="time" name="to" value="${toInput(ge)}" required></label></div>
    ${catRadios(cat, [...PICKABLE, 'unk'])}
    <button class="btn primary big">Ajouter</button></form>`, f => saveEntry(f, ik));
}

function modalEntryEdit(id) {
  const e = (get().days[ui.viewDay]?.log || []).find(x => x.id === id);
  if (!e) return;
  const cats = [...PICKABLE, 'unk'];
  openModal('Modifier', `<form data-submit="entry-edit" data-id="${id}">
    <label>Nom<input type="text" name="title" value="${esc(e.title)}"></label>
    <div class="grid3"><label>De<input type="time" name="from" value="${toInput(minuteOf(e.start, ui.viewDay))}" required></label><label>À<input type="time" name="to" value="${toInput(minuteOf(e.end, ui.viewDay))}" required></label></div>
    <p class="muted small">Type :</p>${catRadios(e.cat === 'unk' && !e.dontKnow ? '' : subOf(e), cats)}
    ${e.id.startsWith('g:') ? '<p class="muted small">📅 Créée dans Google Agenda : au prochain <b>Envoyer</b>, elle y sera mise à jour.</p>' : ''}
    <div class="row"><button class="btn primary">Enregistrer</button><button type="button" class="btn danger" data-act="entry-del" data-id="${id}">Supprimer</button></div></form>`, f => {
    if (!f.cat) return alert('Choisis un type.');
    const a = fromInput(f.from), z = fromInput(f.to);
    if (z <= a) return alert('L\'heure de fin doit être après le début.');
    update(st => {
      const x = (st.days[ui.viewDay]?.log || []).find(y => y.id === id);
      if (!x) return;
      const s0 = dayStartMs(ui.viewDay);
      x.start = s0 + a * 60000; x.end = s0 + z * 60000;
      x.editedAt = Date.now();
      if (x.id.startsWith('g:')) x.dirty = true;                       // activité venue de Google : à renvoyer
      const sp = splitCat(f.cat);
      x.cat = sp.cat; if (sp.sub) x.sub = sp.sub; else delete x.sub;
      x.title = f.title.trim() || (sp.cat === 'unk' ? 'Temps perdu' : CATS[sp.sub || sp.cat].label);
      if (sp.cat === 'unk') x.dontKnow = true; else delete x.dontKnow;
    });
  });
}

function openGap(ref) {
  modalEntry({ gap: ref });
  const form = modalEl.querySelector('form'), input = form.querySelector('input[name=title]');
  input.addEventListener('input', () => {
    const c = classify(input.value);
    form.querySelectorAll('.qbtn').forEach(b => b.classList.toggle('sugg', b.value === c));
    form.querySelector('[data-act=gap-unknown]').classList.toggle('sugg', c === 'lost');
  });
}
/** Après avoir identifié une partie d'un trou : s'il en reste une partie, on pose tout de suite la question pour la suite. */
function nextGap(key, a, z) {
  const g = analyse(get(), key, Date.now()).gaps.find(x => x.start < z && x.end > a);
  if (g) openGap(`${g.start}-${g.end}`);
}

function saveEntry(f, key, extra = {}) {
  const a = fromInput(f.from), z = fromInput(f.to);
  if (z <= a) { alert('L\'heure de fin doit être après le début.'); return false; }
  const s0 = new Date(key.replace(/-/g, '/')).getTime();
  let { cat, sub } = splitCat(f.cat), title = (f.title || '').trim();
  if (extra.unknown) { cat = 'unk'; sub = undefined; title = title || 'Non identifié'; }
  else if (cat === 'unk') { extra = { ...extra, unknown: true }; title = title || 'Temps perdu'; }
  else if (!title && cat) title = CATS[sub || cat].label;
  update(st => { ensureDay(st, key).log.push({ id: uid(), cat, ...(sub ? { sub } : {}), title, goalId: null, start: s0 + a * 60000, end: s0 + z * 60000, dontKnow: !!extra.unknown }); });
  if (f.gapref) { const [gs, ge] = gapParse(f.gapref); setTimeout(() => nextGap(key, gs, ge), 0); }
}

function modalGoal(id) {
  const g = id ? get().days[ui.viewDay]?.goals.find(x => x.id === id) : null;
  openModal(g ? 'Modifier l\'objectif' : 'Nouvel objectif', `<form data-submit="goal" data-id="${id || ''}">
    <label>Matière / projet<input type="text" name="title" value="${esc(g?.title)}" placeholder="Ex. Traitement du signal" required></label>
    <label>Durée visée (heures)<input type="number" name="h" step="0.25" min="0.25" max="12" value="${g ? g.target / 60 : 1}" required></label>
    <div class="cats"><label><input type="radio" name="sub" value="etu" ${(g?.sub || 'etu') === 'etu' ? 'checked' : ''}><span>📚 Études</span></label><label><input type="radio" name="sub" value="trav" ${g?.sub === 'trav' ? 'checked' : ''}><span>💼 Travail</span></label><label><input type="radio" name="sub" value="obl" ${g?.sub === 'obl' ? 'checked' : ''}><span>🔴 Obligation</span></label></div>
    <label class="check"><input type="checkbox" name="hard" ${g?.hard ? 'checked' : ''}> Matière difficile (placée en premier)</label>
    <label class="check"><input type="checkbox" name="rec" ${g?.recurId ? 'checked' : ''}> Répéter chaque jour de la semaine (lun–ven)</label>
    <div class="row"><button class="btn primary">Enregistrer</button>${g ? '<button type="button" class="btn danger" data-act="goal-del">Supprimer</button>' : ''}</div></form>`, f => {
    update(st => {
      const d = ensureDay(st, ui.viewDay), target = Math.round(+f.h * 60), title = f.title.trim(), hard = !!f.hard, sub = f.sub || 'etu', R = st.settings.recurring;
      let g = f.id ? d.goals.find(x => x.id === f.id) : null;
      if (g) Object.assign(g, { title, target, hard, sub }); else { g = { id: uid(), title, target, hard, sub }; d.goals.push(g); }
      if (f.rec) {
        let r = R.find(x => x.id === g.recurId);
        if (!r) { r = { id: uid() }; R.push(r); g.recurId = r.id; }
        Object.assign(r, { title, target, hard, sub }); d.recurDone = true;
      } else if (g.recurId) { st.settings.recurring = R.filter(x => x.id !== g.recurId); delete g.recurId; }
    });
  });
}

/** Ajoute les objectifs répétés (lun–ven) à un jour, une seule fois. */
function ensureRecurring(key) {
  const st = get(), wd = new Date(key.replace(/-/g, '/')).getDay();
  if (wd === 0 || wd === 6 || key < dayKey() || !st.settings.recurring.length || st.days[key]?.recurDone) return;
  update(s => {
    const day = ensureDay(s, key);
    for (const r of s.settings.recurring) if (!day.goals.some(g => g.recurId === r.id)) day.goals.push({ id: uid(), title: r.title, target: r.target, hard: r.hard, sub: r.sub, recurId: r.id });
    day.recurDone = true;
  });
}

const endFromTime = (startMs, hhmm) => {
  const d = new Date(startMs), [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime() <= startMs ? d.getTime() + 86400000 : d.getTime();
};
function modalStale() {
  const c = get().current;
  if (!c) return;
  const def = new Date(Math.min(Date.now(), c.start + get().settings.session * 60000));
  openModal('⏱️ Chrono oublié', `<form data-submit="stale"><p>« ${esc(c.title)} » a démarré à <b>${new Date(c.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</b>. À quelle heure as-tu arrêté ?</p>
    <label>Heure d'arrêt<input type="time" name="t" value="${toInput(def.getHours() * 60 + def.getMinutes())}" required></label>
    <button class="btn primary big">Terminer à cette heure</button>
    <button type="button" class="btn" data-act="stop-now" style="width:100%;margin-top:8px">Il tournait vraiment : terminer maintenant</button></form>`,
    f => { stopSessionAt(endFromTime(c.start, f.t)); });
}

function modalBlock(id) {
  const b = id ? get().days[ui.viewDay]?.plan.find(x => x.id === id) : null;
  openModal(b ? 'Modifier le bloc' : 'Nouveau créneau fixe', `<form data-submit="block" data-id="${id || ''}">
    ${b && IMPORTED.includes(b.source) ? `<p class="muted small">📅 Cet événement vient de Google Agenda. ${!b.ro ? 'Au prochain <b>Envoyer</b>, il sera <b>modifié dans Google</b> (couleur, titre, heure).' : 'Son calendrier est en <b>lecture seule</b> : ta modification reste dans l\'app (statistiques) et ne change pas Google.'}</p>` : ''}
    <label>Titre<input type="text" name="title" value="${esc(b?.title)}" placeholder="Ex. Cours d'automatique" required></label>
    <div class="grid3"><label>De<input type="time" name="from" value="${toInput(b?.start ?? 9 * 60)}" required></label><label>À<input type="time" name="to" value="${toInput(b?.end ?? 10 * 60)}" required></label></div>
    ${catRadios(b ? subOf(b) : 'obl')}
    <div class="row"><button class="btn primary">Enregistrer</button>${b ? '<button type="button" class="btn danger" data-act="block-del">' + (b && IMPORTED.includes(b.source) ? 'Masquer' : 'Supprimer') + '</button>' : ''}${b && IMPORTED.includes(b.source) && (get().settings.overrides || {})[b.id.replace(/:\d{4}-\d\d-\d\d$/, '')] ? '<button type="button" class="btn" data-act="block-reset">↩ Rétablir la version Google</button>' : ''}</div></form>`, f => {
    const start = fromInput(f.from), end = fromInput(f.to);
    if (end <= start) return alert('L\'heure de fin doit être après le début.');
    update(st => {
      const d = ensureDay(st, ui.viewDay);
      if (f.id) {
        const x = d.plan.find(p => p.id === f.id), moved = x.start !== start || x.end !== end;
        Object.assign(x, { title: f.title.trim(), start, end, ...splitCat(f.cat), sub: splitCat(f.cat).sub, fixed: true, source: IMPORTED.includes(x.source) ? x.source : 'user' });
        x.editedAt = Date.now();
        if (IMPORTED.includes(x.source)) {                                   // événement venu de Google : correction retenue ; renvoyée à Google au prochain envoi si le calendrier le permet
          const toGoogle = !x.ro;                                              // sans lien d'origine : l'app se reliera à Google au prochain envoi
          (st.settings.overrides ||= {})[x.id.replace(/:\d{4}-\d\d-\d\d$/, '')] = { cat: x.cat, ...(x.sub ? { sub: x.sub } : {}), title: x.title, ...(moved ? { start, end } : {}), ...(toGoogle ? { dirty: true } : {}) };
          if (toGoogle) x.dirty = true;
        }
      }
      else d.plan.push({ id: uid(), title: f.title.trim(), start, end, ...splitCat(f.cat), fixed: true, source: 'user' });
      d.plan.sort((p, q) => p.start - q.start);
    });
  });
}

function modalReorg(title = 'Réorganiser la journée') {
  const key = dayKey(), p = propose(get(), key, Date.now());
  const list = p.add.length ? p.add.map(b => `<div class="alert"><span>${fmtHM(b.start)}–${fmtHM(b.end)} · ${emojiOf(b)} ${esc(b.title)}</span></div>`).join('') : '<p class="muted">Rien à placer.</p>';
  openModal(title, `<p class="muted">Voici ce que je propose pour la suite. Tu peux accepter ou garder ton planning actuel.</p>${list}
    ${p.unplaced.map(u => `<p class="warn">⚠️ Pas assez de place pour ${fmtDur(u.min)} de « ${esc(u.title)} ».</p>`).join('')}
    <div class="row"><button class="btn primary" data-act="apply-proposal">Accepter</button><button class="btn" data-act="modal-close">Garder tel quel</button></div>`);
  ui.modal.proposal = { key, p };
}

function modalPlanGen() {
  const key = ui.viewDay, p = propose(get(), key, Date.now());
  const list = p.add.length ? p.add.map(b => `<div class="alert"><span>${fmtHM(b.start)}–${fmtHM(b.end)} · ${emojiOf(b)} ${esc(b.title)}</span></div>`).join('')
    : '<p class="muted">Aucun objectif à placer. Ajoute des objectifs d\'abord.</p>';
  openModal('✨ Planning proposé', `<p class="muted">Tient compte de tes créneaux fixes, du sommeil, de tes préférences et de ce qui est déjà fait.</p>${list}
    ${p.unplaced.map(u => `<p class="warn">⚠️ Pas assez de place pour ${fmtDur(u.min)} de « ${esc(u.title)} ». Réduis l'objectif ou libère du temps.</p>`).join('')}
    <div class="row">${p.add.length || p.remove.length ? '<button class="btn primary" data-act="apply-proposal">Accepter</button>' : ''}<button class="btn" data-act="modal-close">Fermer</button></div>`);
  ui.modal.proposal = { key, p };
}

// ------------------------------------------------------------ Événements
let syncing = false;
/** Relit le calendrier d'abonnement et remplace les blocs importés à partir d'aujourd'hui. */
async function syncSub(manual) {
  const url = get().settings.icsUrl;
  if (!url || syncing) return;
  syncing = true;
  try {
    const events = await fetchICS(url), key = dayKey();
    update(s => {
      clearImported(ensureDay, s, 'sub', key, 61);
      const n = importEvents(events.filter(e => e.end > Date.now() - 3600000), ensureDay, s, 'sub');
      s.settings.icsSync = Date.now(); s.settings.icsMsg = `${events.length} événement(s) lu(s)`;
    });
    if (manual) alert('Calendrier synchronisé.');
  } catch (e) {
    const blocked = e instanceof TypeError;
    const msg = blocked
      ? 'Lecture impossible : le site de l\'université n\'autorise pas la lecture directe depuis un navigateur. Abonne-toi plutôt dans Google Agenda (Autres agendas, puis À partir de l\'URL), puis utilise « Importer les 7 prochains jours ».'
      : `Lecture impossible : ${e.message}.`;
    update(s => { s.settings.icsSync = Date.now(); s.settings.icsMsg = msg; });
    if (manual) alert(msg);
  } finally { syncing = false; }
}

/** Lit Google Agenda (8 jours) et remplace les blocs importés. interactive = fenêtre Google autorisée (après un clic). */
let gcalBusy = false, resync = false, inSys = false;
/** Modification faite par la synchro elle-même (ne doit pas redéclencher une synchro). */
const sysUpdate = fn => { inSys = true; try { update(fn); } finally { inSys = false; } };
const BACK_DAYS = 30;                 // jours passés relus à chaque import
/** Lit tes calendriers + « Mon temps » et met l'app à jour (sans message). Suppose qu'on est connecté. */
async function gcalReadAll() {
  const st = get(), today = dayKey(), fromKey = addDays(today, -BACK_DAYS), from = dayStartMs(fromKey), to = dayStartMs(addDays(today, 8));
  const prov = new gg.GoogleCalendarProvider(st.settings.gcalId), colors = st.settings.colors;
  const events = await prov.getEvents(from, to, classifier(colors));
  const mirror = await prov.getMirrorEvents(from, to);
  let changes = { updated: 0, created: 0, removed: 0 };
  sysUpdate(s => {
    clearImported(ensureDay, s, 'gcal', fromKey, BACK_DAYS + 9);
    importEvents(events, ensureDay, s, 'gcal');
    changes = applyMirror(s, mirror, classifier(colors), { fromMs: from, toMs: to });
    const n = changes.updated + changes.created + changes.removed;
    Object.assign(s.settings, { gcalLinked: true, gcalSync: Date.now(), gcalMsg: `${events.length} événement(s) lu(s)${n ? `, ${n} modification(s) venant de « Mon temps »` : ''}` });
  });
  return { events, changes };
}
/** Des événements corrigés dans l'app ne sont pas encore reliés à leur calendrier d'origine (importés avant cette fonction) ? */
const needsRelink = () => Object.values(get().days).some(d => d.plan.some(b => b.source === 'gcal' && !b.gref && get().settings.overrides?.[b.id.replace(/:\d{4}-\d\d-\d\d$/, '')]));

async function gcalImport({ interactive = false, notify = false } = {}) {
  const st = get(), clientId = st.settings.gcalClientId;
  if (!clientId || gcalBusy) return;
  gcalBusy = true;
  try {
    if (!gg.isConnected()) await gg.connect(clientId, { silent: !interactive });
    const { events, changes } = await gcalReadAll();
    ui.gcalTap = false;
    if (notify) alert(`${events.length} événement(s) lus dans tes calendriers.\nModifications faites dans « Mon temps » : ${changes.updated} mise(s) à jour, ${changes.created} ajout(s), ${changes.removed} suppression(s).`);
  } catch (e) {
    if (interactive) alert(e.message);
    else if (get().settings.gcalLinked) { ui.gcalTap = true; if (!ui.modal) render(); }   // il faudra un appui pour renouveler l'accès
  } finally { gcalBusy = false; }
}
/** Synchronisation complète et automatique : lit Google (cours, modifications), puis envoie ce que tu as fait (7 derniers jours + rappels du jour). */
async function gcalAutoSync({ interactive = false } = {}) {
  const clientId = get().settings.gcalClientId;
  if (!clientId || gcalBusy) return;
  gcalBusy = true;
  try {
    if (!gg.isConnected()) await gg.connect(clientId, { silent: !interactive });
    await gcalReadAll();
    const prov = new gg.GoogleCalendarProvider(get().settings.gcalId), today = dayKey();
    for (let i = 6; i >= 0; i--) { const dk = addDays(today, -i); if (i === 0 || userDay(get().days[dk])) await gcalPushDay(dk, prov); }
    await gcalWriteBack(prov);
    sysUpdate(s => { s.settings.gcalSync = Date.now(); s.settings.gcalMsg = 'importé et envoyé'; });
    ui.gcalTap = false;
  } catch (e) {
    if (interactive) alert(e.message);
    else if (get().settings.gcalLinked) { ui.gcalTap = true; if (!ui.modal) render(); }   // il faudra un appui pour renouveler l'accès
  } finally { gcalBusy = false; if (resync) { resync = false; gcalSoon(); } }
}
let syncTimer = null;
/** Quelques secondes après chaque modification (ajout, correction, fin de chrono…), envoie tout vers Google. */
const gcalSoon = () => {
  const s = get().settings;
  if (!s.gcalAuto || !s.gcalLinked || !s.gcalClientId || ui.gcalTap) return;
  if (gcalBusy) { resync = true; return; }                // modifié pendant une synchro : on repartira juste après
  if (syncTimer) return;                                  // une synchro est déjà prévue
  syncTimer = setTimeout(() => { syncTimer = null; gcalAutoSync(); }, 30000);
};
/** Au démarrage / retour dans l'app : si le compte est déjà autorisé, renouvelle l'accès sans rien demander (puis synchronise si c'est dû). */
async function gcalStart() {
  const s = get().settings;
  if (!s.gcalLinked || !s.gcalClientId || gcalBusy) return;
  if (!gg.isConnected()) {
    try { await gg.connect(s.gcalClientId, { silent: true }); ui.gcalTap = false; }
    catch { ui.gcalTap = true; if (!ui.modal) render(); return; }
  }
  if (gcalDue() || !get().settings.gcalSync) gcalAutoSync(); else if (!ui.modal) render();
}
const gcalDue = () => { const st = get().settings; return st.gcalAuto && st.gcalLinked && st.gcalClientId && !ui.gcalTap && Date.now() - st.gcalSync > 15 * 60000; };

const userDay = d => !!d && (d.log.length > 0 || d.wakeActual != null || d.goals.length > 0);

/** Envoie un jour vers « Mon temps » : ce qui a été fait, les sessions prévues pas encore faites, et le temps perdu (en noir). */
async function gcalPushDay(k, prov) {
  const st = get(), col = st.settings.colors, s0 = dayStartMs(k), day = st.days[k] || { plan: [], log: [] };
  const used = userDay(day);                                     // un jour où tu n'as rien fait (même avec des cours importés) n'a pas de « temps perdu »
  const a = analyse(st, k, Date.now()), today = dayKey(), nowMin = minuteOf(Date.now(), today), remind = st.settings.gcalRemind;
  const mn = ms => Math.max(0, Math.min(1440, Math.round((ms - s0) / 60000)));
  const items = [
    // sessions prévues pas encore faites + créneaux fixes saisis dans l'app (rendez-vous, repas…) ; jamais les événements venant de Google
    ...day.plan.filter(b => !IMPORTED.includes(b.source) && b.cat !== 'unk' && (b.fixed || (goalBlock(b) && blockDone(st, k, b, Date.now()) < (b.end - b.start) / 2)))
      .map(b => ({ id: b.id, start: b.start, end: b.end, summary: `${b.unplanned ? '⚡' : emojiOf(b)} ${b.title}`, colorId: col[b.unplanned ? 'imp' : subOf(b)],
        ...(remind && k === today && b.start > nowMin ? { remindMin: goalBlock(b) ? 0 : 10 } : {}) })),
    ...(remind && k === today ? checkIns({ nowM: nowMin, wake: a.wake, bed: a.bed, every: st.settings.checkEvery, busy: day.plan.filter(b => b.fixed && (b.cat === 'obl' || (b.cat === 'prod' && b.sub === 'trav'))) })
      .map(m => ({ id: `chk:${m}`, start: m, end: m + 5, summary: '🔔 Point rapide : ouvre Mon temps (que fais-tu ?)', remindMin: 0 })) : []),
    ...day.log.filter(e => e.cat !== 'unk' && !e.id.startsWith('g:') && mn(e.end) > mn(e.start))
      .map(e => ({ id: `log:${e.id}`, start: mn(e.start), end: mn(e.end), summary: `${e.unplanned ? '⚡' : emojiOf(e)} ${e.title}`, colorId: col[e.unplanned ? 'imp' : subOf(e)] })),
    ...(used ? a.lostSegs.map(g => ({ id: g.id, start: g.start, end: g.end, summary: `⬛ ${g.title}`, colorId: col.lost })) : []),
  ];
  const keep = day.log.filter(e => e.id.startsWith('g:')).map(e => e.id.slice(2));
  const r = await prov.pushDay(k, items, day.gcal || {}, keep);
  sysUpdate(s => { ensureDay(s, k).gcal = r.map; s.settings.gcalId = r.calId; });
  return r;
}

/** Écrit à la source (leur calendrier d'origine) les événements venus de Google que tu as corrigés dans l'app, tous jours confondus. */
async function gcalWriteBack(prov) {
  const col = get().settings.colors, out = { written: 0, readOnly: 0 };
  for (const [k, day] of Object.entries(get().days)) {
    for (const b of day.plan.filter(x => x.dirty && x.gref && !x.ro)) {
      const okey = b.id.replace(/:\d{4}-\d\d-\d\d$/, '');
      try {
        await prov.patchEvent(b.gref.c, b.gref.e, { summary: b.title, colorId: col[b.unplanned ? 'imp' : subOf(b)], start: b.start, end: b.end }, dayStartMs(k));
        out.written++;
        sysUpdate(s => { const bb = s.days[k]?.plan.find(y => y.id === b.id); if (bb) delete bb.dirty; if (s.settings.overrides) delete s.settings.overrides[okey]; });   // Google est à jour : plus besoin de la correction locale
      } catch (e) {
        if (/insufficient|scope/i.test(e.message)) throw new Error('Permission manquante : clique sur « Se connecter à Google » et accepte la nouvelle autorisation (modifier tes événements).');
        if (e.status !== 403 && e.status !== 404) throw e;
        out.readOnly++;                                                  // calendrier en lecture seule (ex. abonnement de l'université)
        sysUpdate(s => { const bb = s.days[k]?.plan.find(y => y.id === b.id); if (bb) { delete bb.dirty; bb.ro = true; } const o = s.settings.overrides?.[okey]; if (o) delete o.dirty; });
      }
    }
  }
  for (const evId of [...(get().settings.tombstones || [])]) {   // activités venues de Google supprimées dans l'app
    const calId = get().settings.gcalId;
    if (calId) await prov.deleteEvent(calId, evId);
    sysUpdate(s => { s.settings.tombstones = (s.settings.tombstones || []).filter(x => x !== evId); });
    out.written++;
  }
  for (const [k, day] of Object.entries(get().days)) {           // activités créées dans Google (calendrier « Mon temps ») puis corrigées dans l'app
    for (const e of day.log.filter(x => x.dirty && x.id.startsWith('g:'))) {
      try {
        const calId = get().settings.gcalId || await prov.ensureCalendar(), s0 = dayStartMs(k);
        await prov.patchEvent(calId, e.id.slice(2), { summary: `${e.unplanned ? '⚡' : emojiOf(e)} ${e.title}`, colorId: col[e.unplanned ? 'imp' : subOf(e)], start: Math.round((e.start - s0) / 60000), end: Math.round((e.end - s0) / 60000) }, s0);
        out.written++;
        sysUpdate(s => { const x = s.days[k]?.log.find(y => y.id === e.id); if (x) delete x.dirty; });
      } catch (err) {
        if (/insufficient|scope/i.test(err.message)) throw new Error('Permission manquante : clique sur « Se connecter à Google » et accepte la nouvelle autorisation (modifier tes événements).');
        if (err.status !== 404 && err.status !== 410) throw err;
        sysUpdate(s => { const x = s.days[k]?.log.find(y => y.id === e.id); if (x) delete x.dirty; });   // l'événement n'existe plus dans Google
      }
    }
  }
  return out;
}

async function gcalRun(fn) {
  try { await fn(); } catch (e) { alert(e.message); }
}
const formData = (form, sub) => Object.fromEntries(new FormData(form, sub).entries());

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  const f = formData(form, e.submitter);
  if (form.dataset.id !== undefined) f.id = form.dataset.id;
  const name = form.dataset.submit;
  if (name === 'wake') { update(st => { ensureDay(st, dayKey()).wakeActual = fromInput(f.t); }); return; }
  const fn = ui.modal?.onSubmit;
  if (!fn) return;
  const r = fn(f);
  if (r === undefined) closeModal();
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act, id = t.dataset.id, st = get(), key = dayKey();
  if (act !== 'gap-ok') e.preventDefault?.();
  const goalOf = gid => (st.days[ui.viewDay]?.goals || st.days[key]?.goals || []).find(g => g.id === gid);
  switch (act) {
    case 'tab': ui.tab = t.dataset.tab; render(); break;
    case 'tab-plan': ui.tab = 'plan'; ui.viewDay = key; ensureRecurring(key); render(); break;
    case 'day-prev': ui.viewDay = addDays(ui.viewDay, -1); render(); break;
    case 'day-next': ui.viewDay = addDays(ui.viewDay, 1); ensureRecurring(ui.viewDay); render(); break;
    case 'day-today': ui.viewDay = key; render(); break;
    case 'modal-close': closeModal(); break;
    case 'start-open': modalStart(); break;
    case 'quick-start': startActivity({ cat: t.dataset.cat, sub: t.dataset.sub || null, title: t.dataset.title, goalId: t.dataset.goal || null }); closeModal(); break;
    case 'set-min': t.closest('form').min.value = t.dataset.min; break;
    case 'stale': modalStale(); break;
    case 'stop-now': stopSession(); closeModal(); break;
    case 'tab-settings': ui.tab = 'settings'; render(); break;
    case 'start-goal': { const g = goalOf(id); if (g) startActivity(g.sub === 'obl' ? { cat: 'obl', title: g.title, goalId: g.id } : { cat: 'prod', sub: g.sub || 'etu', title: g.title, goalId: g.id }); break; }
    case 'start-block': {
      const b = (st.days[key]?.plan || []).find(x => x.id === id);
      if (b) startActivity({ cat: b.cat, sub: b.sub, title: b.title, goalId: b.goalId || null });
      break;
    }
    case 'pause': pauseSession(); break;
    case 'resume': resumeSession(); break;
    case 'stop': stopSession(); break;
    case 'wake-ontime': update(s => { ensureDay(s, key).wakeActual = dayWindow(s, key).wake; }); break;
    case 'unplanned': modalEntry({ unplanned: true }); break;
    case 'entry-open': modalEntry(); break;
    case 'entry-edit': modalEntryEdit(id); break;
    case 'entry-del': update(s => {
      const d = s.days[ui.viewDay];
      if (d) { if (id.startsWith('g:')) (s.settings.tombstones ||= []).push(id.slice(2)); d.log = d.log.filter(x => x.id !== id); }   // venue de Google : sera aussi supprimée dans Google
    }); if (ui.modal) closeModal(); break;
    case 'gap': openGap(t.dataset.ref || t.dataset.id); break;
    case 'gap-unknown': {
      const form = t.closest('form'), f = formData(form);
      if (saveEntry(f, form.dataset.day, { unknown: true }) === undefined) closeModal();
      break;
    }
    case 'goal-add': modalGoal(); break;
    case 'goal-edit': modalGoal(id); break;
    case 'goal-del': {
      const gid = t.closest('form').dataset.id;
      update(s => { const d = s.days[ui.viewDay], g0 = d.goals.find(g => g.id === gid); if (g0?.recurId && confirm('Supprimer aussi ce modèle pour les jours suivants ?')) s.settings.recurring = s.settings.recurring.filter(r => r.id !== g0.recurId); d.goals = d.goals.filter(g => g.id !== gid); d.plan = d.plan.filter(b => b.goalId !== gid || b.fixed); });
      closeModal(); break;
    }
    case 'goals-copy': update(s => { const prev = s.days[addDays(ui.viewDay, -1)]; if (prev) ensureDay(s, ui.viewDay).goals.push(...prev.goals.filter(g => g.settled !== 'abandoned').map(g => ({ id: uid(), title: g.title, target: g.target, hard: g.hard }))); }); break;
    case 'goal-today': {
      if (ui.viewDay === key) { modalPlanGen(); break; }
      const g = goalOf(id), done = analyse(st, ui.viewDay, Date.now()).goals.find(x => x.id === id);
      update(s => {
        ensureDay(s, key).goals.push({ id: uid(), title: g.title, target: Math.round(done.missing), hard: g.hard });
        s.days[ui.viewDay].goals.find(x => x.id === id).settled = 'moved';
      });
      break;
    }
    case 'goal-tomorrow': {
      const g = goalOf(id), done = analyse(st, ui.viewDay, Date.now()).goals.find(x => x.id === id);
      update(s => {
        ensureDay(s, addDays(ui.viewDay, 1)).goals.push({ id: uid(), title: g.title, target: Math.round(done.missing), hard: g.hard });
        s.days[ui.viewDay].goals.find(x => x.id === id).settled = 'tomorrow';
      });
      break;
    }
    case 'goal-abandon': update(s => { s.days[ui.viewDay].goals.find(x => x.id === id).settled = 'abandoned'; }); break;
    case 'block-add': modalBlock(); break;
    case 'block-edit': modalBlock(id); break;
    case 'block-del': {
      const bid = t.closest('form').dataset.id;
      update(s => {
        const d = s.days[ui.viewDay], b0 = d.plan.find(b => b.id === bid);
        if (b0 && IMPORTED.includes(b0.source)) (s.settings.overrides ||= {})[bid.replace(/:\d{4}-\d\d-\d\d$/, '')] = { hidden: true };   // masqué dans l'app (pas supprimé dans Google)
        d.plan = d.plan.filter(b => b.id !== bid);
      });
      closeModal(); break;
    }
    case 'block-reset': {
      const bid = t.closest('form').dataset.id;
      update(s => { if (s.settings.overrides) delete s.settings.overrides[bid.replace(/:\d{4}-\d\d-\d\d$/, '')]; const d = s.days[ui.viewDay]; d.plan = d.plan.filter(b => b.id !== bid); });
      closeModal(); gcalImport({ interactive: true }); break;     // relit Google : la version de Google revient
    }
    case 'overrides-reset':
      if (confirm('Annuler toutes tes corrections locales sur les événements venant de Google (et réafficher ceux que tu as masqués) ?')) { update(s => { s.settings.overrides = {}; }); gcalImport({ interactive: true, notify: true }); }
      break;
    case 'plan-gen': modalPlanGen(); break;
    case 'reorg': modalReorg(); break;
    case 'apply-proposal': {
      const { key: k, p } = ui.modal.proposal;
      update(s => applyProposal(ensureDay(s, k), p));
      closeModal(); break;
    }
    case 'ics-sync': syncSub(true); break;
    case 'gcal-connect': gcalRun(async () => { await gg.connect(st.settings.gcalClientId); update(s => { s.settings.gcalLinked = true; }); }); break;
    case 'gcal-import': gcalImport({ interactive: true, notify: true }); break;
    case 'gcal-sync': gcalAutoSync({ interactive: true }); break;
    case 'color-set': update(s => { s.settings.colors[t.dataset.key] = t.dataset.id; }); break;
    case 'gcal-push': gcalRun(async () => {
      if (!gg.isConnected()) await gg.connect(st.settings.gcalClientId);
      if (needsRelink()) await gcalReadAll();                        // relie d'abord tes événements corrigés à leur calendrier d'origine
      const prov = new gg.GoogleCalendarProvider(get().settings.gcalId);
      const r = await gcalPushDay(ui.viewDay, prov);
      Object.assign(r, await gcalWriteBack(prov));
      alert(`Google Agenda — « Mon temps » : ${r.created} créé(s), ${r.updated} mis à jour, ${r.deleted} supprimé(s).${r.written ? `\nÉvénements d'origine modifiés dans Google : ${r.written}.` : ''}${r.readOnly ? `\n${r.readOnly} événement(s) dans un calendrier en lecture seule : non modifié(s) dans Google.` : ''}`);
    }); break;
    case 'gcal-cleanup': gcalRun(async () => {
      if (!confirm('Garder un seul calendrier « Mon temps », supprimer les autres, puis supprimer les événements en double (90 derniers jours). Continuer ?')) return;
      if (!gg.isConnected()) await gg.connect(st.settings.gcalClientId);
      const r = await new gg.GoogleCalendarProvider(st.settings.gcalId).cleanup(st.settings.gcalId);
      update(s => { s.settings.gcalId = r.calId || s.settings.gcalId; for (const d of Object.values(s.days)) d.gcal = {}; });
      alert(`Nettoyage terminé : ${r.calendars} calendrier(s) en trop supprimé(s), ${r.events} événement(s) en double supprimé(s).`);
    }); break;
    case 'gcal-push-week': gcalRun(async () => {
      if (!gg.isConnected()) await gg.connect(st.settings.gcalClientId);
      if (needsRelink()) await gcalReadAll();
      const prov = new gg.GoogleCalendarProvider(get().settings.gcalId);
      let tot = { created: 0, updated: 0, deleted: 0, written: 0, readOnly: 0 };
      for (let i = 6; i >= 0; i--) { const dk = addDays(key, -i); if (!userDay(get().days[dk])) continue; const r = await gcalPushDay(dk, prov); for (const q in tot) tot[q] += r[q]; }
      Object.assign(tot, await gcalWriteBack(prov));
      alert(`7 derniers jours envoyés : ${tot.created} créé(s), ${tot.updated} mis à jour, ${tot.deleted} supprimé(s)${tot.written ? `, ${tot.written} événement(s) d'origine modifié(s)` : ''}${tot.readOnly ? `, ${tot.readOnly} en lecture seule` : ''}.`);
    }); break;
    case 'notif-perm': notify.askPermission().then(render); break;
    case 'notif-test': notify.test(); break;
    case 'export': {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
      a.download = `mon-temps-${key}.json`; a.click();
      update(s => { s.settings.lastBackup = Date.now(); }); break;
    }
    case 'reset': if (confirm('Effacer toutes les données de cet appareil ? Cette action est irréversible.')) resetAll(); break;
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.dayfield) {
    const f = t.dataset.dayfield;
    update(s => { ensureDay(s, ui.viewDay)[f] = t.value ? fromInput(t.value) : null; });
  } else if (t.dataset.setting) {
    const path = t.dataset.setting.split('.'), v = t.type === 'checkbox' ? t.checked : t.type === 'time' ? fromInput(t.value) : t.type === 'number' ? +t.value : t.value;
    update(s => { let o = s.settings; while (path.length > 1) o = o[path.shift()]; o[path[0]] = v; });
  } else if (t.dataset.file) {
    const file = t.files[0]; if (!file) return;
    const text = await file.text();
    try {
      if (t.dataset.file === 'ics') {
        let n = 0; update(s => { n = importEvents(parseICS(text), ensureDay, s); });
        alert(`${n} événement(s) importé(s) comme obligations.`);
      } else if (confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) importJSON(text);
    } catch (err) { alert('Import impossible : ' + err.message); }
    t.value = '';
  }
});

window.addEventListener('popstate', () => { const t = location.hash.slice(1); if (views[t] && t !== ui.tab) { ui.tab = t; render(); } });
document.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.sec) ui.open[d.dataset.sec] = d.open; }, true);

tabsEl.addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) { ui.tab = b.dataset.tab; if (ui.tab !== 'home') ui.viewDay = ui.viewDay || dayKey(); render(); window.scrollTo(0, 0); }
});
modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });

// -------------------------------------------------------------- Démarrage
subscribe(() => { if (!inSys) gcalSoon(); if (!ui.modal) render(); });
const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');
setInterval(tick, 1000);
const subDue = () => { const st = get().settings; return st.icsUrl && Date.now() - st.icsSync > 30 * 60000; };
setInterval(() => { ensureRecurring(dayKey()); if (subDue()) syncSub(false); if (gcalDue()) gcalAutoSync(); notify.check(); if (!ui.modal && !typing() && !document.hidden) render(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { gcalStart(); notify.check(); if (!ui.modal) render(); } });
ensureRecurring(dayKey());
if (get().settings.gcalClientId) gg.preload();
setTimeout(gcalStart, 1500);                      // laisse le temps au service Google de se charger
if (subDue()) syncSub(false);
render();
notify.check();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
