import { fillFromSite } from '../images/commons.js';
import { fillImages } from '../deck/build.js';

// The photograph ladder, and the order is the whole of it.
//
//   1. THE FILE OUR OWN EDITOR ATTACHED TO THIS PLACE. A Wikimedia Commons
//      photograph, published on the destination page beside the place it shows. It
//      is free to use, it looks like a visitor took it because a visitor did, and -
//      the part that matters most - it is KNOWN to show the named place, because
//      choosing it was an editorial act rather than a search result.
//
//   2. THE ORDINARY SEARCH. Pexels and Unsplash through the existing curator, with
//      the vision call that asks "is this actually the Colosseum". Slower, costs
//      money, and produces commissioned-looking travel photography - but it works
//      for a place the site has no photograph for.
//
//   3. NOTHING. The place loses its slide.
//
// WHY THE ORDER IS NOT NEGOTIABLE. Step 2 exists to answer a question step 1 cannot
// be wrong about. Running the search first and treating the site's photo as a
// fallback would pay for a vision call to second-guess our own editor, and would
// prefer a stock photograph of a generic old town over the actual synagogue.
//
// AND WHY STEP 2 IS STILL HERE. Prague has 31 photographs for 37 places. The six
// without are mostly the kosher entries - a community restaurant is exactly the kind
// of place Commons has no photograph of - and those are the slides this audience
// most wants. Dropping them because the first rung came up empty would quietly
// remove the Israeli angle from every post.

/**
 * A photograph for every place, by the ladder above.
 *
 * MUTATES `place.image`, like fillImages does, so the caller's day and list
 * structures keep pointing at the same objects.
 *
 * `search` false stops at rung one. That is what the labs use when the question is
 * the layout rather than the pictures, and what a caller uses when it would rather
 * have a short post than a slow one.
 *
 * Returns a per-place account of which rung answered, because "which photos are real
 * and which fell back" is a question the approval card has to be able to answer -
 * a stock photograph is a weaker slide and the person approving should know how many
 * of them there are.
 */
export async function fillPostPhotos(
  places,
  { dest = '', search = true, width = 1440, onProgress = null } = {}
) {
  const rows = (places || []).filter(Boolean);
  if (!rows.length) return { commons: 0, stock: 0, missing: 0, why: new Map() };

  const why = new Map();

  // Rung one, for every place at once. One request per fifty files.
  const site = await fillFromSite(rows, { width }).catch((e) => {
    console.error(`posts: the site's own photographs were unavailable - ${e.message}`);
    return { filled: 0, why: new Map() };
  });
  for (const [place, reason] of site.why || []) why.set(place, reason);
  const commons = rows.filter((p) => p.image?.provenance === 'commons').length;
  await onProgress?.({ stage: 'commons', done: commons, of: rows.length });

  // Rung two, only for what is left.
  const left = rows.filter((p) => !p.image?.src);
  let stock = 0;
  if (search && left.length) {
    // fillImages searches on a LATIN name and the site publishes one as `nameLocal`.
    // A place with no Latin name cannot be searched at all - the query would be
    // Hebrew, which Pexels answers badly rather than not at all, and a weak answer
    // that passes the vision check is worse than no answer.
    const searchable = left.filter((p) => /[A-Za-z]{3}/.test(String(p.nameLocal || '')));
    for (const p of left) {
      if (!searchable.includes(p)) why.set(p, 'no Latin name to search a photograph on');
    }
    if (searchable.length) {
      const shaped = searchable.map((p) => ({
        nameHe: p.name,
        nameEn: String(p.nameLocal || '').replace(/\s*\/.*$/, '').trim(),
        place: p,
      }));
      await fillImages(shaped, dest, {
        want: shaped.length,
        about: '',
        onProgress: onProgress ? (x) => onProgress({ stage: 'stock', ...x }) : null,
      });
      for (const s of shaped) {
        if (s.image?.src) {
          s.place.image = s.image;
          stock++;
        } else if (!why.has(s.place)) {
          why.set(s.place, s.imageMiss || 'no photograph');
        }
      }
    }
  } else {
    for (const p of left) if (!why.has(p)) why.set(p, 'no photograph on the page');
  }

  const missing = rows.filter((p) => !p.image?.src).length;
  return { commons, stock, missing, why };
}

/**
 * The cover's photograph, chosen rather than searched.
 *
 * THE PAGE'S OWN HERO FIRST, WHEN IT IS ONE WE CAN TAKE. Every destination page
 * carries a `photo` and an `iconicLandmark.photo`. A post whose cover is that
 * photograph and whose last slide is a screenshot of that page is visibly about the
 * same thing, which is the whole job of the last slide.
 *
 * But the hero is NOT always a Commons file - Prague's is an Unsplash CDN URL -
 * and this is where a shortcut would have broken two rules at once. Putting that URL
 * straight into `<img src>` would hotlink somebody else's server, which every other
 * photograph in this project is fetched precisely to avoid, and it would file an
 * Unsplash image under a Commons provenance on the approval card. So the hero is
 * tried through the Commons route, which refuses anything that is not a Commons
 * host, and anything it refuses simply is not used.
 *
 * Then the best place photograph that is not slide two's, for the reason a deck
 * never opens on the picture it shows next: it reads as running out of material
 * before it has started.
 */
export async function coverPhoto(city, slides = [], { width = 1440 } = {}) {
  const taken = new Set(slides.map((s) => s.image?.src).filter(Boolean));

  for (const url of [city?.photo, city?.iconicLandmark?.photo].filter(Boolean)) {
    const probe = { photo: url };
    // fillFromSite is the one gate: it parses the Commons title, refuses a non
    // Commons host, downloads the bytes and attaches the licence. A hero from
    // anywhere else falls through to a place photograph below.
    const got = await fillFromSite([probe], { width }).catch(() => ({ filled: 0 }));
    if (got.filled && probe.image?.src && !taken.has(probe.image.src)) {
      return { ...probe.image, hero: true };
    }
  }

  const spare = (city?.places || []).find((p) => p.image?.src && !taken.has(p.image.src));
  return spare?.image || slides[0]?.image || null;
}
