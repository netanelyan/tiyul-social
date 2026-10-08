// Whether a deck has been made before, under whatever title it has now.
//
// The idea call is told what went out, and that is the first defence. It was not
// enough on its own, and on 8 Oct 2026 both of its gaps were showing:
//
// The model was told too little. Its memory was the last twelve posts of every
// kind, three days at four a day, and that day a deck called "ההרים בגאורגיה שלא
// נראים אמיתיים" was being built, eleven days after "הרים בגאורגיה שלא נראים
// אמיתיים" went out.
//
// And a title is not what a deck is. "חופים באלבניה שנראים כמו הקאריביים" was
// waiting for an answer while "החופים באלבניה שנראים כמו האיים היווניים" sat in
// the queue with the same beaches on it. Two covers, one post.
//
// Until then the deck id caught some of this by accident. It keyed a free-form deck
// on its region and its slide count, so a rerun was refused as already published,
// and so was every other deck about the same region. With the id fixed, this says
// it out loud instead, on the proposal and again on the built deck, and leaves the
// decision to the owner. It never refuses anything.

// The letters NFKD leaves whole. "Tromsø" has to come out as "tromso".
const FOLD = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** A place name as the words two spellings of it agree on. */
export function placeWords(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[øæœßłđðþı]/g, (c) => FOLD[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Words that say what kind of place it is rather than which one. A name made of
// nothing else matches nothing but itself.
const GENERIC = new Set([
  'lake', 'beach', 'mount', 'mountain', 'island', 'islands', 'national', 'park',
  'bay', 'falls', 'waterfall', 'river', 'valley', 'old', 'town', 'city', 'the', 'of',
]);

/**
 * One place under two of its names: equal, or one inside the other as whole
 * words. "Livadhi Beach" is "Livadhi Beach Himare", and "Kazbek" is "Mount Kazbek".
 */
export function samePlace(a, b) {
  const x = placeWords(a);
  const y = placeWords(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 3 || short.split(' ').every((w) => GENERIC.has(w))) return false;
  return ` ${long} `.includes(` ${short} `);
}

const titleWords = (title) =>
  String(title || '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

// One word with or without the article: "ההרים" is "הרים". Stripping a leading ה
// instead would turn "הרים" into "רים" and miss the pair it was written for.
const sameWord = (a, b) => a === b || a === `ה${b}` || b === `ה${a}`;

/**
 * How alike two covers are, 0 to 1: the words they share over the words either
 * has. The two Georgia covers are 1. The same line about Iceland is 0.67, and so
 * is any pair five words long that differs in one, which is why the bar is high:
 * the cover shapes rotate, so decks about different places share most of a line
 * all the time.
 */
export function titleLikeness(a, b) {
  const x = titleWords(a);
  const free = titleWords(b);
  if (!x.length || !free.length) return 0;
  const total = x.length + free.length;
  let shared = 0;
  for (const w of x) {
    const at = free.findIndex((v) => sameWord(w, v));
    if (at === -1) continue;
    free.splice(at, 1);
    shared++;
  }
  return shared / (total - shared);
}

const SAME_TITLE = 0.8;
// One place in common is a region, two is a list. Two decks about Austria can both
// pass through Hallstatt and still be two decks.
const SHARED_PLACES = 2;

// "27/9", on the clock the owner lives by.
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
export function dayMonth(ts) {
  const parts = DAY_MONTH.formatToParts(new Date(ts));
  const part = (type) => Number(parts.find((p) => p.type === type)?.value);
  return `${part('day')}/${part('month')}`;
}

// A place as both its names, in whichever shape it arrived: a slide, a proposal's
// planned place, or the plain name a published row keeps.
const named = (p) =>
  typeof p === 'string'
    ? { en: p, he: p }
    : { en: p?.nameEn || p?.nameHe || '', he: p?.nameHe || p?.nameEn || '' };

/** What a published row keeps of a deck's places: the English name, which found its photograph. */
export const placeNames = (slides) => (slides || []).map((s) => named(s).en).filter(Boolean);

/**
 * What a deck repeats, as lines for the owner. Empty when it repeats nothing.
 *
 * `deck` is a proposal or a built deck: a cover and its places, as slides or as a
 * proposal's planned places. `published` is the publish log's deck rows
 * (store.publishedDecks) and `waiting` the decks built and not out yet
 * (store.waitingDecks).
 *
 * Either of two things makes it the same deck. The same cover, give or take an
 * article, which for rows written before 8 Oct 2026 is the only check there is,
 * because they kept no places. Or two places in common, whatever the cover says.
 */
export function deckEchoes({ titleHe, places = [] } = {}, { published = [], waiting = [], limit = 2 } = {}) {
  const mine = (places || []).map(named).filter((p) => p.en);
  // A deck sent to the TikTok inbox at approval and still owed to Instagram is in
  // both lists, and on 8 Oct both decks in the queue were. It is one deck, said
  // once, as the one in the queue, where it can still be stopped.
  const waitingIds = new Set(waiting.map(({ cand }) => cand?.id).filter(Boolean));
  const others = [
    ...published.filter((row) => !waitingIds.has(row.id)).map((row) => ({
      title: row.headline,
      places: row.places || [],
      said: `שפורסמה ב-${dayMonth(row.ts)}`,
    })),
    ...waiting.map(({ cand, at }) => ({
      title: cand?.headline,
      places: placeNames(cand?.deck?.slides),
      said: at === 'queued' ? 'שכבר בתור לפרסום' : 'שממתינה לאישור',
    })),
  ];

  const found = [];
  for (const other of others) {
    const likeness = titleLikeness(titleHe, other.title);
    const shared = mine.filter((p) => other.places.some((o) => samePlace(p.en, o)));
    const sameTitle = likeness >= SAME_TITLE;
    const samePlaces = shared.length >= SHARED_PLACES;
    if (!sameTitle && !samePlaces) continue;
    const why = [
      sameTitle && 'כמעט אותה כותרת',
      samePlaces && `${shared.length} מתוך ${mine.length} המקומות כבר בה (${shared.map((p) => p.he).join(', ')})`,
    ]
      .filter(Boolean)
      .join(', ');
    found.push({ weight: likeness + shared.length, line: `דומה למצגת ${other.said}: "${other.title}" - ${why}` });
  }
  return found
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((f) => f.line);
}
