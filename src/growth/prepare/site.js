import { fetchCities } from '../../plan/site.js';
import { getJson, getText } from '../../clients/http.js';
import { SITE } from '../links.js';

// Our own site's data: which destinations it covers, its curated itineraries,
// its place catalog, and which itinerary pages are live.
//
// Every fact a draft may state about a destination comes from here. The full
// city record goes through fetchCities in src/plan/site.js, the same reader the
// posting pipeline uses, so the desk and the posts can never disagree about
// what the site says.

/** The site's whole city list, for resolving a destination named in a post. */
export async function fetchOptions() {
  const body = await getJson(`${SITE}/api/cities?options=1`, { timeoutMs: 20_000 });
  return (body?.options || []).map((o) => ({
    slug: o.slug,
    name: String(o.name || ''),
    nameLocal: String(o.nameLocal || ''),
    country: String(o.country || ''),
    haystack: String(o.haystack || ''),
  }));
}

/** The live /itinerary/<slug>/<days> pages, read from the public sitemap. */
export async function fetchItineraries() {
  const body = await getText(`${SITE}/sitemap.xml`);
  const out = [];
  const seen = new Set();
  for (const m of String(body).matchAll(/\/itinerary\/([a-z0-9-]+)\/(\d+)/g)) {
    const k = `${m[1]}/${m[2]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ slug: m[1], days: Number(m[2]) });
  }
  return out;
}

/** Refresh the cached site lists once a day. Keeps the old copy if the site is down. */
export async function refreshSite(state, { now = Date.now(), force = false } = {}) {
  const age = now - Date.parse(state.site?.at || 0);
  if (!force && state.site?.options?.length && age < 20 * 3_600_000) return state.site;
  try {
    const [options, itineraries] = await Promise.all([fetchOptions(), fetchItineraries().catch(() => state.site?.itineraries || [])]);
    if (options.length) state.site = { at: new Date(now).toISOString(), options, itineraries };
  } catch {
    /* the previous copy stands; a stale city list is still the right list */
  }
  return state.site;
}

/* ------------------------------------------------------------ matching */

// Hebrew without the things that make the same word look different: niqqud,
// geresh, quotes, punctuation, and a one-letter prefix (ב, ל, מ, ה, ו).
export const normHe = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳'"״`’]/g, '')
    .replace(/[^\p{L}\p{N}\s/|-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const PREFIXES = ['וב', 'ול', 'ומ', 'וה', 'שב', 'של', 'ב', 'ל', 'מ', 'ה', 'ו'];
const unprefixed = (w) => {
  for (const p of PREFIXES) if (w.startsWith(p) && w.length - p.length >= 3) return w.slice(p.length);
  return w;
};

/**
 * Which site city a destination named in a post means, or null.
 *
 * A city by its Hebrew or local name first. A COUNTRY ("יוון") resolves to the
 * country's first city in `preferred` (destinations.json's order, which is
 * where this audience flies), or failing that the site's first city there.
 */
export function resolveDestination(text, options, preferred = [], { citiesOnly = false } = {}) {
  const want = normHe(text);
  if (!want || !options?.length) return null;
  const words = new Set(want.split(' ').flatMap((w) => [w, unprefixed(w)]));
  const nameHit = (o) => {
    // The site's haystack lists the country too; a country is not a city name,
    // and matching it here would skip the preferred-city choice below.
    const country = normHe(o.country);
    const names = [o.name, ...o.nameLocal.split('/'), ...o.haystack.split('|')].map(normHe).filter((n) => n && n !== country);
    return names.some((n) => n === want || n === unprefixed(want) || (n.length >= 3 && (words.has(n) || (n.includes(' ') && want.includes(n)))));
  };
  const city = options.find(nameHit);
  if (city || citiesOnly) return city || null;

  const country = options.find((o) => {
    const c = normHe(o.country);
    return c && (c === want || c === unprefixed(want) || words.has(c));
  });
  if (!country) return null;
  const inCountry = options.filter((o) => o.country === country.country);
  for (const slug of preferred) {
    const hit = inCountry.find((o) => o.slug === slug);
    if (hit) return hit;
  }
  return inCountry[0] || null;
}

/**
 * Catalog places a post names, matched by Hebrew or local name.
 *
 * Deterministic and strict: a name matches a place when one contains the other
 * after normalising, and the shorter side is at least four letters. A wrong
 * match puts the wrong place first in somebody's route, which is worse than
 * leaving one of theirs out, so ties and fragments are dropped.
 */
export function matchPlaces(names, places) {
  const matched = [];
  const unmatched = [];
  const used = new Set();
  for (const raw of names || []) {
    const n = normHe(raw);
    const n2 = n
      .split(' ')
      .map(unprefixed)
      .join(' ');
    if (n.length < 3) continue;
    // 3: the same name. 2: the catalog name starts with it ("האקרופוליס" is
    // "האקרופוליס והפרתנון", not "מוזיאון האקרופוליס"). 1: one contains the other.
    const strength = (p) => {
      let best = 0;
      for (const c of [p.name, ...String(p.nameLocal || '').split('/')].map(normHe).filter(Boolean)) {
        const short = Math.min(c.length, n2.length);
        if (c === n || c === n2) best = Math.max(best, 3);
        else if (short < 4) continue;
        else if (c.startsWith(n) || c.startsWith(n2)) best = Math.max(best, 2);
        else if (c.includes(n2) || n2.includes(c) || c.includes(n) || n.includes(c)) best = Math.max(best, 1);
      }
      return best;
    };
    const hits = (places || [])
      .filter((p) => !used.has(p.id))
      .map((p) => ({ p, s: strength(p) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || Math.abs(normHe(a.p.name).length - n.length) - Math.abs(normHe(b.p.name).length - n.length));
    if (hits.length) {
      const hit = hits[0].p;
      used.add(hit.id);
      matched.push({ said: String(raw), id: hit.id, name: hit.name });
    } else {
      unmatched.push(String(raw));
    }
  }
  return { matched, unmatched };
}

/**
 * The destination of one post: what the post says, sharpened by what was searched.
 *
 * A post that names a city resolves to that city. A post that only names a
 * country or a region ("דרום איטליה", "קפריסין") resolves to the SEARCHED city
 * when that city is in the same country: the search for נאפולי found it, so
 * Naples beats the country's default of Rome. Countries in `skip` (Israel, by
 * default: the site plans trips abroad) resolve to nothing.
 */
export function postDestination(said, searched, options, preferred = [], skip = []) {
  const opts = (options || []).filter((o) => !skip.includes(o.country));
  const city = resolveDestination(said, opts, preferred, { citiesOnly: true });
  if (city) return city;
  // A country we skip, named outright, is an answer: not ours. It must not fall
  // through to the searched city, or a hike in the Galilee becomes Naples.
  if (said && (options || []).some((o) => skip.includes(o.country) && normHe(said).includes(normHe(o.country)))) return null;
  const hint = searched ? resolveDestination(searched, opts, preferred, { citiesOnly: true }) : null;
  if (!said) return hint;
  const country = resolveDestination(said, opts, preferred);
  if (country && hint && hint.country === country.country) return hint;
  // The post came up for a searched place the site does not have (Corfu) and
  // names only its country: it is most likely about that place, and the
  // country's default city (Athens) would be somebody else's route.
  if (country && searched && !hint) return null;
  return country;
}

/**
 * Does what a post names support filing it under `opt`?
 *
 * The check behind the sorter's choice (see judge in find/index.js). `verdict`
 * is the sorter's { destination, places }, `countries` the normalised country
 * names the site uses, `city` the destination's full record when fetched.
 */
export function destinationSupported(opt, verdict, { countries = new Set(), city = null } = {}) {
  const all = [verdict?.destination, ...(verdict?.places || [])].filter(Boolean);
  // A post that names its country rules out every other country: "Himalaya"
  // fits Himachal and Kathmandu alike, and a post tagged Nepal is Kathmandu.
  const named = all.map(normHe).filter((s) => countries.has(s));
  if (named.length && !named.includes(normHe(opt.country))) return false;
  // A country name supports nothing: "יוון" is true of Corfu and Santorini alike.
  const said = all.filter((s) => !countries.has(normHe(s)));
  if (!said.length) return false;
  const names = [opt.name, ...String(opt.nameLocal || '').split('/'), ...String(opt.haystack || '').split('|')]
    .map(normHe)
    .filter((n) => n.length >= 3 && !countries.has(n));
  if (said.some((s) => names.some((n) => normHe(s).includes(n)))) return true;
  return Boolean(city && matchPlaces(said, city.places).matched.length);
}

/** The full city record, or null when the site does not cover it. */
export async function cityFor(slug) {
  if (!slug) return null;
  return (await fetchCities([slug])).get(slug) || null;
}

/**
 * What a draft may know about a destination, as compact Hebrew text.
 *
 * The itinerary (day titles, the places in order, the site's own notes), the
 * best season, and the must-see places with the first sentence of their
 * description. This text plus the post is the ENTIRE world the drafting call
 * sees, which is what makes "facts only from the post or from our site" a
 * property of the input rather than an instruction.
 */
export function siteContext(city, { maxPlaces = 18 } = {}) {
  if (!city) return '';
  const byId = new Map((city.places || []).map((p) => [p.id, p]));
  const firstSentence = (s) => String(s || '').split(/(?<=[.!?])\s/)[0].slice(0, 220);
  const lines = [`יעד: ${city.name}${city.tagline ? ` (${city.tagline})` : ''}`];
  if (city.bestSeason) lines.push(`העונה הטובה: ${typeof city.bestSeason === 'string' ? city.bestSeason : JSON.stringify(city.bestSeason)}`);
  if (city.practical?.gettingAround) lines.push(`התניידות: ${city.practical.gettingAround}`);
  if (city.practical?.kosherOverview) lines.push(`כשרות: ${firstSentence(city.practical.kosherOverview)}`);
  lines.push('', 'המסלול באתר:');
  for (const d of (city.itinerary || []).slice().sort((a, b) => a.day - b.day)) {
    const names = (d.placeIds || []).map((id) => byId.get(id)?.name).filter(Boolean);
    lines.push(`יום ${d.day}: ${d.title || ''}. ${names.join(', ')}${d.notes ? `. ${d.notes}` : ''}`);
  }
  const top = (city.places || []).filter((p) => p.mustSee).concat((city.places || []).filter((p) => !p.mustSee));
  lines.push('', 'מקומות:');
  for (const p of top.slice(0, maxPlaces)) lines.push(`- ${p.name}: ${firstSentence(p.description)}`);
  return lines.join('\n');
}
