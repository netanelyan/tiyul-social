import { readFileSync } from 'node:fs';
import { URL_LIKE } from './urlLike.js';

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

  // The Israeli angle pool. It used to live under `shoot.angles` and be folded in
  // from there; the shoot format is gone and so is that fallback.
  const angles = list(raw.angles);
  const destinations = raw.destinations || {};

  const lines = (caption.lines || []).map((s) => String(s).trim()).filter(Boolean);
  if (!lines.length) throw new Error('post-config.json: caption.lines is empty - every post needs an opening line');

  // The brief's caption shape: one short line plus a question, and a soft CTA
  // at the end of some of them. Both are optional in the file and absent means
  // off — a caption pool with no questions in it is the old behaviour and is a
  // perfectly valid thing to go back to.
  const questions = (caption.questions || []).map((s) => String(s).trim()).filter(Boolean);

  // A POOL of closing asks, not one line.
  //
  // It was one string, `caption.cta`, and one string is a signature however
  // soft the wording is: twenty posts carrying the identical last line is the
  // template this pool already replaced once for `lines`. The singular key is
  // still read and folded in, so an existing post-config.json keeps working.
  //
  // What changed alongside the shape is what the asks SAY. The single CTA
  // pointed at the bio, which is the only tappable route either platform
  // offers and is therefore worth keeping in the mix, but a pointer to a link
  // is not the ask that grows an account. A viewer who answers a question has
  // engaged; a viewer who follows comes back. So the pool leans on asks that
  // name the next thing to do here, and the bio pointer is one entry in it
  // rather than the whole of it.
  const ctas = [...(caption.ctas || []), caption.cta]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  // Checked HERE rather than at build time. A CTA with a domain in it would
  // otherwise throw once per post, from assertNoUrl, deep inside a build — and
  // the thing that is actually broken is this file.
  // The two site asks are checked with them. They are the likeliest strings in
  // the whole file to be given an address, because they are the only ones
  // whose subject IS a web page.
  for (const c of [...ctas, caption.siteCtaBioHe, caption.siteCtaDmHe].filter(Boolean)) {
    if (URL_LIKE.test(String(c))) {
      throw new Error(
        `post-config.json: caption ask "${c}" contains a URL - the link lives in the bio, the caption says so in words`
      );
    }
  }

  // THE REASON TO FOLLOW, WHICH EVERY POST CARRIES.
  //
  // Not a share and not a pool of one. `ctas` is drawn on `ctaShare` of posts
  // because an ask that arrives every time reads as an advertisement; the
  // owner's instruction here is the opposite and is about a different line -
  // every post closes with a reason to follow, and on anything with slides or
  // frames the same reason is also the last thing on screen.
  //
  // Two fields per entry, because the closing SLIDE needs them apart: the ask
  // is the big line and the reason is the note under it. See askSlide in
  // src/plan/slides.js, which is where that split was argued out, and
  // followSlideFor in src/render/deck.js, which draws this one.
  //
  // Thrown on when empty, like caption.lines. An empty pool would silently
  // remove a line the owner asked for from every post this pipeline makes,
  // which is the failure mode this file's own header warns about: a post with
  // nothing on it looks exactly like a post that was meant to be that way.
  const follows = (caption.follows || [])
    .map((f) => ({
      askHe: String(f?.askHe || '').trim(),
      whyHe: String(f?.whyHe || '').trim(),
    }))
    .filter((f) => f.askHe && f.whyHe)
    .map((f) => ({ ...f, lineHe: `${f.whyHe}. ${f.askHe}` }));
  if (!follows.length) {
    throw new Error(
      'post-config.json: caption.follows is empty - every post has to carry a reason to follow, and each entry needs both askHe and whyHe'
    );
  }
  // Checked here for the same reason the asks are: a domain typed into a follow
  // line would otherwise throw once per post from inside a build, and the thing
  // that is broken is this file.
  for (const f of follows) {
    if (URL_LIKE.test(f.lineHe)) {
      throw new Error(
        `post-config.json: follow reason "${f.lineHe}" contains a URL - the link lives in the bio, the caption says so in words`
      );
    }
  }

  const broad = tags(hashtags.broad, 'hashtags.broad');
  const niche = tags(hashtags.niche, 'hashtags.niche');
  const broadCount = count(hashtags.broadCount, 2);
  const nicheCount = count(hashtags.nicheCount, 3);
  if (broad.length < broadCount) throw new Error(`post-config.json: hashtags.broad has ${broad.length} tags, needs ${broadCount}`);
  if (niche.length < nicheCount) throw new Error(`post-config.json: hashtags.niche has ${niche.length} tags, needs ${nicheCount}`);

  cached = {
    caption: {
      lines,
      questions,
      ctas,
      follows,
      // Kept so anything still reading the singular key sees the first ask
      // rather than undefined. Nothing in src/ reads it now.
      cta: ctas[0] || '',
      // How often an ask is appended. Clamped rather than trusted: a share
      // above 1 is an ask on every post, which the brief calls the opposite of
      // soft, and a negative one silently turns the feature off.
      ctaShare: Math.max(0, Math.min(1, num(caption.ctaShare, 0))),
      // The two asks used INSTEAD of the pool when the post is about a
      // destination the site has a page for. Not gated by ctaShare: the share
      // exists so a generic ask does not appear on every post and read as a
      // signature, and these are not generic. See the comment beside them in
      // post-config.json.
      siteCtaBioHe: String(caption.siteCtaBioHe || 'המסלול המלא ל{dest}, עם מפה, בלינק בביו'),
      siteCtaDmHe: String(caption.siteCtaDmHe || 'תגיבו "{dest}" ונשלח לכם את המסלול המלא בהודעה'),
    },
    hashtags: {
      broad,
      niche,
      broadCount,
      nicheCount,
      // One of the niche slots is spent on the deck's own country rather than
      // added as a sixth tag — see the note in the file.
      useDestination: hashtags.useDestination !== false,
      // The account's own tag, and the one place a Latin word is allowed in a
      // Hebrew caption: it is a handle rather than a word. Normalised through
      // `tags` like every other pool so "TiyulPlus" and "#TiyulPlus" both work,
      // and null when the file does not declare one.
      brand: tags([hashtags.brand], 'hashtags.brand')[0] || null,
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
    // THE ISRAELI ANGLE, top level, because more than one kind draws on it. See
    // src/angles.js for what an angle may and may not do once a pipeline has one,
    // which is the part that matters.
    angles,
    clips: clips(raw.clips || {}),
    // The hidden gems reel. Its own block rather than a fifth clip shape under
    // `clips`, because `clips` is the configuration of ONE renderer and three
    // shapes of it; this is a format with its own length, its own caption rules
    // and its own hook menu, and the hook menu is shared with the post types.
    gems: gems(raw.gems || {}),
    // How often each format is built, which is a different question from how any
    // one of them is built. See _formats_comment in post-config.json.
    formats: formats(raw.formats || {}),
    plans: plans(raw.plans || {}),
    // The five post types, their looks, their frames and their hook shapes. The
    // block that decides what this account actually posts, which is why the
    // evidence for every weight in it is written beside it in the file.
    posts: posts(raw.posts || {}),
    igReplies: igReplies(raw.igReplies || {}),
    schedule: schedule(raw.schedule || {}),
    // English country name from the vision judge -> Hebrew, for the place
    // formats. Keyed on free text a model produced, which is why it is separate
    // from deck/flags.js and why a miss simply withdraws those formats.
    places: Object.fromEntries(
      Object.entries(raw.clips?.places || {})
        .filter(([k]) => k !== '_comment')
        .map(([k, v]) => [k.toLowerCase(), String(v)])
    ),
    // The owner's own Hebrew spelling for a named site, overriding whatever the
    // vision judge transliterated. Needed because a transliteration is a
    // judgement call — "לאוטרברונן" and "לאוטרברונן" and "לאוטרבורנן" are all
    // defensible — and the same valley spelled three ways across three posts
    // reads worse than any one of them. This file is never expected to be
    // complete: a site missing here uses the judge's spelling.
    sites: Object.fromEntries(
      Object.entries(raw.clips?.sites || {})
        .filter(([k]) => k !== '_comment')
        .map(([k, v]) => [k.toLowerCase(), String(v)])
    ),
  };

  return cached;
}

/**
 * The music bed's mix, not which tracks exist.
 *
 * Which tracks exist is assets/audio/tracks.json, because that is a licensing
 * question and it belongs next to the files rather than in the block of numbers
 * that gets retuned after a week of watching. This is only how loud, how it
 * enters and leaves, and how far into it a clip may start.
 *
 * `volume` is clamped to 2 rather than to 1: going above unity is a legitimate
 * thing to want from a quiet source file, and the ceiling exists only so a typo
 * of 35 for 0.35 cannot ship a clip that clips.
 */
function audioConfig(raw) {
  return {
    on: raw.on !== false,
    volume: Math.max(0, Math.min(2, num(raw.volume, 0.35))),
    fadeInSeconds: Math.max(0, num(raw.fadeInSeconds, 0.4)),
    fadeOutSeconds: Math.max(0, num(raw.fadeOutSeconds, 0.8)),
    maxOffsetSeconds: Math.max(0, Math.round(num(raw.maxOffsetSeconds, 45))),
    bitrate: String(raw.bitrate || '128k'),
  };
}

/**
 * The second clip shape: several shots, cut, a line on each.
 *
 * `cutsMin` is floored at 2 rather than at whatever is configured, because one
 * cut is not a cut, it is a held clip with a different code path, and the
 * renderer refuses it. The ceiling is floored at the minimum for the same
 * reason a range always is: a max below the min is a config that asks for an
 * empty set and would otherwise surface as "no clips found".
 */
function cutsConfig(raw) {
  const cutsMin = Math.max(2, Math.round(num(raw.cutsMin, 4)));
  const cutsMax = Math.max(cutsMin, Math.round(num(raw.cutsMax, 5)));

  const hookFormats = (Array.isArray(raw.hookFormats) ? raw.hookFormats : [])
    .map((f) => ({
      id: String(f.id || '').trim(),
      he: String(f.he || '').trim(),
      desc: String(f.desc || '').trim(),
      weight: Math.max(1, Math.round(num(f.weight, 1))),
      minWords: f.minWords === undefined ? undefined : Math.max(2, Math.round(num(f.minWords, 3))),
      // Only offered when every shot turned out to be in the same country, which
      // is the only case where the writer is allowed to name one. On a mixed cut
      // the user turn forbids naming a country at all, so a format built around
      // the name is a candidate spent on a line that cannot be written - the
      // same withdrawal `needsPlace` performs for the held clip's formats.
      needsCountry: f.needsCountry === true,
    }))
    .filter((f) => f.id && f.desc);

  // Fatal only when the shape is ON. A cut with no hook format has nothing to
  // fill and would fall through to a video whose first line is a place name,
  // which is a deck slide that moves rather than a post with an opening.
  const on = raw.on !== false;
  if (on && !hookFormats.length) {
    throw new Error('post-config.json: clips.cuts.on is true but clips.cuts.hookFormats is empty');
  }

  const secondsPerCut = Math.max(2, num(raw.secondsPerCut, 4));

  return {
    on,
    cutsMin,
    cutsMax,
    secondsPerCut,
    // How long the OPENING cut is held, which is the one cut carrying no place.
    //
    // Its own number because it is doing a different job. Every other cut has to
    // be long enough to read a name and watch the shot move; this one has to be
    // long enough to read the hook and no longer, and four seconds of a line the
    // viewer finished in one is a quarter of the video spent on a title card.
    // The owner's note on the first cuts video was "hook is too long".
    //
    // Floored at 1.5 rather than at secondsPerCut's 2, because shorter is the
    // direction this dial is for and a hook can legitimately be a flash.
    hookSeconds: Math.max(1.5, num(raw.hookSeconds, 3)),
    hookMaxWords: Math.max(3, Math.round(num(raw.hookMaxWords, 6))),
    // Whether a cut's label must be a specific place rather than a country. See
    // pickCuts: on is the owner's rule, off is the escape hatch for a day when
    // the judge named no sites at all and a country list beats no post.
    labelNeedsSite: raw.labelNeedsSite !== false,
    hookFormats,
  };
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
  if (!hooks.length) throw new Error('post-config.json: clips.hooks.lines is empty - a clip is its line');

  const s = raw.search || {};
  const v = raw.video || {};
  const o = raw.overlay || {};
  const words = (list) =>
    (Array.isArray(list) ? list : []).map((w) => String(w).trim().toLowerCase()).filter(Boolean);

  const queries = (s.queries || []).map((q) => String(q).trim()).filter(Boolean);
  if (!queries.length) throw new Error('post-config.json: clips.search.queries is empty - nothing to pull');

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
      // Which of the brief's five shapes this is (BRIEF.md, rule 5). Carried so
      // the rotation can refuse to offer the same shape twice in a row — two
      // different ids that are both shape A are still the same video twice.
      shape: String(f.shape || '').trim().toUpperCase() || null,
      // Whether this shape may carry a price. The fare guard is off globally
      // now, so this is no longer a gate — it is what tells the writer that a
      // number in shekels is the POINT of this format rather than something it
      // is merely permitted to mention.
      allowsPrice: f.allowsPrice === true,
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

  const h = raw.hooks || {};

  return {
    hooks,
    hooksMaxWords: Math.max(3, Math.round(num(h.maxWords, 9))),
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
      // HOW MANY PAGES OF EACH SEARCH TO READ. Four, up from the two that were
      // hardcoded, because the pool ran dry: see the note in findClips. Each page is
      // 24 results and costs one request, so this is the cheapest lever here - no
      // vision calls, no editorial judgement, just reading further down a list the
      // account was already searching.
      pages: Math.max(1, Math.round(num(s.pages, 4))),
      // How tall a frame the judge is sent, which is the largest single number
      // in this pipeline's bill. Measured rather than chosen: the 1200px poster
      // Pexels hands back is 1,008 image tokens and 640 is 287, across the cap
      // that is the difference between 28 cents a run and 8. The verdicts were
      // compared at both and at 448 - see the note at the top of
      // src/video/vision.js for what moved and what did not.
      //
      // Floored at 240 rather than trusted. A number small enough to make the
      // frame unreadable would not fail, it would return confident nonsense
      // about a picture nobody could see, which is the worst shape a saving
      // can take.
      visionThumbHeight: Math.max(240, Math.round(num(s.visionThumbHeight, 640))),
      preferPov: s.preferPov !== false,
      rejectStaged: s.rejectStaged !== false,
      // A person filmed in front of the place, prohibited by the owner. On
      // unless it is explicitly switched off, like rejectStaged and for a
      // stronger reason: this one is a rule rather than a preference, and a
      // missing key must not quietly re-admit it.
      rejectPersonSubject: s.rejectPersonSubject !== false,
      rejectAerialOnly: s.rejectAerialOnly === true,
      // What a drone shot costs when it is not vetoed outright. Large enough
      // that it cannot outrank anything shot on the ground — see rankVision.
      aerialPenalty: num(s.aerialPenalty, 4),
      minHeight: num(s.minHeight, 1600),
      minDuration: num(s.minDuration, 5),
      maxDuration: num(s.maxDuration, 30),
    },
    video: {
      width: Math.round(num(v.width, 1080)),
      height: Math.round(num(v.height, 1920)),
      // How long the finished clip is, start to finish. One number again: the
      // whole video carries one line, so there is nothing to compute it from.
      seconds: num(v.seconds, 8),
      // Repeat the source until the requested length is filled. Off means a
      // short source is simply trimmed to what it has, which on a five-second
      // Pexels clip ships three seconds under length.
      loopSource: v.loopSource !== false,
      startAt: Math.max(0, num(v.startAt, 0.6)),
      fps: Math.round(num(v.fps, 30)),
      crf: Math.round(num(v.crf, 21)),
      preset: String(v.preset || 'medium'),
      keepAudio: v.keepAudio === true,
    },
    audio: audioConfig(raw.audio || {}),
    cuts: cutsConfig(raw.cuts || {}),
    // THE THIRD SHAPE: many shots of ONE place, one line that never changes.
    //
    // Modelled on a reference the owner supplied, and it is the two existing
    // shapes' halves swapped. `held` holds its line over a shot that never
    // moves; `cuts` moves but rewrites the line on every cut. This moves and
    // holds one line, which is what the owner asked for twice - once as "the
    // text should not change" and once as "lots of clips changing each 1-2s
    // with 1 static text".
    //
    // A SECOND AND A HALF, which is the number that makes it a montage rather
    // than a slow list. At four seconds a shot the viewer starts reading each
    // frame as a separate statement, which is exactly right when each one
    // carries its own label and exactly wrong when they are all the same place.
    //
    // TWELVE SHOTS AT 1.5s IS EIGHTEEN SECONDS, inside the brief's 15 to 35,
    // and reached from the opposite end to the way the beats once reached it:
    // the length comes from how much footage of one place the search found,
    // not from how many things the line promised.
    //
    // cutsMin is 6 rather than the cuts shape's 4. Four shots at a second and a
    // half is a six-second video, which is a held clip with a stutter in it.
    montage: {
      on: (raw.montage || {}).on !== false,
      cutsMin: Math.max(2, Math.round(num((raw.montage || {}).cutsMin, 6))),
      cutsMax: Math.max(2, Math.round(num((raw.montage || {}).cutsMax, 12))),
      secondsPerCut: Math.max(0.5, num((raw.montage || {}).secondsPerCut, 1.5)),
    },
    // THE CLOSING FRAME: the reason to follow, at the end of a CUTS clip.
    //
    // The owner's instruction is that a post ends on one. A slideshow ends on a
    // slide (src/deck/follow.js); a video has no slides, so it ends on its last
    // seconds carrying the line instead.
    //
    // A CUTS CLIP ONLY, AND THIS SETTING NO LONGER REACHES THE HELD SHAPE.
    //
    // It did, and the owner's instruction is that it must not: a clip built
    // from one unbroken shot keeps one line from the first frame to the last,
    // even at a cost in follows. On a cuts clip the closing line arrives with
    // new footage under it, which is the condition the whole shape is built on
    // and the reason the same frame is right there and wrong here. The full
    // argument is above burnClip in src/video/overlay.js.
    //
    // So this is the dial for the cuts shape. The held shape has no dial,
    // because "sometimes the text changes" is the thing being ruled out rather
    // than a setting. The description still carries its reason to follow on
    // both - that one is not optional.
    //
    // TWO SECONDS, and the number is doing the same job hookSeconds does at the
    // other end: long enough to read one short line, short enough that nothing
    // is held after it has been understood.
    follow: {
      on: (raw.follow || {}).on !== false,
      seconds: Math.max(0.8, num((raw.follow || {}).seconds, 2)),
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


/**
 * The AI-itinerary slideshow's settings.
 *
 * Two of these are load-bearing rather than editorial, and both are about a
 * promise being kept.
 *
 * `giveaway.on` is a promise to strangers: the post says five commenters get a
 * month of premium, and nothing in this program can deliver that. Off means the
 * ask is not written at all — which is the correct way to stop making it, and
 * the reason it is a switch rather than an empty string somewhere.
 *
 * `stopsMax` is a layout constraint pretending to be taste. Past four stops the
 * day slide stops being readable at the size it is actually seen, and an
 * itinerary nobody can read at a glance is a screenshot of a spreadsheet.
 */
function plans(raw) {
  const g = raw.giveaway || {};
  const daysMin = Math.max(1, Math.round(num(raw.daysMin, 3)));
  const daysMax = Math.max(daysMin, Math.round(num(raw.daysMax, 5)));
  const stopsMin = Math.max(1, Math.round(num(raw.stopsMin, 3)));
  const stopsMax = Math.max(stopsMin, Math.round(num(raw.stopsMax, 4)));

  // Checked here, like caption.cta, so a domain typed into the ask fails once
  // at startup instead of once per post from inside a build. Every string in
  // this block can reach a published caption or a rendered slide.
  //
  // `sitePage.*` is in the list for the same reason the hooks are: it is drawn
  // onto the last slide of a published slideshow, and the whole point of that
  // slide is to be about a website, which is exactly the sentence somebody
  // would be tempted to put an address into.
  for (const [where, s] of [
    ['giveaway.captionHe', g.captionHe],
    ['giveaway.actionHe', g.actionHe],
    ['giveaway.prizeHe', g.prizeHe],
    ['giveaway.titleHe', g.titleHe],
    ['hookHe', raw.hookHe],
    ['hookSiteHe', raw.hookSiteHe],
    ['sitePage.titleHe', raw.sitePage?.titleHe],
    ['sitePage.noteHe', raw.sitePage?.noteHe],
    ['sitePage.ctaBioHe', raw.sitePage?.ctaBioHe],
    ['sitePage.ctaDmHe', raw.sitePage?.ctaDmHe],
    ['hookBudgetHe', raw.hookBudgetHe],
    ['breakdownLabelHe', raw.breakdownLabelHe],
    ['leftHe', raw.leftHe],
    ['totalNoteBudgetHe', raw.totalNoteBudgetHe],
    ['askHe', raw.askHe],
  ]) {
    if (s && URL_LIKE.test(String(s))) {
      throw new Error(`post-config.json: plans.${where} contains a URL - the link lives in the bio, the post says so in words`);
    }
  }

  return {
    // Clamped into its own range, so a config edit cannot ask for a nine-day
    // itinerary that the writer would produce and the carousel could not hold:
    // Instagram takes ten images and a nine-day plan is eleven slides.
    days: Math.min(daysMax, Math.max(daysMin, Math.round(num(raw.days, 4)))),
    daysMin,
    daysMax,
    stopsMin,
    stopsMax,
    currencyHe: String(raw.currencyHe || '₪'),
    askHe: String(raw.askHe || 'תכנן לי {days} ימים ב{dest}'),
    askWhoHe: String(raw.askWhoHe || 'הבקשה שלי'),
    hookHe: String(raw.hookHe || 'ביקשתי מ-AI לתכנן {days} ימים ב{dest}'),
    hookSubHe: String(raw.hookSubHe || 'זה מה שהוא נתן לי'),
    dayLabelHe: String(raw.dayLabelHe || 'יום {n}'),
    totalLabelHe: String(raw.totalLabelHe || 'הכל ביחד'),
    perPersonHe: String(raw.perPersonHe || 'לאדם'),
    // What the total on the slide actually covers. Defaulted rather than
    // optional: the sum is stop prices only, and a four-figure number under
    // "4 ימים ברומא" with nothing qualifying it reads as the price of the trip.
    totalNoteHe: String(
      raw.totalNoteHe === undefined ? 'כניסות ואטרקציות בלבד - בלי טיסה ולינה' : raw.totalNoteHe
    ).trim(),
    // The budgeted variant's own strings. Separate from the four above rather
    // than sharing them, because every one of them says something that is true
    // of exactly one of the two shapes: `hookBudgetHe` puts a trip price on the
    // cover, and `totalNoteBudgetHe` says the total includes a flight. Printing
    // either on a plain /trip would be a lie, which is why neither has a
    // fallback to its unbudgeted twin.
    // Which route writes the itinerary. `prefer` is validated against the two
    // names rather than passed through, because a typo here would silently
    // disable the site route and look exactly like the site being down.
    source: {
      prefer: ['site', 'ai'].includes(String(raw.source?.prefer || 'site')) ? String(raw.source?.prefer) : 'site',
      minDays: Math.max(daysMin, Math.round(num(raw.source?.minDays, daysMin))),
    },
    hookSiteHe: String(raw.hookSiteHe || '{days} ימים ב{dest}, המסלול של טיול+'),
    sitePage: {
      titleHe: String(raw.sitePage?.titleHe || 'המסלול המלא ל{dest}'),
      noteHe: String(raw.sitePage?.noteHe ?? 'עם מפה, ואפשר לשנות כל יום'),
      ctaBioHe: String(raw.sitePage?.ctaBioHe || 'חינם, בלי הרשמה · הלינק בביו'),
      ctaDmHe: String(raw.sitePage?.ctaDmHe || 'תגיבו "{dest}" ונשלח לכם את הלינק'),
    },
    hookBudgetHe: String(raw.hookBudgetHe || '{budget} ₪ ל-{days} ימים ב{dest}. ככה.'),
    breakdownLabelHe: String(raw.breakdownLabelHe || 'על מה הולך הכסף'),
    attractionsHe: String(raw.attractionsHe || 'כניסות'),
    leftHe: String(raw.leftHe || 'נשאר {left} ₪ מהתקציב'),
    leftNoneHe: String(raw.leftNoneHe || 'בדיוק בתקציב'),
    totalNoteBudgetHe: String(
      raw.totalNoteBudgetHe === undefined
        ? 'הכל כלול: טיסה, לינה, אוכל, תחבורה וכניסות'
        : raw.totalNoteBudgetHe
    ).trim(),
    giveaway: {
      on: g.on === true,
      winners: Math.max(1, Math.round(num(g.winners, 5))),
      premiumDays: Math.max(1, Math.round(num(g.premiumDays, 30))),
      keywordHe: String(g.keywordHe || '{dest}'),
      titleHe: String(g.titleHe || 'חודש פרימיום במתנה'),
      // The ask slide's two lines. A deck slide has a name and one short note
      // and nothing else, so the instruction goes on the name and the prize
      // goes under it — see askSlide in src/plan/slides.js. One string for both
      // wrapped to three lines and arrived as a paragraph in brackets.
      actionHe: String(g.actionHe || 'תעקבו ותגיבו "{keyword}"').trim(),
      prizeHe: String(g.prizeHe || '{winners} מכם מקבלים {premiumDays} יום פרימיום').trim(),
      captionHe: String(g.captionHe || '').trim(),
      footHe: String(g.footHe || '').trim(),
    },
  };
}

/**
 * When an Israeli audience is actually on the application.
 *
 * Both halves default to OFF rather than to a guess. A schedule block that
 * failed to parse and silently fell back to "noon to two" would suppress the
 * queue for twenty-two hours a day and look exactly like a quiet bot.
 */
/**
 * The Instagram auto-reply block.
 *
 * THE ONE STRING IN THIS FILE THAT IS SUPPOSED TO CARRY A LINK, and the
 * checking is therefore backwards from everywhere else. Every other published
 * string is refused if it contains an address; this one is refused if it does
 * NOT contain the placeholder, and refused separately if it contains a literal
 * address instead.
 *
 * Both halves matter and they catch different mistakes. A DM with no {url} is
 * a reply that promises a link and sends a sentence, which is worse than not
 * replying. A DM with a hardcoded address sends everybody to the same page
 * with no campaign on it, so the traffic this whole change exists to create
 * arrives unattributed and the next decision about it gets made on no data.
 *
 * Checked even when `on` is false. A block that fails only once somebody
 * switches it on is a block that fails at the least convenient moment.
 */
function igReplies(raw) {
  const on = raw.on === true;
  const dmHe = String(raw.dmHe || '').trim();

  if (dmHe) {
    if (!dmHe.includes('{url}')) {
      throw new Error('post-config.json: igReplies.dmHe has no {url} - the reply would promise a link and send none');
    }
    // The placeholder is removed before the check, so the pattern that finds a
    // domain cannot fire on the thing that is going to become one.
    if (URL_LIKE.test(dmHe.replace(/\{url\}/g, ''))) {
      throw new Error(
        'post-config.json: igReplies.dmHe carries an address - the link is built per post with its own campaign tag'
      );
    }
  } else if (on) {
    throw new Error('post-config.json: igReplies.on is true with no dmHe - there is nothing to send');
  }

  for (const [where, s] of [
    ['publicReplyHe', raw.publicReplyHe],
    ['keywords', (raw.keywords || []).join(' ')],
  ]) {
    if (s && URL_LIKE.test(String(s))) throw new Error(`post-config.json: igReplies.${where} contains a URL`);
  }

  return {
    on,
    // A ceiling on how many strangers this can message in an hour. Not a rate
    // limit for Meta's sake - theirs is far higher - but a blast radius. A
    // matcher bug that starts answering every comment on every post is a
    // spam report against the account, and the account is not replaceable.
    hourlyCap: Math.max(1, Math.round(num(raw.hourlyCap, 30))),
    // Whole words only, matched in src/igReplies/match.js. A substring match
    // on "לינק" would fire on any word containing it.
    keywords: (raw.keywords || []).map((k) => String(k).trim()).filter(Boolean),
    dmHe,
    // Optional. An empty string is how somebody turns the public half off
    // while keeping the DM, which is the half that matters.
    publicReplyHe: String(raw.publicReplyHe || '').trim(),
    utmSource: String(raw.utmSource || 'instagram').trim(),
    utmMedium: String(raw.utmMedium || 'dm').trim(),
  };
}

/**
 * The post menu: which types exist, how often each one comes up, how it looks.
 *
 * WHY THIS IS A MENU AND NOT A SETTING. The evidence this block was written from
 * is that three accounts posting the same template got two to four likes each,
 * while a single account's one good post became 93% of its lifetime likes. So the
 * thing that has to be configurable is not how a post looks, it is how much
 * variety the account produces - which means the weights, the look rotation and the
 * hook shapes all live here together, because turning one without the others is how
 * a rotation quietly becomes a template again.
 *
 * EVERYTHING HERE IS VALIDATED RATHER THAN DEFAULTED AWAY. An empty type list, a
 * type with no hooks, a frame with no dimensions: each one would produce posts that
 * look deliberately plain, which is indistinguishable from a config that was never
 * written. Same argument as caption.lines, at the top of this file.
 */
function posts(raw) {
  const types = (raw.types || [])
    .map((t) => ({
      id: String(t?.id || '').trim(),
      he: String(t?.he || '').trim(),
      weight: Math.max(0, num(t?.weight, 1)),
      // How many slides this type wants. A list post is 15 to 20 by definition -
      // the numbering IS the completion loop - and a verdict post is six.
      slidesMin: count(t?.slidesMin, 5),
      slidesMax: count(t?.slidesMax, 20),
      // What the type cannot be built without. Checked by the builder before it
      // spends anything, so a destination whose page has no drawbacks clause fails
      // fast rather than producing a verdict post with one side of the argument.
      needs: list(t?.needs),
      // WHERE THIS TYPE CAN ACTUALLY GO.
      //
      // Instagram publishes at most ten images in a carousel and refuses the eleventh
      // at publish time, hours after approval. A list post is twenty-one slides
      // because its own hook says "20 דברים", and there is no honest nine-slide
      // version of that - so it is a TikTok type, declared rather than discovered by
      // a rejected publish. Empty means both, which is the ordinary case.
      platforms: list(t?.platforms),
      // HOW MANY POSTS THIS TYPE REFUSES TO REPEAT ITSELF WITHIN.
      //
      // Null means "use posts.typeMemory", which is every type but one. 0 means it
      // is never excluded for being recent, which is what lets a type actually be
      // a majority: the global memory of 2 is a 33% ceiling on share whatever the
      // weight says, because the draw only ever sees what is not excluded. See the
      // note beside typeMemory in post-config.json and pickType in posts/types.js.
      //
      // Read with `== null` rather than `||` so a declared 0 survives, which is the
      // only value anybody would declare it for.
      memory: t?.memory == null ? null : Math.max(0, count(t.memory, 0)),
      desc: String(t?.desc || '').trim(),
    }))
    .filter((t) => t.id);
  if (!types.length) {
    throw new Error('post-config.json: posts.types is empty - there would be nothing for the rotation to choose from');
  }
  if (!types.some((t) => t.weight > 0)) {
    throw new Error('post-config.json: every posts.types weight is 0 - nothing could ever be built');
  }

  const looks = (raw.looks || [])
    .map((l) => ({
      id: String(l?.id || '').trim(),
      he: String(l?.he || '').trim(),
      weight: Math.max(0, num(l?.weight, 1)),
      // Which types may be drawn in this look. A notes checklist is a day, so it
      // belongs to the plan and to nothing else.
      types: list(l?.types),
      desc: String(l?.desc || '').trim(),
    }))
    .filter((l) => l.id);
  if (!looks.length) throw new Error('post-config.json: posts.looks is empty');

  // The aspect-ratio test. `tall` is 9:16, which is what TikTok's player is;
  // `phone` is 3:4, which is what a phone camera shoots and what every one of the
  // reference posts used. Which one performs better is an open question and the
  // whole point of carrying both.
  const frames = (raw.frames || [])
    .map((f) => ({
      id: String(f?.id || '').trim(),
      w: count(f?.w, 1080),
      h: count(f?.h, 1920),
      weight: Math.max(0, num(f?.weight, 1)),
    }))
    .filter((f) => f.id && f.w > 0 && f.h > 0);
  if (!frames.length) throw new Error('post-config.json: posts.frames is empty - a slide needs a size');

  // Questions per type, falling back to the shared pool.
  //
  // A QUESTION HAS TO FIT THE POST, and the shared pool cannot know which post it is
  // on. `caption.questions` was written for cards and clips and it contains "מי מכיר
  // טיסה ישירה לשם?" - which landed under a Rome verdict post whose own slide quotes
  // the page saying there is a direct flight of about three and a half hours. The post
  // answered its own question two slides earlier, which reads as nobody having looked.
  //
  // These are also the line the reference posts get their comments from: the winners
  // end on a real question and collect hundreds of replies. A generic one collects
  // none, so they are written per type - a plan asks what you would add, a verdict asks
  // whether you would still go.
  const questionsFor = {};
  for (const [type, entries] of Object.entries(raw.questions || {})) {
    if (type.startsWith('_')) continue;
    questionsFor[type] = list(entries);
  }

  // Hook shapes per type. Filled formats rather than free writing, the decision
  // src/video/hooks.js made for a clip: a filled format is a known sentence with
  // our own numbers in it.
  const hooks = {};
  for (const [type, entries] of Object.entries(raw.hooks || {})) {
    if (type.startsWith('_')) continue;
    hooks[type] = (entries || [])
      .map((h) => ({
        id: String(h?.id || '').trim(),
        he: String(h?.he || '').trim(),
        weight: Math.max(0, num(h?.weight, 1)),
        desc: String(h?.desc || '').trim(),
        // Which types a SHARED hook is offered to. Absent on a per-type hook, where it
        // would mean nothing; on `hooks.shared` it is the whole point, because the
        // templates are not interchangeable - "{n} מקומות" needs a type that counts
        // places and a plan post counts days. Dropping this field, which an earlier
        // version of this mapper did, silently offers every shared hook to every type.
        ...(Array.isArray(h?.for) ? { for: list(h.for) } : {}),
      }))
      .filter((h) => h.id && h.he);
  }
  // The shared pool is not a type and has no type to be empty for.
  for (const t of types) {
    if (!hooks[t.id]?.length) {
      throw new Error(`post-config.json: posts.hooks.${t.id} is empty - a post type with no hook shape has no cover`);
    }
  }
  // A hook is published text. Checked here, once, at startup, rather than once per
  // post from inside a build - the same bargain the caption asks get.
  for (const [type, entries] of Object.entries(hooks)) {
    for (const h of entries) {
      if (URL_LIKE.test(h.he)) throw new Error(`post-config.json: posts.hooks.${type}.${h.id} contains a URL`);
      if (/[—–]/.test(h.he)) throw new Error(`post-config.json: posts.hooks.${type}.${h.id} contains an em or en dash`);
    }
  }

  // AND THE QUESTIONS, AGAINST THE HONESTY GUARD, AT STARTUP.
  //
  // Every configured question is published text and goes through assertNoExperience at
  // build time like any other line. A question that trips it does not fail predictably:
  // the pool is drawn from at random, so a bad line kills roughly one post in four and
  // looks like an intermittent bug in whichever type happened to draw it. That is what
  // "close.question claims a trip nobody took" was, from a question that had been in the
  // config for weeks.
  //
  // Checked by pattern rather than by importing the guard, because posts/voice.js
  // imports THIS module and the cycle would be worse than the duplication. The patterns
  // here are the unambiguous ones; voice.js remains the authority at build time.
  const TRIP_CLAIM = /(?<![\p{L}\p{N}])(?:ו|ש|כש|וש)?(?:כשהיינו|כשהייתי|טסנו|נסענו|ביקרנו|היינו שם|הייתי שם)(?![\p{L}\p{N}])/u;
  for (const [type, pool] of Object.entries(raw.questions || {})) {
    if (type.startsWith('_')) continue;
    for (const q of pool || []) {
      if (TRIP_CLAIM.test(String(q))) {
        throw new Error(
          `post-config.json: posts.questions.${type} contains a line that claims a trip nobody took: ${JSON.stringify(String(q))}`
        );
      }
    }
  }

  // The caption skeletons. A shape is an ordered list of part names, and what makes
  // it a rotation rather than a template is that no two consecutive posts may use
  // the same one - see src/posts/caption.js.
  const captions = (raw.captions || [])
    .map((c) => ({ id: String(c?.id || '').trim(), parts: list(c?.parts), weight: Math.max(0, num(c?.weight, 1)) }))
    .filter((c) => c.id && c.parts.length);
  if (!captions.length) throw new Error('post-config.json: posts.captions is empty - a post needs a description');

  // Tags that appear on EVERY post of these types, ahead of the pools.
  //
  // `#פוריו` is the Hebrew spelling of "for you" and it is the tag Israeli TikTok
  // actually uses for the feed. It is here rather than in `hashtags.broad` because
  // that pool is shared with cards and clips, and a draw would put it on roughly one
  // post in three - a feed tag is either on every post or it is doing nothing.
  //
  // They REPLACE pool draws rather than adding to them, so the total tag count is
  // the same on every post. Otherwise the one variable section 7 is measuring
  // changes for a reason that has nothing to do with the measurement.
  const always = tags(raw.tags?.alwaysHe || [], 'posts.tags.alwaysHe');

  const closing = raw.closing || {};
  return {
    types,
    looks,
    frames,
    hooks,
    captions,
    questions: questionsFor,
    alwaysTags: always,
    // How many of the recent posts the rotation looks back over when refusing a
    // repeat. Two is the minimum that means anything ("not the same as last time");
    // more makes the account visibly cycle.
    lookMemory: Math.max(1, count(raw.lookMemory, 3)),
    typeMemory: Math.max(1, count(raw.typeMemory, 2)),
    // WHETHER A COVER'S PROMISE IS CHECKED AGAINST THE SLIDES. See ./posts/deliver.js
    // for the evidence, which is this account's own two highest-reach posts and their
    // two lowest like rates. `on: false` is the old behaviour, which is to publish
    // whatever the builder produced.
    deliver: {
      on: raw.deliver?.on !== false,
      // How many KINDS of concrete fact a practical promise has to be backed by, not
      // how many facts. Two is the floor that distinguishes a post which answers the
      // question from one that quotes a drawback and stops: a price and a season, or
      // a booking note and a flight time.
      //
      // MEASURED RATHER THAN CHOSEN. Over the 159 verdict posts the catalogue can
      // build today, by hook and destination, the number of fact kinds each one
      // carries comes out as 1:6, 2:24, 3:21, 4:42, 5:66. So a floor of 2 refuses 6
      // posts and a floor of 3 refuses 30, which is a fifth of the type's output
      // thrown away over a rule nobody has evidence for. The six it does refuse are
      // Phuket and Kathmandu, whose pages carry a season or a flight time and
      // nothing else.
      minSpecifics: Math.max(0, count(raw.deliver?.minSpecifics, 2)),
    },
    // THE OPTIONAL VIDEO VARIANT of the list-style types. Off by default: see the
    // note at the top of src/video/slideReel.js for why a pan over a still is not
    // the format that wins, and why it is still worth being able to test.
    video: {
      on: raw.video?.on === true,
      types: list(raw.video?.types).length ? list(raw.video?.types) : ['list', 'roll', 'verdict'],
      holdSeconds: Math.max(0.5, num(raw.video?.holdSeconds, 2)),
      coverSeconds: Math.max(0.5, num(raw.video?.coverSeconds, 3)),
      maxSeconds: Math.max(2, num(raw.video?.maxSeconds, 30)),
      // How far the gentle drift travels, as a fraction. 0 turns it off and gives a
      // hard cut between stills, which is the honest version of a slideshow.
      zoom: Math.max(0, Math.min(0.5, num(raw.video?.zoom, 0.04))),
    },
    // The default ask. "שמרו את זה לטיול" is the one the evidence points at: saves
    // run at 47 to 95% of likes on every post that worked, and a save is somebody
    // planning a trip rather than admiring a photograph.
    saveAskHe: String(closing.saveAskHe || 'שמרו את זה לטיול').trim(),
    // The warm sign-off that replaces "רוצים עוד? תעקבו". The winners close by
    // giving something; an ask that offers nothing is what our own posts closed on.
    signoffsHe: list(closing.signoffsHe),
    // How many days a plan post covers, and how many stops of each day it shows.
    days: Math.max(1, count(raw.days, 4)),
    stopsMin: Math.max(1, count(raw.stopsMin, 3)),
    stopsMax: Math.max(1, count(raw.stopsMax, 5)),
    // Above this, a gap between two stops is a ride rather than a walk. Three
    // kilometres is about forty minutes on foot, which is the point at which
    // printing a distance stops being useful and printing "נסיעה" starts.
    walkMaxKm: Math.max(0.2, num(raw.walkMaxKm, 3)),
  };
}

/**
 * The hidden gems reel: its shape, its sound, its caption and its hook menu.
 *
 * NORMALISED HARD, because every number in it is a duration that reaches ffmpeg.
 * A shot count of 2.5 or a hold of -1 is not a bad post, it is a filter graph that
 * fails after the footage has been downloaded and the vision calls paid for.
 *
 * The one check that THROWS rather than falling back is an empty category list with
 * the generator switched on. Everything else has an honest default: no templates for
 * a category simply withdraws that category, no caption lines falls back to the
 * places on their own, and an unknown `sound` is read as the current behaviour.
 */
function gems(raw) {
  const h = raw.hooks || {};
  const cap = raw.caption || {};

  const templates = (list, where) =>
    (Array.isArray(list) ? list : [])
      .filter((t) => t && String(t.he || '').trim())
      .map((t) => {
        const he = String(t.he).trim();
        if (URL_LIKE.test(he)) throw new Error(`post-config.json: gems.hooks.${where}.${t.id} contains a URL`);
        // The same check posts.hooks makes, and for the same reason: a dash in a
        // template is a dash in every post it fills, and this project bans them.
        if (/[—–]/.test(he)) throw new Error(`post-config.json: gems.hooks.${where}.${t.id} contains an em or en dash`);
        return {
          id: String(t.id || '').trim() || he.slice(0, 12),
          he,
          weight: Math.max(0, num(t.weight, 1)),
          // 1 is a claim the post can stand behind. Clamped rather than trusted,
          // because the scorer multiplies by it and a 5 typed here would let one
          // template outrank every honest one.
          honesty: Math.max(0, Math.min(1, num(t.honesty, 1))),
          needs: list2(t.needs),
          desc: String(t.desc || ''),
        };
      });

  const categories = (Array.isArray(h.categories) ? h.categories : [])
    .filter((c) => c && String(c.id || '').trim())
    .map((c) => ({
      id: String(c.id).trim(),
      he: String(c.he || c.id).trim(),
      weight: Math.max(0, num(c.weight, 1)),
      // Which formats can DELIVER this category. Empty means every format, which
      // is the permissive direction and the wrong default for this field, so the
      // file always states it. See the note beside gems.hooks in post-config.json.
      formats: list2(c.formats),
      desc: String(c.desc || ''),
      templates: templates(c.templates, c.id),
    }))
    .filter((c) => c.templates.length);

  // THE OPEN LOOP: the second line of a hook, whose whole job is to be unresolved.
  //
  // `orderBy` is the measure the reel is ordered on so the claim comes true, and a
  // template with one is only offered when that measure can actually be computed for
  // the shots in hand. `needsSite` is the stricter version of the same honesty: a
  // claim about "the last place" needs the last place to HAVE a name, not just a
  // country. See orderForOpenLoop and validateRetentionPlan in src/video/retention.js.
  const openLoops = (Array.isArray(h.openLoops) ? h.openLoops : [])
    .filter((o) => o && String(o.he || '').trim())
    .map((o) => {
      const he = String(o.he).trim();
      if (URL_LIKE.test(he)) throw new Error(`post-config.json: gems.hooks.openLoops.${o.id} contains a URL`);
      if (/[—–]/.test(he)) throw new Error(`post-config.json: gems.hooks.openLoops.${o.id} contains an em or en dash`);
      return {
        id: String(o.id || '').trim() || he.slice(0, 12),
        he,
        weight: Math.max(0, num(o.weight, 1)),
        orderBy: ['surprise', 'beauty', 'price'].includes(o.orderBy) ? o.orderBy : null,
        needsSite: o.needsSite !== false,
        desc: String(o.desc || ''),
      };
    });

  const on = h.on !== false;
  if (on && !categories.length) {
    throw new Error(
      'post-config.json: gems.hooks.on is true and no category has a usable template - the reel would have no hook to open on'
    );
  }

  const shots = {
    min: Math.max(2, count(raw.shots?.min, 3)),
    max: Math.max(2, count(raw.shots?.max, 5)),
  };
  shots.max = Math.max(shots.min, shots.max);

  const hold = {
    min: Math.max(0.5, num(raw.holdSeconds?.min, 2)),
    max: Math.max(0.5, num(raw.holdSeconds?.max, 3)),
  };
  hold.max = Math.max(hold.min, hold.max);

  // SEVEN TO NINE SECONDS, DOWN FROM TEN TO FIFTEEN, and the reason is a ratio rather
  // than a length. One reel averaged 3.1 seconds of watch time against about 12, which
  // is 26%, with 5% watching it through. The numerator is hard to move and the
  // denominator is ours: the same 3.1 seconds against 8 is 39%, and the shots that
  // were being skipped are the ones that no longer exist.
  const target = {
    min: Math.max(1, num(raw.targetSeconds?.min, 7)),
    max: Math.max(1, num(raw.targetSeconds?.max, 9)),
  };
  target.max = Math.max(target.min, target.max);

  // WHAT KEEPS A VIEWER PAST THREE SECONDS. See the note at the top of
  // src/video/retention.js for the analytics every default here comes from.
  const ret = raw.retention || {};
  const retention = {
    on: ret.on !== false,
    // The counter, "2/3", and the hook kept as a header. Separable because they are
    // two different claims on the frame and an owner who wants one may not want both.
    counter: ret.counter !== false,
    headerOn: ret.headerOn !== false,
    question: ret.question !== false,
    openLoop: ret.openLoop !== false,
    strongestFirst: ret.strongestFirst !== false,
    // THE FIRST CUT, which is the whole diagnosis in one number. The old hook shot ran
    // to exactly three seconds and the average view ended at 3.1.
    firstCutSeconds: Math.max(0.5, num(ret.firstCutSeconds, 1.6)),
    maxFirstCutSeconds: Math.max(0.5, num(ret.maxFirstCutSeconds, 2.5)),
    // How long the hook stays at full size before it shrinks into the header. The
    // brief's three to four seconds; it is not how long the hook is READABLE, which
    // is the whole video now, it is how long it is the only thing being said.
    hookFullSeconds: Math.max(0.5, num(ret.hookFullSeconds, 3.2)),
    // How long a place name needs on screen after the hook shrinks. The first shot is
    // lengthened to guarantee it; see retentionPlan.
    labelMinSeconds: Math.max(0.3, num(ret.labelMinSeconds, 1.2)),
    // `match` picks the opening and closing windows to look alike, `cut` returns to
    // the opening shot for a fraction of a second, `off` does neither. Match by
    // default because it costs no screen time: the closing frame has to carry the
    // question, and a cut back to the start would spend that frame on a repeat.
    loop: ['match', 'cut', 'off'].includes(ret.loop) ? ret.loop : 'match',
    // Above this the two frames are too unalike to call it a loop, and the reel is
    // built without one rather than with a jarring one. 0..1, see loopDistance.
    loopMaxDistance: Math.max(0, Math.min(1, num(ret.loopMaxDistance, 0.22))),
    // How many times a plan that fails the quality gate is rebuilt before the format
    // gives up for this run. One retry: the second attempt re-draws the hook and the
    // open loop, which is what a timing failure usually needs, and a third would be
    // three vision passes for one post.
    retries: Math.max(0, count(ret.retries, 1)),
  };

  return {
    shots,
    holdSeconds: hold,
    targetSeconds: target,
    hookSeconds: Math.max(0.5, num(raw.hookSeconds, 3)),
    // HOW LONG A PLACE IS OFF LIMITS AFTER A POST NAMES IT. The brief says 14 days
    // and 14 is the default; it is a dial rather than a constant because it is the
    // one rule here that can starve the format.
    //
    // The reel needs three to five places the vision judge can name with confidence,
    // and the recognizable pool from the configured queries is perhaps fifty. At two
    // reels a day the fortnight rule reserves something like a hundred place-days out
    // of that, so a run of reels that cannot be built looks exactly like a search
    // that has gone stale. The error names how many places were skipped for this rule
    // so the two can be told apart, and this is what to lower when it is this.
    placeMemoryDays: Math.max(0, count(raw.placeMemoryDays, 14)),
    // ENDING ON THE BEST SHOT, WHICH IS NOW OFF BY DEFAULT AND IS NOT A CONTRADICTION.
    //
    // It was true that the last frame of a reel is what a viewer is looking at while
    // they decide to watch again. It is also true that 95% of them never got there:
    // the average view ended at 3.1 seconds of 12. A frame nobody reaches cannot earn
    // a rewatch, and the first frame is the one every single viewer sees.
    //
    // So the ordering question moved into retention.strongestFirst, which puts the
    // highest-ranked shot at the opening and reserves the LAST slot for whichever
    // shot pays off the hook's open loop. That is a better version of the same idea:
    // the reel still ends on a shot chosen on purpose, and now it ends on the one the
    // hook promised. Setting this true again restores the plain reversal.
    strongestLast: raw.strongestLast === true,
    retention,
    loop: raw.loop === true,
    loopSeconds: Math.max(0, num(raw.loopSeconds, 0.4)),
    // `app` is the current behaviour: the file goes out silent and the owner picks
    // the track in TikTok. `library` mixes a declared track so the post can be
    // promoted. Anything else is read as `app`, which is the safe direction.
    sound: raw.sound === 'library' ? 'library' : 'app',
    caption: {
      lines: list(cap.lines),
      questions: list(cap.questions),
      tagCount: Math.max(0, count(cap.tagCount, 3)),
    },
    hooks: {
      on,
      candidates: Math.max(1, count(h.candidates, 10)),
      // HOW MANY RECENT REELS' HOOKS ARE REFUSED. Two, which is a cycle of three
      // shapes rather than the strict alternation a depth of one produces.
      //
      // It is not optional in practice. The scorer is deterministic, so without it
      // the best line ships every time: four reels in one dry run opened on the
      // identical sentence. Floored at 0 so it can be switched off, which is a thing
      // to do while comparing two hooks on purpose and not otherwise.
      memory: Math.max(0, count(h.memory, 2)),
      maxWords: Math.max(2, count(h.maxWords, 8)),
      minWords: Math.max(1, count(h.minWords, 3)),
      banned: list(h.banned),
      categories,
      openLoops,
      // HOW MUCH "a reason to stay" IS WORTH IN THE SCORE, beside specificity and
      // curiosity. A quarter: enough that an open loop outranks a line without one,
      // not enough to float a line that promises nothing specific. The 3.8% like rate
      // says the old hooks were good lines; the 26% watch ratio says they finished
      // the sentence. See scoreHook.
      stayWeight: Math.max(0, Math.min(1, num(h.stayWeight, 0.25))),
    },
  };
}

/**
 * The mix across formats, and the run limit the weights cannot express.
 *
 * `on` false restores the previous behaviour exactly: each kind's own daily counter
 * runs independently and nothing consults this block. That is the rollback, and it
 * is one word in the file rather than a revert.
 */
function formats(raw) {
  const mix = (Array.isArray(raw.mix) ? raw.mix : [])
    .filter((f) => f && String(f.id || '').trim())
    .map((f) => ({
      id: String(f.id).trim(),
      he: String(f.he || f.id).trim(),
      // Which pipeline builds it. Only `clip` and `post` exist today; an unknown
      // kind is kept rather than dropped so the rotation can report it as
      // unbuildable instead of silently never drawing it.
      kind: String(f.kind || 'clip').trim(),
      weight: Math.max(0, num(f.weight, 0)),
      desc: String(f.desc || ''),
    }));

  const on = raw.rotation?.on !== false;
  if (on && !mix.some((f) => f.weight > 0)) {
    throw new Error(
      'post-config.json: formats.rotation.on is true and every formats.mix weight is 0 - the rotation would have nothing to build'
    );
  }

  return {
    rotation: {
      on,
      // 1 means never twice in a row, 2 means never three times. Floored at 1
      // because 0 would exclude the format that was just used from being used
      // again ever, which is not what the number means.
      maxRun: Math.max(1, count(raw.rotation?.maxRun, 2)),
    },
    mix,
  };
}

function schedule(raw) {
  const windows = (Array.isArray(raw.windows) ? raw.windows : [])
    .map((w) => pair(w, null))
    .filter((w) => w && w[0] >= 0 && w[1] <= 24 && w[1] > w[0]);

  const sh = raw.shabbat || {};
  const day = (v, fallback) => {
    const n = Math.round(num(v, fallback));
    return n >= 0 && n <= 6 ? n : fallback;
  };
  const hour = (v, fallback) => {
    const n = num(v, fallback);
    return n >= 0 && n <= 24 ? n : fallback;
  };

  return {
    timeZone: String(raw.timeZone || 'Asia/Jerusalem'),
    windows,
    shabbat: raw.shabbat
      ? {
          // getDay(): 0 Sunday … 5 Friday, 6 Saturday.
          fromDay: day(sh.fromDay, 5),
          fromHour: hour(sh.fromHour, 15),
          toDay: day(sh.toDay, 6),
          toHour: hour(sh.toHour, 20),
        }
      : null,
  };
}

/** A list of non-empty trimmed strings, which is most of what this file holds. */
const list = (v) => (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean);

/**
 * The same thing, lowercased, for the lists that are matched against rather than
 * printed: a category's `formats` and a template's `needs`.
 *
 * Separate from `list` so a caller cannot lowercase a Hebrew caption line by
 * reaching for the wrong helper. Hebrew has no case, so it would be silent.
 */
const list2 = (v) => list(v).map((s) => s.toLowerCase());

/** A numeric [a, b] pair, or the fallback. */
function pair(v, fallback) {
  if (!Array.isArray(v) || v.length !== 2) return fallback;
  const [a, b] = v.map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : fallback;
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
