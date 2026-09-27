// A photograph of the real page, taken with a real browser.
//
// THE WHOLE POINT IS THAT IT IS NOT A MOCKUP.
//
// BRIEF.md rule 3 asks for the product in half the posts and the plan format
// was the one route a program could take to it: draw the itinerary rather than
// film the screen. That was honest and it was also a drawing. This is the
// screen, captured from tiyulplus.com at the moment the post was built, and
// the rule it has to keep is the one post-config.json has carried since the
// plan format shipped: no slide may imitate a screen the product does not
// have. A screenshot cannot, by construction.
//
// WHY THE CAPTURE MUST NEVER BE ALLOWED TO HALF-SUCCEED.
//
// Every other failure in this pipeline is loud: a stop with no photograph is
// dropped and named on the approval card, a quote that does not match refuses
// the draft. This one is different, because a page that loaded its shell and
// none of its content screenshots perfectly happily, and what publishes is a
// phone frame with an empty white rectangle in it under the words "המסלול
// המלא". That is worse than no slide at all: it is an advertisement for a page
// that appears to be broken.
//
// So the capture is checked rather than trusted, and every check that does not
// pass returns null, which puts the ordinary follow slide back. Never an empty
// phone.
//
// AND IT MUST NOT BE COUNTED AS A VISIT. These captures happen on the build,
// unattended, several times a day, from a datacentre. Left alone they would
// arrive in the site's own analytics as real sessions with a 100% bounce rate
// and no scroll, which is a measurement problem rather than a traffic one: the
// number this whole change exists to move would be moved by the change
// measuring itself. Analytics and tag managers are aborted at the network
// layer, before the request leaves.

import { getBrowser } from '../render/index.js';

const BASE = process.env.TIYULPLUS_BASE || 'https://www.tiyulplus.com';

/** A phone, at the size the frame on the slide is drawn to hold. */
export const SHOT = { width: 390, height: 844, scale: 2 };

// Hosts that exist to count this visit. Matched on a substring of the request
// URL rather than on an exact host, because the same collector is reached at
// several names and a new one appearing is likelier than one of these moving.
const COUNTERS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'doubleclick.net',
  'facebook.net',
  'connect.facebook.com',
  '/gtag/',
  'plausible.io',
  'vercel-insights.com',
  'vitals.vercel-insights.com',
];

export const isCounter = (url) => COUNTERS.some((c) => String(url || '').includes(c));

/**
 * The destination page, as a PNG data URI, or null.
 *
 * Null on anything at all going wrong, and the caller's job is to carry on
 * without it. The reasons are returned alongside so the approval card can say
 * which one it was: "the site slide is missing" and "the site slide is missing
 * because the page 404s" need different things done about them, and the second
 * one means the slug is wrong.
 */
export async function captureSitePage(slug, { timeoutMs = 20_000, base = BASE } = {}) {
  const clean = String(slug || '').trim();
  if (!clean) return { image: null, why: 'no slug' };

  const url = `${base}/destinations/${clean}`;
  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      viewport: { width: SHOT.width, height: SHOT.height },
      deviceScaleFactor: SHOT.scale,
      locale: 'he-IL',
      // The page is ours and it is light. Forcing dark here would screenshot a
      // theme the visitor who follows the link will not see, which makes the
      // slide a picture of somewhere else.
      colorScheme: 'light',
      isMobile: true,
      hasTouch: true,
    });

    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const target = route.request().url();
      if (isCounter(target)) return route.abort();
      return route.continue();
    });

    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    if (!res) return { image: null, why: 'no response' };
    if (!res.ok()) return { image: null, why: `HTTP ${res.status()}` };

    // Did the page actually put anything on the screen?
    //
    // networkidle says the requests stopped, which a shell that failed to
    // hydrate satisfies perfectly. These two ask the question the screenshot
    // is about to answer visually: is there Hebrew text on it, and is there
    // more than a header's worth of it.
    const filled = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return { chars: text.trim().length, hebrew: /[֐-׿]/.test(text) };
    });
    if (!filled.hebrew || filled.chars < 200) {
      return { image: null, why: `page looks empty (${filled.chars} chars)` };
    }

    const buf = await page.screenshot({ type: 'png' });
    // A screenshot of a blank page is small. The floor is deliberately low: it
    // is a backstop under the content check above rather than the check
    // itself, and a real page at this size lands two orders of magnitude over.
    if (!buf || buf.length < 20_000) return { image: null, why: `screenshot too small (${buf?.length || 0}b)` };

    return { image: `data:image/png;base64,${buf.toString('base64')}`, why: null, url };
  } catch (e) {
    return { image: null, why: e.message };
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * The deck, with its screenshot, or the deck with the site slide taken off it.
 *
 * THE FALLBACK IS A FIELD EDIT, and that is the whole trick. "Keep the old
 * follow slide when the capture fails" sounds like a branch in the renderer,
 * and written that way it would be wrong twice over: src/deck/follow.js would
 * have to learn that a deck can claim a site slide and not get one, and the
 * Instagram ten-image check would already have counted a slide that is not
 * going to exist.
 *
 * So a failed capture clears `siteSlug` instead, before anything counts
 * anything. Downstream there is no failure to handle: the deck simply never
 * had a site slide, hasFollowSlide goes back to true, and the arithmetic in
 * follow.js is right without knowing any of this happened.
 *
 * Called ONCE per deck rather than per size. Both sizes draw the same page and
 * a second capture would be a second page load, a second seven seconds, and a
 * second visit to block from the analytics.
 */
export async function withSiteShot(deck, opts = {}) {
  if (!deck?.siteSlug) return { deck, shot: null, why: null };
  const { image, why } = await captureSitePage(deck.siteSlug, opts);
  if (image) return { deck, shot: image, why: null };
  return { deck: { ...deck, siteSlug: null }, shot: null, why };
}
