import { listPlaces, placeLine, durationHe, kosherLine, ratingBadge } from './source.js';
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
    // The rating rather than the count: the hook already counts ("20 דברים ב..."), so a
    // badge repeating it spends the loudest element on the second-loudest word.
    ...(ratingBadge(city) || {}),
    band: 'mid',
  };

  // GROUPED, BECAUSE TWENTY UNDIFFERENTIATED PLACES IS A LIST NOBODY FINISHES.
  //
  // The first version ranked by mustSee and rating and numbered straight through, so a
  // viewer got a castle, a restaurant, a viewpoint, a museum and a market in no order
  // they could predict - which gives them nothing to orient by and no reason to expect
  // the next slide to be relevant to them. Somebody reading for where to EAT has to sit
  // through fourteen churches.
  //
  // So the list runs in blocks, and a divider slide names each one. That costs three or
  // four slides out of twenty-one and buys two things: a viewer can tell where they are,
  // and a viewer who only wants one block knows it is coming rather than leaving.
  //
  // THE ORDER OF THE BLOCKS IS THE EDITORIAL DECISION. Sights first because that is what
  // the hook promised, food second because it is what this audience most often comes
  // back for, and the rest after - and within a block the page's own ranking survives.
  const BLOCKS = [
    { id: 'sights', he: 'האתרים', emoji: '🏰', cats: ['historic', 'attraction', 'museum', 'viewpoint'] },
    { id: 'food', he: 'אוכל', emoji: '🍽️', cats: ['food', 'cafe', 'kosher-food', 'kosher-market', 'market'] },
    { id: 'outdoors', he: 'טבע ובחוץ', emoji: '🌿', cats: ['nature'] },
    { id: 'shops', he: 'שופינג', emoji: '🛍️', cats: ['shopping'] },
  ];

  // COUNTING DOWN, NOT UP, and this is the one decision here worth arguing about.
  //
  // Up is what @teonakan does and it is what a person writing a list does. Down
  // ("20... 19... 18") is the listicle convention and it holds attention better in
  // theory, because the best is last. It is not used here: counting down means the
  // viewer who stops at slide four has seen the four things we rated WORST, and this
  // account's problem is not retention on long posts, it is that nobody watches the
  // first two slides. Best first.
  // Ordered by block, numbering continuous across them so the count the cover promises
  // is the count the post delivers.
  const grouped = [];
  const used = new Set();
  for (const block of BLOCKS) {
    const mine = pool.filter((p) => !used.has(p.id) && block.cats.includes(String(p.category || '')));
    if (!mine.length) continue;
    for (const p of mine) used.add(p.id);
    grouped.push({ block, places: mine });
  }
  // Anything the blocks do not name keeps its place rather than being dropped - the
  // site's categories are not a closed set and a post that silently loses a place is
  // worse than one with a slightly loose last block.
  const rest = pool.filter((p) => !used.has(p.id));
  if (rest.length) grouped.push({ block: { id: 'more', he: 'ועוד', emoji: '📍', cats: [] }, places: rest });

  // DIVIDERS ONLY WHEN THE LIST IS LONG ENOUGH TO NEED THEM.
  //
  // "the format should be easier" - and on a list of ten places, four divider slides are
  // nearly a third of the post spent on signposting a post short enough not to need
  // signposting. Dividers earn their slide on a long list, where a viewer genuinely
  // cannot see the end from the start; on a short one they are furniture.
  //
  // Two conditions, both necessary: enough places that the viewer loses their place
  // without help, and enough blocks that the dividers are telling them something. Three
  // blocks over twelve places is a structure; two blocks over nine is a label on a label.
  const useDividers = pool.length >= 13 && grouped.length >= 3;

  const items = [];
  let k = 0;
  for (const { block, places } of grouped) {
    // The divider. No photograph of its own: it takes the first place of its block, so
    // the slide is a picture of what is coming rather than a title card.
    if (useDividers) {
      items.push({
        look: 'label',
        titleHe: line(block.he, { where: `block.${block.id}` }),
        noteHe: line(places.length === 1 ? 'מקום אחד' : `${places.length} מקומות`, { where: `block.${block.id}.n` }),
        emojis: [block.emoji],
        image: places[0].image,
        band: 'mid',
        divider: true,
      });
    }
    for (const p of places) {
      k++;
      items.push({
        look: 'label',
        number: `${k}.`,
        titleHe: line(p.name, { where: `item${k}` }),
        noteHe: itemLine(p),
        image: p.image,
        band: 'lower',
        placeId: p.id,
      });
    }
  }

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
