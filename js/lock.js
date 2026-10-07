// Verrou à code (4 chiffres). C'est un verrou d'écran, pas un chiffrement :
// il empêche quelqu'un qui prend ton téléphone / navigateur d'ouvrir l'app.
// Le code n'est jamais stocké en clair (empreinte salée dans localStorage).
const KEY = 'temps-lock';
const MAX_FREE = 5;                 // essais avant temporisation

const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function hash(pin, salt) {
  if (crypto.subtle) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 150000, hash: 'SHA-256' }, k, 256);
    return b64(new Uint8Array(bits));
  }
  // contexte non sécurisé (http sur le réseau local, test uniquement)
  let h = 5381; for (const c of salt + pin) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return 'f' + h;
}

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = c => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* stockage bloqué */ } };

async function makeCfg(pin) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hash(pin, salt), fails: 0, until: 0 };
}

// ---------------------------------------------------------------- interface
let ov, digits = '', pending = null;
const $ = s => ov.querySelector(s);

function build() {
  if (ov) return;
  ov = document.createElement('div');
  ov.id = 'lock'; ov.hidden = true;
  ov.innerHTML = `<div class="lk"><div class="lk-ico">🔒</div><h2 id="lkT"></h2><div id="lkD" class="dots"></div>
    <p id="lkM" role="status"></p>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button type="button" data-k="${k}" aria-label="${k === '⌫' ? 'Effacer' : k}">${k}</button>`).join('')}</div>
    <div class="lk-row"><button type="button" id="lkX" class="lk-link" hidden>Annuler</button><button type="button" id="lkF" class="lk-link" hidden>Code oublié ?</button></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  document.addEventListener('keydown', e => {
    if (ov.hidden) return;
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Escape' && !$('#lkX').hidden) $('#lkX').click();
  });
  $('#lkF').addEventListener('click', () => {
    if (!confirm('Sans le code, la seule solution est d\'effacer toutes les données de cette application sur cet appareil (objectifs, journal, réglages). Continuer ?')) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith('temps-')) localStorage.removeItem(k);
    location.reload();
  });
}

function draw() { $('#lkD').innerHTML = [0, 1, 2, 3].map(i => `<i class="${i < digits.length ? 'on' : ''}"></i>`).join(''); }

function press(k) {
  if (!pending) return;
  if (k === '⌫') digits = digits.slice(0, -1);
  else if (digits.length < 4) digits += k;
  draw();
  if (digits.length === 4) {
    const p = digits, res = pending;
    pending = null;
    setTimeout(() => { digits = ''; draw(); res(p); }, 120);
  }
}

/** Affiche l'écran et attend 4 chiffres. Retourne le code, ou null si annulé. */
function ask({ title, msg = '', cancellable = false, forgot = false }) {
  build();
  ov.hidden = false;
  $('#lkT').textContent = title;
  $('#lkM').textContent = msg;
  $('#lkF').hidden = !forgot;
  digits = ''; draw();
  return new Promise(resolve => {
    pending = resolve;
    const x = $('#lkX');
    x.hidden = !cancellable;
    x.onclick = () => { pending = null; resolve(null); };
  });
}
const hide = () => { if (ov) ov.hidden = true; };

async function check(cfg, pin) { return (await hash(pin, cfg.salt)) === cfg.hash; }

async function createFlow(first = 'Crée un code à 4 chiffres', cancellable = false) {
  let msg = 'Il protège l\'accès à l\'application sur cet appareil.';
  for (;;) {
    const a = await ask({ title: first, msg, cancellable });
    if (a == null) return null;
    const b = await ask({ title: 'Confirme le code', cancellable });
    if (b == null) return null;
    if (a === b) return a;
    msg = 'Les deux codes ne correspondent pas. Recommence.';
  }
}

/** Demande le code (ou en crée un au premier lancement). Résout quand l'app peut s'ouvrir. */
export async function unlock() {
  let cfg = load();
  if (!cfg) {
    const pin = await createFlow();
    save(await makeCfg(pin));
    hide();
    return;
  }
  let msg = '';
  for (;;) {
    cfg = load();
    const wait = Math.ceil((cfg.until - Date.now()) / 1000);
    if (wait > 0) {
      msg = `Trop d'essais. Réessaie dans ${wait >= 60 ? Math.ceil(wait / 60) + ' min' : wait + ' s'}.`;
      build(); ov.hidden = false; $('#lkT').textContent = 'Verrouillé'; $('#lkM').textContent = msg; $('#lkF').hidden = false; $('#lkX').hidden = true;
      await new Promise(r => setTimeout(r, Math.min(wait * 1000, 5000)));
      continue;
    }
    const pin = await ask({ title: 'Entre ton code', msg, forgot: true });
    if (await check(cfg, pin)) { cfg.fails = 0; cfg.until = 0; save(cfg); hide(); return; }
    cfg.fails = (cfg.fails || 0) + 1;
    if (cfg.fails >= MAX_FREE) cfg.until = Date.now() + Math.min(900, 30 * 2 ** (cfg.fails - MAX_FREE)) * 1000;
    save(cfg);
    msg = 'Code incorrect.';
  }
}

/** Changer le code (depuis les réglages). Retourne true si modifié. */
export async function changePin() {
  const cfg = load();
  let msg = '';
  if (cfg) {
    for (;;) {
      const old = await ask({ title: 'Code actuel', msg, cancellable: true });
      if (old == null) { hide(); return false; }
      if (await check(cfg, old)) break;
      msg = 'Code incorrect.';
    }
  }
  const pin = await createFlow('Nouveau code', true);
  hide();
  if (pin == null) return false;
  save(await makeCfg(pin));
  return true;
}
