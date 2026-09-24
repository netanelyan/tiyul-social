import { createHash } from 'node:crypto';
import { cardOutputDir } from '../render/index.js';
import { renderDeckSize } from '../render/deck.js';
import { SIZES } from '../render/deckTemplates.js';
import { fillImages } from '../deck/build.js';
import { targetsForKind } from '../publish/targets.js';
import { overrideActive, overrideNotes } from '../override.js';
import { assertNoUrl } from '../format.js';
import { planCaption } from '../hashtags.js';
import { planText, planGiveaway } from './text.js';
import { tripDecks, deckForSize, dayTotal, allStops, shekels } from './slides.js';

// A written itinerary becomes something the approval queue can carry.
//
// Deliberately the same shape as a deck candidate — id, publishTargets, a
// `deck`-style payload of rendered slide URLs, captions, an approval message —
// because that is what makes this a small addition rather than a second
// pipeline. The queue, the drip, the album send, the TikTok carousel publisher
// and the held list all work on it unchanged; what they read is
// `cand.deck.urls`, and a plan fills that in the same format a deck does.
//
// The one thing it does NOT reuse is the renderer. A deck measures each
// photograph and moves its text to wherever that frame is quietest; a plan has
// no photograph and must not move anything — see the note at the top of
// render/planSlides.js.

/**
 * Stable across re-runs of the same plan, so one cannot be staged twice.
 *
 * Keyed on the destination and the stop NAMES rather than on the prose. Two
 * itineraries that visit the same places in the same order are the same post
 * even when the notes are worded differently, which is exactly what asking the
 * model twice produces. The day count is in the key because four days in Rome
 * and five days in Rome are genuinely different posts.
 */
export function planId(plan) {
  const key = [
    plan.dest.id || plan.dest.he,
    plan.days.length,
    ...plan.days.flatMap((d) => d.stops.map((s) => s.nameHe)),
  ].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 12);
}

/** One each of the destinations that have a render size, in publish order. */
export const sizesFor = (targets) => [
  ...new Set((targets || []).filter((t) => t === 'instagram' || t === 'tiktok')),
];

/**
 * A photograph for every stop, and one for the cover.
 *
 * The deck's own image step, unchanged: `fillImages` searches two libraries,
 * judges the thumbnails with a vision call — "is this actually the Colosseum" —
 * and refuses rather than falling back to the library's top hit. That refusal
 * is the reason this is worth the money. A mislabelled slide costs more than a
 * missing one, and an itinerary is nothing but labelled places.
 *
 * SO A STOP CAN LOSE ITS PICTURE AND LEAVE. The plan and the slideshow have to
 * be the same thing — a stop with no slide would still be in the total, and the
 * arithmetic on the last slide would disagree with the slides above it — so the
 * plan is rewritten around what survived and the totals are recomputed from it.
 *
 * It is also the slowest step in the build by a wide margin: up to three
 * searches per stop across two libraries, each ending in a vision call, and a
 * four-day plan has sixteen stops. `onProgress` is how the bot says so while it
 * happens, because a working build and a hung one look identical from outside.
 */
export async function fillPlanPhotos(plan, { stopsMin = 0, onProgress = null } = {}) {
  const cover = {};
  // The stop objects themselves, so fillImages writes `image` onto the plan
  // rather than onto copies of it. `about` is deliberately empty: these are
  // named landmarks, and "Colosseum" is a better query than "Colosseum city
  // landmark" — see cinematicQueries.
  const stops = plan.days.flatMap((d) => d.stops);
  await fillImages(stops, plan.dest.en, { want: stops.length, cover, about: '', onProgress });

  const missing = [];
  const days = [];
  for (const day of plan.days) {
    const kept = day.stops.filter((s) => s.image?.src);
    for (const s of day.stops) if (!s.image?.src) missing.push(`${s.nameHe} — no photograph`);
    if (kept.length < Math.max(1, stopsMin)) {
      missing.push(`יום ${day.n}: ${kept.length} stop(s) with a photograph, needs ${Math.max(1, stopsMin)}`);
      continue;
    }
    days.push({ ...day, stops: kept });
  }

  return {
    ...plan,
    days: days.map((d, i) => ({ ...d, n: i + 1 })),
    coverImage: cover.image || null,
    total: days.reduce((sum, d) => sum + dayTotal(d), 0),
    dropped: [...(plan.dropped || []), ...missing],
  };
}

/**
 * Render both sets.
 *
 * TWO SETS, NOT TWO CROPS, and the count is why. TikTok takes 35 photos and
 * gets one slide per stop; Instagram takes 10 and gets one per day. Both are
 * built from the same photographs and the same plan — see the note on
 * `daySlide` in ./slides.js.
 *
 * The rendering itself is the deck's, called on a deck-shaped object: it
 * measures each photograph, chooses the band and the ink, and draws TikTok's
 * unbranded slide and Instagram's card from the same words. Nothing in this
 * module draws anything.
 */
export async function renderPlan(plan, { sizes = ['instagram', 'tiktok'], outDir = cardOutputDir(), text, giveaway } = {}) {
  const want = sizes.filter((s) => SIZES[s]);
  if (!want.length) throw new Error(`renderPlan: no known size in [${sizes.join(', ')}]`);

  const decks = tripDecks(plan, { text, giveaway });
  const out = {};
  for (const size of want) {
    const deck = deckForSize(decks, size);
    // The bound Instagram enforces at publish time, checked here where it can
    // still be acted on. A carousel over ten is rejected outright, hours after
    // the post was approved and by an error that names none of this.
    if (size === 'instagram' && deck.slides.length + 1 > 10) {
      throw new Error(
        `the Instagram set is ${deck.slides.length + 1} slides and a carousel takes 10 — ` +
          'shorten the trip or lower plans.daysMax'
      );
    }
    out[size] = await renderDeckSize(deck, { size, outDir });
  }

  return {
    tiktok: out.tiktok || [],
    instagram: out.instagram || [],
    // What the approval message shows is the destination that was chosen, not
    // whichever size happened to render first.
    preview: out[want[0]],
    urls: {
      tiktok: (out.tiktok || []).map((s) => s.url),
      instagram: (out.instagram || []).map((s) => s.url),
    },
    slideCounts: Object.fromEntries(want.map((s) => [s, out[s].length])),
  };
}

/**
 * Wrap a written plan as an approvable candidate.
 *
 * Rendering happens here rather than in write.js for the same reason a card and
 * a deck render last: it is the step that costs a browser, and a plan that lost
 * a day to its shape check should not have paid for one.
 */
export async function toPlanCandidate(plan, { targets = targetsForKind('plan'), tiktokDraft = true, outDir = cardOutputDir(), photos = true, stopsMin = 0, onProgress = null } = {}) {
  // Photographs first, because they can still change the plan: a stop whose
  // picture could not be found or could not be verified leaves, and everything
  // downstream — the id, the totals, the caption, the card — has to describe
  // what actually survived. `photos: false` is for the lab, where the layout is
  // the question and the libraries are not.
  const shot = photos ? await fillPlanPhotos(plan, { stopsMin, onProgress }) : plan;

  const id = planId(shot);
  const withId = { ...shot, id };
  const text = planText(withId);
  const giveaway = planGiveaway(withId);

  const rendered = await renderPlan(withId, { sizes: sizesFor(targets), outDir, text, giveaway });

  const cand = {
    kind: 'plan',
    id,
    headline: text.hookHe,
    // The shared vocabulary. A plan has no source article and no stock library:
    // what it has is a model and a date, and saying so is the honest answer to
    // "where did this come from".
    sourceName: `${plan.dest.he} · מסלול שנכתב ב-AI`,
    sourceUrl: null,
    pillar: 'day',
    tags: [],
    // `deck`, not `plan`, and not a mistake: this is the field the carousel
    // publishers and the Telegram album send already read. A plan that invented
    // its own field name would need every one of them changed, and each change
    // would be a place a future kind could be forgotten.
    deck: {
      ...withId,
      // The photographs go, now that they are baked into the JPEGs.
      //
      // The same decision toDeckCandidate makes and for the same reason: each
      // image arrives as a base64 data URI, a staged candidate lives in
      // data/store.json, and store.js rewrites that whole file every time
      // anything is marked seen. A sixteen-stop itinerary awaiting approval
      // would re-serialise twenty megabytes of base64 on every save.
      days: withId.days.map((d) => ({
        ...d,
        stops: d.stops.map((s) =>
          s.image ? { ...s, image: { provenance: s.image.provenance, credit: s.image.credit || null } } : s
        ),
      })),
      coverImage: withId.coverImage
        ? { provenance: withId.coverImage.provenance, credit: withId.coverImage.credit || null }
        : null,
      ...rendered,
      // `where` and `category` are the two fields the published ledger reads off
      // a slideshow — bot.js writes `topic: deckTopic(cand.deck)` and
      // `place: cand.deck.where` for anything carrying a deck payload. Without
      // them a plan files as "undefined · undefined" with no place, and the
      // repeat it cannot then see is the one that matters most here: the
      // destination is the ONLY thing that varies between two plans, so two
      // Rome itineraries in a week are the same post twice.
      where: withId.dest.he,
      category: 'מסלול AI',
      // What the slides say, kept beside them so the approval card can print the
      // plan without re-deriving any of it.
      stops: allStops(withId).length,
      dayTotals: withId.days.map((d) => dayTotal(d)),
    },
    plan: {
      dest: withId.dest,
      days: withId.days.length,
      stops: allStops(withId).length,
      total: withId.total,
      // How many slides each platform actually got. They differ by design —
      // TikTok one per stop, Instagram one per day — and the difference is the
      // kind of thing that should be read on the card rather than discovered in
      // the feed.
      slides: rendered.slideCounts,
      // Which lines the shape check dropped, and which stops lost their
      // photograph. Printed on the card, because a day that arrived with four
      // stops and shows three is the difference between an itinerary and a
      // shortened one.
      dropped: withId.dropped || [],
      giveaway: giveaway
        ? { winners: giveaway.winners, premiumDays: giveaway.premiumDays, keyword: giveaway.keyword }
        : null,
    },
    publishTargets: targets,
    // A draft by default, exactly as a deck bound for TikTok is: the API has no
    // field for choosing a sound and a sound cannot be changed after
    // publishing, so the slides land in the account's inbox and are finished by
    // hand. A plan is also the one post here that asks something of the viewer,
    // which is the last thing to want published unattended.
    tiktokDraft: Boolean(tiktokDraft),
    createdAt: plan.createdAt || new Date().toISOString(),
    overrides: overrideActive() ? overrideNotes() : [],
    notes: [],
  };

  // Both captions, drawn once each. The hook opens the Instagram caption because
  // a carousel has no title field; TikTok carries the title separately and its
  // description opens with the pin instead.
  const instagram = planCaption(withId, { text, giveaway, titled: true });
  const tiktok = planCaption(withId, { text, giveaway, titled: false });
  cand.instagramCaption = assertNoUrl(instagram, 'the plan caption');
  cand.tiktokCaption = assertNoUrl(tiktok, 'the plan description');
  cand.channelCaption = cand.instagramCaption;

  // A plan publishes from its slide URLs, but Telegram uploads bytes and the
  // held/retry paths look for a file — the cover stands in as "the card".
  cand.card = rendered.preview[0] || null;

  return cand;
}

/**
 * What you are shown before deciding.
 *
 * LONGER THAN THE OTHER THREE, on purpose. A card is one claim with its quotes
 * behind a button, a deck is photographs you can see, a clip is a video you just
 * watched. A plan is forty small assertions — thirteen place names, thirteen
 * prices, four titles and a total — and the cover image shows none of them. The
 * only way to disagree with a plan before it publishes is to read it, so this
 * prints the whole thing.
 *
 * The prices are printed per stop for the same reason. Nothing in this pipeline
 * sourced them; they are the account's estimate the moment this is approved, and
 * the brief's bargain is that a number is the owner's claim (BRIEF.md, the fare
 * ban). A total with the stops hidden behind it is not a claim anybody could
 * check.
 */
export function planApprovalMessage(cand) {
  const p = cand.plan || {};
  const deck = cand.deck || {};
  const days = deck.days || [];

  // The two counts, both of them, because they differ by design and the album
  // above this message only shows one of them. Somebody who sees seven pictures
  // and reads "19 slides" should be able to tell which is which without asking.
  const counts = Object.entries(p.slides || {})
    .map(([size, n]) => `${size === 'tiktok' ? 'טיקטוק' : 'אינסטגרם'} ${n}`)
    .join(' · ');

  const lines = [
    `🗺️ מסלול AI · ${p.dest?.he || '—'} · ${p.days} ימים · ${counts || '—'} שקופיות`,
    '',
    `✍️ ${cand.headline}`,
    '',
  ];

  for (const day of days) {
    lines.push(`📅 יום ${day.n} — ${day.titleHe}`);
    for (const stop of day.stops) {
      const price = stop.costIls > 0 ? `${shekels(stop.costIls)} ₪` : 'חינם';
      lines.push(`   ${stop.timeHe ? `${stop.timeHe} · ` : ''}${stop.nameHe} · ${price}`);
      lines.push(`      ${stop.noteHe}`);
    }
    lines.push('');
  }

  lines.push(`💰 סה״כ ${shekels(p.total)} ₪ לאדם · ${p.stops} עצירות`);
  // The qualification, repeated here and not only on the slide. Approving is
  // where the number becomes the account's, so this is the moment to be told
  // what it does and does not include.
  lines.push('   כניסות ואטרקציות בלבד — בלי טיסה ולינה');

  // Who was promised what, spelled out, because the bot cannot keep this
  // promise and the person tapping approve can.
  if (p.giveaway) {
    lines.push('');
    lines.push(`🎁 ${p.giveaway.winners} זוכים · ${p.giveaway.premiumDays} יום פרימיום · מילת מפתח "${p.giveaway.keyword}"`);
    lines.push('   ⚠️ הבחירה והמתנה עליך — הבוט לא קורא תגובות');
  }

  if (p.dropped?.length) {
    lines.push('');
    lines.push(`⚠️ ${p.dropped.length} שורות נפסלו בבנייה:`);
    for (const why of p.dropped.slice(0, 5)) lines.push(`   ✗ ${why}`);
  }

  lines.push('');
  lines.push(`🏷️ ${cand.tiktokCaption?.split('\n').pop() || '(אין תגיות)'}`);

  return lines.join('\n');
}
