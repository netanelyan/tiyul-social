import { listPlaces, firstClause, bookingLines, practicalOf, notesSource, ratingBadge } from './source.js';
import { costLine } from './verdict.js';
import { line, fill } from './voice.js';

// "X דברים שכדאי לדעת לפני <יעד>": the broad listicle the trend watcher found
// working across languages, and the one the owner pointed at (250K+ views on the
// examples). Not about Tiyul+ at all; useful whoever made it.
//
// EVERY FACT IS THE PAGE'S OWN, one per slide, quoted the way the verdict post
// quotes it: the flight, how to get around, when to go, what to book ahead, and
// what a day costs. A page that cannot supply four of those cannot carry the
// post, and it throws rather than padding the count the cover promises.
//
// No kosher slide: kosher is a note on this account, never a slide's subject (see
// assertKosherIsANote in ./voice.js), and the verdict and plan posts carry it.

export const KNOW_MIN = 4;
export const KNOW_MAX = 7;

/** The page's facts that fit this post, in the order a traveller asks them. */
export function knowFacts(city) {
  const p = practicalOf(city);
  const facts = [];
  const add = (text, source, label) => {
    if (text && !facts.some((f) => f.text === text)) facts.push({ text, source, label });
  };
  add(firstClause(p.flightsHe, { max: 110 }), p.flightsHe, 'הטיסה');
  add(firstClause(p.aroundHe, { max: 110 }), p.aroundHe, 'להתנייד');
  add(firstClause(p.seasonHe, { max: 90 }), p.seasonHe, 'מתי לנסוע');
  for (const b of bookingLines(city, { want: 2 })) add(b, notesSource(city), 'להזמין מראש');
  const cost = costLine(city);
  if (cost) facts.push({ text: cost, source: null, label: 'כמה עולה יום' });
  return facts.slice(0, KNOW_MAX);
}

export function buildKnowPost(city, { hook, dest } = {}) {
  const destHe = dest?.he || city.name;
  const facts = knowFacts(city);
  if (facts.length < KNOW_MIN) {
    throw new Error(`the page carries ${facts.length} practical fact(s), and a "know before" post needs ${KNOW_MIN}`);
  }
  const n = facts.length;
  const photos = listPlaces(city, { want: n + 4, needPhoto: false }).filter((x) => x.image?.src);

  const cover = {
    look: 'label',
    cover: true,
    titleHe: line(fill(hook.he, { dest: destHe, n }), { where: 'cover' }),
    noteHe: line(`${n} דברים, כולם מהדף של ${destHe}`, { where: 'cover.note' }),
    image: photos[0]?.image || null,
    ...(ratingBadge(city) || {}),
    band: 'mid',
  };

  const slides = facts.map((f, i) => ({
    look: 'sheet',
    titleHe: line(`${i + 1}. ${f.label}`, { where: `fact${i}.title` }),
    lines: [{ text: line(f.text, { where: `fact${i}`, quote: f.source }) }],
    image: photos[i + 1]?.image || photos[0]?.image || null,
  }));

  return {
    slides: [cover, ...slides],
    captionHookHe: line(`${n} דברים שכדאי לדעת לפני ${destHe}`, { where: 'caption.hook' }),
    stats: { items: n },
  };
}
