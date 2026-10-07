import {
  get, update, subscribe, ensureDay, newDay, startActivity, pauseSession, resumeSession, stopSession,
  exportJSON, importJSON, resetAll,
} from './store.js';
import {
  dayKey, dayStartMs, addDays, dayLabel, dayShort, minuteOf, fmtHM, fmtDur, fmtPct, fmtClock, toInput, fromInput, uid, ceil5,
} from './time.js';
import { CATS, PICKABLE, analyse, insights, patterns, hasData, sessionElapsed, blockDone, dayWindow, entriesOf } from './analysis.js';
import { propose, applyProposal } from './planner.js';
import { signals } from './signals.js';
import { classify } from './classify.js';
import { parseICS, importEvents, clearImported } from './calendar.js';
import * as gg from './google.js';
import * as lock from './lock.js';
import * as notify from './notify.js';

const app = document.getElementById('app'), modalEl = document.getElementById('modal'), tabsEl = document.getElementById('tabs');
const ui = { tab: 'home', viewDay: dayKey(), modal: null };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catChip = c => `${CATS[c].emoji} ${CATS[c].label}`;
const nowM = () => minuteOf(Date.now(), dayKey());

// ---------------------------------------------------------------- Accueil
function renderHome() {
  const st = get(), now = Date.now(), key = dayKey(), a = analyse(st, key, now), day = st.days[key] || newDay();
  const nm = nowM(), cur = st.current, sess = st.session;
  let html = '';

  if (day.wakeActual == null && nm >= a.wake && nm < a.bed)
    html += `<section class="card"><h2>☀️ Bonjour</h2><p>À quelle heure t'es-tu réveillé ? <span class="muted">(prévu ${fmtHM(a.wake)})</span></p>
      <form class="row" data-submit="wake"><input type="time" name="t" value="${toInput(Math.max(a.wake, Math.min(nm, 1439)))}" required>
      <button class="btn primary">Valider</button><button type="button" class="btn" data-act="wake-ontime">À l'heure prévue</button></form></section>`;

  // Maintenant
  if (cur && sess) {
    const paused = cur.cat === 'pause' && sess.cat !== 'pause';
    const goal = sess.goalId && day.goals.find(g => g.id === sess.goalId);
    const prog = goal ? analyse(st, key, now).goals.find(g => g.id === goal.id) : null;
    html += `<section class="card now ${paused ? 'paused' : ''}"><h2>Maintenant</h2>
      <div class="act">${CATS[sess.cat].emoji} ${esc(sess.title)}</div>
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
    ? `<div class="act">${CATS[next.cat].emoji} ${esc(next.title)}</div><p class="muted">${fmtHM(next.start)}–${fmtHM(next.end)}</p>
       ${next.cat === 'prod' ? `<button class="btn" data-act="start-block" data-id="${next.id}">▶ Commencer maintenant</button>` : ''}`
    : '<p class="muted">Rien de prévu pour la suite. <a href="#" data-act="tab" data-tab="plan">Planifier</a></p>'}</section>`;

  // Aujourd'hui
  const ratio = a.target ? Math.min(100, a.cat.prod / a.target * 100) : 0;
  html += `<section class="card"><h2>Aujourd'hui</h2>
    <div class="stats"><div><b>${fmtDur(a.cat.prod)}</b><span>Productivité</span></div>
    <div><b>${a.target ? fmtDur(a.target) : '—'}</b><span>Objectif</span></div>
    <div><b>${fmtDur(a.availRemaining)}</b><span>Temps disponible restant</span></div></div>
    ${a.target ? `<div class="bar"><i style="width:${ratio}%"></i></div>` : ''}</section>`;

  // Alertes
  const sigs = signals(st, now);
  if (!day.goals.length && !day.plan.length && nm < a.bed)
    sigs.push({ icon: '🗒️', text: 'Aucun objectif pour aujourd\'hui. Définis-les dans l\'onglet Planning pour obtenir un planning proposé.', action: 'tab-plan' });
  html += `<section class="card"><h2>Alertes</h2>${sigs.length ? sigs.map(alertRow).join('') : '<p class="muted">Rien à signaler 👍</p>'}</section>`;

  html += `<div class="row"><button class="btn" data-act="unplanned">⚡ Imprévu</button><button class="btn" data-act="entry-open">＋ Activité passée</button></div>`;
  return html;
}

function alertRow(s) {
  const btn = {
    gap: ['Identifier', 'gap'], reorg: ['Réorganiser', 'reorg'], 'start-block': ['Commencer', 'start-block'],
    resume: ['Reprendre', 'resume'], stop: ['Terminer', 'stop'], 'tab-plan': ['Ouvrir', 'tab-plan'],
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
    <div><b>${esc(g.title)}</b>${g.hard ? ' <span class="tag">difficile</span>' : ''}
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
      const done = b.cat === 'prod' ? blockDone(st, key, b, now) : 0;
      return `<div class="block c-${b.cat}"><div class="t">${fmtHM(b.start)}<br>${fmtHM(b.end)}</div>
        <div class="grow"><b>${CATS[b.cat].emoji} ${esc(b.title)}</b>
        <div class="muted">${b.fixed ? (b.source === 'ics' || b.source === 'gcal' ? 'calendrier' : 'contrainte') : 'proposé'}${done > 0 ? ` · fait ${fmtDur(done)}` : ''}</div></div>
        <div class="row tight">${!past && b.cat === 'prod' && key === dayKey() ? `<button class="btn small" data-act="start-block" data-id="${b.id}">▶</button>` : ''}
        <button class="btn small" data-act="block-edit" data-id="${b.id}">✎</button></div></div>`;
    }).join('') : '<p class="muted">Planning vide.</p>'}
    <div class="row"><button class="btn" data-act="block-add">＋ Contrainte</button>
    ${!past ? '<button class="btn primary" data-act="plan-gen">✨ Proposer un planning</button>' : ''}
    ${!past && s.gcalClientId && day.plan.some(b => b.cat === 'prod') ? '<button class="btn" data-act="gcal-push">📅 Envoyer vers Google Agenda</button>' : ''}</div>
    <p class="muted small">Les contraintes (cours, rendez-vous, transport…) sont respectées. Rien n'est déplacé sans ton accord.</p></section>`;
  return html;
}

// ------------------------------------------------------------------ Bilan
function renderBilan() {
  const st = get(), key = ui.viewDay, now = Date.now(), a = analyse(st, key, now);
  let html = dayNav();
  if (!hasData(st, key) && key !== dayKey()) return html + '<section class="card"><p class="muted">Pas de données pour ce jour.</p></section>';
  html += `<section class="card"><h2>Journée du ${dayLabel(key)}</h2><p>Temps éveillé : <b>${fmtDur(a.awake)}</b></p>
    ${['prod', 'obl', 'vie', 'pause', 'loisir', 'unk'].map(c => `
      <div class="line c-${c}"><div class="lh"><span>${catChip(c)}</span><b>${fmtDur(a.cat[c])} — ${fmtPct(a.cat[c], a.awake)}</b></div>
      <div class="bar"><i style="width:${a.awake ? a.cat[c] / a.awake * 100 : 0}%"></i></div></div>`).join('')}
    <p class="muted">Temps réellement disponible (éveillé − obligations − vie quotidienne) : <b>${fmtDur(a.availSoFar)}</b>.
    ${a.unkPending ? ` Dont ${fmtDur(a.unkPending)} à identifier.` : ''}${a.unkLost ? ` ${fmtDur(a.unkLost)} déclarés « je ne sais plus » (temps perdu estimé).` : ''}</p></section>`;

  const ins = insights(a), pat = patterns(st, key, now);
  html += `<section class="card"><h2>Analyse</h2>${ins.map(t => `<p>${esc(t)}</p>`).join('') || '<p class="muted">Pas encore assez de données.</p>'}
    ${pat.length ? `<h3>Tendances récurrentes</h3>${pat.map(t => `<p>${esc(t)}</p>`).join('')}` : ''}</section>`;

  if (a.goals.length)
    html += `<section class="card"><h2>🎯 Objectifs</h2>${a.goals.map(g => goalRow(g, key, false)).join('')}</section>`;

  if (a.gaps.length)
    html += `<section class="card"><h2>❓ À identifier</h2>${a.gaps.map(g => `<div class="alert"><span>${fmtHM(g.start)}–${fmtHM(g.end)} (${fmtDur(g.end - g.start)})</span>
      <button class="btn small" data-act="gap" data-ref="${g.start}-${g.end}">Identifier</button></div>`).join('')}</section>`;

  const day = st.days[key], log = (day?.log || []).slice().sort((x, y) => x.start - y.start);
  html += `<section class="card"><h2>Journal</h2>${log.length ? log.map(e => `<div class="alert"><span>${new Date(e.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}–${new Date(e.end).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
    · ${CATS[e.cat].emoji} ${esc(e.title)} (${fmtDur((e.end - e.start) / 60000)})</span>
    <button class="btn small" data-act="entry-del" data-id="${e.id}" aria-label="Supprimer">✕</button></div>`).join('') : '<p class="muted">Aucune activité enregistrée.</p>'}
    <div class="row"><button class="btn" data-act="entry-open">＋ Ajouter une activité</button></div></section>`;
  return html;
}

// ---------------------------------------------------------------- Semaine
function renderWeek() {
  const st = get(), now = Date.now(), today = dayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const rows = days.map(k => ({ k, a: hasData(st, k) ? analyse(st, k, now) : null }));
  const have = rows.filter(r => r.a);
  const sum = f => have.reduce((x, r) => x + f(r.a), 0);
  const maxProd = Math.max(60, ...have.map(r => Math.max(r.a.cat.prod, r.a.target)));
  let html = `<section class="card"><h2>Heures productives</h2>${rows.map(({ k, a }) => `
    <div class="wk"><span class="d">${dayShort(k)}</span>
    <div class="track">${a ? `<i class="p" style="width:${a.cat.prod / maxProd * 100}%"></i>${a.target ? `<u style="left:${a.target / maxProd * 100}%" title="objectif"></u>` : ''}` : ''}</div>
    <b>${a ? fmtDur(a.cat.prod) : '—'}</b></div>`).join('')}
    <p class="muted small">Le trait vertical indique l'objectif du jour.</p></section>`;

  html += `<section class="card"><h2>Détail</h2><div class="scroll"><table><thead><tr><th></th><th>Prod.</th><th>Obj.</th><th>Dispo</th><th>Non id.</th><th>Oblig.</th><th>Pause</th><th>Loisir</th></tr></thead><tbody>
    ${rows.map(({ k, a }) => a ? `<tr><td>${dayShort(k)}</td><td>${fmtDur(a.cat.prod)}</td><td>${a.target ? Math.round(a.cat.prod / a.target * 100) + ' %' : '—'}</td>
      <td>${fmtDur(a.availSoFar)}</td><td>${fmtDur(a.cat.unk)}</td><td>${fmtDur(a.cat.obl)}</td><td>${fmtDur(a.cat.pause)}</td><td>${fmtDur(a.cat.loisir)}</td></tr>`
      : `<tr class="muted"><td>${dayShort(k)}</td><td colspan="7">—</td></tr>`).join('')}</tbody></table></div></section>`;

  // tendances
  const lines = [];
  if (have.length >= 2) {
    const prods = have.map(r => r.a.cat.prod), half = Math.floor(prods.length / 2);
    const avg = l => l.reduce((x, y) => x + y, 0) / (l.length || 1);
    const first = avg(prods.slice(0, half)), last = avg(prods.slice(half));
    const diff = last - first;
    lines.push(`Moyenne : ${fmtDur(avg(prods))} productives par jour. ${Math.abs(diff) < 15 ? 'Rythme stable.' : diff > 0 ? `En hausse récemment (+${fmtDur(diff)} par jour).` : `En baisse récemment (−${fmtDur(-diff)} par jour).`}`);
    const best = have.reduce((b, r) => (r.a.cat.prod > b.a.cat.prod ? r : b));
    lines.push(`Meilleur jour : ${dayShort(best.k)} (${fmtDur(best.a.cat.prod)}).`);
    const withGoal = have.filter(r => r.a.target);
    if (withGoal.length) lines.push(`Objectifs atteints (≥ 100 %) : ${withGoal.filter(r => r.a.cat.prod >= r.a.target).length} jour(s) sur ${withGoal.length}.`);
    const unkPct = sum(a => a.cat.unk) / (sum(a => a.awake) || 1);
    lines.push(`Temps non identifié : ${fmtDur(sum(a => a.cat.unk))} sur la période (${fmtPct(sum(a => a.cat.unk), sum(a => a.awake))}).${unkPct > 0.2 ? ' Identifier ces plages donnerait une image plus juste.' : ''}`);
  }
  const pat = patterns(st, today, now);
  html += `<section class="card"><h2>Tendances</h2>${[...lines, ...pat].map(t => `<p>${esc(t)}</p>`).join('') || '<p class="muted">Utilise l\'app quelques jours pour voir apparaître des tendances.</p>'}</section>`;
  return html;
}

// --------------------------------------------------------------- Réglages
function renderSettings() {
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
    ${chk('reminder', 'Rappel de début d\'activité')}${chk('late', 'Retard')}${chk('unknown', 'Temps non identifié')}
    ${chk('end', 'Fin de session')}${chk('pause', 'Pause plus longue que prévu')}${chk('reorg', 'Réorganisation')}
    <p class="muted small">Sans serveur, les notifications partent tant que l'app est ouverte ou en arrière-plan. Aucune surveillance des autres applications.</p></section>
    <section class="card"><h2>Google Agenda</h2>
    <p class="muted">Lecture de tes événements (cours, rendez-vous…) comme contraintes ; envoi des sessions de productivité dans un calendrier séparé « Mon temps », seulement quand tu le demandes.</p>
    <label>Identifiant client Google <span class="small">(voir LISEZMOI)</span><input type="text" data-setting="gcalClientId" value="${esc(s.gcalClientId)}" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false"></label>
    <div class="row"><button class="btn primary" data-act="gcal-connect" ${s.gcalClientId ? '' : 'disabled'}>${gg.isConnected() ? 'Connecté ✓' : 'Se connecter à Google'}</button>
    <button class="btn" data-act="gcal-import" ${s.gcalClientId ? '' : 'disabled'}>Importer les 7 prochains jours</button></div>
    <p class="muted small">Sans identifiant, tu peux importer un fichier .ics :</p>
    <label class="btn file">Importer un .ics<input type="file" accept=".ics,text/calendar" data-file="ics" hidden></label></section>
    <section class="card"><h2>🔒 Sécurité</h2><p class="muted">Un code à 4 chiffres est demandé à l'ouverture et après 2 minutes en arrière-plan.</p>
    <div class="row"><button class="btn" data-act="lock-now">Verrouiller maintenant</button><button class="btn" data-act="pin-change">Changer le code</button></div></section>
    <section class="card"><h2>Données</h2><p class="muted">Tout reste sur cet appareil. Exporte régulièrement une sauvegarde.</p>
    <div class="row"><button class="btn" data-act="export">Exporter</button>
    <label class="btn file">Importer<input type="file" accept="application/json" data-file="backup" hidden></label>
    <button class="btn danger" data-act="reset">Tout effacer</button></div></section>`;
}

// ----------------------------------------------------------------- Rendu
const views = { home: renderHome, plan: renderPlan, bilan: renderBilan, week: renderWeek, settings: renderSettings };
function render() {
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
const catRadios = (sel, cats = PICKABLE) => `<div class="cats">${cats.map(c => `<label><input type="radio" name="cat" value="${c}" ${c === sel ? 'checked' : ''}><span>${catChip(c)}</span></label>`).join('')}</div>`;
function openModal(title, body, onSubmit) {
  ui.modal = { onSubmit };
  modalEl.innerHTML = `<div class="sheet"><div class="sh"><h2>${title}</h2><button class="btn small" data-act="modal-close" aria-label="Fermer">✕</button></div>${body}</div>`;
  modalEl.hidden = false;
  modalEl.querySelector('input[type=text],input[type=number]')?.focus({ preventScroll: true });
}
function closeModal() { ui.modal = null; modalEl.hidden = true; modalEl.innerHTML = ''; render(); }
const gapParse = r => r.split('-').map(Number);

function modalStart(pre = {}) {
  const key = dayKey(), goals = (get().days[key]?.goals || []).filter(g => !g.settled);
  openModal('Commencer une activité', `<form data-submit="start">
    ${goals.length ? `<div class="chips">${goals.map(g => `<button type="button" class="chip" data-act="pick-goal" data-id="${g.id}" data-title="${esc(g.title)}">📚 ${esc(g.title)}</button>`).join('')}</div>` : ''}
    <input type="hidden" name="goalId" value="${pre.goalId || ''}">
    ${catRadios(pre.cat || 'prod')}
    <label>Titre<input type="text" name="title" value="${esc(pre.title || '')}" placeholder="Ex. Traitement du signal" required></label>
    <label class="plen">Durée de pause prévue (min)<input type="number" name="plannedMin" value="${get().settings.breakLen}" min="1"></label>
    <button class="btn primary big">▶ Commencer</button></form>`, f => {
    startActivity({ cat: f.cat, title: f.title.trim(), goalId: f.goalId || null, plannedMin: +f.plannedMin || null });
  });
}

function modalEntry({ unplanned = false, gap = null, cat = 'prod', title = '' } = {}) {
  const ik = ui.tab === 'home' ? dayKey() : ui.viewDay;
  const nm = Math.min(nowM(), 1439);
  const [gs, ge] = gap ? gapParse(gap) : [Math.max(0, nm - 60), nm];
  if (unplanned) {
    openModal('⚡ Imprévu', `<form data-submit="unplanned"><label>Que s'est-il passé ?<input type="text" name="title" placeholder="Ex. Appel, dépannage…" required></label>
      <label>Durée (minutes)<input type="number" name="min" value="45" min="5" max="600" required></label>${catRadios('obl')}
      <p class="muted small">L'imprévu est enregistré comme terminé à l'instant. Je te proposerai ensuite de réorganiser le reste de la journée — rien ne bouge sans ton accord.</p>
      <button class="btn primary big">Ajouter</button></form>`, f => {
      const end = Date.now(), start = end - f.min * 60000;
      update(st => { ensureDay(st, dayKey(new Date(start))).log.push({ id: uid(), cat: f.cat, title: f.title.trim(), goalId: null, start, end }); });
      setTimeout(modalReorg, 0);
    });
    return;
  }
  openModal(gap ? '❓ Que faisais-tu ?' : 'Ajouter une activité', `<form data-submit="entry" data-day="${ik}">
    ${gap ? '<label>Décris en quelques mots<input type="text" name="title" placeholder="Ex. je préparais à manger"></label>' : '<label>Titre<input type="text" name="title" required></label>'}
    <div class="grid3"><label>De<input type="time" name="from" value="${toInput(gs)}" required></label><label>À<input type="time" name="to" value="${toInput(ge)}" required></label></div>
    ${catRadios(cat)}
    <div class="row">${gap ? '<button class="btn primary" data-act="gap-ok">Enregistrer</button><button type="button" class="btn" data-act="gap-unknown">Je ne sais plus</button>' : '<button class="btn primary">Ajouter</button>'}</div></form>`,
    f => saveEntry(f, ik));
}

function saveEntry(f, key, extra = {}) {
  const a = fromInput(f.from), z = fromInput(f.to);
  if (z <= a) return alert('L\'heure de fin doit être après le début.');
  const s0 = new Date(key.replace(/-/g, '/')).getTime();
  let cat = f.cat, title = (f.title || '').trim();
  if (extra.unknown) { cat = 'unk'; title = 'Non identifié'; }
  else if (!title && cat) title = CATS[cat].label;
  update(st => { ensureDay(st, key).log.push({ id: uid(), cat, title, goalId: null, start: s0 + a * 60000, end: s0 + z * 60000, dontKnow: !!extra.unknown }); });
}

function modalGoal(id) {
  const g = id ? get().days[ui.viewDay]?.goals.find(x => x.id === id) : null;
  openModal(g ? 'Modifier l\'objectif' : 'Nouvel objectif', `<form data-submit="goal" data-id="${id || ''}">
    <label>Matière / projet<input type="text" name="title" value="${esc(g?.title)}" placeholder="Ex. Traitement du signal" required></label>
    <label>Durée visée (heures)<input type="number" name="h" step="0.25" min="0.25" max="12" value="${g ? g.target / 60 : 1}" required></label>
    <label class="check"><input type="checkbox" name="hard" ${g?.hard ? 'checked' : ''}> Matière difficile (placée en premier)</label>
    <div class="row"><button class="btn primary">Enregistrer</button>${g ? '<button type="button" class="btn danger" data-act="goal-del">Supprimer</button>' : ''}</div></form>`, f => {
    update(st => {
      const d = ensureDay(st, ui.viewDay), target = Math.round(+f.h * 60);
      if (f.id) Object.assign(d.goals.find(x => x.id === f.id), { title: f.title.trim(), target, hard: !!f.hard });
      else d.goals.push({ id: uid(), title: f.title.trim(), target, hard: !!f.hard });
    });
  });
}

function modalBlock(id) {
  const b = id ? get().days[ui.viewDay]?.plan.find(x => x.id === id) : null;
  openModal(b ? 'Modifier le bloc' : 'Nouvelle contrainte', `<form data-submit="block" data-id="${id || ''}">
    <label>Titre<input type="text" name="title" value="${esc(b?.title)}" placeholder="Ex. Cours d'automatique" required></label>
    <div class="grid3"><label>De<input type="time" name="from" value="${toInput(b?.start ?? 9 * 60)}" required></label><label>À<input type="time" name="to" value="${toInput(b?.end ?? 10 * 60)}" required></label></div>
    ${catRadios(b?.cat || 'obl')}
    <div class="row"><button class="btn primary">Enregistrer</button>${b ? '<button type="button" class="btn danger" data-act="block-del">Supprimer</button>' : ''}</div></form>`, f => {
    const start = fromInput(f.from), end = fromInput(f.to);
    if (end <= start) return alert('L\'heure de fin doit être après le début.');
    update(st => {
      const d = ensureDay(st, ui.viewDay);
      if (f.id) { const x = d.plan.find(p => p.id === f.id); Object.assign(x, { title: f.title.trim(), start, end, cat: f.cat, fixed: true, source: x.source === 'ics' || x.source === 'gcal' ? x.source : 'user' }); }
      else d.plan.push({ id: uid(), title: f.title.trim(), start, end, cat: f.cat, fixed: true, source: 'user' });
      d.plan.sort((p, q) => p.start - q.start);
    });
  });
}

function modalReorg(title = 'Réorganiser la journée') {
  const key = dayKey(), p = propose(get(), key, Date.now());
  const list = p.add.length ? p.add.map(b => `<div class="alert"><span>${fmtHM(b.start)}–${fmtHM(b.end)} · ${CATS[b.cat].emoji} ${esc(b.title)}</span></div>`).join('') : '<p class="muted">Rien à placer.</p>';
  openModal(title, `<p class="muted">Voici ce que je propose pour la suite. Tu peux accepter ou garder ton planning actuel.</p>${list}
    ${p.unplaced.map(u => `<p class="warn">⚠️ Pas assez de place pour ${fmtDur(u.min)} de « ${esc(u.title)} ».</p>`).join('')}
    <div class="row"><button class="btn primary" data-act="apply-proposal">Accepter</button><button class="btn" data-act="modal-close">Garder tel quel</button></div>`);
  ui.modal.proposal = { key, p };
}

function modalPlanGen() {
  const key = ui.viewDay, p = propose(get(), key, Date.now());
  const list = p.add.length ? p.add.map(b => `<div class="alert"><span>${fmtHM(b.start)}–${fmtHM(b.end)} · ${CATS[b.cat].emoji} ${esc(b.title)}</span></div>`).join('')
    : '<p class="muted">Aucun objectif à placer. Ajoute des objectifs d\'abord.</p>';
  openModal('✨ Planning proposé', `<p class="muted">Tient compte de tes contraintes, du sommeil, de tes préférences et de ce qui est déjà fait.</p>${list}
    ${p.unplaced.map(u => `<p class="warn">⚠️ Pas assez de place pour ${fmtDur(u.min)} de « ${esc(u.title)} ». Réduis l'objectif ou libère du temps.</p>`).join('')}
    <div class="row">${p.add.length || p.remove.length ? '<button class="btn primary" data-act="apply-proposal">Accepter</button>' : ''}<button class="btn" data-act="modal-close">Fermer</button></div>`);
  ui.modal.proposal = { key, p };
}

// ------------------------------------------------------------ Événements
async function gcalRun(fn) {
  try { await fn(); } catch (e) { alert(e.message); }
}
const formData = form => Object.fromEntries(new FormData(form).entries());

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  const f = formData(form);
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
    case 'tab-plan': ui.tab = 'plan'; ui.viewDay = key; render(); break;
    case 'day-prev': ui.viewDay = addDays(ui.viewDay, -1); render(); break;
    case 'day-next': ui.viewDay = addDays(ui.viewDay, 1); render(); break;
    case 'day-today': ui.viewDay = key; render(); break;
    case 'modal-close': closeModal(); break;
    case 'start-open': modalStart(); break;
    case 'pick-goal': {
      const f = t.closest('form'); f.goalId.value = id; f.title.value = t.dataset.title;
      f.querySelector('input[name=cat][value=prod]').checked = true; break;
    }
    case 'start-goal': { const g = goalOf(id); if (g) startActivity({ cat: 'prod', title: g.title, goalId: g.id }); break; }
    case 'start-block': {
      const b = (st.days[key]?.plan || []).find(x => x.id === id);
      if (b) startActivity({ cat: b.cat, title: b.title, goalId: b.goalId || null });
      break;
    }
    case 'pause': pauseSession(); break;
    case 'resume': resumeSession(); break;
    case 'stop': stopSession(); break;
    case 'wake-ontime': update(s => { ensureDay(s, key).wakeActual = dayWindow(s, key).wake; }); break;
    case 'unplanned': modalEntry({ unplanned: true }); break;
    case 'entry-open': modalEntry(); break;
    case 'entry-del': update(s => { const d = s.days[ui.viewDay]; if (d) d.log = d.log.filter(x => x.id !== id); }); break;
    case 'gap': {
      const ref = t.dataset.ref || t.dataset.id;
      modalEntry({ gap: ref, cat: '' });
      const form = modalEl.querySelector('form'), input = form.querySelector('input[name=title]');
      input.addEventListener('input', () => { const c = classify(input.value); if (c) form.querySelector(`input[name=cat][value=${c}]`).checked = true; });
      form.querySelectorAll('input[name=cat]').forEach(r => (r.checked = false));
      form.addEventListener('submit', ev => { if (!form.querySelector('input[name=cat]:checked')) { ev.stopImmediatePropagation(); ev.preventDefault(); alert('Choisis une catégorie (ou « Je ne sais plus »).'); } }, true);
      break;
    }
    case 'gap-unknown': {
      const form = t.closest('form'), f = formData(form);
      if (saveEntry(f, form.dataset.day, { unknown: true }) === undefined) closeModal();
      break;
    }
    case 'goal-add': modalGoal(); break;
    case 'goal-edit': modalGoal(id); break;
    case 'goal-del': {
      const gid = t.closest('form').dataset.id;
      update(s => { const d = s.days[ui.viewDay]; d.goals = d.goals.filter(g => g.id !== gid); d.plan = d.plan.filter(b => b.goalId !== gid || b.fixed); });
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
    case 'block-del': { const bid = t.closest('form').dataset.id; update(s => { const d = s.days[ui.viewDay]; d.plan = d.plan.filter(b => b.id !== bid); }); closeModal(); break; }
    case 'plan-gen': modalPlanGen(); break;
    case 'reorg': modalReorg(); break;
    case 'apply-proposal': {
      const { key: k, p } = ui.modal.proposal;
      update(s => applyProposal(ensureDay(s, k), p));
      closeModal(); break;
    }
    case 'gcal-connect': gcalRun(async () => { await gg.connect(st.settings.gcalClientId); render(); }); break;
    case 'gcal-import': gcalRun(async () => {
      if (!gg.isConnected()) await gg.connect(st.settings.gcalClientId);
      const from = dayStartMs(key), prov = new gg.GoogleCalendarProvider(st.settings.gcalId);
      const events = await prov.getEvents(from, from + 8 * 86400000);
      let n = 0;
      update(s => { clearImported(ensureDay, s, 'gcal', key, 8); n = importEvents(events, ensureDay, s, 'gcal'); });
      alert(`${events.length} événement(s) lu(s) dans Google Agenda (${n} bloc(s) ajouté(s) comme obligations).`);
    }); break;
    case 'gcal-push': gcalRun(async () => {
      if (!gg.isConnected()) await gg.connect(st.settings.gcalClientId);
      const k = ui.viewDay, blocks = (st.days[k]?.plan || []).filter(b => b.cat === 'prod');
      const prov = new gg.GoogleCalendarProvider(st.settings.gcalId);
      const r = await prov.pushDay(k, blocks, st.days[k]?.gcal || {});
      update(s => { ensureDay(s, k).gcal = r.map; s.settings.gcalId = r.calId; });
      alert(`Google Agenda (calendrier « Mon temps ») : ${r.created} créé(s), ${r.updated} mis à jour, ${r.deleted} supprimé(s).`);
    }); break;
    case 'lock-now': location.reload(); break;
    case 'pin-change': lock.changePin().then(ok => ok && alert('Code modifié.')); break;
    case 'notif-perm': notify.askPermission().then(render); break;
    case 'export': {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
      a.download = `mon-temps-${key}.json`; a.click(); break;
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

tabsEl.addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) { ui.tab = b.dataset.tab; if (ui.tab !== 'home') ui.viewDay = ui.viewDay || dayKey(); render(); window.scrollTo(0, 0); }
});
modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });

// -------------------------------------------------------------- Démarrage
subscribe(() => { if (!ui.modal) render(); });
const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');
setInterval(tick, 1000);
setInterval(() => { notify.check(); if (!ui.modal && !typing() && !document.hidden) render(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { notify.check(); if (!ui.modal) render(); } });
if (get().settings.gcalClientId) gg.preload();
render();
notify.check();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
