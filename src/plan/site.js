// The itinerary the site actually publishes, as a plan.
//
// WHAT THIS CHANGES ABOUT THE CLAIM A PLAN MAKES.
//
// src/plan/write.js opens by saying the post's whole claim is "an AI planned
// this", and that the day somebody wires the real product in, that comment is
// the first thing to change. This is that day, for the destinations the site
// covers. A plan built here is not a proposal a model invented; it is the
// itinerary on tiyulplus.com/destinations/<slug>, in the site's own order, and
// the post says so.
//
// THE PRICE OF THAT IS EVERY NUMBER ON THE SLIDE.
//
// An AI plan carries a time and a shekel price per stop because a model will
// produce both on request. The site publishes neither. It has a visit length
// and a price BAND (0 to 3), and a band is not a price: printing "₪₪" on a
// slide, or converting it to shekels, would be inventing exactly the figure
// this route exists to stop inventing. So a site plan has no times, no stop
// prices, no day subtotal and no total slide, and what fills that space is the
// site's own facts: what kind of place it is, how long people spend there, and
// whether it is free to walk into.
//
// The site does also publish a sourced daily cost, with a currency, a source
// URL and a date it was checked. It is deliberately not used here: it is in the
// destination's local currency, and the rate that would turn it into the
// shekels this audience reads in is a number nobody has published. Carried
// through on the plan object so turning it on later is a decision rather than
// another fetch.

import { postConfig } from '../postConfig.js';

const BASE = process.env.TIYULPLUS_BASE || 'https://www.tiyulplus.com';

/** The API takes up to 24 slugs in one call, and says so. */
export const SLUG_BATCH = 24;

export class SiteplanError extends Error {
  constructor(message, { step, slug } = {}) {
    super(message);
    this.step = step;
    this.slug = slug;
  }
}

/**
 * Which page on the site this catalogue row is.
 *
 * Three attempts, in the order that a wrong answer costs least. An explicit
 * `siteSlug` on the row is somebody having already decided; the id is right for
 * almost every row, because the catalogue and the site were named from the same
 * list; the English name slugified is the guess, and it is last because it is
 * the one that can quietly land on a real page for a different city.
 */
export const siteSlugFor = (dest) =>
  String(dest?.siteSlug || dest?.id || '')
    .trim()
    .toLowerCase() ||
  String(dest?.en || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Destinations from the site, by slug.
 *
 * Returns a Map rather than the array the API hands back, because the caller
 * asked about particular slugs and the response carries only the ones that
 * exist. A city we do not cover is an ORDINARY answer here, the same way it is
 * in src/sources/tiyulplus.js: it means fall back to the AI route, not that
 * anything is broken, so it comes back as a missing key rather than as a throw.
 */
export async function fetchCities(slugs, { timeoutMs = 20_000 } = {}) {
  const want = [...new Set((slugs || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!want.length) return new Map();
  if (want.length > SLUG_BATCH) {
    throw new SiteplanError(`${want.length} slugs asked for, the API takes ${SLUG_BATCH}`, { step: 'slugs' });
  }

  const url = `${BASE}/api/cities?slugs=${encodeURIComponent(want.join(','))}`;
  let body;
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': process.env.PLACES_USER_AGENT || 'tiyul-plus/1.0 (own content)',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new SiteplanError(`HTTP ${res.status}`, { step: 'fetch' });
    body = await res.json();
  } catch (e) {
    if (e instanceof SiteplanError) throw e;
    throw new SiteplanError(`fetch failed: ${e.message}`, { step: 'fetch' });
  }

  return new Map((body?.cities || []).filter((c) => c?.slug).map((c) => [String(c.slug), c]));
}

// What the site calls a category, in Hebrew, for the one line under a name.
//
// The site's API answers in English here even though everything else it returns
// is Hebrew, so this table is a translation rather than a mapping: there is no
// judgement in it and no category may be left out. An unknown one contributes
// nothing to the note rather than printing an English word onto a Hebrew slide,
// which is the rule src/deck/hebrew.js applies to names.
export const CATEGORY_HE = {
  attraction: 'אטרקציה',
  historic: 'אתר היסטורי',
  museum: 'מוזיאון',
  nature: 'טבע',
  viewpoint: 'תצפית',
  cafe: 'בית קפה',
  food: 'אוכל',
  market: 'שוק',
  shopping: 'שופינג',
  'kosher-food': 'אוכל כשר',
  'kosher-market': 'מכולת כשרה',
};

/** The categories that are the Israeli angle, and the reason for the swap below. */
export const KOSHER = new Set(['kosher-food', 'kosher-market']);

/**
 * A visit length, said the way a person says it.
 *
 * Not "45 דקות". The site stores minutes because minutes are what a database
 * stores, and a slide that prints them reads as a field rather than as advice.
 * The bands are deliberately coarse and deliberately hedged with כ: the number
 * is somebody's estimate of how long a museum takes, and rendering it to the
 * minute claims a precision the source does not have.
 */
export function durationHe(min) {
  const n = Number(min);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 35) return 'כחצי שעה';
  if (n <= 75) return 'כשעה';
  if (n <= 105) return 'כשעה וחצי';
  if (n <= 150) return 'כשעתיים';
  if (n <= 200) return 'כשלוש שעות';
  if (n < 360) return 'חצי יום';
  return 'יום שלם';
}

/**
 * The one line under a place name on a site plan's slide.
 *
 * Built from the site's own fields and nothing else. Two facts at most, because
 * the slide gives it one small line over a photograph and a third fact wraps it
 * onto the picture - the same six-word ceiling shapePlan holds AI notes to.
 *
 * Free entry outranks the visit length when both are available. "כניסה חופשית"
 * changes whether somebody goes; "כשעה" only changes when.
 */
export function noteFor(place) {
  const bits = [];
  const cat = CATEGORY_HE[String(place?.category || '').trim()];
  if (cat) bits.push(cat);
  // priceLevel 0 is a fact and priceLevel undefined is a gap, and `||` cannot
  // tell them apart. Free is the only band that may be printed: 1, 2 and 3 are
  // a scale whose top is "expensive relative to this city", which means nothing
  // on a slide without the scale beside it.
  if (Number(place?.priceLevel) === 0) bits.push('כניסה חופשית');
  else {
    const d = durationHe(place?.durationMin);
    if (d) bits.push(d);
  }
  return bits.join(' · ');
}

/**
 * One day's stops, in the site's order, cut to what a slide set can hold.
 *
 * THE KOSHER SWAP, and why it is worth a rule of its own. The site marks a
 * place kosher only where supervision was actually reported, which makes those
 * entries the one thing on the page this audience cannot get from a generic
 * guide. A day usually has five or six stops and a slide set holds four, so
 * taking the first four in order drops the kosher entry roughly whenever it is
 * not early in the day. It is swapped into the last of the four instead.
 *
 * It replaces the LAST kept stop rather than being appended, because the count
 * is what the slide set can hold and appending would silently exceed it.
 */
export function stopsForDay(place_ids, byId, { stopsMax }) {
  const all = (place_ids || []).map((id) => byId.get(id)).filter(Boolean);
  const kept = all.slice(0, stopsMax);
  if (kept.length < stopsMax) return kept;

  const already = kept.some((p) => KOSHER.has(p.category));
  if (already) return kept;
  const kosher = all.slice(stopsMax).find((p) => KOSHER.has(p.category));
  if (!kosher) return kept;
  return [...kept.slice(0, stopsMax - 1), kosher];
}

/**
 * The site's itinerary as plan days.
 *
 * STOPS AT THE FIRST SHORT DAY, and does not skip it. The day numbers on the
 * slides are the site's own day numbers, so a viewer who opens the page after
 * seeing the post finds יום 3 saying what יום 3 said. Skipping a thin day would
 * renumber everything after it and quietly make the post disagree with the page
 * it is advertising. Prague is the live example: seven days, of which day six
 * is a two-stop trip out to Kutná Hora, so a Prague plan is five days.
 */
export function planDaysFrom(city, { days, stopsMin, stopsMax }) {
  const byId = new Map((city?.places || []).map((p) => [p.id, p]));
  const out = [];
  const dropped = [];

  for (const day of (city?.itinerary || []).slice().sort((a, b) => (a.day || 0) - (b.day || 0))) {
    if (out.length >= days) break;

    const stops = stopsForDay(day.placeIds, byId, { stopsMax })
      .map((p) => ({
        // No time. The site does not publish one and a plan may not invent one.
        timeHe: null,
        nameHe: String(p.name || '').trim(),
        // What the photograph search runs on. The site's Latin name is exactly
        // the field the curator wants, and it is the reason a site stop needs
        // no transliteration step at all.
        nameEn: String(p.nameLocal || '').trim(),
        noteHe: noteFor(p),
        // Not priced, and `null` rather than 0 so nothing downstream can add it
        // up into a total. 0 means free on an AI plan; here it would mean "we
        // did not ask", and the two must not print the same.
        costIls: null,
        siteId: p.id,
        category: p.category || null,
      }))
      .filter((s) => {
        if (!s.nameHe) return false;
        // A stop with no Latin name cannot be photographed, and a stop with no
        // photograph is dropped later anyway. Refusing it here keeps the reason
        // readable on the approval card.
        if (!/[A-Za-z]{3}/.test(s.nameEn)) {
          dropped.push(`${s.nameHe} - no Latin name to search a photograph on`);
          return false;
        }
        return true;
      });

    if (stops.length < stopsMin) {
      dropped.push(`יום ${day.day}: ${stops.length} עצירות, צריך ${stopsMin} - המסלול נעצר כאן`);
      break;
    }
    out.push({ n: out.length + 1, titleHe: String(day.title || '').trim(), stops });
  }

  return { days: out, dropped };
}

/**
 * One plan, from the site, or null when the site cannot supply one.
 *
 * Null rather than throwing for the ordinary misses (no page, too few usable
 * days), because those are the cases the AI route exists to cover and the
 * caller's next line is to call it. A throw is reserved for the site being
 * broken, which is a different thing and worth seeing.
 */
export async function writeSitePlan({ dest, days = null, cfg = null } = {}) {
  const plans = cfg || postConfig().plans;
  const src = plans.source || {};
  const want = Math.min(plans.daysMax, Math.max(plans.daysMin, Math.round(Number(days) || plans.days)));

  const slug = siteSlugFor(dest);
  if (!slug) return null;

  const city = (await fetchCities([slug])).get(slug);
  if (!city) return null;

  const { days: built, dropped } = planDaysFrom(city, {
    days: want,
    stopsMin: plans.stopsMin,
    stopsMax: plans.stopsMax,
  });

  // A site page with a two-day itinerary is worse than the AI route rather than
  // better: the post promises a trip and delivers a weekend. The floor is
  // configured rather than fixed to daysMin, because "long enough to publish"
  // and "long enough to be worth switching source for" are different questions.
  const floor = Math.max(plans.daysMin, Number(src.minDays) || plans.daysMin);
  if (built.length < floor) return null;

  return {
    source: 'site',
    slug,
    url: `${BASE}/destinations/${slug}`,
    dest,
    days: built,
    // Every price field a priced plan carries, explicitly empty. Present so
    // that nothing downstream has to ask which shape of plan it is holding
    // before it can read them.
    priced: false,
    total: null,
    stopsIls: null,
    costs: null,
    budgetIls: null,
    // Carried, unused. See the note at the top of this file.
    siteCost: city.dailyCost || null,
    siteName: String(city.name || '').trim() || null,
    dropped,
  };
}
