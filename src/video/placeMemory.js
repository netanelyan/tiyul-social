import { clipPlaceLabel } from '../hashtags.js';
import { postConfig } from '../postConfig.js';

// ONE PLACE MEMORY FOR EVERY REEL, NOT JUST THE GEMS REEL.
//
// The fortnight memory used to belong to the gems reel: it was the only format that
// wrote placesNamed and the only one that read it. The postcard, cuts, montage and held
// shapes all put a place on screen and none of them looked, so a place could open one
// format in the morning and close another in the afternoon. On 4 and 5 Oct 2026
// Hallstatt was in four reels of five - a cuts video, both gems reels, and a montage
// that was mostly Hallstatt - and the memory had recorded it once, from a gems reel.
// The owner's report was "each video features the same place in austria".
//
// Nobody chose Hallstatt. One of the 44 queries asks for it by name, a second asks for
// Austrian alpine villages, the library holds a great deal of it, and the judge is sure
// of it: the clip it saw on 8 Oct scored 10 for destination and 9 for confidence. Left
// alone, the best-covered place in the library is in every reel.
//
// TWO WINDOWS, AND ONLY THE SHORT ONE IS A REFUSAL. Inside gems.placeHoldDays no reel
// names the place again, however short the pool is. Inside gems.placeMemoryDays it is
// the preference it always was: fresh places first, a recent one only after them. The
// note above sortShots explains why the fortnight stayed a preference, and the reason
// still holds for the fortnight. The hold is short enough to live with: four slots a
// day, about half of them reels naming three places, is six or seven names a day, so
// three days holds about twenty.
//
// NOTHING HERE READS THE STORE, ON PURPOSE. clip.js is imported by scripts/clip-lab.js
// and scripts/clip-redo.js, and importing src/store.js is enough to prune and rewrite
// the file, which is how a second process reverts the bot (see scripts/redraw.js).
// bot.js reads the memory and passes it in. A caller that passes nothing gets the old
// behaviour, which is what a lab run wants.

/** The place a found clip would be labelled with, or null when the judge did not name one. */
export const placeOf = (clip) => clipPlaceLabel({ vision: clip?.vision || null });

/**
 * Every place a built reel names, in the spelling the memory is keyed on.
 *
 * `places` covers the gems and postcard reels, which list theirs. A cuts video burns
 * one label per cut. A held clip and a montage name one place, read off `clip.vision`
 * by the same function that writes their pin, so the memory and the caption cannot
 * disagree about where the footage was.
 */
export function placesOfCandidate(cand) {
  const c = cand?.clip || {};
  if (Array.isArray(c.places) && c.places.length) return [...new Set(c.places.filter(Boolean))];
  const cut = (c.cuts || []).map((x) => x?.label).filter(Boolean);
  if (cut.length) return [...new Set(cut)];
  const one = clipPlaceLabel(cand);
  return one ? [one] : [];
}

/**
 * The memory as a reel needs it: when each place was last named, and which of them are
 * still inside the hold.
 *
 * `named` is placesNamedSince's Map of label -> when. The hold is clamped to the memory,
 * because a place the memory has already forgotten cannot be held.
 */
export function holdPlaces(named, { now = Date.now(), gems = postConfig().gems } = {}) {
  const days = Math.min(gems.placeHoldDays, gems.placeMemoryDays);
  const holdSince = now - days * 86_400_000;
  const map = named instanceof Map ? named : new Map();
  const held = new Set([...map].filter(([, at]) => Number(at) >= holdSince).map(([label]) => label));
  return { named: map, held, holdSince, days, isHeld: (label) => isHeldBy(held, label) };
}

const countryOf = (label) => String(label).split(',').pop().trim();

/**
 * Whether a label is inside the hold, which reaches a little further than the label.
 *
 * The judge names a site only when it is sure and otherwise just the country, so the
 * same Hallstatt footage can be "הלשטט, אוסטריה" on one clip and "אוסטריה" on the
 * next. So a held site holds its bare country, and a held bare country holds every
 * site in it. A named site does not hold the rest of its country: Vienna is not
 * Hallstatt, and holding a whole country whenever one of its sites is named would
 * starve the reels, with Italy and Greece being most of the library.
 */
export function isHeldBy(held, label) {
  if (!label || !held?.size) return false;
  if (held.has(label)) return true;
  if (!String(label).includes(',')) return [...held].some((h) => countryOf(h) === label);
  return held.has(countryOf(label));
}

/**
 * Found clips in the order a reel should consider them.
 *
 * Held places are dropped entirely. They are not kept as spares either, because a spare
 * becomes the hook shot, and a held place under the title is still the same place on
 * screen. Fresh places keep their rank order. Places named inside the fortnight follow,
 * oldest first. A clip the judge could not place stays among the fresh ones: it names
 * nothing, so it repeats nothing, and the hook shot is chosen from those clips.
 */
export function preferFresh(clips, memory = null) {
  const list = clips || [];
  if (!memory) return [...list];
  const { named = new Map(), held = new Set() } = memory;
  const isHeld = memory.isHeld || ((label) => isHeldBy(held, label));
  const fresh = [];
  const stale = [];
  for (const c of list) {
    const label = placeOf(c);
    if (label && isHeld(label)) continue;
    const at = label ? named.get(label) : undefined;
    if (at == null) fresh.push(c);
    else stale.push({ c, at: Number(at) });
  }
  stale.sort((a, b) => a.at - b.at);
  return [...fresh, ...stale.map((s) => s.c)];
}
