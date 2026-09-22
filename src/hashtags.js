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
 * Where the clip is, for the first line of the description.
 *
 * Place then country, which is the order the deck slides already use
 * ("סקוגאפוס, איסלנד") and the order every map label in the world uses:
 * specific first, general second.
 *
 * The site stays in Latin rather than being transliterated. It is a proper
 * noun, it is what a viewer would type into a search box, and transliterating
 * it would cost a model call per clip to produce a spelling nobody has agreed
 * on — "לאוטרברונן" is one of several defensible answers and none of them is
 * what the place calls itself. The country is Hebrew because that one HAS an
 * agreed spelling, and it is the word an Israeli audience reads.
 *
 * Returns null when the country was not established. A pin with nothing after
 * it is worse than no pin.
 */
export function clipPlaceLine(cand) {
  const v = cand?.clip?.vision || cand?.vision || null;
  if (!v?.place) return null;
  const countryHe = postConfig().places[String(v.place).toLowerCase()];
  if (!countryHe) return null;
  // The first segment only. The schema asks for the bare name, and the judge
  // still returns "Cinque Torri, Dolomites" often enough to matter — which
  // renders as "📍 Cinque Torri, Dolomites, איטליה", a pin with two commas and
  // a region nobody asked for. Trimming here rather than trusting the prompt,
  // because a prompt is a request and this is the line that publishes.
  const site = String(v.site || '').split(',')[0].trim();
  return site ? `📍 ${site}, ${countryHe}` : `📍 ${countryHe}`;
}

/**
 * The whole TikTok description for a clip.
 *
 * A pin line and the tags. The HOOK is not repeated here — it is burned into
 * the video, and printing it again spends the description on something the
 * viewer read two seconds ago. What the description adds is the one thing the
 * video cannot say: where this is.
 */
export function clipCaption(cand, opts) {
  const place = clipPlaceLine(cand);
  const tags = clipHashtags(cand, opts).join(' ');
  return place ? `${place}

${tags}` : tags;
}
