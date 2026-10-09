// Classe une réponse libre (« je préparais à manger ») dans une catégorie.
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const RULES = [
  ['prep', /organis|planifi|prepar\w* (mes |les |le |la |l'|ma |mon )?(cours|etude|revis|planning|semaine|examen|programme|fiche)|trier|classer|fiches?\b/],
  ['lost', /reseau|insta|tiktok|snap|facebook|scroll/],            // réseaux sociaux = temps perdu (même chose que « je ne sais plus »)
  ['vie', /manger|mange|repas|cuisin|dejeuner|diner|petit.?dej|douche|menage|courses|lessive|vaisselle|habill|prepar(e|ais) (mes|ma|le|la)|rang(e|ais)|toilette/],
  ['trav', /boulot|\bjob\b|travail|alternance|stage|mission|client|bureau|shift/],
  ['obl', /cours|rdv|rendez|transport|bus|metro|train|trajet|demarche|admin|reunion|soutien|fac|ecole/],
  ['etu', /etud|revis|exerc|program|code|coder|projet|devoir|\btd\b|\btp\b|lectur|appren|rediger|rapport/],
  ['pause', /pause|repos|sieste|souffl|cafe|me reposais|detent|marche/],
  ['loisir', /jeu|jou(er|ais)|youtube|film|serie|netflix|musique|ami|telephone|video|sport|foot/],
];

export function classify(text) {
  const t = norm(text || '');
  for (const [cat, re] of RULES) if (re.test(t)) return cat;
  return null;
}
