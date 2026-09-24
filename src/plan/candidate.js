import { createHash } from 'node:crypto';
import { renderToJpeg, cardOutputDir } from '../render/index.js';
import { renderPlanSlideHtml, planSlides, SIZES, dayTotal, stopCount, shekels } from '../render/planSlides.js';
import { targetsForKind } from '../publish/targets.js';
import { overrideActive, overrideNotes } from '../override.js';
import { assertNoUrl } from '../format.js';
import { planCaption } from '../hashtags.js';
import { planText, planGiveaway } from './text.js';

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

/** deck-<id>-<size>-<nn>, the naming decks already use — order is load-bearing. */
export const planSlideStem = (id, size, index) => `plan-${id}-${size}-${String(index).padStart(2, '0')}`;

/** One each of the destinations that have a render size, in publish order. */
export const sizesFor = (targets) => [
  ...new Set((targets || []).filter((t) => t === 'instagram' || t === 'tiktok')),
];

/**
 * Render every slide of a plan at every needed size.
 *
 * Instagram takes ten images in a carousel. A plan is days + 3 slides at most,
 * so five days is the configured ceiling and eight slides the practical one —
 * but the slice is here rather than trusted, because the failure mode is
 * Instagram rejecting the whole post at publish time, hours after approval.
 */
export async function renderPlan(plan, { sizes = ['instagram', 'tiktok'], outDir = cardOutputDir(), text, giveaway } = {}) {
  const want = sizes.filter((s) => SIZES[s]);
  if (!want.length) throw new Error(`renderPlan: no known size in [${sizes.join(', ')}]`);

  const slides = planSlides(plan, { giveaway });
  const out = {};

  for (const size of want) {
    const rendered = [];
    for (const [i, slide] of slides.entries()) {
      const html = renderPlanSlideHtml(slide, plan, { size, text, giveaway });
      rendered.push({
        ...(await renderToJpeg(html, {
          stem: planSlideStem(plan.id, size, i + 1),
          width: SIZES[size].w,
          height: SIZES[size].h,
          outDir,
        })),
        index: i + 1,
        type: slide.type,
        cover: i === 0,
      });
    }
    out[size] = rendered;
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
  };
}

/**
 * Wrap a written plan as an approvable candidate.
 *
 * Rendering happens here rather than in write.js for the same reason a card and
 * a deck render last: it is the step that costs a browser, and a plan that lost
 * a day to its shape check should not have paid for one.
 */
export async function toPlanCandidate(plan, { targets = targetsForKind('plan'), tiktokDraft = true, outDir = cardOutputDir() } = {}) {
  const id = planId(plan);
  const withId = { ...plan, id };
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
      stops: stopCount(plan.days),
      dayTotals: plan.days.map((d) => dayTotal(d)),
    },
    plan: {
      dest: plan.dest,
      days: plan.days.length,
      stops: stopCount(plan.days),
      total: plan.total,
      // Which lines the shape check dropped. Printed on the card, because a
      // day that arrived with four stops and shows three is the difference
      // between an itinerary and a shortened one.
      dropped: plan.dropped || [],
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

  const lines = [
    `🗺️ מסלול AI · ${p.dest?.he || '—'} · ${p.days} ימים · ${deck.tiktok?.length || deck.instagram?.length || 0} שקופיות`,
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
