import { askJson } from '../claude.js';

// Sorting what the search found, ten posts to a call, on the cheap model.
//
// The questions are all ones a caption can answer: is it Hebrew, is it a
// creator showing a trip or a person asking how to plan one, which destination,
// which places it names, and does it show people asking for the route. Nothing
// here writes text anybody reads; a wrong answer costs one lead out of thirty,
// which is the trade the mechanical tier is for.
//
// GENDER COMES FROM GRAMMAR, NEVER FROM A NAME. "הייתי ממש מתרגשת" is evidence;
// "Noa" is not. When the text has no first-person form, the answer is
// "unknown" and the toggle starts on the template's own default.

const SYSTEM = `You sort social media posts found by a travel site's growth tool. The audience is Israeli; most posts are in Hebrew.

For each post return:
- hebrew: true if the post text is mainly Hebrew.
- kind: "creator" if the author shows or tells about their own trip (a vlog, a route, recommendations they give); "customer" if the author is planning a trip and asks for advice or a route; "other" for anything else (ads, agencies, news, songs, unrelated).
- destination: the most specific city, island or region the post is about, in Hebrew as Israelis write it (for example "קורפו", "פוקט", "צפון תאילנד"). The country only when the post names nothing more specific. Empty string if none.
- places: specific attractions, sites, neighbourhoods or restaurants the text names, as written. Empty list if none. Not cities or countries.
- routeDemand: true only if the text says people ask the author for the route or itinerary, or offers to send it (for example "המון שאלתם על המסלול", "המסלול בתגובות", "כתבו לי ואשלח").
- asksForRoute: true only if the author explicitly asks for a route, itinerary or day plan (not just a single tip).
- days: the trip length in days if the text states it, else 0.
- gender: "f" or "m" only from the author's first-person Hebrew grammar in the text (for example "הייתי מתרגשת" is f, "טסתי לבד והייתי בטוח" is m). Never from a name. Otherwise "unknown".
- reason: a short Hebrew phrase saying why you chose the kind.

- siteDestination: the destination from the SITE LIST below that the post is actually about: the same city, or one whose area contains the places the post names (Pai is inside "צפון תאילנד"; Phuket is "פוקט"). A neighbouring region or merely the same country is NOT a match: Corfu is not "אתונה", Naples is not "סיציליה". If the post covers several listed destinations, the one it names first. Copy the name exactly as written in the list. Empty string if none of its places is inside a listed destination, or if it is about Israel.

Judge only from the text given. Do not guess what the video shows.`;

const siteList = (names) => `\n\nSITE LIST (destinations our site has pages for):\n${names.join(' | ')}`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          hebrew: { type: 'boolean' },
          kind: { type: 'string', enum: ['creator', 'customer', 'other'] },
          destination: { type: 'string' },
          places: { type: 'array', items: { type: 'string' } },
          routeDemand: { type: 'boolean' },
          asksForRoute: { type: 'boolean' },
          days: { type: 'integer' },
          gender: { type: 'string', enum: ['f', 'm', 'unknown'] },
          reason: { type: 'string' },
          siteDestination: { type: 'string' },
        },
        required: ['i', 'hebrew', 'kind', 'destination', 'places', 'routeDemand', 'asksForRoute', 'days', 'gender', 'reason', 'siteDestination'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

export const BATCH = 10;

/**
 * Classify posts. `posts` are { text, author, platform }; returns one verdict
 * per post in the same order (null where the model skipped one).
 */
export async function classify(posts, { state, settings, destinations = [] }) {
  const out = new Array(posts.length).fill(null);
  // The site's own list goes in the system prompt, which is the same for every
  // batch of the run and so is cached after the first.
  const system = destinations.length ? SYSTEM + siteList(destinations) : SYSTEM;
  for (let start = 0; start < posts.length; start += BATCH) {
    const batch = posts.slice(start, start + BATCH);
    const user = batch
      .map((p, j) => `#${j}\nplatform: ${p.platform}\nauthor: ${p.author || ''}\ntext: ${String(p.text || '').slice(0, 900)}`)
      .join('\n\n');
    const res = await askJson({ state, settings, model: settings.models.sort, system, user, schema: SCHEMA, maxTokens: 2800, estimate: 0.02 });
    for (const v of res.items || []) {
      if (Number.isInteger(v.i) && v.i >= 0 && v.i < batch.length) out[start + v.i] = v;
    }
  }
  return out;
}

/* ------------------------------------------------------------ agencies */

// Keywords could not tell a travel agency from a Jerusalem walking-tour company
// whose homepage welcomes "תיירים מחו"ל": both say the word. A reader can, and
// one cheap call reads a whole Places page of them at once.
const AGENCY_SYSTEM = `A travel-planning site wants to reach Israeli travel agencies. You check businesses found on Google Maps.

For each business return, in this order:
- reason: a short Hebrew phrase saying who its clients are and where they travel.
- sellsAbroad: true only if its clients are people in Israel who fly ABROAD with it (a travel agency, an organiser of group trips abroad). false for incoming tourism (bringing foreign tourists into Israel), tour guides in Israel, tours inside Israel, attractions, farms, hotels, restaurants, shops, and anything unclear. It must agree with the reason.
- kosherAudience: true if it serves kosher, religious or Shabbat-observant travellers.

Judge only from the name, the Google types and the homepage text given.`;

const AGENCY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { i: { type: 'integer' }, reason: { type: 'string' }, sellsAbroad: { type: 'boolean' }, kosherAudience: { type: 'boolean' } },
        required: ['i', 'reason', 'sellsAbroad', 'kosherAudience'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

/** One verdict per business, in order (null where the model skipped one). */
export async function classifyAgencies(list, { state, settings }) {
  const out = new Array(list.length).fill(null);
  if (!list.length) return out;
  const user = list
    .map((a, j) => `#${j}\nname: ${a.name}\ntypes: ${(a.types || []).join(', ')}\nhomepage: ${String(a.snippet || '(could not be read)').slice(0, 1200)}`)
    .join('\n\n');
  const res = await askJson({ state, settings, model: settings.models.sort, system: AGENCY_SYSTEM, user, schema: AGENCY_SCHEMA, maxTokens: 2000, estimate: 0.03 });
  for (const v of res.items || []) if (Number.isInteger(v.i) && v.i >= 0 && v.i < list.length) out[v.i] = v;
  return out;
}
