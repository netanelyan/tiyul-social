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

  // The Israeli angle pool, read before anything that needs it. `shoot.angles`
  // is where this list used to live and is still folded in, so an untouched
  // post-config.json keeps working; the shoot block is then handed this same
  // list back, so the two can never disagree.
  const angles = [...new Set([...list(raw.angles), ...list(raw.shoot?.angles)])];
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
  for (const c of ctas) {
    if (URL_LIKE.test(c)) {
      throw new Error(
        `post-config.json: caption ask "${c}" contains a URL - the link lives in the bio, the caption says so in words`
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
      // Kept so anything still reading the singular key sees the first ask
      // rather than undefined. Nothing in src/ reads it now.
      cta: ctas[0] || '',
      // How often an ask is appended. Clamped rather than trusted: a share
      // above 1 is an ask on every post, which the brief calls the opposite of
      // soft, and a negative one silently turns the feature off.
      ctaShare: Math.max(0, Math.min(1, num(caption.ctaShare, 0))),
    },
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
    // THE ISRAELI ANGLE, top level now, because more than one kind draws on it.
    //
    // It lived in `shoot.angles` and reached exactly one kind of post: the
    // shoot, which is the one thing here the bot cannot make. Every format that
    // actually runs unattended chose its subject with no angle at all. See
    // src/angles.js for what an angle may and may not do once a pipeline has
    // one, which is the part that matters.
    //
    // `shoot.angles` is still read and folded in, so an untouched
    // post-config.json keeps working and a deployment migrates by moving the
    // list up rather than by editing two places.
    angles,
    clips: clips(raw.clips || {}),
    // The shoot is handed the SHARED pool rather than its own. Its `angles`
    // key is the same list the deck now draws from, so anything still reading
    // `postConfig().shoot.angles` keeps working and cannot drift from what
    // `postConfig().angles` says.
    shoot: shoot(raw.shoot || {}, angles),
    plans: plans(raw.plans || {}),
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
    }))
    .filter((f) => f.id && f.desc);

  // Fatal only when the shape is ON. A cut with no hook format has nothing to
  // fill and would fall through to a video whose first line is a place name,
  // which is a deck slide that moves rather than a post with an opening.
  const on = raw.on !== false;
  if (on && !hookFormats.length) {
    throw new Error('post-config.json: clips.cuts.on is true but clips.cuts.hookFormats is empty');
  }

  return {
    on,
    cutsMin,
    cutsMax,
    secondsPerCut: Math.max(2, num(raw.secondsPerCut, 4)),
    hookMaxWords: Math.max(3, Math.round(num(raw.hookMaxWords, 9))),
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
 * The filming queue's settings.
 *
 * Validated less strictly than clips, and deliberately: nothing here is ever
 * published. A malformed clip config ships a broken video; a malformed shoot
 * config ships a worse shot list to one person who can read it and tell.
 *
 * The one fatal case is an empty format list, because a rotation with nothing
 * to rotate through produces a shot list with no shape — which is a message
 * saying "film something", and the whole point of this queue is that it does
 * not say that.
 */
function shoot(raw, sharedAngles = []) {
  const formats = (Array.isArray(raw.formats) ? raw.formats : [])
    .map((f) => ({
      id: String(f.id || '').trim(),
      shape: String(f.shape || '').trim().toUpperCase() || null,
      he: String(f.he || '').trim(),
      desc: String(f.desc || '').trim(),
      weight: Math.max(1, Math.round(num(f.weight, 1))),
      // The format that IS the product demo. Counted by the rotation so the
      // brief's "at least half" is a check rather than a hope — see
      // productShare below and src/shoot/rotation.js.
      needsProduct: f.needsProduct === true,
      allowsPrice: f.allowsPrice === true,
      hookExamples: list(f.hookExamples),
      // What to actually film, in order. The field that makes this a task
      // rather than a brief: "a face to camera saying the hook" is something
      // you can do in the next ten minutes, and "make a mistakes video" is not.
      shots: list(f.shots),
    }))
    .filter((f) => f.id && f.desc);

  if (!formats.length) {
    throw new Error('post-config.json: shoot.formats is empty - a shot list with no shape is a message saying "film something"');
  }

  const series = raw.series || {};
  return {
    perDay: Math.max(0, Math.round(num(raw.perDay, 1))),
    backlogMax: Math.max(1, Math.round(num(raw.backlogMax, 3))),
    lengthSeconds: pair(raw.lengthSeconds, [15, 35]),
    cta: String(raw.cta || '').trim(),
    // The brief's rule 3 is "at least half", which is a floor. A weight is a
    // tendency and a run of five non-product shoots sits well inside normal for
    // any weighting, so this is enforced over a window instead.
    productShare: Math.max(0, Math.min(1, num(raw.productShare, 0.5))),
    productWindow: Math.max(1, Math.round(num(raw.productWindow, 6))),
    // The shared pool, not a private one. This key used to BE the pool; it is
    // now a view onto postConfig().angles so a reader here and a reader there
    // cannot drift apart. See the note at the top-level `angles`.
    angles: sharedAngles,
    series: {
      every: Math.max(0, Math.round(num(series.every, 0))),
      length: Math.max(2, Math.round(num(series.length, 3))),
      labelHe: String(series.labelHe || 'חלק {n} מתוך {of}'),
      nextHe: String(series.nextHe || 'עקבו לחלק {n} מחר'),
    },
    formats,
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
  for (const [where, s] of [
    ['giveaway.captionHe', g.captionHe],
    ['giveaway.actionHe', g.actionHe],
    ['giveaway.prizeHe', g.prizeHe],
    ['giveaway.titleHe', g.titleHe],
    ['hookHe', raw.hookHe],
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
      actionHe: String(g.actionHe || 'עקבו ותגיבו "{keyword}"').trim(),
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
