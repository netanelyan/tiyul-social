import { pillarHe } from './pillars.js';
import { LAYOUT_HE } from './render/templates.js';
import { provenanceHe } from './images.js';
import { targetsHe } from './publish/targets.js';
import { privacyHe } from './publish/tiktok.js';
import { KINDS } from './sources/places.js';
import { clipApprovalMessage } from './video/clip.js';
import { planApprovalMessage } from './plan/candidate.js';
import { postConfig } from './postConfig.js';
import { hashtagLine, captionQuestion, captionCta } from './hashtags.js';
import { URL_LIKE } from './urlLike.js';

// Two different texts, for two different readers.
//
//   approvalMessage() — for you, before anything publishes. Everything you need
//                       to make the call, including the source URL, every time.
//   channelCaption()  — for the channel and for Instagram, after you approve.
//
// Deliberately kept apart: the approval card carries provenance, evidence and
// quota state that have no business in a published post, and the published post
// must never quietly gain something you didn't see.

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * The caption that actually publishes.
 *
 * The source link goes out with the post too, not only in the approval message —
 * a claim is worth as much as the reader's ability to check it.
 */
export function channelCaption(cand) {
  const brand = process.env.BRAND_NAME || 'טיול+';
  const lines = [clean(cand.headline), '', String(cand.caption || '').trim()];

  if (cand.sourceUrl) lines.push('', `מקור: ${cand.sourceUrl}`);
  if (brand) lines.push('', brand);

  return lines.join('\n').trim();
}

/**
 * The Instagram caption. Deliberately short.
 *
 * Three things are NOT here, and each is a decision rather than an omission:
 *
 *   - the headline, because it is already the largest thing on the image;
 *     repeating it is the caption's most common way of wasting its first line.
 *   - the source URL, because it is unclickable on Instagram and long. The
 *     attribution still ships: the card itself prints "מקור: <domain>" in its
 *     footer, so the claim stays traceable in the artefact people actually see.
 *   - the brand name, which the site line already carries.
 *
 * The approval message is unaffected and still carries the full source URL
 * every time. That rule is about what YOU see before tapping, not about what
 * gets published.
 */
// THE SIGNATURE IS GONE, AND WITH IT THE LAST URL THIS PIPELINE PUBLISHED.
//
// It was two lines under every card: `לסוכן הטיולים החכם שלנו:` over
// `www.tiyulplus.com`. Three things were wrong with it, and they are the same
// three the deck's caption note already worked through, the difference is that
// a card never got the fix, so the one kind that publishes most often to
// Instagram was also the only kind still shipping a domain.
//
// The URL is the expensive part. It is not tappable in an Instagram caption or
// a TikTok description, so it bought no traffic; what it did buy is a post that
// opens by pointing away from the app it is published on, which neither app has
// a reason to distribute. `assertNoUrl` has refused this string in every other
// kind since it was written. It was never pointed at a card.
//
// The second is that it was fixed. One closing line across every post is a
// signature, and a signature is a template, the argument that replaced the
// fixed caption with `caption.lines`.
//
// And the third is that it asked for nothing a viewer could do without leaving.
// What replaces it is what the clip format already closes with: a question
// worth answering and, on some posts, one ask naming the next thing to do here.
// See `_ctas_comment` in post-config.json for which asks and in what order.

// A slideshow carries NO signature, no call to action and no URL.
//
// It used to carry all three: "למתכנן טיולים חכם בביו שלנו" over
// "www.tiyulplus.com", which was the entire TikTok description. Three things
// were wrong with it and they compound.
//
// The URL is the expensive one. An external domain in a TikTok description is
// a demotion — the app has no reason to send traffic off itself — and the link
// was never tappable there in the first place, so it bought nothing to offset
// the cost. The bio is where the link lives, and the bio is reachable from the
// post regardless of what the description says.
//
// The call to action is the second. A post whose first line asks for something
// reads as an advertisement before anyone has looked at the picture, and this
// account's problem is that it reads as an advertisement.
//
// And the brand name is the third, for the same reason.
//
// What replaces it is one short line with no ask in it, drawn at random from a
// pool in post-config.json, and five hashtags. See captionHook below.
const HOOK_POOL = () => postConfig().caption.lines;

/**
 * The line that opens a published slideshow.
 *
 * Random per post rather than fixed, because the pool is the point: twenty
 * openings across twenty posts is a feed somebody wrote, one opening across
 * twenty posts is a template, and the template is what the previous signature
 * was.
 */
export const captionHook = ({ rand = Math.random } = {}) => {
  const lines = HOOK_POOL();
  return lines[Math.floor(rand() * lines.length)];
};

// The link pattern moved to src/urlLike.js so postConfig.js can guard the
// configured CTA with the same object without closing an import cycle — see
// the note there. Imported AND re-exported, not forwarded: `export { X } from`
// alone would publish the name without binding it in this module's scope, and
// assertNoUrl below reads it.
export { URL_LIKE };

/**
 * The guard between a built caption and the approval queue.
 *
 * Here rather than at publish time on purpose. The rule is about what we choose
 * to publish, so it has to fire before anything is shown for approval — a
 * caption with a URL in it must never become something you can tap approve on,
 * because at that point the only thing standing between it and TikTok is
 * whether you happened to read the last line.
 *
 * Throws rather than stripping. A caption assembled from a pool that has a
 * domain in it is a configuration error, and silently editing it would leave
 * post-config.json broken and every future post quietly repaired.
 */
export function assertNoUrl(caption, where = 'caption') {
  const text = String(caption || '');
  const hit = text.match(URL_LIKE);
  if (hit) {
    throw new Error(
      `${where} contains a URL ("${hit[0]}") - nothing published may carry one; the link lives in the bio`
    );
  }
  return text;
}

// Instagram's caption limit, and the shortest of the three a deck publishes to.
const CAPTION_LIMIT = 2200;

function publishedDescription(cand, limit, opts = {}) {
  // The subhead is deliberately absent from the rendered card, so this is the
  // only place it appears. Putting it first means the description opens by
  // answering the headline rather than repeating it.
  const parts = [];
  const sub = String(cand.subhead || '').trim();
  const body = String(cand.caption || '').trim();

  if (sub) parts.push(sub);
  if (body) parts.push(body);

  // The close, in the order the clip format settled on: the question above the
  // ask, because a viewer who reads to the end of a caption should reach the
  // thing that costs them nothing before the thing that asks them to act.
  parts.push(...captionClose(opts));

  // Checked, now that there is nothing here that is supposed to carry a domain.
  // This was the ONE published string with no such guard on it, for the good
  // reason that it deliberately ended in one; with the signature gone the
  // exemption has nothing left to protect and a `www.` reaching a caption from
  // anywhere, a model, an edited headline, a future signature, should fail
  // where every other kind already fails.
  return assertNoUrl(parts.join('\n\n').trim().slice(0, limit), 'the card description');
}

export const instagramCaption = (cand, opts) => publishedDescription(cand, 2200, opts); // IG caption limit

/**
 * The TikTok description. Deliberately the same text as Instagram's.
 *
 * Same card, same claim, same signature — a second wording would be a second
 * thing to review, and the approval message shows you one description. The only
 * difference is the ceiling, and the headline, which travels separately as the
 * post title rather than being repeated here.
 */
export const tiktokCaption = (cand, opts) => publishedDescription(cand, 4000, opts); // TikTok description limit

/**
 * Both of a card's descriptions, from ONE draw of the question and the ask.
 *
 * The identity above is a decision, not an accident: the approval message shows
 * you one description, so two wordings would mean approving text that is not
 * what publishes. That held for free while the close was a fixed signature.
 * With a question and an ask drawn per call it stopped holding, calling the two
 * builders in sequence draws twice and the two platforms get different closes.
 *
 * So the draw happens here, once, and is handed to both. Callers that want both
 * captions must use this rather than calling the two exports back to back;
 * the exports stay for the single-caption callers and for the labs.
 */
export function publishedDescriptions(cand, opts = {}) {
  const close = { question: captionQuestion(opts), cta: captionCta(opts) };
  return {
    instagram: instagramCaption(cand, { ...opts, ...close }),
    tiktok: tiktokCaption(cand, { ...opts, ...close }),
  };
}

/**
 * The caption under a published deck.
 *
 * The cover slide already carries the title, so the caption opens with the
 * angle — the reason to watch — and then lists the places in order. The list is
 * the part that survives being read without the images, which is what a caption
 * is for, and it is also what someone searching for one of those places will
 * match on.
 */
/**
 * What goes under a deck on TIKTOK.
 *
 * One line and five tags. The title is NOT here — TikTok carries it in
 * post_info.title, and repeating it in the description spends the first line of
 * the description on a line the viewer has already read two centimetres higher.
 *
 * Instagram is the other way round — see deckCaption — because a carousel has
 * no title field and the caption is the only text there is.
 *
 * Checked before it is returned, not after it is staged: see assertNoUrl.
 */
/**
 * How a published caption ends: a question, then sometimes one ask.
 *
 * Shared by every kind. `opts.question` and `opts.cta` are drawn once per POST
 * by the caller and handed to each builder, so the Instagram and TikTok halves
 * of one post close the same way, which is what makes the single description on
 * the approval card a true preview of both.
 *
 * The undefined/null distinction is load-bearing. `undefined` means nothing was
 * handed over and one is drawn here, which is what the labs and the tests do.
 * `null` means the caller drew and got nothing, which on the ask is the normal
 * case by ctaShare and must not be re-rolled into a yes.
 */
function captionClose(opts = {}) {
  const question = opts.question === undefined ? captionQuestion(opts) : opts.question;
  const cta = opts.cta === undefined ? captionCta(opts) : opts.cta;
  return [question, cta].filter(Boolean);
}

export function deckTiktokCaption(deck, opts = {}) {
  const hook = opts.hook || captionHook(opts);
  const tags = hashtagLine(deck, opts);
  // The tags stay last. Everything added here goes ABOVE them, because a tag
  // block is where a reader stops reading and anything under it is unread.
  const parts = [hook, ...captionClose(opts), tags];
  return assertNoUrl(parts.join('\n\n').trim(), 'the TikTok description');
}

export function deckCaption(deck, opts = {}) {
  // The title, one line, and the tags.
  //
  // This listed the angle and then every place, numbered — which is the deck
  // itself, retyped underneath the deck. A viewer who wants the list swipes;
  // the description's job on a slideshow is to say what it is, and a wall of
  // names pushes everything else below the fold.
  //
  // The title survives here and not on TikTok because a carousel has no title
  // field: drop it and the post has no title at all.
  //
  // The tags are RESERVED out of the limit rather than appended and hoped for.
  // The old version built the whole string and sliced it to 2200, so on a long
  // deck the last thing was the part that fell off the end — and the last thing
  // is now what the post is filed under.
  const hook = opts.hook || captionHook(opts);
  // The close sits between the line and the tags, and is RESERVED out of the
  // limit along with them for the same reason: built into the string and sliced
  // afterwards, the last thing added is the first thing to fall off, and the
  // last things here are the question and the tags.
  const tail = `\n\n${[hook, ...captionClose(opts), hashtagLine(deck, opts)].join('\n\n')}`;
  const body = String(deck.titleHe || '').trim().slice(0, CAPTION_LIMIT - tail.length);
  return assertNoUrl(`${body}${tail}`.trim(), 'the Instagram caption');
}

/**
 * The approval message for a deck.
 *
 * Longer than a card's, because there is more that can be wrong and all of it
 * is invisible in the images: which slides were dropped and why, how thin the
 * region was, and which domain each fact was quoted from. The album arrives
 * above this message, so the pictures and this text are read together.
 */
export function deckApprovalMessage(cand) {
  const deck = cand.deck || cand;
  const lines = [];

  // The style is on the header because it is the single biggest visual
  // difference between two decks and it is chosen automatically. Reading
  // "minimal" and seeing cream-and-bronze slides means the style decision is
  // wrong, and that is otherwise invisible until the pictures load.
  const styleHe = deck.style === 'info' ? 'מידע' : 'מינימלי';
  // The category in Hebrew, not as its internal id. "temple" and "trail" are
  // keys in a lookup table, and printing them put an English word in the first
  // line of an otherwise Hebrew message for no reason anyone reading it could
  // see. The place name stays as it is — it is a proper noun and the map knows
  // it by that name.
  lines.push(`🎞️ מצגת · ${KINDS[deck.category]?.he || deck.category} · ${deck.where} · סגנון ${styleHe}`);
  lines.push('');
  lines.push(`🖼️ על השער: ${clean(deck.titleHe)}`);
  if (deck.idea?.emphasisHe) lines.push(`   בצבע: ${clean(deck.idea.emphasisHe)}`);
  // The Israeli angle this destination was chosen for.
  //
  // Printed because it is a decision made before you see anything and it is
  // otherwise invisible: the angle never appears on a slide by design, so a
  // rotation that has quietly been proposing beach destinations under "חנוכה
  // בחו״ל" for a fortnight looks, on every card, exactly like one that is
  // working. Same reason the shot list prints it.
  if (deck.idea?.angle) lines.push(`   🇮🇱 הזווית: ${clean(deck.idea.angle)}`);
  lines.push('');

  // The description, shown before you approve it.
  //
  // It was not shown at all until the caption stopped being a fixed signature.
  // A constant needs reviewing once; a line drawn at random from a pool of
  // twenty, followed by five tags one of which is generated from the deck's own
  // country, is a different post every time and is the thing this account is
  // currently testing. Printed as it will publish, TikTok's version, because
  // that is the destination the change was made for.
  const desc = cand.tiktokCaption || cand.instagramCaption;
  if (desc) {
    lines.push('📝 התיאור:');
    for (const l of String(desc).split('\n')) lines.push(`   ${l}`.trimEnd());
    lines.push('');
  }

  lines.push(`📑 ${deck.slides.length + 1} שקופיות (שער + ${deck.slides.length} מקומות):`);
  for (const [i, s] of deck.slides.entries()) {
    // A slide is a name and, where the category has them, a few fields. The
    // fields are shown because they are the only part that can be wrong.
    const fields = (s.fields || []).map((f) => `${f.labelHe}: ${f.value}`).join(' · ');
    const note = (s.bullets || [])[0]?.text;
    const extra = fields || note || '';
    lines.push(`   ${i + 2}. ${s.nameHe}${s.flag ? ` ${s.flag}` : ''}${extra ? ` - ${extra}` : ''}`);
  }
  lines.push('');

  // The shortfall, stated. A deck that asked for five and built three looks
  // exactly like a deck that meant to be three, and the difference is whether
  // the region is thin or the search is broken.
  if (deck.short) {
    lines.push(`⚠️ ביקשנו ${deck.counts.asked} מקומות, נבנו ${deck.counts.built}`);
  }
  lines.push(
    `🔎 ${deck.counts.found} מקומות באזור · ${deck.counts.withAuthority} עם גוף מוסמך · ${deck.counts.built} נכנסו`
  );

  // Why each candidate fell out. Capped, because a thin region can drop a dozen
  // and the useful signal is the first few reasons, not the list.
  for (const d of (deck.dropped || []).slice(0, 4)) {
    lines.push(`   ✗ ${d.place}: ${String(d.why).slice(0, 80)}`);
  }
  if ((deck.dropped || []).length > 4) lines.push(`   ✗ ועוד ${deck.dropped.length - 4}`);

  // Kept, but with less on them than the category asked for. Listed separately
  // from the dropped, and with a different mark: a place whose page had no
  // numbers is on a slide carrying its name, which is a working slide — showing
  // it under "✗" made a perfectly good deck read as half-broken.
  for (const d of (deck.degraded || []).slice(0, 3)) {
    lines.push(`   ~ ${d.place}: בלי נתונים, רק השם`);
  }
  if ((deck.degraded || []).length > 3) lines.push(`   ~ ועוד ${deck.degraded.length - 3}`);

  const missing = deck.slides.filter((s) => s.imageMiss).length;
  if (missing) lines.push(`⚠️ ${missing} שקופיות בלי צילום`);

  const targets = cand.publishTargets?.length ? cand.publishTargets : [];
  lines.push('');
  lines.push(targets.length ? `📤 יפורסם ל${targetsHe(targets)}` : '⛔ אין יעד פרסום מוגדר');

  if (targets.includes('tiktok')) {
    if (cand.tiktok?.error) {
      lines.push(`⚠️ טיקטוק: לא ניתן לקרוא את הגדרות החשבון - ${cand.tiktok.error}`);
    } else if (cand.tiktok?.privacy) {
      const who = cand.tiktok.username ? ` · @${cand.tiktok.username}` : '';
      lines.push(`🔒 פרטיות בטיקטוק: ${privacyHe(cand.tiktok.privacy)}${who}`);
    }
  }

  // Same as the card: a deck built by stepping over a guard says so before you
  // approve it. This is the one that matters most — "the third Dolomites deck
  // in a row" is invisible in a slideshow and obvious on the feed.
  if (cand.overrides?.length) {
    lines.push('');
    lines.push('🔓 נעקפו בקרות:');
    for (const o of cand.overrides) lines.push(`   • ${o}`);
  }

  // Its own heading, and unconditional. These used to be folded into the block
  // above, which meant two wrong things at once: they only appeared when an
  // override was active, and when they did they were filed as controls that had
  // been bypassed. A repeat bypasses nothing. It is the sentence that changes
  // whether you tap approve on a slideshow that is fine on its own and is the
  // third about the same city.
  if (cand.notes?.length) {
    lines.push('');
    lines.push('👀 שימו לב:');
    for (const n of cand.notes) lines.push(`   • ${n}`);
  }

  lines.push('');
  lines.push('🔗 מקורות:');
  for (const s of deck.slides) {
    // A slide with no page prints where its facts DID come from, rather than
    // the word "null". Mountains and waterfalls mostly have no official site —
    // that is why those kinds are allowed to build from Wikidata at all — so
    // this is the common case for them, not an error. Printing the raw value
    // made a normal deck look broken and told you nothing about provenance.
    // A free-form slide has no source because it carries no claim — saying
    // "Wikidata" there would name a source it never consulted.
    const from = s.sourceUrl || (deck.freeform ? 'ללא מקור (מצגת חופשית)' : `ויקינתונים${s.qid ? ` (${s.qid})` : ''}`);
    lines.push(`   ${s.nameHe}: ${from}`);
  }

  return lines.join('\n');
}

/**
 * The staging card.
 *
 * No parse_mode is used for this message anywhere in the bot — a headline or a
 * source URL containing `*`, `_` or a backtick would break Telegram's Markdown
 * parser, and the failure mode there is a message that doesn't send at all.
 * BrickDeal hit exactly this and worked around it with a fallback; not asking
 * for Markdown in the first place is simpler and can't fail.
 */
export function approvalMessage(cand) {
  // A deck has a different failure surface and therefore a different message.
  if (cand.kind === 'deck') return deckApprovalMessage(cand);
  // A clip has a third one: no quotes to check, no slides to drop, and the one
  // thing that cannot be seen in the video is why this footage was chosen.
  if (cand.kind === 'clip') return clipApprovalMessage(cand);
  // And a plan has a fourth: forty small assertions, none of them sourced and
  // none of them visible on the cover image, so the card prints the itinerary
  // itself. See the note above planApprovalMessage.
  if (cand.kind === 'plan') return planApprovalMessage(cand);

  const lines = [];

  lines.push(`${LAYOUT_HE[cand.layout] || cand.layout} · ${pillarHe(cand.pillar)}`);
  if (cand.tags?.length) lines.push(`תגיות: ${cand.tags.join(', ')}`);
  lines.push('');

  // Shown the way it will actually appear: the card carries the headline alone,
  // and the subhead opens the description. Splitting them here is what lets you
  // see the hook and the payoff as two separate things before approving.
  lines.push(`🖼️ על הכרטיס: ${clean(cand.headline)}`);
  lines.push('');

  const desc = instagramCaption(cand);
  if (desc) {
    lines.push('📝 התיאור:');
    lines.push(desc);
    lines.push('');
  }

  // The trip this post connects to. Nothing reaches this message without one —
  // src/candidate.js refuses to stage a candidate that cannot answer it — so
  // this line is not a check for you to perform, it is the answer that got the
  // post here, shown so you can disagree with it before it publishes.
  if (cand.trip?.where) {
    lines.push(`🧭 הטיול: ${cand.trip.where} · ${cand.trip.how}`);
    if (cand.trip.want) lines.push(`   למה שירצו: ${cand.trip.want}`);
  }

  // Which of the three permitted origins this image came from — or that there
  // is no image at all, which for a text-led card is the expected answer.
  //
  // The search term is printed too. It is the one input to the photograph that
  // the drafting step chose, and when a card arrives with the wrong picture the
  // first question is whether the search was wrong or the library was.
  lines.push(
    cand.image
      ? `🖼️ תמונה: ${provenanceHe(cand.image.provenance)}${cand.image.credit ? ` · ${cand.image.credit}` : ''}${cand.image.query ? ` · חיפוש: "${cand.image.query}"` : ''}`
      : '🖼️ תמונה: אין - כרטיס טקסט בלבד'
  );

  // A card that wanted a photograph and did not get one says so. Without this
  // line the demoted card and the deliberately text-led card look the same, and
  // an image provider that stopped working reads as a run of editorial choices.
  if (cand.imageMiss) {
    lines.push(`   ⚠️ ירד ל${LAYOUT_HE[cand.layout] || cand.layout} מ-${cand.photoDowngrade}: ${cand.imageMiss}`);
  }

  const n = cand.evidence?.length || 0;
  lines.push(`✅ ${n} ציטוט${n === 1 ? '' : 'ים'} אומת${n === 1 ? '' : 'ו'} מול דף המקור`);

  // Approving is the irreversible step, so the card says where it goes before
  // you tap, not after. Resolved when the candidate was built rather than at
  // publish time, so what you were shown is what was true when you decided.
  const targets = cand.publishTargets?.length ? cand.publishTargets : [];
  lines.push(targets.length ? `📤 יפורסם ל${targetsHe(targets)}` : '⛔ אין יעד פרסום מוגדר');

  // TikTok's Direct Post rules require the creator to see the privacy level
  // before the post goes out, so it is shown here rather than assumed from
  // .env — and the button under this message is what changes it. A card whose
  // creator-info call failed says so instead of showing a level that was never
  // confirmed against the account.
  if (targets.includes('tiktok')) {
    if (cand.tiktok?.error) {
      lines.push(`⚠️ טיקטוק: לא ניתן לקרוא את הגדרות החשבון - ${cand.tiktok.error}`);
    } else if (cand.tiktok?.privacy) {
      const who = cand.tiktok.username ? ` · @${cand.tiktok.username}` : '';
      lines.push(`🔒 פרטיות בטיקטוק: ${privacyHe(cand.tiktok.privacy)}${who}`);
    }
  }

  // What it took to build this one. Above the source URL rather than below it,
  // because this is the part that changes whether you tap approve — the whole
  // point of letting the owner step over a quota is that stepping over it is a
  // decision, and a decision needs the number in front of it.
  if (cand.overrides?.length) {
    lines.push('');
    lines.push('🔓 נעקפו בקרות:');
    for (const o of cand.overrides) lines.push(`   • ${o}`);
  }

  // What repeats what just went out — see the same block in the deck message.
  // Always computed, never a block, and deliberately not filed under "bypassed".
  if (cand.notes?.length) {
    lines.push('');
    lines.push('👀 שימו לב:');
    for (const n of cand.notes) lines.push(`   • ${n}`);
  }

  // The rule is "the source URL is always in the approval message", so it is
  // pushed unconditionally, in full, never truncated and never folded into a
  // link label that would hide where it actually points. It sits last rather
  // than in the middle of the copy: an API URL 200 characters long was cutting
  // the draft in half and making the whole message hard to read.
  //
  // It appears here and nowhere else. Nothing published carries a URL.
  lines.push('');
  lines.push(`🔗 מקור (${cand.sourceName}):`);
  lines.push(cand.sourceUrl);

  return lines.join('\n');
}

/** Shown after you tap — the card is rewritten in place so a decision is visible. */
export function decidedMessage(statusLine, cand) {
  return `${statusLine}\n\n${approvalMessage(cand)}`;
}

/** The evidence itself, on demand — `/why` shows counts, this shows the quotes. */
export function evidenceReport(cand) {
  // A deck's evidence is per slide, and which slide a quote belongs to is the
  // thing you need in order to check it — a flat list of quotes from six
  // different websites is unreadable.
  if (cand.kind === 'deck') {
    // A name-only deck has nothing to quote, and saying so is the honest
    // answer: the only assertion on those slides is that a place is called
    // what our own page calls it.
    const withFields = (cand.deck?.slides || []).filter((s) => s.fields?.length);
    if (!withFields.length) {
      return 'במצגת הזו אין טענות לצטט - כל שקופית נושאת שם מקום בלבד, מתוך הדף שלנו.';
    }
    const blocks = withFields.map((s) => {
      const quotes = s.fields.map((f) => `   ${f.labelHe}: ${f.value}\n   « ${String(f.quote || '').slice(0, 240)} »`);
      return [`${s.n}. ${s.nameHe}`, `   ${s.sourceUrl}`, ...quotes].join('\n');
    });
    return `📎 הציטוטים, שקופית אחר שקופית:\n\n${blocks.join('\n\n')}`;
  }

  if (!cand.evidence?.length) return 'אין ציטוטים שמורים לפריט הזה';
  const lines = cand.evidence.map(
    (e, i) => `${i + 1}. ${e.claim}\n   « ${String(e.quote).slice(0, 300)} »`
  );
  return `📎 הציטוטים מדף המקור:\n${cand.sourceUrl}\n\n${lines.join('\n\n')}`;
}
