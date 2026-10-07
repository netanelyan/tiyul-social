import { postConfig } from '../postConfig.js';
import { postShapeHistory } from '../store.js';
import { pageSpecifics } from './deliver.js';

// The menu, and the rotation that keeps it from becoming a template.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT, stated plainly because it is the one
// failure the evidence is unambiguous about: three different accounts posted the
// same templated Greece post and got two, three and four likes. The For You feed
// deprioritises "reproduced or unoriginal content without any new or creative
// edits", and a pipeline is a machine for producing exactly that.
//
// So variety is not a nice-to-have here, it is the product. And it has to be
// designed rather than hoped for, because every individual decision this pipeline
// makes is a weighted draw and a weighted draw with a heavy favourite produces runs.
// `plan` is weighted 4 of 12, so four posts in a row being plans is an ordinary
// outcome of an honest random draw - and four plans in a row is what the viewer sees
// as a template.
//
// FOUR DIMENSIONS, EACH WITH ITS OWN MEMORY. Type, look, hook shape and caption
// shape. They vary independently because varying only one of them still produces a
// template: five different types all drawn in the `label` look, all opening on the
// same caption line, is one post five times with different words.

/** How the draw sees the recent past. Injectable so the tests are not stateful. */
export const recentShapes = (history = null) => (history == null ? postShapeHistory() : history);

/**
 * A weighted draw that refuses what the last few produced.
 *
 * `avoid` is the exclusion and it is applied BEFORE the weights, not after: a
 * post-weighting filter would re-normalise across the survivors and let the heavy
 * favourite dominate the remainder, which is the run being prevented. The fallback
 * to the full pool when everything is excluded is not a loophole - with a memory of
 * 3 and a pool of 4 looks, a run of three does exhaust it, and refusing to build is
 * a worse answer than repeating the oldest of them.
 */
export function drawWeighted(pool, { avoid = [], rand = Math.random, key = (x) => x.id } = {}) {
  const live = (pool || []).filter((x) => (Number(x.weight) || 0) > 0);
  if (!live.length) return null;
  const fresh = live.filter((x) => !avoid.includes(key(x)));
  const from = fresh.length ? fresh : live;
  const total = from.reduce((s, x) => s + (Number(x.weight) || 0), 0);
  let n = rand() * total;
  for (const x of from) {
    n -= Number(x.weight) || 0;
    if (n <= 0) return x;
  }
  return from[from.length - 1];
}

/** The last `n` values of one dimension, newest first, for the exclusion list. */
export const lastOf = (history, field, n) =>
  recentShapes(history)
    .slice(0, Math.max(0, n))
    .map((h) => h?.[field])
    .filter(Boolean);

/**
 * Which post type to build next.
 *
 * `only` is a request - `/post list פראג` - and it bypasses the rotation entirely,
 * because a rotation is a decision about what to do when nobody has decided. It
 * still returns the type's config so the caller gets the slide bounds and the
 * requirements.
 */
export function pickType({ only = null, history = null, rand = Math.random } = {}) {
  const { types, typeMemory } = postConfig().posts;
  if (only) {
    const found = types.find((t) => t.id === only);
    if (!found) throw new Error(`unknown post type "${only}" - have: ${types.map((t) => t.id).join(', ')}`);
    return found;
  }
  return drawWeighted(types, { avoid: typesToAvoid(types, typeMemory, history), rand });
}

/**
 * Which types are excluded for being recent, each by its own depth.
 *
 * ONE DEPTH PER TYPE, AND THE REASON IS THAT THE GLOBAL ONE IS A CEILING ON SHARE.
 *
 * `typeMemory` 2 excludes whatever the last two posts were, so a type that was just
 * used cannot return for two draws - which caps it at one post in three HOWEVER it
 * is weighted. That is the right rule for six types sharing an account and the wrong
 * one for a lead format: raising a type's weight from 2 to 20 moved its share from
 * 13% to 33% and no further, and the owner's instruction was "most of the content".
 *
 * So a type may declare `memory: 0` and never be excluded. The mechanism is still
 * the memory rather than a special case: `memory: 1` is "not twice in a row", which
 * is a 50% ceiling, and a type that declares nothing behaves exactly as before.
 *
 * Read ONCE from the store. The earlier version called lastOf per type, which reads
 * the history per call, and a history that changed between two of those reads would
 * produce an exclusion list describing two different pasts.
 */
export function typesToAvoid(types, typeMemory, history = null) {
  const seen = recentShapes(history);
  const out = [];
  for (const t of types || []) {
    const depth = t?.memory == null ? typeMemory : t.memory;
    if (!(depth > 0)) continue;
    if (lastOf(seen, 'type', depth).includes(t.id)) out.push(t.id);
  }
  return out;
}

/**
 * Which look to draw a type in.
 *
 * Restricted to the looks that declare this type. A notes checklist is a day, so it
 * belongs to the plan; a numbered label belongs to the list. A look that fits no
 * type is a configuration error rather than a silent fallback, because the
 * alternative is a post drawn in a look nobody chose.
 */
export function pickLook(type, { only = null, history = null, rand = Math.random } = {}) {
  const { looks, lookMemory } = postConfig().posts;
  const fit = looks.filter((l) => l.types.includes(type));
  if (!fit.length) throw new Error(`no look in post-config.json accepts the type "${type}"`);
  if (only) {
    const found = fit.find((l) => l.id === only);
    if (!found) throw new Error(`look "${only}" does not accept the type "${type}" - have: ${fit.map((l) => l.id).join(', ')}`);
    return found;
  }
  return drawWeighted(fit, { avoid: lastOf(history, 'look', lookMemory), rand });
}

/**
 * Which aspect ratio. The A/B test, drawn per post.
 *
 * NOT excluded against the history, and that is the one dimension where a repeat is
 * fine. The other three vary because a viewer notices a repeated shape; nobody
 * notices two 3:4 posts in a row, and excluding a frame would turn a test that
 * wants an even split into a strict alternation - which is a different experiment,
 * and a worse one, because it correlates the frame with whatever else alternates.
 */
export function pickFrame({ only = null, rand = Math.random } = {}) {
  const { frames } = postConfig().posts;
  if (only) {
    const found = frames.find((f) => f.id === only);
    if (!found) throw new Error(`unknown frame "${only}" - have: ${frames.map((f) => f.id).join(', ')}`);
    return found;
  }
  return drawWeighted(frames, { rand });
}

/** Which caption skeleton. Excluded against the last one so no two in a row match. */
export function pickCaptionShape({ only = null, history = null, rand = Math.random } = {}) {
  const { captions } = postConfig().posts;
  if (only) {
    const found = captions.find((c) => c.id === only);
    if (!found) throw new Error(`unknown caption shape "${only}"`);
    return found;
  }
  return drawWeighted(captions, { avoid: lastOf(history, 'caption', 2), rand });
}

/**
 * Everything about the shape of the next post, decided together.
 *
 * ONE CALL, because the four draws have to see the same history. Drawn separately
 * by four callers they would each read the store at a different moment, and the
 * record written afterwards would describe a combination that was never chosen.
 */
export function nextShape({ type = null, look = null, frame = null, caption = null, history = null, rand = Math.random } = {}) {
  const seen = recentShapes(history);
  const t = pickType({ only: type, history: seen, rand });
  return {
    type: t.id,
    config: t,
    look: pickLook(t.id, { only: look, history: seen, rand }).id,
    frame: pickFrame({ only: frame, rand }).id,
    caption: pickCaptionShape({ only: caption, history: seen, rand }).id,
  };
}

/**
 * The catalogue rows a post of this type can be built for, before anything is fetched.
 *
 * ASKED BEFORE THE DESTINATION IS DRAWN, NOT DISCOVERED AFTER. The unasked post drew
 * from all 102 rows of destinations.json, 41 of which have no page on the site, so
 * Milan, Naples and Catania came up and every page-built type failed on them with
 * "the site has no page". On the production log that was 8 of the 20 failed builds,
 * and an `instead` post for a country with fewer than three other pages was 7 more.
 * Each one cost its rotation slot for two hours.
 *
 * Every type but one needs the destination's own page. `instead` is the exception
 * and wants the opposite: a destination people default to, which is usually one the
 * site does NOT cover, in a country where it covers at least three others. Those
 * three are the post. The same rule bot.js applies when it gathers the alternatives,
 * so a row this returns is one that can actually be built.
 */
export function destinationsFor(type, rows) {
  const all = rows || [];
  const paged = all.filter((r) => r?.siteSlug);
  if (type !== 'instead') return paged;
  const perCountry = new Map();
  for (const r of paged) perCountry.set(r.country, (perCountry.get(r.country) || 0) + 1);
  return all.filter((r) => (perCountry.get(r?.country) || 0) - (r?.siteSlug ? 1 : 0) >= 3);
}

/**
 * Whether a destination's page can carry a given type, and why not when it cannot.
 *
 * CHECKED BEFORE ANYTHING IS SPENT. Each type declares what it needs in
 * post-config.json, and every one of those requirements is answerable from the
 * city payload alone - no photographs fetched, no model called. A verdict post for a
 * page whose verdict names no drawbacks must fail here, for nothing, rather than
 * halfway through a render.
 *
 * Returns `{ ok, why }`. `why` is English: it goes into a log and onto an approval
 * card's diagnostics line, not onto a slide.
 */
export function canBuild(type, city, { verdict = null } = {}) {
  const t = postConfig().posts.types.find((x) => x.id === type);
  if (!t) return { ok: false, why: `unknown type ${type}` };
  const places = city?.places || [];
  const days = city?.itinerary || [];

  for (const need of t.needs) {
    if (need === 'itinerary' && days.length < 3) return { ok: false, why: `only ${days.length} itinerary day(s)` };
    // `placesN` reads its floor from the type's own slidesMin rather than from the name,
    // so shortening the list format is one number in post-config.json instead of a
    // capability string here and a length there that can disagree.
    if (need.startsWith('places')) {
      const floor = Number(t.slidesMin) || Number(need.slice(6)) || 8;
      const got = places.filter((p) => p.photo).length;
      if (got < floor) return { ok: false, why: `only ${got} places with a photograph, needs ${floor}` };
    }
    if (need === 'coords8' && places.filter((p) => p.lat && p.lng).length < 8) {
      return { ok: false, why: `only ${places.filter((p) => p.lat && p.lng).length} places with coordinates` };
    }
    // CAN THIS PAGE BACK A PRACTICAL PROMISE? Asked here, where it is free, rather
    // than after the photograph pass where the finished slides are checked by
    // assertDelivers. Both exist on purpose: this one saves the spend, and that one
    // catches a post whose facts were dropped between here and the render. See the
    // note above pageSpecifics.
    if (need === 'specifics') {
      const floor = postConfig().posts.deliver.minSpecifics;
      const got = pageSpecifics(city);
      if (postConfig().posts.deliver.on && got.length < floor) {
        return { ok: false, why: `the page carries ${got.length} kind(s) of concrete fact (${got.join(', ') || 'none'}), needs ${floor}` };
      }
    }
    if (need === 'cons') {
      // The drawbacks are the whole post. `cued` false means the verdict does not
      // say where its drawbacks are - which is NOT the same as there being none,
      // and the two must not produce the same post. See verdictOf.
      if (!verdict?.cued || !verdict.consHe.length) {
        return { ok: false, why: 'the page verdict names no drawbacks to quote' };
      }
      if (!verdict.prosHe.length) return { ok: false, why: 'the page verdict names nothing good either' };
    }
    // `region3` cannot be answered from one city and is checked by the instead
    // builder, which is the only thing that knows about a region at all.
  }
  return { ok: true, why: null };
}

/**
 * Which platforms a type may be published to.
 *
 * Declared per type in post-config.json rather than inferred from the slide count,
 * because the count is not the reason. A list post is twenty-one slides BECAUSE its
 * hook promises twenty things, so "trim it to nine for Instagram" is not a smaller
 * version of the post - it is a post whose cover lies. An empty declaration means
 * both, which is the ordinary case.
 */
export function platformsFor(type, fallback = ['instagram', 'tiktok']) {
  const t = postConfig().posts.types.find((x) => x.id === type);
  const declared = t?.platforms || [];
  return declared.length ? declared : fallback;
}
