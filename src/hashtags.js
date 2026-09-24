import { postConfig } from './postConfig.js';
import { deckPlace } from './deck/region.js';

// The five tags under every slideshow.
//
// Two broad and three niche, and the split is the whole design: broad tags buy
// the first few hundred impressions from the general pool, niche tags decide
// who the post is shown to after that. All-broad is a post competing with
// everything on the app; all-niche is a post with no way in.
//
// One of the three niche slots is spent on the deck's own country. That tag is
// the only one on the post that is actually ABOUT the post, and it is the one
// somebody searching for a trip will match on.

/**
 * The deck's country, as a hashtag can carry it.
 *
 * Read off the slides rather than off `deck.where`, for the same reason the
 * cover is: `where` is the English string the map was searched with ("Prague"),
 * and the country is a property of the places that actually survived. deckPlace
 * answers it from the slides' own ISO codes, which survive the build — the
 * Hebrew country NAME does not, because applyCountryVisibility strips it from
 * every slide once they all agree on one, which is the common case.
 *
 * Returns null rather than guessing. A deck spanning four countries genuinely
 * has no country tag, and inventing one is worse than spending the slot on the
 * niche pool.
 */
export function destinationTag(deck) {
  if (!deck) return null;
  const place = deckPlace(deck.slides || [], { kind: deck.category });
  const he = place.he || (deck.slides || []).find((s) => s.countryHe)?.countryHe || null;
  if (!he) return null;

  // A hashtag has no spaces and no punctuation. "צ׳כיה" keeps its geresh —
  // that is a letter as far as the name is concerned and the tag is unusable
  // without it — while "דרום מזרח אסיה" closes up into one word, which is what
  // a person typing it would do anyway.
  const word = String(he).replace(/\s+/g, '').replace(/[^\p{L}\p{N}׳״'"]/gu, '');
  return word.length >= 2 ? `#${word}` : null;
}

/**
 * A clip's country, as a hashtag.
 *
 * Different source from a deck's, same rule. A deck derives its country from
 * the slides' own Wikidata P17 claims; a clip has no slides and no Wikidata —
 * what it has is the vision judge's reading of the frame, already filtered to
 * the cases it was sure of (see placeMinConfidence). The English name it
 * returns is mapped to the Hebrew spelling Israelis use.
 *
 * Null when the country was not established, and the slot then falls back to
 * the niche pool — exactly as it does for a deck spanning four countries.
 * Tagging #יוון on footage that might be Croatia is the same fabrication the
 * rest of this pipeline refuses to make.
 */
export function clipDestinationTag(cand) {
  const place = cand?.clip?.vision?.place || cand?.vision?.place || null;
  if (!place) return null;
  const he = postConfig().places[String(place).toLowerCase()];
  if (!he) return null;
  const word = String(he).replace(/\s+/g, '').replace(/[^\p{L}\p{N}׳״'"]/gu, '');
  return word.length >= 2 ? `#${word}` : null;
}

/** `n` distinct entries from a pool, chosen at random, in the order drawn. */
function draw(pool, n, taken, rand) {
  const left = pool.filter((t) => !taken.has(t));
  const out = [];
  while (out.length < n && left.length) {
    const [tag] = left.splice(Math.floor(rand() * left.length), 1);
    taken.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * The hashtag block for one deck: exactly broadCount + nicheCount tags.
 *
 * "Exactly" is enforced rather than hoped for. The destination tag REPLACES a
 * niche draw instead of being appended to it, so a deck whose country resolved
 * and a deck whose country did not both publish with the same number of tags —
 * otherwise the one variable being tested changes for a reason that has
 * nothing to do with the test.
 *
 * Broad tags lead. They are what the first impressions come from, and a
 * description is read from its first line.
 */
export function hashtagsFor(deck, { rand = Math.random } = {}) {
  const cfg = postConfig().hashtags;
  const taken = new Set();

  const broad = draw(cfg.broad, cfg.broadCount, taken, rand);

  const niche = [];
  const dest = cfg.useDestination ? destinationTag(deck) : null;
  if (dest) {
    taken.add(dest);
    niche.push(dest);
  }
  niche.push(...draw(cfg.niche, cfg.nicheCount - niche.length, taken, rand));

  return [...broad, ...niche];
}

/** The same thing as the line that goes under a caption. */
export const hashtagLine = (deck, opts) => hashtagsFor(deck, opts).join(' ');

/**
 * The five tags under a clip, and the whole of its description.
 *
 * The line itself is BURNED INTO the video, so repeating it underneath spends
 * the description on something the viewer has already read — the same argument
 * that keeps a deck's title out of its TikTok description. What is left is the
 * tags, which is also exactly what the reference post the owner supplied does:
 * a flag and five hashtags, nothing else.
 */
export function clipHashtags(cand, { rand = Math.random } = {}) {
  const cfg = postConfig().hashtags;
  const taken = new Set();

  const broad = draw(cfg.broad, cfg.broadCount, taken, rand);

  const niche = [];
  const dest = cfg.useDestination ? clipDestinationTag(cand) : null;
  if (dest) {
    taken.add(dest);
    niche.push(dest);
  }
  niche.push(...draw(cfg.niche, cfg.nicheCount - niche.length, taken, rand));

  return [...broad, ...niche];
}

/**
 * The site's name in Hebrew letters, or null.
 *
 * The description is a Hebrew post and every word of it is Hebrew, including
 * the hard ones. The earlier version left the site in Latin on the argument
 * that "Lauterbrunnen" is what a viewer would type into a search box and that
 * "לאוטרברונן" is one of several defensible spellings — true, and beside the
 * point: one Latin word in the middle of a Hebrew line reads as a machine
 * filling a field, which is the one impression this account cannot afford.
 * The owner's instruction is the rule now — Hebrew even when the name is
 * awkward to write.
 *
 * Two sources, pinned first. `clips.sites` in post-config.json is the owner's
 * own spelling for the places this feed keeps returning to, and it wins,
 * because a transliteration that changes between posts is worse than either
 * choice made consistently. Everything else uses the spelling the vision judge
 * returned alongside the name, which costs nothing — it is the same call that
 * identified the place.
 *
 * Null rather than a fallback to Latin. A pin of just the country is a true
 * line in Hebrew; a pin with one Latin word in it is the thing being fixed.
 */
export function clipSiteName(v) {
  // The first segment only. The schema asks for the bare name, and the judge
  // still returns "Cinque Torri, Dolomites" often enough to matter — which
  // renders as "📍 Cinque Torri, Dolomites, איטליה", a pin with two commas and
  // a region nobody asked for. Trimming here rather than trusting the prompt,
  // because a prompt is a request and this is the line that publishes.
  const site = String(v?.site || '').split(',')[0].trim();
  if (!site) return null;

  const pinned = postConfig().sites[site.toLowerCase()];
  if (pinned) return pinned;

  const he = String(v?.siteHe || '').split(',')[0].trim();
  // Checked rather than trusted. The judge is asked for Hebrew letters and
  // mostly obliges, but a model handed "Lago di Braies" sometimes hands it
  // straight back — and an unchecked passthrough would put the Latin name back
  // in the line under a field name that claims otherwise.
  if (!he || /[A-Za-z]/.test(he) || !/\p{Script=Hebrew}/u.test(he)) return null;
  return he;
}

/**
 * Where the clip is, for the first line of the description.
 *
 * Place then country, which is the order the deck slides already use
 * ("סקוגאפוס, איסלנד") and the order every map label in the world uses:
 * specific first, general second. Both halves are Hebrew — see clipSiteName.
 *
 * Returns null when the country was not established. A pin with nothing after
 * it is worse than no pin.
 */
export function clipPlaceLine(cand) {
  const v = cand?.clip?.vision || cand?.vision || null;
  if (!v?.place) return null;
  const countryHe = postConfig().places[String(v.place).toLowerCase()];
  if (!countryHe) return null;
  const site = clipSiteName(v);
  return site ? `📍 ${site}, ${countryHe}` : `📍 ${countryHe}`;
}

/**
 * One question to close a caption with, or null.
 *
 * The brief's caption shape is "one short line plus a question" (rule 7), and
 * the question is doing a specific job: it is the thing a comment is an answer
 * TO. A caption that states and stops gives nobody anything to type, and the
 * comment count on the first seven posts — which is zero — is what that looks
 * like in the data.
 *
 * Null when none are configured, which is the old behaviour and a valid thing
 * to go back to by emptying the list.
 */
export function captionQuestion({ rand = Math.random } = {}) {
  const { questions } = postConfig().caption;
  return questions.length ? questions[Math.floor(rand() * questions.length)] : null;
}

/**
 * The soft call to action, on `ctaShare` of posts.
 *
 * NOT on every post, and that is the whole of what "soft" means here. The
 * brief's rule 8 says a soft CTA at the end and never make the whole video an
 * advertisement; a pointer to the bio under every single caption is not soft,
 * it is a signature. Half is the configured default.
 *
 * The string is checked for a domain when post-config.json is read rather than
 * here, so a CTA with a URL in it fails once, loudly, at startup — instead of
 * once per post from inside a build.
 */
export function captionCta({ rand = Math.random } = {}) {
  const { cta, ctaShare } = postConfig().caption;
  if (!cta || ctaShare <= 0) return null;
  return rand() < ctaShare ? cta : null;
}

/**
 * The whole TikTok description for a clip.
 *
 * The pin, a question, sometimes the CTA, then the tags. The HOOK is still not
 * repeated here — it is burned into the video, and printing it again spends the
 * description on something the viewer read two seconds ago.
 *
 * ORDER IS THE DECISION. The pin is first because it is the one thing the video
 * cannot say and the one thing somebody searching will match on. The question
 * sits above the CTA because a viewer who reads to the end of a caption should
 * hit the thing that costs them nothing before the thing that asks them to
 * leave. The tags are last, where they have always been.
 */
export function clipCaption(cand, opts) {
  const parts = [clipPlaceLine(cand), captionQuestion(opts), captionCta(opts)].filter(Boolean);
  const tags = clipHashtags(cand, opts).join(' ');
  return parts.length ? `${parts.join('\n\n')}\n\n${tags}` : tags;
}

/**
 * A plan's country, as a hashtag.
 *
 * The third source for the same slot, and the simplest of the three: a deck
 * derives its country from Wikidata P17, a clip from the vision judge's reading
 * of a frame, and a plan simply knows — its destination came out of
 * destinations.json, where the Hebrew country name is written down next to it.
 *
 * The CITY is the better tag when it differs, because a plan is about one city
 * and #רומא is what somebody planning Rome types. The country is the fallback
 * for the destinations that are one.
 */
export function planDestinationTag(plan) {
  const he = plan?.dest?.he || plan?.dest?.country || null;
  if (!he) return null;
  const word = String(he).replace(/\s+/g, '').replace(/[^\p{L}\p{N}׳״'"]/gu, '');
  return word.length >= 2 ? `#${word}` : null;
}

/** The five tags under a plan. Same count, same split, third source for the slot. */
export function planHashtags(plan, { rand = Math.random } = {}) {
  const cfg = postConfig().hashtags;
  const taken = new Set();

  const broad = draw(cfg.broad, cfg.broadCount, taken, rand);

  const niche = [];
  const dest = cfg.useDestination ? planDestinationTag(plan) : null;
  if (dest) {
    taken.add(dest);
    niche.push(dest);
  }
  niche.push(...draw(cfg.niche, cfg.nicheCount - niche.length, taken, rand));

  return [...broad, ...niche];
}

/**
 * The description under an AI-itinerary slideshow.
 *
 * ONE ASK PER POST, and that is the rule this function exists to hold. The
 * giveaway is already the ask — follow, comment a word, five of you get a month
 * — and appending "the link is in the bio" underneath it turns a post that
 * wants a comment into a post that wants two different things. The bio CTA is
 * therefore drawn ONLY when the giveaway is off, which is also the case where
 * the post would otherwise ask for nothing at all.
 *
 * The question survives alongside the giveaway, because it is not an ask. It is
 * what a comment can be an answer to, and the giveaway's keyword gives somebody
 * a reason to be in the comments in the first place.
 *
 * `titled` is for Instagram, which has no title field on a carousel: its
 * caption has to open with the hook or the post has none. TikTok carries the
 * title separately, so repeating it there would spend the first line on
 * something already on screen — the same split a deck's two captions make.
 */
export function planCaption(plan, { text, giveaway = null, titled = false, ...opts } = {}) {
  const parts = [
    titled ? text.hookHe : null,
    `📍 ${plan.dest.he}${plan.dest.country && plan.dest.country !== plan.dest.he ? `, ${plan.dest.country}` : ''} · ${plan.days.length} ימים`,
    captionQuestion(opts),
    giveaway?.captionHe || null,
    giveaway ? null : captionCta(opts),
  ].filter(Boolean);
  const tags = planHashtags(plan, opts).join(' ');
  return `${parts.join('\n\n')}\n\n${tags}`;
}
