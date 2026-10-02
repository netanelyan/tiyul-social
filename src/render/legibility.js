import { sampleGrids, scrimAlpha, underScrim, CONTRAST_WHITE, toSrgb, toLinear } from './photo.js';

/**
 * THE CONTRAST GATE. No slide ships with text that cannot be read.
 *
 * WHY THIS IS A MODULE AND NOT A NUMBER IN A TEMPLATE. The rule, in the owner's words:
 * "one bad slide makes a whole deck useless". A viewer who hits an unreadable slide on
 * swipe four does not squint at it, they leave - so the cost of a single bad slide is
 * not one bad slide, it is the rest of the post. That makes legibility the one property
 * here that cannot be a default with exceptions. It has to be a gate every slide passes
 * through, and it has to be able to CHANGE THE DESIGN of a slide that would fail rather
 * than merely reporting that it did.
 *
 * WHAT WAS ACTUALLY WRONG, because it is worth writing down. The previous version
 * measured the scrim off the photograph and was correct in every line except one:
 *
 *     const grid = grids[i];
 *     if (!src || !grid?.length) return null;
 *
 * `sampleGrids` returns `{lum, sat, hue}` - an OBJECT with flat arrays on it, not an
 * array of rows. `grid.length` on that object is `undefined`, so the guard fired for
 * every image ever measured, `measureVeils` returned null for all of them, and every
 * template silently fell back to the worst-photograph constant it was written with. The
 * measurement existed, was tested, was documented, and never ran once. A bright sky got
 * the same 0.58 wash as a night shot, which is exactly the complaint.
 *
 * So the gate below is deliberately built so that silence is impossible: it returns a
 * predicted contrast ratio for every slide, and `assertLegible` throws with the slide
 * index and the number when one is under target. A measurement that stops working now
 * fails the build instead of dimming the type.
 *
 * THREE DECISIONS, each of which the previous version got wrong or did not make:
 *
 *   1. THE WORST PATCH, NOT THE BRIGHTEST ROW. A row mean averages the full width of
 *      the frame. A sunlit wall behind three words at the end of a line is a quarter of
 *      that row and vanishes into its mean, and those three words are the ones that
 *      stop reading. So the band is scanned with a window the size of ONE LINE OF TYPE,
 *      in both halves of the width, and the worst window wins.
 *
 *   2. NO SILENT CEILING. The old code capped the alpha at 0.72 and returned the cap,
 *      so a photograph that needed 0.9 got 0.72 and shipped under target with nothing
 *      said. A cap is a reasonable thing to want - past about 0.62 a gradient stops
 *      looking like a photograph and starts looking like a grey card - but the answer
 *      to "this picture needs more than a gradient can give" is a DIFFERENT TREATMENT,
 *      not the same treatment underpowered.
 *
 *   3. ESCALATION, AND NEITHER STEP OF IT IS A BOX.
 *
 *      The first version escalated to a PLATE - a translucent rounded panel with a
 *      backdrop blur behind the type. It reached the contrast target perfectly and it
 *      looked, in the owner's words, "not professional at all". That judgement is
 *      correct and worth recording, because the reasoning that produced the plate was
 *      sound and the result was still wrong:
 *
 *        A floating panel ALWAYS reads as a patch. It has edges that belong to nothing
 *        in the photograph, the backdrop blur drags the picture's colour through it so
 *        it is never a clean fill, and a viewer reads it as the design having run into
 *        trouble - which it had. Every reference this account is modelled on puts type
 *        straight onto the photograph with no box anywhere.
 *
 *      So both treatments are GRADIENTS ANCHORED TO A FRAME EDGE, and the difference
 *      between them is only how far they go:
 *
 *        veil - a soft wash over the text's band. Gentle, keeps the photograph bright,
 *               what the platform's own player already does over a caption.
 *        band - the same wash, heavier and taller, running to near-opaque AT THE EDGE
 *               of the frame. It can go much darker than a veil without ever looking
 *               like a panel, because it has no far edge: it bleeds off the frame, the
 *               way a graduated filter does on a photograph. This is the floor nothing
 *               falls through, and it always reaches target because its dark end is as
 *               dark as it needs to be.
 */

/**
 * The contrast ratio white type must clear, after treatment.
 *
 * 7.0 is WCAG AAA for body text. That is a stricter target than a 60px bold headline
 * strictly needs, and it is chosen deliberately: the thing being protected is not a
 * person reading a paragraph at arm's length, it is a thumb pausing on a phone held at
 * a glance in daylight. The headroom between "passes AA" and "reads instantly" is the
 * whole difference the owner is pointing at.
 */
export const TARGET = 7.0;

/**
 * The heaviest SOFT wash that still leaves the photograph looking untouched.
 *
 * Past this a veil starts to flatten the picture, and the answer is not a heavier veil
 * of the same shape - it is the band below, which puts the weight at the frame edge
 * where the photograph was going to be cropped by the player anyway.
 */
export const VEIL_MAX = 0.62;

/**
 * The lightest band worth drawing, at its darkest point.
 *
 * A band is a gradient to the frame edge, so this is the alpha AT THE EDGE and not an
 * average: the end nearest the middle of the picture is always transparent. That is why
 * it can be this heavy and still read as a photograph rather than as a panel.
 */
export const BAND_MIN = 0.72;

/**
 * The treatment for a slide whose photograph could not be measured at all.
 *
 * A band, not a light veil. An unmeasurable image is exactly the case the
 * worst-photograph constant was written for, and the worst photograph there is - a
 * white sky - is one a soft wash cannot carry. Choosing the treatment that always works
 * costs one slide a little brightness and cannot cost the post a reader.
 */
export const UNMEASURED = Object.freeze({ treatment: 'band', alpha: 0.82, ratio: null, measured: false });

/**
 * Where a look puts its type, as [x0, y0, x1, y1] in fractions of the frame.
 *
 * These are read off the templates rather than guessed, and they are the reason the
 * measurement is worth anything: measuring the middle of the frame and then setting the
 * type across the bottom measures a part of the picture nobody reads over.
 */
export const TEXT_BOXES = {
  'label.cover': [0.07, 0.3, 0.93, 0.82],
  'label.mid': [0.07, 0.26, 0.93, 0.74],
  'label.lower': [0.07, 0.56, 0.93, 0.95],
  collage: [0.06, 0.3, 0.94, 0.7],
  route: [0.06, 0.12, 0.94, 0.95],
  notes: [0.08, 0.14, 0.92, 0.92],
  roll: [0.08, 0.2, 0.92, 0.66],
  deck: [0.07, 0.55, 0.93, 0.95],
  site: [0.07, 0.1, 0.93, 0.9],
};

/**
 * The brightest window the size of one line of type anywhere in the box.
 *
 * `grid` is what sampleGrids returns: `{lum}`, a flat gw*gh array in LINEAR luminance.
 * The window is one line tall and half the box wide, stepped by a quarter of itself, so
 * a bright patch cannot hide between two sample positions.
 */
export function worstPatch(grid, { gw, gh, box, lines = 3 }) {
  const lum = grid?.lum;
  if (!lum?.length) return null;

  const [fx0, fy0, fx1, fy1] = box;
  const x0 = Math.max(0, Math.floor(fx0 * gw));
  const x1 = Math.min(gw, Math.ceil(fx1 * gw));
  const y0 = Math.max(0, Math.floor(fy0 * gh));
  const y1 = Math.min(gh, Math.ceil(fy1 * gh));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;

  // One line of type, in grid cells. `lines` is how many lines the box is expected to
  // hold; a taller window averages away the very patch this function exists to find.
  const winH = Math.max(1, Math.round((y1 - y0) / Math.max(1, lines)));
  const winW = Math.max(1, Math.round((x1 - x0) / 2));
  const stepY = Math.max(1, Math.round(winH / 4));
  const stepX = Math.max(1, Math.round(winW / 4));

  let worst = 0;
  for (let y = y0; y + winH <= y1 || y === y0; y += stepY) {
    for (let x = x0; x + winW <= x1 || x === x0; x += stepX) {
      let sum = 0;
      let n = 0;
      for (let yy = y; yy < Math.min(y + winH, y1); yy++) {
        for (let xx = x; xx < Math.min(x + winW, x1); xx++) {
          sum += lum[yy * gw + xx];
          n++;
        }
      }
      if (n) worst = Math.max(worst, sum / n);
    }
  }
  return worst;
}

/**
 * The treatment one measured luminance needs to carry white type at TARGET.
 *
 * `floor` is not legibility, it is composition: it is what makes the type read as a
 * deliberate block rather than as words that happened to land somewhere dark.
 */
export function treatmentFor(lum, { floor = 0.2 } = {}) {
  if (!Number.isFinite(lum)) return { ...UNMEASURED };

  const needed = scrimAlpha(lum, { want: TARGET, floor, ceiling: 1 });
  if (needed <= VEIL_MAX) {
    return {
      treatment: 'veil',
      alpha: Math.round(needed * 100) / 100,
      ratio: round2(CONTRAST_WHITE(underScrim(lum, needed))),
      measured: true,
    };
  }

  // A soft wash cannot get there without flattening the picture, so the weight moves to
  // the frame edge. Sized the same way - the lightest band that clears target - so a
  // photograph that only just needed one gets a band you can barely see.
  const alpha = Math.max(BAND_MIN, needed);
  return {
    treatment: 'band',
    alpha: Math.round(Math.min(0.96, alpha) * 100) / 100,
    ratio: round2(CONTRAST_WHITE(underScrim(lum, Math.min(0.96, alpha)))),
    measured: true,
  };
}

/**
 * Plan the treatment for a list of slides in one pass.
 *
 * `items` is [{ src, box, lines, floor }] - one per slide, with `src` null for a slide
 * that has no photograph (which needs no treatment and gets none). Returns one plan per
 * item, positionally, so a caller can zip it straight back onto its slides.
 *
 * ONE BROWSER PASS for the whole post, because sampleGrids opens a context per call and
 * a 26-slide list post would otherwise pay that 26 times.
 */
export async function planLegibility(items, { onError = null } = {}) {
  const list = items || [];
  const srcs = list.map((it) => it?.src || null);
  if (!srcs.some(Boolean)) return list.map(() => null);

  let grids = [];
  try {
    grids = await sampleGrids(srcs, { gw: GW, gh: GH });
  } catch (err) {
    // Named, never swallowed. This is the failure that hid for a week.
    const say = onError || ((m) => console.error(m));
    say(`legibility: could not sample ${srcs.filter(Boolean).length} image(s) - ${err.message}`);
    grids = [];
  }

  return list.map((it, i) => {
    if (!it?.src) return null;
    const grid = grids[i];
    if (!grid?.lum?.length) return { ...UNMEASURED };
    const raw = worstPatch(grid, {
      gw: GW,
      gh: GH,
      box: it.box || TEXT_BOXES['label.lower'],
      lines: it.lines || 3,
    });
    // WHAT THE TEMPLATE ALREADY DOES TO THE PICTURE, APPLIED BEFORE THE DECISION.
    //
    // The grounded looks (route, notes, roll) draw their photograph under a CSS
    // `brightness()` and behind a blur. Measuring the raw file and then rendering it at
    // .62 brightness sizes every treatment for a picture that is not the one on screen,
    // which is how a slide ends up over-darkened. `gain` is the template's own factor.
    //
    // The blur needs no correction here: blurring averages, and `worstPatch` already
    // averages over a window far larger than any blur radius, so the number it returns
    // is close to the blurred one by construction.
    const lum = Number.isFinite(raw) && it.gain ? toLinear(Math.max(0, Math.min(1, toSrgb(raw) * it.gain))) : raw;
    return treatmentFor(lum, { floor: it.floor ?? 0.2 });
  });
}

/**
 * THE GATE. Throws if any planned slide would ship under target.
 *
 * It cannot fire for a measured slide, because `treatmentFor` escalates to a band that
 * always reaches target - which is the point. What it catches is the class of bug that
 * caused this module to exist: a measurement path that silently stops producing numbers.
 * If that happens again the build stops instead of the type going dim.
 */
export function assertLegible(plans, { where = 'post' } = {}) {
  const bad = (plans || [])
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p && p.measured && Number.isFinite(p.ratio) && p.ratio < TARGET - 0.05);
  if (bad.length) {
    const detail = bad.map(({ p, i }) => `slide ${i + 1} at ${p.ratio}:1 (${p.treatment} ${p.alpha})`).join(', ');
    throw new Error(`${where}: ${bad.length} slide(s) under the ${TARGET}:1 contrast target - ${detail}`);
  }
  return plans;
}

/**
 * Which of a post's photographs makes the best blurred ground.
 *
 * "a blurred image of the place the post talks about. ONE THAT LOOKS NICE" - and once
 * it is blurred past recognition, "nice" stops being about subject and becomes about
 * two measurable things:
 *
 *   COLOUR. A blurred photograph is reduced to its colour field, so a saturated one
 *   becomes a rich wash and a grey one becomes a grey rectangle - which is the gradient
 *   this exists to replace, arrived at the long way round.
 *
 *   MIDTONE. A blown-out sky blurs to near-white and a night shot blurs to near-black.
 *   Both need so much tint on top to carry type that nothing of the picture survives.
 *   The ones that stay a photograph under a tint are the ones that started in the middle.
 *
 * Returns the chosen source, or the first available when nothing could be measured -
 * a ground that was not scored is still better than a gradient.
 */
export async function pickGround(sources, { onError = null } = {}) {
  const list = (sources || []).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return list[0];

  let grids = [];
  try {
    grids = await sampleGrids(list, { gw: 24, gh: 36 });
  } catch (err) {
    (onError || ((m) => console.error(m)))(`legibility: could not score grounds - ${err.message}`);
    return list[0];
  }

  let best = list[0];
  let bestScore = -1;
  for (const [i, grid] of grids.entries()) {
    if (!grid?.lum?.length) continue;
    const n = grid.lum.length;
    let lum = 0;
    let sat = 0;
    for (let k = 0; k < n; k++) {
      lum += grid.lum[k];
      sat += grid.sat[k];
    }
    lum /= n;
    sat /= n;
    // Peaks at a mid luminance and falls off towards both ends; colour is a straight
    // bonus. The exact weights are a judgement, and the shape is the part that matters.
    const midness = 1 - Math.min(1, Math.abs(lum - 0.22) / 0.3);
    const score = midness * 0.65 + Math.min(1, sat / 0.45) * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = list[i];
    }
  }
  return best;
}

// The grid the gate measures on. Finer than the card scorer's 48x60 because the window
// is one line of type tall: at 60 rows a line of a three-line block is 20 cells and the
// window cannot be stepped inside it.
const GW = 64;
const GH = 96;

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

export const __test = { GW, GH, round2 };
