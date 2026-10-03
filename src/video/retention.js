import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { ffmpegPath } from './overlay.js';
import { solveHolds } from './fit.js';
import { getBrowser } from '../render/index.js';
import { assistantDataUri, escapeHtml } from '../render/theme.js';
import { postConfig } from '../postConfig.js';

// WHY A VIEWER LEAVES AT THREE SECONDS, AND WHAT TO DO ABOUT IT.
//
// THE ANALYTICS, from one reel the owner read off the app:
//
//   559 views · 21 likes (3.8%) · 0 comments · 1 share · 1 save · 0 followers
//   average watch time 3.1s of ~12s · watched in full 5.03%
//   distribution climbed for two hours and stopped by hour three
//
// 3.1 seconds is not a coincidence and it is not the footage. `hookSeconds` was 3 in
// both reel formats, so at exactly three seconds the hook text vanished and the first
// shot cut away - and whatever the next shot was, the viewer had already been given
// the whole post. The line was read, the promise was closed, and there was no reason
// on screen to stay. TikTok tested the video on 559 people, measured a 26% watch
// ratio and a 5% completion, and stopped.
//
// Likes were fine. Likes are not what ranks a video: watch time, completion,
// rewatches, comments, shares and saves are, and this post scored 0 comments.
//
// SO EVERY DECISION IN THIS MODULE IS ABOUT THE SAME SECOND. The hook does not
// vanish, it shrinks and stays. A counter says how much is left. The hook promises
// something that is only paid off at the end, and the order of the shots makes that
// promise true. The first cut lands before three seconds rather than on it. The reel
// is seven to nine seconds instead of twelve, because completion is a ratio and the
// denominator is ours to choose. The last shot asks a question, because 0 comments
// is a number this account can change on purpose.
//
// WHAT IT DOES NOT DO IS CHANGE THE LOOK. Same typeface, same white, same tight
// shadow on the letterforms, same top gradient only when the footage cannot carry
// white type, no boxes and no panels. Every new element here is the postcard reel's
// own line at a smaller size in a different place, which is the one kind of change
// this project's design notes allow without an argument.

/* -------------------------------------------------------------------------- */
/* the timeline                                                                */
/* -------------------------------------------------------------------------- */

/** Hebrew ordinals, for an open loop that names which item pays it off. */
const ORDINALS = { 1: 'הראשון', 2: 'השני', 3: 'השלישי', 4: 'הרביעי', 5: 'החמישי', 6: 'השישי' };
export const ordinalHe = (n) => ORDINALS[Number(n)] || 'האחרון';

/**
 * How long each shot is held, and when each line is on screen.
 *
 * ONE PURE FUNCTION FOR THE WHOLE TIMELINE, because every requirement in the brief is
 * a statement about a moment and they constrain each other. The first cut has to land
 * before 2.5 seconds; the hook has to stay at full size for three to four; the first
 * place's name has to be readable AFTER the hook shrinks, or it is a shot with no
 * name on a format whose promise is that every shot is named. Those three pull in
 * different directions and the only way to see that they hold together is to compute
 * the whole thing and then check it.
 *
 * THE RECONCILIATION WITH THE OWNER'S OWN RULE IS THE INTERESTING PART. "The hook and
 * the first label shared a frame. They stacked, which is two messages in the half
 * second a viewer decides on" - so the hook got its own shot (git e64f71c). That rule
 * stands and this does not break it: the hook shot is still its own shot and still
 * carries no label, it is just shorter, and the first PLACE's label is withheld until
 * the hook has shrunk to a header. At no moment are there two full-size messages.
 * What changed is that the hook stops being full size before it stops being present.
 *
 * Returns the shot holds, the card windows, and the numbers the validator checks.
 */
export function retentionPlan({ shots = [], hookHe = '', openLoopHe = null, questionHe = null, cfg = null } = {}) {
  const gems = cfg || postConfig().gems;
  const r = gems.retention;
  const target = gems.targetSeconds;
  const { min: lo, max: hi } = gems.holdSeconds;

  // THE SHOT COUNT FOLLOWS FROM THE LENGTH, which is why nothing here configures it
  // separately. At a 7 to 9 second target with a 1.6 second hook shot and a 2 second
  // floor, four places need 9.6 seconds and do not fit; three need 7.6 and do. So the
  // brief's "3 clips of about 2 to 3 seconds" is an OUTCOME of its own 7 to 9 seconds
  // rather than a second number to keep in step with the first.
  const hook = r.on ? r.firstCutSeconds : gems.hookSeconds;
  const round = (x) => Math.round(x * 10) / 10;

  // THE FIRST PLACE IS HELD LONGER THAN THE REST, by exactly as much as it takes for
  // its name to be readable after the hook shrinks. Without this the label window on
  // shot one is hookFullSeconds to the end of that shot, which at the default numbers
  // is eight tenths of a second for a name like "צ׳ינקווה טורי, איטליה". A label
  // nobody can finish reading is the same defect as no label.
  const firstBonus = r.on ? round(Math.max(0, r.hookFullSeconds - hook) + r.labelMinSeconds) : 0;

  // ONE SOLVER, IN ./fit.js. The length arithmetic lives there and is tested through
  // fitHolds; what this function knows is the two things the solver cannot: that the
  // hook shot is as long as the first cut, and why the first place needs the extra
  // second.
  const fit = solveHolds(shots.length, gems, { hookSeconds: hook, firstBonus });
  const holds = fit.holds;
  const dropped = fit.dropped;
  const kept = shots.slice(0, holds.length);
  const seconds = fit.seconds;

  // Where each shot starts. The hook shot is index 0 and the places follow.
  const at = [];
  let clock = hook;
  for (const h of holds) {
    at.push(round(clock));
    clock += h;
  }

  // THE CARDS. One PNG per distinct text state rather than one per element, because
  // the elements overlap in time and a layer per element is a filter chain three times
  // longer for the same picture. A card holds everything on screen at that moment,
  // which is also what makes the legibility measurement honest: the gradient is sized
  // against the frames the whole block lands on.
  const cards = [];
  const hookFull = r.on ? Math.min(r.hookFullSeconds, seconds) : hook;
  cards.push({
    id: 'hook',
    from: 0,
    to: round(hookFull),
    hookHe,
    openLoopHe: r.on ? openLoopHe : null,
    big: true,
  });

  if (r.on) {
    for (const [i, h] of holds.entries()) {
      const from = Math.max(at[i], hookFull);
      const to = round(at[i] + h);
      if (to - from <= 0.05) continue;
      const last = i === holds.length - 1;
      cards.push({
        id: `place${i + 1}`,
        from: round(from),
        to,
        // The hook, kept. Smaller, at the top, for the rest of the video: this is the
        // line the 3.1 second average says viewers leave when it disappears.
        headerHe: r.headerOn ? hookHe : null,
        counterHe: r.counter ? `${i + 1}/${holds.length}` : null,
        labelHe: kept[i]?.labelHe || null,
        // The question goes on the last shot and nowhere else. Asked once, on the
        // frame a viewer is looking at when they decide whether to type something.
        questionHe: last && r.question ? questionHe : null,
        big: false,
      });
    }
  } else {
    // THE OLD TIMELINE, REACHABLE BY CONFIG. One line per shot, nothing persistent,
    // which is what this account published before the analytics came in.
    for (const [i, h] of holds.entries()) {
      cards.push({ id: `place${i + 1}`, from: at[i], to: round(at[i] + h), labelHe: kept[i]?.labelHe || null, big: false });
    }
  }

  return {
    hookSeconds: hook,
    holds,
    at,
    seconds,
    dropped,
    shots: kept,
    cards,
    // What the validator reads, named rather than recomputed from the cards.
    firstCutAt: hook,
    hookFullUntil: round(hookFull),
    counted: Boolean(r.on && r.counter),
    hasQuestion: Boolean(r.on && r.question && questionHe),
    hasOpenLoop: Boolean(r.on && openLoopHe),
  };
}

/* -------------------------------------------------------------------------- */
/* the quality gate                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Everything the brief says must be true of a retention video, checked on the plan.
 *
 * BEFORE ANYTHING IS ENCODED, which is the whole point of planning the timeline as
 * data first. A reel that fails here has cost a search and a hook; a reel that fails
 * after the encode has cost twelve megabytes and four minutes, and the owner's inbox
 * gets a video nobody should post.
 *
 * `problems` is a list of English reasons, which is what gets logged and what the
 * approval card prints. Returning them all rather than the first means one run tells
 * you everything that is wrong instead of one thing at a time.
 */
export function validateRetentionPlan(plan, { cfg = null, openLoop = null, lastShot = null } = {}) {
  const gems = cfg || postConfig().gems;
  const r = gems.retention;
  const problems = [];
  if (!r.on) return { ok: true, problems };

  if (!plan?.hasOpenLoop) problems.push('the hook has no open loop, so nothing on screen says to stay');
  if (r.counter && !plan?.counted) problems.push('no counter, so nothing says how much is left');
  if (!(plan?.firstCutAt <= r.maxFirstCutSeconds)) {
    problems.push(`the first cut is at ${plan?.firstCutAt}s, after the ${r.maxFirstCutSeconds}s drop-off`);
  }
  if (!(plan?.seconds <= gems.targetSeconds.max)) {
    problems.push(`${plan?.seconds}s is over the ${gems.targetSeconds.max}s ceiling`);
  }
  if (r.question && !plan?.hasQuestion) problems.push('no question on the last shot, and comments are the number being fixed');
  if (r.headerOn && !(plan?.hookFullUntil >= r.hookFullSeconds - 0.05)) {
    problems.push(`the hook goes small at ${plan?.hookFullUntil}s, before ${r.hookFullSeconds}s`);
  }

  // THE PROMISE HAS TO BE TRUE OF THE LAST SHOT, which is the one check here that is
  // about the content rather than the timing. An open loop that says the last one is
  // the most surprising, over a reel whose last shot is whatever came back third, is
  // the same broken promise as a cover that does not deliver - and that one is
  // already measured at 0.5% likes per view. See orderForOpenLoop.
  if (openLoop?.orderBy && lastShot) {
    if (openLoop.needsSite && !String(lastShot.labelHe || '').includes(',')) {
      problems.push(`"${openLoop.he}" claims something about the last place and it has no name, only a country`);
    }
    if (lastShot.measure == null) {
      problems.push(`"${openLoop.he}" orders by ${openLoop.orderBy} and the last shot could not be measured on it`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/* -------------------------------------------------------------------------- */
/* the order of the shots                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The strongest shot first, and the shot that pays off the open loop last.
 *
 * THOSE ARE TWO DIFFERENT MEASURES AND THAT IS WHY BOTH CAN BE TRUE AT ONCE.
 *
 * "Strongest" is this project's own `rank`: the judge's destination score, plus a
 * point and a half for a participant camera, minus four for a drone. Every term in it
 * is already the owner's taste - BRIEF.md lists aerials under Never, and rankVision's
 * note explains that at a penalty of 4 a drone shot only ever gets built when nothing
 * on the ground survived. So "the most dramatic shot" here cannot mean a drone shot,
 * and it means the highest-ranked one, which is usually a POV shot that moves. That
 * is also what the brief asks for in the same breath: movement from frame 1.
 *
 * The open loop's measure is deliberately a DIFFERENT dimension:
 *
 *   surprise   the place is not one of the handful pinned in clips.sites, which is
 *              the owner's own list of the places this feed keeps returning to. Not
 *              pinned is the closest thing to "unfamiliar" the data actually holds.
 *   beauty     the judge's raw `destination` score, before the POV and drone
 *              adjustments that `rank` applies. The prettiest place, as scored.
 *   price      what a day there costs, which the site publishes for its own
 *              destinations and nobody publishes for a stock clip. Offered only when
 *              every place maps to a page with a figure, which for a reel built out
 *              of Pexels footage is approximately never, and it is wired up anyway
 *              because the brief names it and because /gems may one day be handed a
 *              region.
 *
 * When the same shot wins both, the PROMISE takes the last slot and the next best
 * goes first. A promise is a claim and the opening is a preference.
 */
export function shotMeasure(shot, orderBy) {
  if (!shot || !orderBy) return null;
  if (orderBy === 'surprise') {
    const label = String(shot.labelHe || '');
    const site = label.split(',')[0].trim();
    // A claim about the last PLACE needs a place, not a country. An unnamed shot is
    // unmeasurable on surprise by definition: nothing is surprising about a country.
    if (!site || !label.includes(',')) return null;
    // Pinned means familiar, so an unpinned site scores higher on surprise. Keyed on
    // the Hebrew spelling the pinning table holds, which is what the label carries.
    return Object.values(postConfig().sites).includes(site) ? 0 : 1;
  }
  if (orderBy === 'beauty') {
    const d = Number(shot.vision?.destination);
    return Number.isFinite(d) ? d : null;
  }
  if (orderBy === 'price') {
    const c = Number(shot.dailyCost);
    // Cheapest wins, so the measure is negated: the highest measure is always the one
    // that goes last, whatever the dimension happens to mean.
    return Number.isFinite(c) && c > 0 ? -c : null;
  }
  return null;
}

export function orderForOpenLoop(shots, { openLoop = null, strongestFirst = true } = {}) {
  const list = [...(shots || [])];
  const scored = list.map((s) => ({ ...s, measure: shotMeasure(s, openLoop?.orderBy) }));
  if (scored.length < 2) return { ordered: scored, last: scored[0] || null };
  const rankOf = (s) => (Number.isFinite(Number(s.rank)) ? Number(s.rank) : -1);

  // The payoff slot. Among the shots that can be measured at all, the best; ties go to
  // the lower-ranked one, which leaves the stronger footage free for the opening.
  const measurable = scored.filter((s) => s.measure != null);
  const last = measurable.length
    ? measurable.slice().sort((a, b) => b.measure - a.measure || rankOf(a) - rankOf(b))[0]
    : scored[scored.length - 1];

  const rest = scored.filter((s) => s !== last);
  if (strongestFirst) rest.sort((a, b) => rankOf(b) - rankOf(a) || (b.vision?.pov ? 1 : 0) - (a.vision?.pov ? 1 : 0));

  return { ordered: [...rest, last], last };
}

/* -------------------------------------------------------------------------- */
/* the loop                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * An 8x8 RGB thumbnail of one frame, as raw bytes.
 *
 * NO IMAGE DECODER, which is why it is 8x8 raw rather than a JPEG. ffmpeg will write
 * `rawvideo` straight to stdout, so 192 bytes come back and the mean colour and a
 * coarse brightness grid are arithmetic. The alternative was a dependency or a
 * temporary file per frame, for a number that only has to rank two candidates.
 *
 * Cropped to the delivery frame first, so the comparison is of pixels that ship: a
 * 16:9 source centre-cropped to 9:16 loses two thirds of its width, and comparing the
 * uncropped frames would match on footage nobody sees.
 */
export async function frameSignature(file, at = 0, { width = null, height = null } = {}) {
  const v = postConfig().clips.video;
  const w = width || v.width;
  const h = height || v.height;
  const out = await capture(ffmpegPath(), [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(Math.max(0, at)),
    '-i', file,
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},scale=8:8`,
    '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]).catch(() => null);
  if (!out || out.length < 192) return null;

  const px = [];
  for (let i = 0; i < 64; i++) {
    const r = out[i * 3];
    const g = out[i * 3 + 1];
    const b = out[i * 3 + 2];
    px.push({ r, g, b, y: 0.2126 * r + 0.7152 * g + 0.0722 * b });
  }
  const mean = (f) => px.reduce((a, p) => a + f(p), 0) / px.length;
  return { r: mean((p) => p.r), g: mean((p) => p.g), b: mean((p) => p.b), grid: px.map((p) => p.y) };
}

/**
 * How unlike each other two frames are, 0 being identical.
 *
 * COLOUR AND LAYOUT, WEIGHTED TOWARD COLOUR. A cut between two frames of the same
 * brightness in the same arrangement is the one a viewer does not notice, and on a
 * loop the cut is from the last frame to the first. The grid term is what makes it
 * about framing rather than only about tint: two shots can share a mean colour and
 * put the horizon in different places.
 *
 * Normalised to roughly 0..1 so the threshold in the config means something.
 */
export function loopDistance(a, b) {
  if (!a || !b) return null;
  const colour = (Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)) / 3 / 255;
  const grid = a.grid.reduce((s, y, i) => s + Math.abs(y - b.grid[i]), 0) / a.grid.length / 255;
  return 0.6 * colour + 0.4 * grid;
}

function capture(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => {
      err += d.toString();
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))
    );
  });
}

/* -------------------------------------------------------------------------- */
/* the card                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One text state, as a transparent PNG.
 *
 * THE SAME TREATMENT THE POSTCARD REEL ESTABLISHED, which is the only reason this is
 * allowed to put four elements on a frame that used to carry one. No box, no backdrop,
 * no scrim shaped like a text block: a tight shadow on the letterforms themselves,
 * and a gradient running off the TOP edge only when the measurement says the footage
 * cannot carry white type. Both of those are quoted from renderPostcardPng, and the
 * reason is in its own note - "a scrim sized to a text block is a box with soft edges,
 * and a box is what every reference this account is modelled on does without".
 *
 * WHERE EACH ELEMENT SITS, and every one of these numbers is a decision:
 *
 *   hook, full size   the upper third, exactly where the postcard puts it. Unchanged.
 *   open loop         under the hook, two thirds the size. It is a subordinate clause
 *                     of the same sentence and reads as one.
 *   header            11% from the top. Clear of TikTok's own search bar, which is
 *                     why the full-size hook sits at 20% and not higher, and small
 *                     enough that it is furniture rather than a second message.
 *   counter           just under the header, centred, bold. Its own line because
 *                     "2/3" beside a sentence reads as part of the sentence.
 *   place name        the LOWER band, 68%, which is where this project's own `label`
 *                     slide look puts a place name. It moved down because the top is
 *                     now occupied, and it moved to a position the house style
 *                     already uses rather than to a new one.
 *   question          under the place name, at 76%, inside the bottom safe area the
 *                     measurement already excludes for the caption rail.
 */
export function retentionCardHtml({ card, width, height, spot = null }) {
  const big = Math.round(width * 0.058);
  const loop = Math.round(width * 0.039);
  const header = Math.round(width * 0.032);
  const counter = Math.round(width * 0.036);
  const label = Math.round(width * 0.042);
  const ask = Math.round(width * 0.038);

  // How much help the footage needs, on the postcard's own curve. Deliberately
  // generous because a moving background changes under every word, and an unmeasured
  // clip gets the help: not knowing is the risky case, not the safe one.
  const contrast = Number(spot?.contrast);
  const a = !Number.isFinite(contrast) ? 0.26 : contrast < 6 ? Math.min(0.5, (6 - contrast) / 7 + 0.16) : 0;

  const shadow = (px) => `text-shadow: 0 2px 6px rgba(0,0,0,.55), 0 0 ${Math.round(px * 0.7)}px rgba(0,0,0,.4);`;
  const el = (cls, text, style) => (text ? `<div class="${cls}" style="${style}">${escapeHtml(text)}</div>` : '');

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family: 'Assistant'; src: url(${assistantDataUri()}) format('truetype'); font-weight: 200 800; font-display: block; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
body { position: relative; -webkit-font-smoothing: antialiased; font-family: 'Assistant', sans-serif; color: #fff; }
${a ? `.lift { position:absolute; inset-inline:0; top:0; height:${Math.round(height * 0.46)}px;
        background:linear-gradient(180deg, rgba(6,8,12,${a.toFixed(2)}) 0%, rgba(6,8,12,${(a * 0.5).toFixed(2)}) 48%, rgba(6,8,12,0) 100%); }` : ''}
/* A second gradient off the BOTTOM edge, and only when there is something down there
   to read. Same argument as the top one: a gradient to a frame edge has no shape to
   notice, and the place name moved into the lower band where nothing was lifting it. */
${a ? `.liftLow { position:absolute; inset-inline:0; bottom:0; height:${Math.round(height * 0.34)}px;
        background:linear-gradient(0deg, rgba(6,8,12,${(a * 0.9).toFixed(2)}) 0%, rgba(6,8,12,${(a * 0.4).toFixed(2)}) 52%, rgba(6,8,12,0) 100%); }` : ''}
.block { position:absolute; inset-inline:${Math.round(width * 0.1)}px; text-align:center; text-wrap:balance; }
.hook { top:${Math.round(height * 0.2)}px; font-weight:800; font-size:${big}px; line-height:1.26; ${shadow(big)} }
.loop { top:${Math.round(height * 0.2 + big * 1.26 * 2 + big * 0.5)}px; font-weight:700; font-size:${loop}px;
        line-height:1.3; opacity:.95; ${shadow(loop)} }
.header { top:${Math.round(height * 0.11)}px; font-weight:700; font-size:${header}px; line-height:1.25;
          opacity:.92; ${shadow(header)} }
.counter { top:${Math.round(height * 0.11 + header * 1.25 * 2 + header * 0.35)}px; font-weight:800;
           font-size:${counter}px; letter-spacing:.02em; ${shadow(counter)} }
.label { top:${Math.round(height * 0.68)}px; font-weight:700; font-size:${label}px; line-height:1.25; ${shadow(label)} }
.ask { top:${Math.round(height * 0.76)}px; font-weight:800; font-size:${ask}px; line-height:1.25; ${shadow(ask)} }
</style></head><body>
${a && (card.big || card.headerHe || card.counterHe) ? '<div class="lift"></div>' : ''}
${a && (card.labelHe || card.questionHe) ? '<div class="liftLow"></div>' : ''}
${el('block hook', card.big ? card.hookHe : null, '')}
${el('block loop', card.big ? card.openLoopHe : null, '')}
${el('block header', card.headerHe, '')}
${el('block counter', card.counterHe, '')}
${el('block label', card.labelHe, '')}
${el('block ask', card.questionHe, '')}
</body></html>`;
}

/** One card, rendered. Same browser and same context settings as every other overlay. */
export async function renderRetentionCard({ card, width, height, file, spot = null }) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'he-IL' });
  const page = await context.newPage();
  try {
    await page.setContent(retentionCardHtml({ card, width, height, spot }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(file, await page.screenshot({ type: 'png', omitBackground: true }));
    return file;
  } finally {
    await context.close().catch(() => {});
  }
}
