// Utilitaires de temps. Les "minutes" sont des minutes depuis minuit du jour concerné.
export const pad = n => String(n).padStart(2, '0');

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const dayStartMs = key => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

export const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
};

export const minuteOf = (ms, key) => Math.floor((ms - dayStartMs(key)) / 60000);

export const ceil5 = m => Math.ceil(m / 5) * 5;

/** 510 → "08h30" */
export const fmtHM = min => `${pad(Math.floor(min / 60) % 24)}h${pad(min % 60)}`;

/** 510 → "08:30" (pour <input type="time">) */
export const toInput = min => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

export const fromInput = s => {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
};

/** 85 → "1h25", 35 → "35 min" */
export const fmtDur = min => {
  min = Math.round(min);
  if (min <= 0) return '0 min';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h${pad(m)}` : `${m} min`;
};

/** ms → "01:24:37" */
export const fmtClock = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

export const fmtPct = (a, b) => (b > 0 ? (a / b * 100).toFixed(1).replace('.', ',') : '0') + ' %';

export const dayLabel = key => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};

export const dayShort = key => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
};

export const uid = () => Math.random().toString(36).slice(2, 9);
