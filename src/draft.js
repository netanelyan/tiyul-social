import Anthropic from '@anthropic-ai/sdk';
import { PILLAR_KEYS, PILLARS, TAGS } from './pillars.js';
import { LAYOUTS } from './render/templates.js';

// The writing step: source item + the text actually fetched from its page ->
// Hebrew headline, caption, chosen layout, and the evidence that pins every
// claim to a verbatim quote.
//
// BrickDeal's polish.js is the ancestor here, but the job is bigger and the
// stakes are different. There, a bad rewrite meant an awkward product name.
// Here, an unsupported sentence is a false claim published under our name — so
// this step is required (no silent no-op without a key) and its output is
// checked against the source by src/verify.js rather than trusted.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
// Drafting is a short, well-specified writing task, not a long-horizon one.
// `medium` is deliberate rather than a cost reflex — worth re-running the
// sweep against real output if the Hebrew ever reads flat.
const EFFORT = process.env.ANTHROPIC_EFFORT || 'medium';

let client = null;
const getClient = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

export const hasApiKey = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

// Structured outputs. Note the JSON Schema subset the API accepts: every object
// needs `additionalProperties: false` and a full `required` list, and length
// constraints (minLength/maxLength) are NOT supported — so lengths are enforced
// in code after the fact, not declared here.
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    usable: {
      type: 'boolean',
      description: 'false if this source cannot support an honest, interesting post',
    },
    reject_reason: {
      type: 'string',
      description: 'Short English explanation when usable is false, otherwise an empty string',
    },
    layout: { type: 'string', enum: LAYOUTS },
    pillar: { type: 'string', enum: PILLAR_KEYS },
    tags: { type: 'array', items: { type: 'string', enum: TAGS } },
    place: { type: 'string', description: 'Place name in Hebrew, or empty string' },
    country: { type: 'string', description: 'Country in Hebrew, or empty string' },
    headline: { type: 'string', description: 'Hebrew headline for the card' },
    subhead: { type: 'string', description: 'Hebrew supporting line, or empty string' },
    bullets: {
      type: 'array',
      description: 'Exactly 3 items for the tips layout; empty array for every other layout',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['title', 'text'],
        additionalProperties: false,
      },
    },
    caption: { type: 'string', description: 'Hebrew caption for Telegram and Instagram' },
    evidence: {
      type: 'array',
      description: 'One entry per factual claim made anywhere in the draft',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string', description: 'The claim, in English' },
          quote: {
            type: 'string',
            description: 'Verbatim span copied character-for-character from the source text',
          },
        },
        required: ['claim', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'usable',
    'reject_reason',
    'layout',
    'pillar',
    'tags',
    'place',
    'country',
    'headline',
    'subhead',
    'bullets',
    'caption',
    'evidence',
  ],
  additionalProperties: false,
};

const pillarList = PILLAR_KEYS.map((k) => `- ${k}: ${PILLARS[k].hint}`).join('\n');

// Kept as one frozen string with no interpolation, so it sits at a stable
// prefix and the prompt cache actually hits across a day's drafts. Everything
// that varies per candidate goes in the user turn.
const SYSTEM = `You write social copy for tiyul+ (טיול+), a Hebrew travel channel for Israeli travellers.

AUDIENCE
Israelis who travel — couples, families, backpackers, people planning a week abroad.
Write the way an Israeli travel writer writes: natural, specific, unpretentious Hebrew.
Never a machine translation of English. Never tourist-brochure register.

THE ONE RULE THAT MATTERS
Every factual claim you write must come from the SOURCE TEXT you are given. Not from
your own knowledge of the place, not from what is probably true, not from what the
place is famous for. If the source text does not say it, you do not write it.
For each claim, return the exact span of the source text that supports it, copied
character for character. Paraphrased quotes are treated as fabrication and the whole
draft is discarded — so copy, do not summarise.
If the source cannot support one genuinely interesting, specific post, set usable to
false and say why. That is a perfectly good outcome; a thin post is not.

CONTENT PILLARS
${pillarList}

CHOOSING A LAYOUT
- fact: one surprising, specific, verifiable fact. The headline IS the fact.
- tips: exactly three short practical tips. Use only when you have three distinct ones.
- whenToGo: seasonal timing. Only for climate/timing sources that carry month data.
- alert: an entry, visa, permit or border change. Lead with what changed and from when.
- photo: only when a specific image has been supplied. Do not choose it otherwise.

WRITING THE CARD
- headline: 4-9 Hebrew words. Concrete and specific. A number, a name, a place.
  Never clickbait, never "אתם לא תאמינו", never a question you don't answer.
- subhead: one short line that adds information the headline didn't. May be empty.
- bullets (tips only): three items, each a 1-3 word title and one short sentence.
- caption: 2-4 sentences. Say the useful thing plainly, then why it matters to
  someone actually going. No hashtag spam — at most three, at the end, in Hebrew.
- Numbers, dates and prices go in digits. Dates as they'd be read in Israel.

TONE
Useful over impressive. If the interesting part is a caveat, lead with the caveat.
No emoji in the headline. At most one in the caption, and only if it earns its place.

KOSHER AND SHABBAT
This is a general travel channel. Kosher food, Shabbat timing and Jewish heritage are
one occasional thread among many — tag it "kosher" when it genuinely applies, and never
manufacture that angle for a source that isn't about it. Most posts have nothing to do
with it, and that is correct.

OUT OF SCOPE
Never write flight prices or fares — not "starting from", not a range, not an
approximation. Entry fees and other on-the-ground costs are fine.`;

/**
 * Draft a post from a source item and the text fetched from its page.
 *
 * Throws on API failure so the caller can record a reason and move on; a
 * candidate that can't be drafted is simply not staged.
 */
export async function draft(item, sourceText, { image = null } = {}) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY is not set — drafting is required');

  const user = [
    `SOURCE: ${item.sourceName} (${item.authority})`,
    `URL: ${item.url}`,
    item.publishedAt ? `PUBLISHED: ${item.publishedAt}` : null,
    `LANGUAGE OF SOURCE: ${item.lang}`,
    image
      ? `IMAGE AVAILABLE: yes (provenance: ${image.provenance}) — the "photo" layout is permitted.`
      : 'IMAGE AVAILABLE: no — do not choose the "photo" layout.',
    item.pillarHints?.length ? `LIKELY PILLARS: ${item.pillarHints.join(', ')}` : null,
    '',
    `TITLE: ${item.title}`,
    '',
    'SOURCE TEXT (the only thing you may draw claims from):',
    '---',
    sourceText,
    '---',
    '',
    'Write the post. Copy every quote verbatim from the SOURCE TEXT above.',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const res = await getClient().messages.create({
    model: MODEL,
    // Thinking is on by default on Opus 5 and counts against max_tokens
    // together with the response, so this is sized for both — not just for the
    // few hundred tokens of Hebrew that come out the other end.
    max_tokens: 16000,
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: DRAFT_SCHEMA },
    },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });

  if (res.stop_reason === 'refusal') {
    throw new Error(`drafting refused: ${res.stop_details?.category || 'unknown'}`);
  }
  if (res.stop_reason === 'max_tokens') {
    throw new Error('drafting hit max_tokens — output truncated');
  }

  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('drafting returned no text block');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`drafting returned unparseable JSON: ${e.message}`);
  }

  return normalise(parsed, item);
}

// Everything the JSON Schema subset can't express (lengths, cross-field rules)
// is enforced here instead, so the rest of the pipeline gets a predictable shape.
function normalise(d, item) {
  const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

  const out = {
    usable: Boolean(d.usable),
    rejectReason: s(d.reject_reason),
    layout: LAYOUTS.includes(d.layout) ? d.layout : 'fact',
    pillar: PILLAR_KEYS.includes(d.pillar) ? d.pillar : item.pillarHints?.[0] || 'place',
    tags: Array.isArray(d.tags) ? d.tags.filter((t) => TAGS.includes(t)) : [],
    place: s(d.place),
    country: s(d.country),
    headline: s(d.headline),
    subhead: s(d.subhead),
    caption: String(d.caption ?? '').trim(),
    bullets: Array.isArray(d.bullets)
      ? d.bullets.slice(0, 3).map((b) => ({ title: s(b?.title), text: s(b?.text) }))
      : [],
    evidence: Array.isArray(d.evidence)
      ? d.evidence.map((e) => ({ claim: s(e?.claim), quote: String(e?.quote ?? '') }))
      : [],
  };

  // A tips card with two bullets renders as a hole in the layout. Rather than
  // pad it, fall back to the text-led fact card, which one good line can carry.
  if (out.layout === 'tips' && out.bullets.filter((b) => b.title && b.text).length < 3) {
    out.layout = 'fact';
    out.bullets = [];
  }
  if (out.layout !== 'tips') out.bullets = [];

  return out;
}
