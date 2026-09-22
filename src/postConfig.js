import { readFileSync } from 'node:fs';

// post-config.json, read once and checked on the way in.
//
// The file holds the editorial decisions that get changed after looking at a
// week of numbers — the caption pool, the hashtag mix, how big the type is on a
// slide, which countries the pipeline leans toward. None of it is structural,
// all of it is the sort of thing you want to edit without opening a module.
//
// Read the way sources.json and destinations.json are read: synchronously, on
// first use, cached for the life of the process, and THROWING when the file is
// unusable. That last part is deliberate. A silent fallback would publish a
// post with no hashtags and no caption line, which looks exactly like a post
// that was never configured to have any — and the whole point of moving these
// out of the code was to make them visible.

let cached = null;

/** Everything in post-config.json, validated. Throws once, loudly, if it can't. */
export function postConfig() {
  if (cached) return cached;

  let raw;
  try {
    raw = JSON.parse(readFileSync(new URL('../post-config.json', import.meta.url), 'utf8'));
  } catch (e) {
    throw new Error(`post-config.json could not be read: ${e.message}`);
  }

  const caption = raw.caption || {};
  const hashtags = raw.hashtags || {};
  const overlay = raw.overlay || {};
  const destinations = raw.destinations || {};

  const lines = (caption.lines || []).map((s) => String(s).trim()).filter(Boolean);
  if (!lines.length) throw new Error('post-config.json: caption.lines is empty — every post needs an opening line');

  const broad = tags(hashtags.broad, 'hashtags.broad');
  const niche = tags(hashtags.niche, 'hashtags.niche');
  const broadCount = count(hashtags.broadCount, 2);
  const nicheCount = count(hashtags.nicheCount, 3);
  if (broad.length < broadCount) throw new Error(`post-config.json: hashtags.broad has ${broad.length} tags, needs ${broadCount}`);
  if (niche.length < nicheCount) throw new Error(`post-config.json: hashtags.niche has ${niche.length} tags, needs ${nicheCount}`);

  cached = {
    caption: { lines },
    hashtags: {
      broad,
      niche,
      broadCount,
      nicheCount,
      // One of the niche slots is spent on the deck's own country rather than
      // added as a sixth tag — see the note in the file.
      useDestination: hashtags.useDestination !== false,
    },
    overlay: {
      sizePct: num(overlay.sizePct, 0.03),
      sizeBasis: overlay.sizeBasis === 'height' ? 'height' : 'width',
      coverSizePct: num(overlay.coverSizePct, 0.034),
      weight: num(overlay.weight, 400),
      opacity: num(overlay.opacity, 0.9),
      shadow: String(overlay.shadow || '0 1px 3px rgba(0,0,0,0.38)'),
      maxLines: Math.max(1, Math.round(num(overlay.maxLines, 2))),
      align: overlay.align === 'right' ? 'right' : 'left',
      x: num(overlay.x, 0.3),
      width: num(overlay.width, 0.44),
      bands: {
        upper: band(overlay.bands?.upper, [0.2, 0.36]),
        lower: band(overlay.bands?.lower, [0.6, 0.78]),
      },
      assist: overlay.assist !== false,
      // How far each of the above may rise when the photograph refuses to
      // carry them. See the note in post-config.json — these are what make the
      // values a floor rather than a constant.
      adapt: {
        weightBoost: num(overlay.adapt?.weightBoost, 200),
        opacityCeiling: num(overlay.adapt?.opacityCeiling, 1),
        shadowBoost: overlay.adapt?.shadowBoost !== false,
      },
    },
    destinations: {
      defaultWeight: num(destinations.defaultWeight, 1),
      weights: { ...(destinations.weights || {}) },
    },
    clips: clips(raw.clips || {}),
    // English country name from the vision judge -> Hebrew, for the place
    // formats. Keyed on free text a model produced, which is why it is separate
    // from deck/flags.js and why a miss simply withdraws those formats.
    places: Object.fromEntries(
      Object.entries(raw.clips?.places || {})
        .filter(([k]) => k !== '_comment')
        .map(([k, v]) => [k.toLowerCase(), String(v)])
    ),
  };

  return cached;
}

/**
 * The clip format's settings.
 *
 * Validated the same way as the rest and for the same reason, with one extra
 * check: an empty hook pool is fatal. A clip with no line on it is a stock
 * video, and a stock video posted bare is the most anonymous thing this account
 * could publish.
 */
function clips(raw) {
  // The fallback pool. Lines are normally written per clip by video/hooks.js;
  // this is what a failed API call degrades to, and it must not be empty,
  // because a clip with no line on it is just a stock video.
  const hooks = ((raw.hooks || {}).lines || []).map((s) => String(s).trim()).filter(Boolean);
  if (!hooks.length) throw new Error('post-config.json: clips.hooks.lines is empty — a clip is its line');

  const s = raw.search || {};
  const v = raw.video || {};
  const o = raw.overlay || {};
  const words = (list) =>
    (Array.isArray(list) ? list : []).map((w) => String(w).trim().toLowerCase()).filter(Boolean);

  const queries = (s.queries || []).map((q) => String(q).trim()).filter(Boolean);
  if (!queries.length) throw new Error('post-config.json: clips.search.queries is empty — nothing to pull');

  const colours = (o.colors || [])
    .map((c) => ({
      name: String(c.name || 'ink'),
      fill: String(c.fill || '#FFFFFF'),
      stroke: String(c.stroke || 'rgba(0,0,0,0.55)'),
      // Cream has almost the same luminance as a bright sky, so it is offered
      // over a dark frame only — the same rule the deck applies to its accent.
      onDarkOnly: c.onDarkOnly === true,
    }))
    .filter((c) => /^#|rgb/.test(c.fill));
  if (!colours.length) colours.push({ name: 'white', fill: '#FFFFFF', stroke: 'rgba(0,0,0,0.55)', onDarkOnly: false });

  // The sentence formats the hook writer fills. Each is a recognizable meme
  // template — the writer's job is filling one, never free composition.
  const formats = (Array.isArray((raw.hooks || {}).formats) ? raw.hooks.formats : [])
    .map((f) => ({
      id: String(f.id || '').trim(),
      he: String(f.he || '').trim(),
      desc: String(f.desc || '').trim(),
      // How often this format is offered relative to the others. The owner
      // graded the shapes good/fine, and the grade is a weight, not a cut.
      weight: Math.max(1, Math.round(num(f.weight, 1))),
      // Only offered when the vision judge named a country it was sure of.
      // Without this a clip of an unidentifiable forest gets "יוון אחי, יוון"
      // and the account states something it cannot know.
      needsPlace: f.needsPlace === true,
      // Exempt from the first/second-person guard. Only for shapes that are
      // BUILT from pronouns — see the note at reject() in video/hooks.js.
      allowsPerson: f.allowsPerson === true,
      // Shortest acceptable line for this shape. The place formats are three
      // and four words by design.
      minWords: f.minWords === undefined ? undefined : Math.max(2, Math.round(num(f.minWords, 5))),
      examples: (Array.isArray(f.examples) ? f.examples : []).map((e) => String(e).trim()).filter(Boolean),
    }))
    .filter((f) => f.id && f.desc);

  return {
    hooks,
    hooksMaxWords: Math.max(3, Math.round(num((raw.hooks || {}).maxWords, 12))),
    formats,
    search: {
      queries,
      prefer: words(s.prefer),
      reject: words(s.reject),
      spectator: words(s.spectator),
      spectatorPenalty: num(s.spectatorPenalty, 5),
      povBonus: num(s.povBonus, 5),
      // Specific Pexels ids the owner has rejected by eye. A veto, like the
      // reject words — a clip that was already turned down must never come
      // back however well it scores.
      denyIds: (Array.isArray(s.denyIds) ? s.denyIds : []).map((n) => String(n)),
      minScore: num(s.minScore, 3),
      // The vision judge, which is now the real filter — see src/video/vision.js.
      // The title words above survive as a free pre-filter that throws out the
      // obvious before anything is paid for.
      visionMinDestination: num(s.visionMinDestination, 7),
      // How sure the judge must be before a place NAME is printed on a post.
      // A separate, higher bar than the selection score: everything else only
      // decides whether a clip is used, this one becomes a factual claim.
      placeMinConfidence: num(s.placeMinConfidence, 7),
      visionMaxCandidates: Math.max(1, Math.round(num(s.visionMaxCandidates, 24))),
      preferPov: s.preferPov !== false,
      rejectStaged: s.rejectStaged !== false,
      rejectAerialOnly: s.rejectAerialOnly === true,
      minHeight: num(s.minHeight, 1600),
      minDuration: num(s.minDuration, 5),
      maxDuration: num(s.maxDuration, 30),
    },
    video: {
      width: Math.round(num(v.width, 1080)),
      height: Math.round(num(v.height, 1920)),
      seconds: num(v.seconds, 8),
      startAt: Math.max(0, num(v.startAt, 0.6)),
      fps: Math.round(num(v.fps, 30)),
      crf: Math.round(num(v.crf, 21)),
      preset: String(v.preset || 'medium'),
      keepAudio: v.keepAudio === true,
    },
    overlay: {
      sizePct: num(o.sizePct, 0.052),
      sizeBasis: o.sizeBasis === 'height' ? 'height' : 'width',
      weight: num(o.weight, 700),
      opacity: num(o.opacity, 1),
      shadow: String(o.shadow || '0 2px 12px rgba(0,0,0,0.5)'),
      // A stroke, unlike on a deck slide where it is banned as the burned-in
      // look. Here it IS the native look: it is what TikTok's own text tool
      // produces and what every Hebrew reference post uses.
      strokePct: num(o.strokePct, 0.055),
      // How much thicker the stroke gets when the frame will not carry the ink
      // on its own. The palette is yellow by request, and yellow over a bright
      // cloud is only legible because of what is behind the letterform — so
      // the stroke adapts where a deck slide would have flipped to near-black.
      strokeBoost: num(o.strokeBoost, 0.06),
      maxLines: Math.max(1, Math.round(num(o.maxLines, 3))),
      align: ['left', 'right', 'center'].includes(o.align) ? o.align : 'center',
      x: num(o.x, 0.5),
      // The columns the placement search may choose between. Three, so the
      // line can go in whichever corner of the sky is empty — see place() in
      // render/photo.js.
      xs: (Array.isArray(o.xs) ? o.xs : [0.28, 0.5, 0.72]).map(Number).filter(Number.isFinite),
      // Above this measured luminance the line flips to near-black. High on
      // purpose: stroked cream survives a blue sky, and flipping it early is
      // what put dark type on Lauterbrunnen.
      flipToDarkAbove: num(o.flipToDarkAbove, 0.62),
      width: num(o.width, 0.72),
      bands: {
        upper: band(o.bands?.upper, [0.2, 0.3]),
        mid: band(o.bands?.mid, [0.36, 0.46]),
      },
      // Charge the placement search for crossing a horizon — see place() in
      // render/photo.js.
      seamPenalty: o.seamPenalty !== false,
      colors: colours,
    },
  };
}

/** One hook line for one clip. */
export const clipHook = ({ rand = Math.random } = {}) => {
  const { hooks } = postConfig().clips;
  return hooks[Math.floor(rand() * hooks.length)];
};

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const count = (v, fallback) => Math.max(0, Math.round(num(v, fallback)));

/** A vertical band as [top, bottom] in frame fractions, or the default. */
function band(v, fallback) {
  if (!Array.isArray(v) || v.length !== 2) return fallback;
  const [a, b] = v.map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : fallback;
}

/**
 * A hashtag pool, normalised.
 *
 * The leading # is added here rather than required in the file, so an entry
 * written either way works and no post ever goes out with "fyp" as a word.
 */
function tags(list, where) {
  if (!Array.isArray(list)) throw new Error(`post-config.json: ${where} must be an array`);
  const out = [];
  for (const t of list) {
    const clean = String(t || '').trim().replace(/^#+/, '');
    if (!clean) continue;
    const tag = `#${clean.replace(/\s+/g, '')}`;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * How strongly this pipeline should prefer a destination.
 *
 * Keyed on the Hebrew country name, which is what destinations.json carries.
 * An unlisted country gets the default rather than zero — the weights say what
 * to lead with, not what is allowed.
 */
export function destinationWeight(dest) {
  const { defaultWeight, weights } = postConfig().destinations;
  const country = String(dest?.country || '').trim();
  return num(weights[country], defaultWeight);
}

/**
 * The same destinations, heaviest first, ties left exactly as they arrived.
 *
 * A stable sort rather than a weighted shuffle, and that is the right tool
 * here: both callers already have an ordering they want preserved inside a
 * tier — the climate adapter's day-of-year rotation, the idea generator's file
 * order — and randomising it would throw away the thing that stops the same
 * city coming up every day.
 */
export const byWeight = (dests) =>
  [...(dests || [])]
    .map((d, i) => ({ d, i, w: destinationWeight(d) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.d);

/** For tests: forget the parsed file so the next call re-reads it. */
export const __reset = () => {
  cached = null;
};
