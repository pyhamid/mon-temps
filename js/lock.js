// Verrou à code unique (4 chiffres), identique sur tous les appareils.
// Le code n'est jamais écrit en clair : seule son empreinte salée (PBKDF2) est dans le code.
// Limite connue : sans serveur, c'est une barrière pour les curieux, pas une protection absolue.
const KEY = 'temps-lock';
const CODE = { salt: 'vexgzuFpD+PJly+fR8JPoA==', hash: 'MK14q6/LRwdOwvJEGphZ7hiUUTT5levDU55nfahMz7Q=' };
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
    <div class="lk-row"><button type="button" id="lkX" class="lk-link" hidden>Annuler</button></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  document.addEventListener('keydown', e => {
    if (ov.hidden) return;
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Escape' && !$('#lkX').hidden) $('#lkX').click();
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
function ask({ title, msg = '', cancellable = false }) {
  build();
  ov.hidden = false;
  $('#lkT').textContent = title;
  $('#lkM').textContent = msg;
  digits = ''; draw();
  return new Promise(resolve => {
    pending = resolve;
    const x = $('#lkX');
    x.hidden = !cancellable;
    x.onclick = () => { pending = null; resolve(null); };
  });
}
const hide = () => { if (ov) ov.hidden = true; };

/** Demande le code. Résout quand l'app peut s'ouvrir. */
export async function unlock() {
  if (!crypto.subtle) {
    build(); ov.hidden = false;
    $('#lkT').textContent = 'Connexion non sécurisée';
    $('#lkM').textContent = 'Ouvre l\'application avec une adresse https://.';
    await new Promise(() => {});
  }
  let msg = '';
  for (;;) {
    const st = load() || { fails: 0, until: 0 };
    const wait = Math.ceil((st.until - Date.now()) / 1000);
    if (wait > 0) {
      build(); ov.hidden = false; $('#lkT').textContent = 'Verrouillé';
      $('#lkM').textContent = `Trop d'essais. Réessaie dans ${wait >= 60 ? Math.ceil(wait / 60) + ' min' : wait + ' s'}.`;
      $('#lkX').hidden = true;
      await new Promise(r => setTimeout(r, Math.min(wait * 1000, 5000)));
      continue;
    }
    const pin = await ask({ title: 'Entre ton code', msg });
    if (await hash(pin, CODE.salt) === CODE.hash) { save({ fails: 0, until: 0 }); hide(); return; }
    st.fails = (st.fails || 0) + 1;
    if (st.fails >= MAX_FREE) st.until = Date.now() + Math.min(900, 30 * 2 ** (st.fails - MAX_FREE)) * 1000;
    save(st);
    msg = 'Code incorrect.';
  }
}
