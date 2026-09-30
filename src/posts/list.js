import { listPlaces, placeLine, durationHe, kosherLine } from './source.js';
import { line, fill } from './voice.js';
import { postConfig } from '../postConfig.js';

// TYPE B: THE LONG LIST. The single best-performing shape in the whole study.
//
// @teonakan's "20 things to do in Prague" is 108.3K likes on a 2,200-follower
// account, and it is 93% of every like that account has ever received. Twenty-one
// slides. Her own phone photographs. One place per slide, numbered, in TikTok's
// native text. That is the entire post.
//
// WHY THE NUMBER IS THE MECHANISM, and why it is not decoration.
//
// A viewer who reads "3." knows two things at once: that there are seventeen more,
// and roughly how long this will take. That is a completion loop, and completion is
// what TikTok says it weighs most heavily. A list of the same twenty places with no
// numbers on them is twenty independent slides, each of which can be abandoned at no
// cost.
//
// So the number is set LARGER than the name and in the accent colour. It is the thing
// being counted; the place is what it happens to be.
//
// AND WHY EACH SLIDE NEEDS ONE SPECIFIC LINE. Without it this is our own Italian
// lakes deck with numbers added - a name over a photograph, skippable in half a
// second, 0.22 saves per like. The line is what makes the slide worth pausing on, and
// it comes off the page: free entry, how long it takes, or the kosher fact, in that
// order of what changes somebody's plan. See placeLine.

/**
 * One list post.
 *
 * `want` is bounded by the type's own slidesMin/slidesMax rather than by an argument,
 * because the count IS the format: fourteen is not a short version of this post, it is
 * a different post that promises "14" and delivers a list nobody counts through.
 */
export function buildListPost(city, { hook, dest, want = null } = {}) {
  const type = postConfig().posts.types.find((t) => t.id === 'list');
  const destHe = dest?.he || city.name;

  // Only places that actually have a photograph on them by now. The numbering has to
  // be contiguous - a list that goes 1, 2, 4 is a post with a missing slide - so the
  // numbers are assigned AFTER the photographs are known, which is why this builder
  // runs on a city whose places have already been through fillPostPhotos.
  const pool = listPlaces(city, { want: (want || type.slidesMax) + 4, needPhoto: false })
    .filter((p) => p.image?.src)
    .slice(0, want || type.slidesMax);

  if (pool.length < type.slidesMin) {
    throw new Error(`only ${pool.length} places have a photograph, and a list post needs ${type.slidesMin}`);
  }

  const n = pool.length;

  const cover = {
    look: 'label',
    cover: true,
    titleHe: line(fill(hook.he, { dest: destHe, n }), { where: 'cover' }),
    // What is in the list, counted two ways: how many are free and how many are
    // must-sees. Both are facts off the page and both are reasons to swipe - "6
    // כניסה חופשית" is the most useful thing that can be said about a list of twenty
    // places before you have read any of them.
    noteHe: line(coverNote(pool), { where: 'cover.note' }),
    // THE COUNT AS THE BADGE. On this type the number IS the format - a viewer who
    // reads "20" knows exactly what they are getting and how long it takes - so it is
    // set as the one thing the eye lands on rather than buried inside the sentence
    // that also contains it.
    badgeHe: String(n),
    badgeLabelHe: 'מקומות',
    band: 'mid',
  };

  // COUNTING DOWN, NOT UP, and this is the one decision here worth arguing about.
  //
  // Up is what @teonakan does and it is what a person writing a list does. Down
  // ("20... 19... 18") is the listicle convention and it holds attention better in
  // theory, because the best is last. It is not used here: counting down means the
  // viewer who stops at slide four has seen the four things we rated WORST, and this
  // account's problem is not retention on long posts, it is that nobody watches the
  // first two slides. Best first.
  const items = pool.map((p, i) => ({
    look: 'label',
    number: `${i + 1}.`,
    titleHe: line(p.name, { where: `item${i + 1}` }),
    noteHe: itemLine(p),
    image: p.image,
    band: 'lower',
    placeId: p.id,
  }));

  return {
    slides: [cover, ...items],
    // No summary slide and no closing ask beyond the site slide the renderer appends.
    // The count IS the ending: a list that reaches 20 has visibly finished, and a
    // summary slide after it is a slide explaining a post the viewer just read.
    captionHookHe: line(`${n} דברים ב${destHe}, בסדר שאנחנו היינו עושים`, { where: 'caption.hook' }),
    stats: { items: n, free: pool.filter((p) => Number(p.priceLevel) === 0).length },
  };
}

/** What the cover promises: how many are free, how many the page flags as must-sees. */
function coverNote(pool) {
  const free = pool.filter((p) => Number(p.priceLevel) === 0).length;
  const must = pool.filter((p) => p.mustSee).length;
  const bits = [`${pool.length} מקומות`];
  if (free) bits.push(`${free} בחינם`);
  else if (must) bits.push(`${must} חובה`);
  return bits.join(' · ');
}

/**
 * The one line under a numbered place.
 *
 * placeLine is the general answer and this adds the one thing a list wants that an
 * itinerary does not: a MUST-SEE marker. On an itinerary every stop is there because
 * the day needs it, so flagging some of them says nothing; on a ranked list of twenty
 * it is the page's own editor saying "if you only do one thing", which is exactly the
 * judgement a viewer is looking for.
 */
export function itemLine(place) {
  const base = placeLine(place);
  if (place?.mustSee && base && base.length < 34) return `⭐ ${base}`;
  if (place?.mustSee && !base) return '⭐ חובה';
  // A place with neither a price band nor a duration nor a kosher status still needs
  // a line, or the slide is a name over a photograph - which is the post this format
  // exists to be better than.
  return base || kosherLine(place) || durationHe(place?.durationMin) || null;
}
