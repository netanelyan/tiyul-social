import { createHash } from 'node:crypto';
import { postConfig } from '../postConfig.js';
import { captionQuestion, captionFollow } from '../hashtags.js';
import { targetsForKind } from '../publish/targets.js';
import { overrideActive, overrideNotes } from '../override.js';
import { cardOutputDir } from '../render/index.js';
import { renderPost } from '../render/post.js';
import { notePostShape } from '../store.js';
import { loadCity, verdictOf, firstClause } from './source.js';
import { nextShape, canBuild, platformsFor } from './types.js';
import { hookShape, fill, assertPostVoice } from './voice.js';
import { fillPostPhotos, coverPhoto } from './photos.js';
import { captionsFor } from './caption.js';
import { buildPlanPost } from './plan.js';
import { buildListPost } from './list.js';
import { buildVerdictPost } from './verdict.js';
import { buildInsteadPost } from './instead.js';
import { buildMapPost } from './mapPost.js';

// One post, from a destination, through whichever of the five types the rotation
// chose.
//
// THE ORDER OF THIS FUNCTION IS THE WHOLE DESIGN, and every step is here rather than
// somewhere cheaper because of what it can still change:
//
//   1. the shape       type, look, frame, caption shape - one draw, one history
//   2. the page        one request. Free, and it decides everything below.
//   3. can it be built the type's requirements, answered from the page alone. A
//                      verdict post for a page with no drawbacks clause must fail
//                      HERE, for nothing, rather than after twenty photographs.
//   4. the photographs the slow step, and the only one that costs money
//   5. the slides      built from what actually survived step 4
//   6. the voice gate  over the finished object, so a line nobody remembered to
//                      guard is still guarded
//   7. the render      the step that costs a browser
//
// A candidate comes out the far end in the SAME SHAPE a deck candidate has, because
// that is what makes this an addition rather than a second pipeline: the queue, the
// drip, the Telegram album, the TikTok carousel publisher and the held list all read
// `cand.deck.urls` and none of them needs to change.

/**
 * Stable across re-runs of the same post, so one cannot be staged twice.
 *
 * Keyed on what the post IS - the destination, the type and the places on it - rather
 * than on its words, which the rotation varies deliberately. Two list posts about the
 * same twenty Prague places are the same post whichever hook shape they drew, and the
 * whole point of the id is to notice that.
 *
 * The TYPE is in the key because a plan and a list about Prague are genuinely
 * different posts. The look and the frame are NOT: redrawing the same content in the
 * other look is the same post twice, and that is precisely what the id has to catch.
 */
export function postId(post) {
  const key = [post.type, post.slug, post.slides.length, ...post.slides.map((s) => s.titleHe || s.placeId || '')].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 12);
}

/** One each of the destinations that have a render size, in publish order. */
export const sizesFor = (targets) => [...new Set((targets || []).filter((t) => t === 'instagram' || t === 'tiktok'))];

/**
 * Which places a type needs photographs for.
 *
 * ASKED BEFORE THE PHOTOGRAPHS ARE FETCHED, because the answer differs by a factor of
 * four and photographs are the only part of this that costs money. A list post needs
 * twenty; a verdict post needs three; a map post needs one, for its cover.
 *
 * Deliberately a little generous - a few spares - because a place whose photograph
 * cannot be found is dropped, and a list post that asked for exactly twenty and got
 * eighteen is a post that promises 20 in its own hook.
 */
function placesToPhotograph(type, city) {
  const places = city.places || [];
  const cfg = postConfig().posts;
  if (type === 'plan') {
    // The stops of the days that will actually be used, and nothing else.
    const ids = new Set(
      (city.itinerary || [])
        .slice()
        .sort((a, b) => (a.day || 0) - (b.day || 0))
        .slice(0, cfg.days)
        .flatMap((d) => (d.placeIds || []).slice(0, cfg.stopsMax))
    );
    return places.filter((p) => ids.has(p.id));
  }
  if (type === 'list') {
    const want = postConfig().posts.types.find((t) => t.id === 'list').slidesMax + 4;
    return [...places].sort((a, b) => (b.mustSee ? 1 : 0) - (a.mustSee ? 1 : 0) || (b.rating || 0) - (a.rating || 0)).slice(0, want);
  }
  if (type === 'verdict') return places.filter((p) => p.mustSee || p.photo).slice(0, 6);
  if (type === 'map') return places.filter((p) => p.photo).slice(0, 2);
  return places.slice(0, 4);
}

/**
 * One post, built and rendered, as an approvable candidate.
 *
 * `dest` is a destinations.json row. `type`, `look` and `frame` override the rotation,
 * which is what a `/post` command and the labs use.
 */
export async function buildPost({
  dest,
  type = null,
  look = null,
  frame = null,
  caption = null,
  days = null,
  alternatives = null,
  defaultHe = null,
  regionHe = null,
  targets = targetsForKind('deck'),
  photos = true,
  // Rung two of the photo ladder, separately switchable. `photos: false` skips the
  // pictures entirely, which is a layout-only render; `search: false` keeps the site's
  // own Commons files and skips the stock search, which is the fast iteration the labs
  // actually want - seconds instead of minutes, with real photographs on the slides.
  search = true,
  render = true,
  outDir = cardOutputDir(),
  history = null,
  onProgress = null,
  rand = Math.random,
} = {}) {
  const slug = dest?.siteSlug || dest?.id;
  const shape = nextShape({ type, look, frame, caption, history, rand });
  const say = (text) => onProgress?.(text);

  say(`building a ${shape.type} post in the ${shape.look} look at ${shape.frame}`);

  // THE `instead` TYPE IS THE ONE WHOSE SUBJECT WE DELIBERATELY HAVE NO PAGE FOR.
  //
  // Every other type is built FROM a destination page. This one argues with a habit -
  // "stop only flying to Rhodes" - and Rhodes is precisely a destination the site does
  // not cover, which is most of the point: the alternatives are the pages we have. So
  // the default needs a NAME and nothing else, and requiring a page for it would make
  // the type buildable only for the destinations it is arguing against.
  const needsPage = shape.type !== 'instead';
  const city = needsPage ? await loadCity(slug) : { name: dest?.he || defaultHe, slug, places: [], itinerary: [] };
  if (!city) throw new Error(`the site has no page for "${slug}" - nothing to build a post from`);

  // The requirements, answered from the page. Before anything is spent.
  const verdict = needsPage ? verdictOf(city) : null;
  if (needsPage) {
    const check = canBuild(shape.type, city, { verdict });
    if (!check.ok) throw new Error(`a ${shape.type} post cannot be built from ${slug}: ${check.why}`);
  }

  // The hook shape, excluding whatever the last post of this type used.
  const hook = hookShape(shape.type, {
    rand,
    avoid: (history || []).filter((h) => h.type === shape.type).slice(0, 1).map((h) => h.hook),
  });

  // ONE DRAW of the question and the follow reason for the whole post, handed to the
  // slides and to both captions. Two draws would give a post whose closing slide asks
  // one thing and whose description asks another - one post apparently written by two
  // people, which is the bug the deck's single hook draw already fixed once.
  const questionHe = captionQuestion({ rand });
  const follow = captionFollow({ rand });
  const signoffs = postConfig().posts.signoffsHe;
  const signoffHe = signoffs.length ? signoffs[Math.floor(rand() * signoffs.length)] : null;

  // Photographs, for the places this type will actually use.
  const wanted = placesToPhotograph(shape.type, city);
  let shots = { commons: 0, stock: 0, missing: 0, why: new Map() };
  if (photos && wanted.length) {
    say(`photographs for ${wanted.length} places`);
    shots = await fillPostPhotos(wanted, {
      dest: dest?.en || city.nameLocal || city.name,
      search,
      onProgress: onProgress ? (x) => say(`photographs: ${x.stage} ${x.done ?? ''}/${x.of ?? ''}`) : null,
    });
  }

  // The alternatives for an `instead` post, each its own page and its own photographs.
  const alts = [];
  if (shape.type === 'instead') {
    for (const row of alternatives || []) {
      const c = await loadCity(row?.siteSlug || row?.id);
      if (!c) continue;
      if (photos) {
        const got = await fillPostPhotos(placesToPhotograph('verdict', c), { dest: row?.en || c.name, search });
        // Counted into the post's own tally, because the approval card's "how many of
        // these photographs are real" question is about the POST, and on this type
        // every photograph on it came from an alternative's page rather than from the
        // destination the post is named after.
        shots.commons += got.commons;
        shots.stock += got.stock;
        shots.missing += got.missing;
      }
      alts.push(c);
    }
    if (alts.length < 3) throw new Error(`only ${alts.length} alternative page(s) loaded, and this post needs 3`);
  }

  const built = buildFor(shape.type, city, {
    look: shape.look,
    hook,
    dest,
    days,
    questionHe,
    alts,
    defaultHe,
    regionHe,
  });

  // The cover's photograph, if the builder did not claim one. A cover that shows the
  // same picture as slide two reads as running out of material before it started.
  if (!built.slides[0].image) {
    built.slides[0].image = await coverPhoto(city, built.slides.slice(1)).catch(() => null);
  }

  const post = {
    kind: 'post',
    type: shape.type,
    look: shape.look,
    frame: shape.frame,
    hook: hook.id,
    where: dest?.he || city.name,
    countryHe: dest?.country || city.country || null,
    slug,
    // WHICH PAGE THE POST CLOSES ON.
    //
    // The post's own destination, except on an `instead` post - which argues about a
    // destination we deliberately have no page for, and whose whole case is the pages
    // we DO have. So it closes on the first alternative's page and names it, which is
    // both the honest link and the useful one: somebody persuaded by the argument wants
    // the itinerary for the place they were just persuaded to consider.
    siteSlug: shape.type === 'instead' ? alts[0]?.slug || null : slug,
    siteDestHe: shape.type === 'instead' ? alts[0]?.name || null : null,
    url: shape.type === 'instead' ? alts[0]?.url || null : city.url,
    titleHe: built.slides[0].titleHe,
    slides: built.slides,
    signoffHe,
    practicalHe: practicalFor(built),
    captionHookHe: built.captionHookHe,
    // The flag, so destinationTag can produce a country hashtag from a post the same
    // way it does from a deck: it reads `countryHe` off the slides.
    category: shape.type,
    createdAt: new Date().toISOString(),
    dropped: built.dropped || [],
    photos: { commons: shots.commons, stock: shots.stock, missing: shots.missing },
    stats: built.stats || {},
  };
  post.id = postId(post);

  // THE VOICE GATE, over the finished object.
  //
  // Each builder calls `line()` on what it writes, and this runs over the RESULT -
  // deliberately belt and braces. A builder is where a new line gets added, and a new
  // line added without a guard is the likeliest way a fabricated experience or a
  // stray em dash reaches a slide. Running over the object means a field somebody adds
  // next year is covered by a check nobody had to remember to write.
  assertPostVoice(post, { where: `${shape.type}/${dest?.he || slug}` });

  if (!render) return { post, shape, city };

  // The platforms this TYPE goes to, intersected with the ones that were asked for.
  //
  // Both, not either. `targets` is the destination chosen at the proposal and it is the
  // owner's decision; `platformsFor` is a property of the format and it is not
  // negotiable - a twenty-one-slide list cannot be an Instagram carousel however it was
  // routed. The intersection is what actually gets rendered, and an empty one is a real
  // error rather than a silently empty post.
  const allowed = platformsFor(shape.type);
  const sizes = sizesFor(targets).filter((s) => allowed.includes(s));
  if (!sizes.length) {
    throw new Error(
      `a ${shape.type} post goes to ${allowed.join(' and ')}, and this build was routed to ${targets.join(' and ') || 'nowhere'}`
    );
  }

  say('rendering');
  const rendered = await renderPost(post, { sizes, outDir });
  if (!rendered.siteSlide) post.siteSlug = null;

  const captions = captionsFor(
    { ...post, slides: post.slides.map((s) => ({ ...s, countryHe: post.countryHe })) },
    { shape: postConfig().posts.captions.find((c) => c.id === shape.caption), question: questionHe, follow }
  );

  // Recorded when BUILT, not when published. A post that is rejected was still
  // produced, and replacing it with another of the same shape is the run of identical
  // posts the rotation exists to prevent - the argument noteClipShape already makes.
  notePostShape({ type: shape.type, look: shape.look, hook: hook.id, frame: shape.frame, caption: shape.caption });

  return {
    post,
    shape,
    city,
    rendered,
    cand: toCandidate(post, { rendered, captions, targets, follow }),
  };
}

/** Which builder, and the arguments each one wants. One place, so a type is one line. */
function buildFor(type, city, { look, hook, dest, days, questionHe, alts, defaultHe, regionHe }) {
  switch (type) {
    case 'plan':
      return buildPlanPost(city, { look, hook, dest, days, questionHe });
    case 'list':
      return buildListPost(city, { hook, dest });
    case 'verdict':
      return buildVerdictPost(city, { hook, dest, questionHe });
    case 'instead':
      return buildInsteadPost(alts, { hook, defaultHe, regionHe, questionHe });
    case 'map':
      return buildMapPost(city, { hook, dest });
    default:
      throw new Error(`no builder for post type "${type}"`);
  }
}

/**
 * The caption's one practical line.
 *
 * The flight before the kosher overview, for the reason practicalLine in ./caption.js
 * gives: the flight is the most Israeli fact on the page and the one the reader is
 * actually deciding on. Null when the builder loaded neither, and the caption shape
 * then has one part fewer - which is a real variation rather than a hole.
 */
const practicalFor = (built) =>
  built.practical ? firstClause(built.practical.flightsHe) || firstClause(built.practical.kosherHe) : null;

/**
 * The candidate, in the shape the queue already carries.
 *
 * `deck` rather than `post`, and not a mistake: that is the field the carousel
 * publishers and the Telegram album send read. A kind that invented its own field name
 * would need every one of them changed, and each change is a place the next kind can be
 * forgotten.
 */
export function toCandidate(post, { rendered, captions, targets, follow }) {
  return {
    kind: 'post',
    id: post.id,
    headline: post.titleHe,
    sourceName: `${post.where} · ${post.type}`,
    // The page the post is built from. Unlike a plan, this one HAS a source URL and it
    // is ours, so the approval card can print it and it can be opened to check the
    // slides against it.
    sourceUrl: post.url || null,
    pillar: 'day',
    tags: [],
    deck: {
      ...post,
      // The photographs go, now that they are baked into the JPEGs. A staged candidate
      // lives in data/store.json and store.js rewrites that whole file on every save;
      // a twenty-slide post awaiting approval would re-serialise twenty megabytes of
      // base64 every time anything else marked an item seen.
      slides: post.slides.map((s) => ({
        ...s,
        image: s.image ? { provenance: s.image.provenance, credit: s.image.credit || null } : null,
        images: s.images ? s.images.map((i) => ({ provenance: i.provenance, credit: i.credit || null })) : undefined,
        stops: s.stops
          ? s.stops.map((t) => ({ ...t, image: t.image ? { provenance: t.image.provenance, credit: t.image.credit || null } : null }))
          : undefined,
        bgImage: s.bgImage ? { provenance: s.bgImage.provenance } : undefined,
      })),
      ...rendered,
      follow,
    },
    publishTargets: targets,
    // A draft, always. The API has no field for choosing a sound and a sound cannot be
    // changed after publishing, so the slides land in the account's inbox and are
    // finished by hand. Unchanged from every other slideshow this pipeline makes.
    tiktokDraft: true,
    createdAt: post.createdAt,
    overrides: overrideActive() ? overrideNotes() : [],
    notes: [],
    instagramCaption: captions.instagram,
    tiktokCaption: captions.tiktok,
    channelCaption: captions.instagram,
    captionShape: captions.shape,
    card: rendered.preview?.[0] || null,
  };
}

export { fill };
