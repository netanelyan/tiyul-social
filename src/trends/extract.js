import Anthropic from '@anthropic-ai/sdk';
import { getBytes } from '../clients/http.js';
import { claudeCost, guard, record as recordSpend } from '../clients/budget.js';
import { modelFor, outputConfig } from '../models.js';
import { record as recordUsage } from '../usage.js';
import { fill } from '../posts/voice.js';

// The format of a post that works, never its content.
//
// The existing vision pattern (src/video/vision.js judgeThumb): the thumbnail is
// fetched into memory, sent as an image block with the title, against a cached
// system prompt and a JSON schema. What comes back is the SHAPE: a hook as a
// Hebrew template with placeholders, a topic type, a look, the slide structure and
// the caption style, all abstract.
//
// WHAT IS NEVER KEPT, AND THE CHECK THAT HOLDS IT. TikTok deprioritises copied
// content and its guidelines rule out copying from other platforms; and none of
// their words or claims are ours to print. So:
//   - the image is never written anywhere; the bytes live for one request
//   - a card is refused if any field repeats three consecutive words of the
//     source's title or description, or if the hook carries a digit (a count is
//     {n}, filled from our data) or a Latin word (a name from the source)
//   - the card keeps the source's link and numbers, for the report, and nothing
//     else of it

const MODEL = () => modelFor('judgement');

let client = null;
const getClient = () => (client ??= new Anthropic());
export const setClient = (c) => {
  client = c;
};

const SYSTEM = `You study travel slideshows and short videos that are doing well, to learn their FORMAT for a Hebrew travel account. You never copy their content.

From the cover image and the title, return:
- isTravelFormat: true only if this is a travel tips, itinerary, budget, comparison or list format that could be made about any destination.
- hookShapeHe: the cover's opening line as a reusable HEBREW template, in natural spoken Hebrew, with {dest} for the destination and {n} for any count. No names of places, people or brands, no numbers (use {n}), no words copied from the title. Example shapes: "{n} דברים שכדאי לדעת לפני {dest}", "כמה עולה יום ב{dest}?", "{dest}: שווה או לא שווה".
- topicType: what the post's cover PROMISES, as one of:
  know_before: a counted list of practical things to know before going (flights, getting around, season, booking, costs)
  itinerary: a plan of a set number of days, a day at a time
  budget: what a trip or a day there costs
  places_list: a counted list of places to see
  versus: whether a destination is worth it, or one place against another
  mistakes, dont: mistakes or things not to do
  hidden_gems: secret, hidden or "real" places, off the beaten track
  other: anything else (food, a single moment, a story, news, behind the scenes)
  When the cover does not clearly promise one of the first five, choose other.
- look: one of native_text (big text over a photo), notes_app, photo_led, illustrated, map, other.
- slideStructure: in Hebrew, how the slides are likely ordered, abstractly (for example "שער, פריט אחד בכל שקף, שקף סיכום").
- captionStyle: in Hebrew, abstractly (for example "שאלה קצרה ובקשה לשמור").
- why: a short Hebrew phrase on what makes the format work.

Describe only the structure. Never repeat the title's wording.`;

const SCHEMA = {
  type: 'object',
  properties: {
    isTravelFormat: { type: 'boolean' },
    hookShapeHe: { type: 'string' },
    topicType: { type: 'string', enum: ['mistakes', 'budget', 'itinerary', 'hidden_gems', 'versus', 'dont', 'know_before', 'places_list', 'other'] },
    look: { type: 'string', enum: ['native_text', 'notes_app', 'photo_led', 'illustrated', 'map', 'other'] },
    slideStructure: { type: 'string' },
    captionStyle: { type: 'string' },
    why: { type: 'string' },
  },
  required: ['isTravelFormat', 'hookShapeHe', 'topicType', 'look', 'slideStructure', 'captionStyle', 'why'],
  additionalProperties: false,
};

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Every run of three consecutive words in a text, for the copy check. */
export function trigrams(text) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/** Why a card cannot be kept, or null. The check behind "never carries source text". */
export function sourceLeak(card, source) {
  const from = new Set([...trigrams(source?.title), ...trigrams(source?.description)]);
  for (const field of ['hookShapeHe', 'slideStructure', 'captionStyle', 'why']) {
    for (const t of trigrams(card?.[field])) if (from.has(t)) return `${field} repeats the source: "${t}"`;
  }
  const hook = String(card?.hookShapeHe || '');
  if (/\d/.test(hook)) return `the hook carries a number from the source: "${hook}"`;
  if (/[A-Za-z]{2,}/.test(hook.replace(/\{(dest|n|days)\}/g, ''))) return `the hook carries a Latin word, likely a name: "${hook}"`;
  if (!hook.includes('{dest}')) return `the hook names no {dest}: "${hook}"`;
  return null;
}

/**
 * One card from one winner, or { rejected }. `item` is a found post:
 * { platform, url, title, description, thumb, views, likes, comments, lang, signal }.
 */
export async function extractCard(item, { state, settings, now = Date.now(), deps = {} } = {}) {
  const model = MODEL();
  guard(state, settings, 'claude', 0.02, now);
  const { buf, type } = await (deps.getBytes || getBytes)(item.thumb, { timeoutMs: 15_000 });
  const res = await getClient().messages.create({
    model,
    max_tokens: 700,
    output_config: outputConfig(model, 'low', SCHEMA),
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: type.split(';')[0], data: buf.toString('base64') } },
          { type: 'text', text: `Title: ${String(item.title || '').slice(0, 300)}` },
        ],
      },
    ],
  });
  recordUsage(res.usage, model);
  recordSpend(state, 'claude', { usd: claudeCost(res.usage, model), now });
  const text = res.content?.find((b) => b.type === 'text')?.text;
  let out;
  try {
    out = JSON.parse(text || '{}');
  } catch {
    return { rejected: 'the model returned no JSON' };
  }
  if (!out.isTravelFormat) return { rejected: `not a reusable travel format (${out.why || 'no reason'})` };

  const card = {
    hookShapeHe: String(out.hookShapeHe || '').trim(),
    topicType: out.topicType,
    look: out.look,
    slideStructure: String(out.slideStructure || '').trim(),
    captionStyle: String(out.captionStyle || '').trim(),
    why: String(out.why || '').trim(),
  };
  const leak = sourceLeak(card, item);
  if (leak) return { rejected: leak };
  return {
    card: {
      ...card,
      // The source as a pointer and its numbers, never its words or its picture.
      source: {
        platform: item.platform,
        url: item.url,
        lang: item.lang,
        signal: item.signal,
        publishedAt: item.publishedAt || null,
        views: item.views ?? null,
        likes: item.likes ?? null,
        comments: item.comments ?? null,
      },
    },
  };
}

// THE SECOND LOOK: does the cover promise only what the slides give?
//
// The deterministic checks in formats.js catch the shapes we have names for (a
// missing {dest}, a season, a cover with no count on a counted post). The first
// real runs showed the rest: "is it worth travelling with grandparents to {dest}"
// passes every pattern for a verdict post and promises an audience the verdict
// never addresses. Text only and short, so it costs a fraction of the vision call.

/** What each builder's slides contain, for the second look. Exactly this, nothing else. */
export const DELIVERS = {
  verdict: "a verdict on the destination: the site's rating, what is good about it, its drawbacks, and practical facts (flight time, what a day costs)",
  plan: "a day-by-day itinerary of {days} days in the destination: one slide per day with that day's places, then a summary",
  know: '4 to 7 practical facts about the destination, one per slide: the flight, getting around, when to go, what to book ahead, what a day costs',
  budget: 'what a typical day costs on the ground per person, in local currency, without flights or lodging: transport, food and activities, budget and comfort totals, free entry places, what to book ahead, and the date the figures were checked',
  list: "a numbered list of {n} places to see in the destination, one place per slide with a photograph and one line from the site's page",
};

const PROMISE_SYSTEM = `You check one cover line for a Hebrew travel slideshow against what its slides contain. The slides are built from a destination page and contain exactly what is described, nothing more.

Answer delivers=false if the cover promises anything the slides do not give: a particular audience (families, grandparents, couples, students), an activity (diving, food, nightlife), a season, a month or a date, news or what is new, a story or a personal experience, a secret or hidden place, or the cost of flights or lodging. Answer delivers=false too if the line, filled in as shown, is not natural, grammatical Hebrew. Answer delivers=true only when a reader who opened the post because of the cover would get what it promised. why: one short Hebrew sentence.`;

const PROMISE_SCHEMA = {
  type: 'object',
  properties: { delivers: { type: 'boolean' }, why: { type: 'string' } },
  required: ['delivers', 'why'],
  additionalProperties: false,
};

/** { delivers, why } for a mapped card ({ type, hook }). */
export async function checkPromise(mapped, { state, settings, now = Date.now() } = {}) {
  const model = MODEL();
  guard(state, settings, 'claude', 0.005, now);
  const res = await getClient().messages.create({
    model,
    max_tokens: 200,
    output_config: outputConfig(model, 'low', PROMISE_SCHEMA),
    system: [{ type: 'text', text: PROMISE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Cover line template ({dest} is the destination): ${mapped.hook.he}\nFilled in, for example: ${fill(mapped.hook.he, { dest: 'פראג', n: 5, days: 3 })}\nThe slides contain: ${DELIVERS[mapped.type]}`,
      },
    ],
  });
  recordUsage(res.usage, model);
  recordSpend(state, 'claude', { usd: claudeCost(res.usage, model), now });
  try {
    const out = JSON.parse(res.content?.find((b) => b.type === 'text')?.text || '{}');
    return { delivers: out.delivers === true, why: String(out.why || '').trim() };
  } catch {
    return { delivers: false, why: 'הבדיקה לא החזירה תשובה' };
  }
}
