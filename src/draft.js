import Anthropic from '@anthropic-ai/sdk';
import { PILLAR_KEYS, PILLARS, TAGS } from './pillars.js';
import { LAYOUTS } from './render/templates.js';
import { record as recordUsage } from './usage.js';

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
    // Layout-specific payloads. The JSON Schema subset the API accepts requires
    // every property to be listed in `required`, so these are always present and
    // are filled with empty strings when the chosen layout doesn't use them.
    // normalise() below falls the layout back when its payload is incomplete.
    stat: {
      type: 'object',
      description: 'For the numbers layout. Empty strings otherwise.',
      properties: {
        value: { type: 'string', description: 'The figure itself, digits only, e.g. "2,576"' },
        unit: { type: 'string', description: 'Short unit in Hebrew, e.g. "מדרגות", or empty' },
        label: { type: 'string', description: 'One short Hebrew line saying what the figure counts' },
      },
      required: ['value', 'unit', 'label'],
      additionalProperties: false,
    },
    compare: {
      type: 'object',
      description: 'For the compare layout: a is the wrong belief, b is what is actually true.',
      properties: {
        aTitle: { type: 'string' },
        aText: { type: 'string' },
        bTitle: { type: 'string' },
        bText: { type: 'string' },
      },
      required: ['aTitle', 'aText', 'bTitle', 'bText'],
      additionalProperties: false,
    },
    route: {
      type: 'object',
      description: 'For the route layout. Never include a fare anywhere in these fields.',
      properties: {
        from: { type: 'string', description: 'Origin in Hebrew, almost always "תל אביב"' },
        to: { type: 'string', description: 'Destination in Hebrew' },
        operator: { type: 'string', description: 'Airline in Hebrew, or empty' },
        startsOn: { type: 'string', description: 'When it starts, as an Israeli reader would write it, or empty' },
      },
      required: ['from', 'to', 'operator', 'startsOn'],
      additionalProperties: false,
    },
    image_query: {
      type: 'string',
      description:
        'ENGLISH search terms for a stock photograph to sit behind the card, 2-5 words. ' +
        'Empty string for a text-led layout. Stock libraries index in English, so this ' +
        'is never Hebrew.',
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
    'stat',
    'compare',
    'route',
    'image_query',
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
Pick the one the content actually fits. A layout whose payload you cannot fill
honestly is the wrong layout — say so by choosing another, never by padding.

Text-led (no photograph needed — these are the default):
- fact: one surprising, specific, verifiable fact. The headline IS the fact.
- numbers: when a single figure carries the story. Fill "stat" with the figure
  in digits and a short unit. The card shows the figure and the headline and
  nothing else, so the headline must be the whole point - do not also restate it
  in the subhead. Only when the number is genuinely striking on its own.
- compare: a widely held belief that the source contradicts. Fill "compare":
  a is the wrong belief, b is what the source actually says. Only when the
  source really does contradict something, never as a rhetorical frame.
- tips: exactly three short practical tips. Use only when you have three distinct ones.
- whenToGo: seasonal timing. Only for climate/timing sources that carry month data.
- alert: an entry, visa, permit or border change. Lead with what changed and from when.
- route: a new or returning route out of Tel Aviv. Fill "route" with origin,
  destination, operator and start date. Never a fare, in any field.

Photo-led (ONLY when IMAGE AVAILABLE below says yes; otherwise forbidden, and
the card would fall back to a text layout anyway).

When you choose one of these, fill "image_query" with 2-5 ENGLISH words naming
what should be behind the card. Name the actual place when the post is about a
place - "Lisbon old town alley", "Kyoto wooden bridge", "Faroe Islands cliffs".
Describe the scene you want, not the abstract idea: "Tokyo metro platform"
finds something; "Japanese efficiency" does not.

Prefer a text-led layout when the story is a number, a rule or a comparison. A
photograph behind an arrivals statistic is decoration; behind a hidden village
it is the content. If the picture would only be wallpaper, do not ask for one.
- photoFull: full-bleed picture, headline and one supporting line over the
  bottom of it. The strongest choice when the place itself is the story.
- photoBand: picture on top, a solid band of type beneath. Best when the
  supporting line needs more room than a scrim can carry legibly.
- photoFrame: inset picture with a gallery caption under it. Quieter, good for
  a single object or detail rather than a landscape.

WHAT THE CARD IS FOR
The card is a hook, not the post. Someone scrolling gives it under a second.
It carries the headline and, at most, one short line. Everything else - the
context, the caveat, the practical detail - goes in the caption underneath.

The failure mode to avoid is a card that reads like a paragraph: a headline,
then a supporting line, then another line restating the same fact in different
words. If your subhead is saying what the headline already said, leave it empty.
Empty is a good answer. A card with four lines of type on it is a card nobody
finishes reading.

WRITING THE CARD
- headline: 4-9 Hebrew words. Concrete and specific. A number, a name, a place.
  Never clickbait, never "אתם לא תאמינו", never a question you don't answer.
- subhead: ONE short line, under about twelve words, adding something the
  headline did not say. Often the right answer is an empty string. Never a
  second sentence, never a restatement.
- bullets (tips only): three items, each a 1-3 word title and one short sentence.
- caption: SHORT. Two or three sentences, and stop. It is read under a picture
  on a phone, not as an article. Say the useful thing plainly, then why it
  matters to someone actually going. Do not restate the headline - it is
  already the largest thing on the card. At most three hashtags, at the end.

  The caption expands the HEADLINE'S subject. It is not a summary of the page.
  A source often mentions several unrelated things; picking up each one in turn
  produces a caption that starts on your subject and then wanders. If the
  headline is about a beach in Normandy, the caption is about that beach - not
  also about a site removed from a list in Vienna, the global total, and where
  next year's meeting is. Those facts are true and sourced and still do not
  belong. One subject per post; the rest is somebody else's post.
- Numbers, dates and prices go in digits. Dates as they'd be read in Israel.

TONE
Useful over impressive. If the interesting part is a caveat, lead with the caveat.
No emoji in the headline. At most one in the caption, and only if it earns its place.

SOUNDING LIKE A PERSON
Write the way someone who has actually been there would write it to a friend who
is about to go. That is a real constraint, not a vibe. In practice:

- Never open with a rhetorical question, and never open with "ידעתם ש...".
- Never announce the post ("היום נדבר על...", "אז מה חשוב לדעת?"). Start with the thing.
- No summing-up line at the end. When you have said it, stop. Do not add
  "אז אם אתם מתכננים..." or "שווה לזכור".
- Vary the rhythm. Not every sentence the same length, not every post the same shape.
- Drop adjectives that carry no information: מדהים, מרהיב, קסום, חלומי, בלתי נשכח.
  A specific detail does the work an adjective is pretending to do.
- Prefer the concrete noun to the general one. "השוק בשבת בבוקר", not "חוויה מקומית".
- It is fine to sound slightly dry, or to admit something is a hassle. That reads
  as someone who went. Relentless enthusiasm reads as an advert.
- At most three hashtags, at the very end, and only ones a person would actually
  search. No hashtag stuffing.

PUNCTUATION
Use a plain hyphen (-) only. Never an em dash or an en dash. This applies to the
headline, the subhead, the caption and every list item.

TAGS
Optional, and an empty list is the normal answer. Tag only what the post is
actually about: "nature" for a coastline, "city" for an urban post, "food" for
a food one. A tag that is merely adjacent is worse than none, because the tags
are what the topic-balance report is computed from - a mis-tag quietly skews it.

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
export async function draft(item, sourceText, { imagesAvailable = false } = {}) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY is not set — drafting is required');

  const user = [
    `SOURCE: ${item.sourceName} (${item.authority})`,
    `URL: ${item.url}`,
    item.publishedAt ? `PUBLISHED: ${item.publishedAt}` : null,
    `LANGUAGE OF SOURCE: ${item.lang}`,
    imagesAvailable
      ? 'IMAGE AVAILABLE: yes - licensed stock can be fetched, so the photo layouts are permitted. Fill image_query if you choose one.'
      : 'IMAGE AVAILABLE: no - the photo layouts are forbidden; leave image_query empty.',
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

  recordUsage(res.usage, MODEL);

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
// Em dashes and en dashes are asked for in the prompt and enforced here, because
// a prompt is a request and this needed to be a guarantee. They are also one of
// the more reliable tells that copy was machine-written, so a stray one undoes
// the "sounds like a person" work in a single character.
//
// Spacing is collapsed alongside the substitution: " — " becomes " - " rather
// than "  -  ", and a dash used as a range ("2-3") stays tight.
// Note the character classes: [^\S\n] is "whitespace except a newline". The
// caption is multi-line, and a naive \s* here silently swallows the line breaks
// around a dash, turning a three-line caption into one run-on paragraph.
export function hyphensOnly(text) {
  return String(text ?? '')
    // A range keeps its dash tight: "2–3 ימים" -> "2-3 ימים", not "2 - 3 ימים".
    .replace(/(\d)[^\S\n]*[—–][^\S\n]*(\d)/g, '$1-$2')
    .replace(/[^\S\n]*[—–][^\S\n]*/g, ' - ')
    .replace(/[^\S\n]{2,}/g, ' ');
}

function normalise(d, item) {
  const s = (v) => hyphensOnly(String(v ?? '').replace(/\s+/g, ' ').trim()).trim();

  const out = {
    usable: Boolean(d.usable),
    rejectReason: s(d.reject_reason),
    layout: LAYOUTS.includes(d.layout) ? d.layout : 'fact',
    pillar: PILLAR_KEYS.includes(d.pillar) ? d.pillar : item.pillarHints?.[0] || 'place',
    tags: Array.isArray(d.tags) ? d.tags.filter((t) => TAGS.includes(t)) : [],
    imageQuery: s(d.image_query),
    place: s(d.place),
    country: s(d.country),
    headline: s(d.headline),
    subhead: s(d.subhead),
    caption: hyphensOnly(String(d.caption ?? '')).trim(),
    bullets: Array.isArray(d.bullets)
      ? d.bullets.slice(0, 3).map((b) => ({ title: s(b?.title), text: s(b?.text) }))
      : [],
    stat: { value: s(d.stat?.value), unit: s(d.stat?.unit), label: s(d.stat?.label) },
    compare: {
      aTitle: s(d.compare?.aTitle),
      aText: s(d.compare?.aText),
      bTitle: s(d.compare?.bTitle),
      bText: s(d.compare?.bText),
    },
    route: {
      from: s(d.route?.from) || 'תל אביב',
      to: s(d.route?.to),
      operator: s(d.route?.operator),
      startsOn: s(d.route?.startsOn),
    },
    evidence: Array.isArray(d.evidence)
      ? d.evidence.map((e) => ({ claim: s(e?.claim), quote: String(e?.quote ?? '') }))
      : [],
  };

  // A layout whose payload came back incomplete renders as a hole — a tips card
  // with two bullets, a numbers card with no number. Rather than pad it with
  // filler, fall back to the fact card, which one good line can carry on its
  // own. Same principle as the photo layouts degrading when there is no image.
  const complete = {
    tips: () => out.bullets.filter((b) => b.title && b.text).length === 3,
    numbers: () => Boolean(out.stat.value),
    compare: () => Boolean(out.compare.aTitle && out.compare.aText && out.compare.bTitle && out.compare.bText),
    route: () => Boolean(out.route.to),
  };
  if (complete[out.layout] && !complete[out.layout]()) out.layout = 'fact';

  // Clear payloads the surviving layout doesn't use, so nothing unused reaches
  // the renderer or the store.
  if (out.layout !== 'tips') out.bullets = [];

  return out;
}
