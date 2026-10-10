import { listPlaces, bookingLines, notesSource, isFree, ratingBadge } from './source.js';
import { CURRENCY_HE } from './verdict.js';
import { line, fill } from './voice.js';

// "כמה עולה יום ב<יעד>": the budget format, from the page's own sourced daily cost.
//
// The owner allowed budget posts on one condition: the date the figures were
// checked is on the post. The site publishes each daily cost with its source and
// a `checked` date, and that date is printed on the cover. The source's own name
// is not: it is a domain, and a domain on a TikTok slide is a URL by this
// project's rules (src/urlLike.js).
//
// STILL IN THE LOCAL CURRENCY, as costLine in ./verdict.js explains: no page
// publishes shekels, and converting would need a rate nobody published.
//
// Three tiers if the page has them (budget, mid, comfort), the mid tier split into
// its parts, then what is free to walk into and what to book ahead. A page with
// no split daily cost cannot carry the post.

const PARTS_HE = { transport: 'תחבורה', food: 'אוכל', activities: 'אטרקציות' };

const total = (tier) => Object.values(tier || {}).map(Number).filter((x) => Number.isFinite(x) && x > 0).reduce((a, b) => a + b, 0);
const n = (x) => Math.round(x).toLocaleString('en-US');

/** "2026-07-29" as "29.7.2026", or null. */
export function checkedHe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : null;
}

/** Can this page carry a budget post? The canBuild `cost` need. */
export const hasSplitCost = (city) => {
  const c = city?.dailyCost;
  return Boolean(c?.currency && c.mid && typeof c.mid === 'object' && !Array.isArray(c.mid) && total(c.mid) > 0 && checkedHe(c.source?.checked));
};

export function buildBudgetPost(city, { hook, dest } = {}) {
  const destHe = dest?.he || city.name;
  if (!hasSplitCost(city)) throw new Error('the page publishes no split daily cost with a checked date');
  const c = city.dailyCost;
  const he = CURRENCY_HE[String(c.currency).toUpperCase()] || c.currency;
  const checked = checkedHe(c.source.checked);
  const photos = listPlaces(city, { want: 10, needPhoto: false }).filter((x) => x.image?.src);

  const slides = [];
  slides.push({
    look: 'label',
    cover: true,
    titleHe: line(fill(hook.he, { dest: destHe }), { where: 'cover' }),
    noteHe: line(`לפי הנתונים באתר, נכון ל-${checked}`, { where: 'cover.note' }),
    image: photos[0]?.image || null,
    ...(ratingBadge(city) || {}),
    band: 'mid',
  });

  const mid = Object.entries(c.mid)
    .filter(([k, v]) => PARTS_HE[k] && Number(v) > 0)
    .map(([k, v]) => ({ text: line(`${PARTS_HE[k]}: כ-${n(v)} ${he}`, { where: `mid.${k}` }) }));
  mid.push({ text: line(`ביחד: כ-${n(total(c.mid))} ${he} ליום לאדם, בלי לינה`, { where: 'mid.total' }) });
  slides.push({ look: 'sheet', titleHe: line('יום ממוצע', { where: 'mid.title' }), lines: mid, image: photos[1]?.image || null });

  const tiers = [];
  if (total(c.budget)) tiers.push({ text: line(`בתקציב נמוך: כ-${n(total(c.budget))} ${he} ליום`, { where: 'tier.budget' }) });
  if (total(c.comfort)) tiers.push({ text: line(`בנוחות: כ-${n(total(c.comfort))} ${he} ליום`, { where: 'tier.comfort' }) });
  if (tiers.length) slides.push({ look: 'sheet', titleHe: line('ובקצוות', { where: 'tier.title' }), lines: tiers, image: photos[2]?.image || null });

  const free = (city.places || []).filter(isFree).slice(0, 4);
  if (free.length >= 2) {
    slides.push({
      look: 'sheet',
      titleHe: line('בלי לשלם כניסה', { where: 'free.title' }),
      lines: free.map((p, i) => ({ text: line(p.name, { where: `free${i}` }) })),
      image: photos[3]?.image || null,
    });
  }

  const booking = bookingLines(city, { want: 2 });
  if (booking.length) {
    slides.push({
      look: 'sheet',
      titleHe: line('מה להזמין מראש', { where: 'booking.title' }),
      lines: booking.map((b, i) => ({ text: line(b, { where: `booking${i}`, quote: notesSource(city) }) })),
      image: photos[4]?.image || null,
    });
  }

  if (slides.length < 3) throw new Error(`only ${slides.length - 1} budget slide(s) after the cover`);
  return {
    slides,
    captionHookHe: line(`כמה עולה יום ב${destHe}, לפי הנתונים באתר`, { where: 'caption.hook' }),
    stats: { items: slides.length - 1, free: free.length },
  };
}
