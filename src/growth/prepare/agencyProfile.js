import { draftEstimate } from '../../clients/budget.js';
import { askJson } from '../claude.js';
import { destinations } from '../find/queries.js';
import { siteSlugFor } from '../../plan/site.js';
import { agencyPage } from '../../clients/http.js';
import { resolveDestination } from './site.js';

// Who an agency is, read off its own site, and which of our pages to show it.
//
// THE PRAGUE MISTAKE, 2026-10-11: an agency that runs organised trips to Egypt
// was sent a sample itinerary for Prague, because the sample was picked by a
// hash of the lead's id over eight popular pages. Nothing the agency sells was
// ever read. So now, for each agency picked for today:
//
//   1. its homepage and at most two of its own pages that look like trips or
//      destinations are read (GET only, same host, nothing behind a login);
//   2. one Sonnet call turns that text into the destinations it sells and who
//      its clients are, every item with the words it was taken from; an item
//      whose quote is not really on the page is dropped in code;
//   3. those destinations are matched to the cities in our catalog, and the
//      example is a route on one of them (prepare/index.js publishes it);
//   4. when none of them is in our catalog, a route on one of our most complete
//      destinations is used, and the card says why. (Until 2026-10-11 that was
//      the site's own itinerary page, which cannot be repaired when it fails the
//      route check; the route is built from the same itinerary and fixed.)
//
// The homepage text is kept on the lead (up to 6,000 characters), because the
// draft's one specific detail is quoted from it and checked against it.

const SITE_CHARS = 6000;
const TRIPISH = /trip|tour|travel|destin|packag|טיול|טיולים|יעד|יעדים|חבילות|נופש|מסלול|מסלולים|ארצות|מדינות/i;

/** Up to `n` same-host links whose address or text looks like trips or destinations. */
export function tripLinks(html, base, n = 2) {
  let origin;
  try {
    origin = new URL(base);
  } catch {
    return [];
  }
  const out = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u;
    try {
      u = new URL(m[1], origin);
    } catch {
      continue;
    }
    if (u.hostname !== origin.hostname || !/^https?:$/.test(u.protocol)) continue;
    if (u.pathname === origin.pathname || /\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(u.pathname)) continue;
    const label = m[2].replace(/<[^>]+>/g, ' ');
    if (!TRIPISH.test(decodeURIComponent(u.pathname)) && !TRIPISH.test(label)) continue;
    const href = `${u.origin}${u.pathname}`;
    if (!out.includes(href)) out.push(href);
    if (out.length >= n) break;
  }
  return out;
}

/** The agency's own pages, as text: the homepage and up to two trip pages. */
export async function readAgencySite(lead, { fetchPage = agencyPage } = {}) {
  if (!lead.website) return { text: '', pages: [] };
  const home = await fetchPage(lead.website);
  const pages = [lead.website];
  let text = home.text || '';
  for (const url of tripLinks(home.html, lead.website)) {
    try {
      const p = await fetchPage(url);
      text += `\n\n${p.text || ''}`;
      pages.push(url);
    } catch {
      /* one unreadable page is not a reason to lose the others */
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim().slice(0, SITE_CHARS), pages };
}

const SYSTEM = `You read a travel agency's own website and say what it sells, for someone who is about to write to them.

Return only what the text says. Every item carries "quote": the exact words from the text it came from, copied verbatim, a few words long. Items without a quote, or with words that are not in the text, are thrown away.

- destinations: the countries, regions or cities they sell trips to, as named in the text ("מצרים", "אוזבקיסטן", "צפון איטליה"). Their names in Hebrew when the text is Hebrew.
- clientele: who their clients are, if the text says ("קבוצות דתיות", "משפחות", "גמלאים"). Empty when it does not say.
- tripTypes: the kind of trips ("טיולים מאורגנים", "טיולי שורשים", "ירח דבש"). Empty when it does not say.`;

const SCHEMA = {
  type: 'object',
  properties: {
    destinations: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, quote: { type: 'string' } }, required: ['name', 'quote'], additionalProperties: false } },
    clientele: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, quote: { type: 'string' } }, required: ['label', 'quote'], additionalProperties: false } },
    tripTypes: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, quote: { type: 'string' } }, required: ['label', 'quote'], additionalProperties: false } },
  },
  required: ['destinations', 'clientele', 'tripTypes'],
  additionalProperties: false,
};

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const onPage = (quote, text) => {
  const q = flat(quote);
  return q.length >= 2 && flat(text).includes(q);
};

/**
 * The agency's profile from its pages and its Google listing. Items whose quote
 * is not in the text are dropped here, whatever the model said.
 */
export async function extractProfile({ state, settings, lead, siteText, now = Date.now() }) {
  const listing = [lead.name, lead.address].filter(Boolean).join('. ');
  const text = `${listing}\n\n${siteText || ''}`;
  const out = await askJson({
    state,
    settings,
    model: settings.models.extract,
    system: SYSTEM,
    user: `GOOGLE LISTING:\n${listing}\n\nTHEIR WEBSITE:\n${siteText || '(could not be read)'}`,
    schema: SCHEMA,
    maxTokens: 6000,
    effort: 'low',
    estimate: draftEstimate(settings.models.extract, { inTokens: 4000, outTokens: 1500 }),
    tag: 'extract:agency',
  });
  const keep = (list, field) => (list || []).filter((x) => flat(x[field]) && onPage(x.quote, text)).map((x) => ({ [field]: flat(x[field]), quote: flat(x.quote) }));
  return {
    at: new Date(now).toISOString(),
    siteText: siteText || '',
    destinations: keep(out.destinations, 'name'),
    clientele: keep(out.clientele, 'label'),
    tripTypes: keep(out.tripTypes, 'label'),
  };
}

/**
 * Our catalog cities that this agency sells, best first.
 *
 * A city named outright wins; a country they sell resolves to its first city
 * in destinations.json's order (where this audience flies), as resolveDestination
 * does for posts. The agency's own name counts too: "עמק המלכים - טיולים
 * מאורגנים למצרים" says Egypt before any page is read.
 */
export function soldCities(lead, options, preferred = destinations().map(siteSlugFor)) {
  const said = [...(lead.profile?.destinations || []).map((d) => d.name)];
  const fromName = /(?:^|\s)ל([א-ת"׳']{3,})(?=\s|$|,)/g;
  for (const m of String(lead.name || '').matchAll(fromName)) said.push(m[1]);
  const out = [];
  for (const s of said) {
    const hit = resolveDestination(s, options, preferred);
    if (hit && !out.some((o) => o.option.slug === hit.slug)) out.push({ option: hit, said: s });
  }
  return out;
}

/**
 * The example for this agency: a route on a city they sell, or the closest page.
 *
 * Returns { kind: 'route', slug, he, said, reason } when one of their
 * destinations is in our catalog (prepare/index.js builds and publishes the
 * route), else { kind: 'route', fallback: true, slug, he, reason } on the city
 * `fallback` picks.
 */
export function chooseExample(state, lead, { fallback, preferred } = {}) {
  const options = state.site?.options || [];
  const sold = soldCities(lead, options, preferred);
  if (sold.length) {
    const s = sold[0];
    const names = (lead.profile?.destinations || []).map((d) => d.name);
    return {
      kind: 'route',
      slug: s.option.slug,
      he: s.option.name,
      said: s.said,
      reason: `They sell ${names.length ? names.join(', ') : s.said}; ${s.option.name} is in our catalog, so the example is a route there.`,
    };
  }
  const page = fallback?.(state, lead) || null;
  const names = (lead.profile?.destinations || []).map((d) => d.name);
  return page
    ? {
        kind: 'route',
        fallback: true,
        slug: page.slug,
        he: page.he,
        reason: names.length
          ? `None of what they sell (${names.join(', ')}) is in our catalog, so the example is a route on ${page.he}, one of the most complete destinations we have.`
          : `Their site did not say which destinations they sell, so the example is a route on ${page.he}, one of the most complete destinations we have.`,
      }
    : null;
}
