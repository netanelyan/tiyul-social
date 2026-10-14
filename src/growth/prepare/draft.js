import { stripDashes } from '../../dashes.js';
import { draftEstimate } from '../../clients/budget.js';
import { askJson } from '../claude.js';
import { checkDraft } from './guards.js';
import { REWRITE_AT, reviewTexts } from './review.js';
import { normHe } from './site.js';
import { addressLine, fewShotBlock, systemFor } from './voice.js';

// Everything a model writes for the desk, in four kinds:
//
//   comment   a reaction to a creator's video, with one tip (optional, TikTok and Instagram)
//   creator   the first DM or email to that creator, with their route's link
//   agency    the first WhatsApp or email to an agency, with its sample route
//   reply     an answer to somebody asking how to plan a trip
//
// Each is written three times, in Netanel's voice (voice.js), from a context
// that holds everything the model may say: their own words (the video's title,
// description and top comments, or the agency's site and listing) and our
// site's data. Then:
//
//   1. code checks every variant (guards.js and tells.js): no bot tells, no
//      invented number, the length, the one link, and the one specific thing,
//      whose quote must really be in the source it names;
//   2. the variants that failed are asked for again once, with the reasons;
//   3. a separate skeptical-reader call (review.js) scores each one and
//      rewrites any that reads like a bot; a rewrite replaces the draft only if
//      it passes the same code checks, and is then scored once more.
//
// What is stored is the variants with their scores, so the card can show what
// the reviewer thought of each. A kind where no variant survives is reported
// on the card with the reasons, never shown as if it were fine.

export class DraftError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.problems = problems;
  }
}

export const VARIANTS = 3;

// Where the one specific thing may be quoted from, per kind.
const SOURCES = {
  comment: ['title', 'description', 'comment'],
  creator: ['title', 'description', 'comment'],
  agency: ['site', 'listing'],
  reply: ['question'],
};

const CHECK_KIND = { comment: 'comment', reply: 'reply', agency: 'message', creator: 'message' };

// How a creator's first message reaches them (links.js creatorContact), for the prompt.
const CHANNEL_LINE = {
  Instagram: 'an Instagram direct message.',
  TikTok: 'a TikTok direct message.',
  Email: 'an email to the business address they list.',
  none: 'not known yet. YouTube has no direct messages, so Netanel will send it as an Instagram DM or an email, whichever their channel page lists. Write it so it reads right as either.',
};

const schemaFor = (kind) => ({
  type: 'object',
  properties: {
    firstName: { type: 'string' },
    variants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          specific: {
            type: 'object',
            properties: { quote: { type: 'string' }, source: { type: 'string', enum: SOURCES[kind] } },
            required: ['quote', 'source'],
            additionalProperties: false,
          },
        },
        required: ['text', 'specific'],
        additionalProperties: false,
      },
    },
  },
  required: ['firstName', 'variants'],
  additionalProperties: false,
});

const clean = (s) => stripDashes(String(s || '').trim()).replace(/^["“”']+|["“”']+$/g, '');
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const PREFIXES = ['וב', 'ול', 'ומ', 'וה', 'שב', 'של', 'שה', 'ב', 'ל', 'מ', 'ה', 'ו', 'ש', 'כ'];

/** A word and every form of it with a prefix or two taken off: "והשקיעה" is also "השקיעה" and "שקיעה". */
function forms(w) {
  const out = new Set([w]);
  for (const p of PREFIXES) {
    if (!w.startsWith(p) || w.length - p.length < 3) continue;
    const rest = w.slice(p.length);
    out.add(rest);
    for (const q of PREFIXES) if (rest.startsWith(q) && rest.length - q.length >= 3) out.add(rest.slice(q.length));
  }
  return out;
}
const contentWords = (s) => new Set(normHe(s).split(' ').filter((w) => w.length >= 3).flatMap((w) => [...forms(w)]));

/**
 * Is the one specific thing really there? The quote must appear, verbatim (up
 * to spacing and niqqud), in the source the draft says it came from, and the
 * draft must use at least one of its words: a quote nobody can see in the text
 * is not what the text is about.
 */
export function specificProblem(text, specific, sources) {
  const quote = flat(specific?.quote);
  if (!quote) return 'no specific detail about them';
  const where = sources[specific.source];
  const haystack = Array.isArray(where) ? where.join('\n') : String(where || '');
  if (!normHe(haystack).includes(normHe(quote))) return `the quoted detail is not in their ${specific.source || 'text'}: "${quote.slice(0, 60)}"`;
  const mine = contentWords(text);
  if (![...contentWords(quote)].some((w) => mine.has(w))) return 'the draft does not use the detail it quotes';
  return null;
}

/**
 * The context one item is written from, as the prompt text and as the sources
 * the checks read.
 *
 * kind   'comment' | 'creator' | 'agency' | 'reply'
 * lead   the lead; post: the video or question; site: our destination text
 * extra  { route, link, exampleNote, offer } for the messages; for a creator's,
 *        also { channel, commented }: how it reaches them, and whether the
 *        owner commented on the video
 */
export function contextFor(kind, { lead, post = null, site = '', extra = {} }) {
  const sources = {};
  const blocks = [];
  if (kind === 'comment' || kind === 'creator') {
    sources.title = flat(post?.title);
    sources.description = flat(post?.description);
    sources.comment = (post?.topComments || []).map((c) => flat(c.text)).filter(Boolean);
    blocks.push(
      'THE VIDEO:',
      `Platform: ${post?.platform || ''}. Creator: ${lead.name || lead.handle || ''}${Number.isFinite(lead.followers) ? `, ${lead.followers} followers` : ''}.`,
      `Title: ${sources.title || '(none)'}`,
      `Description: ${sources.description || '(none)'}`,
      sources.comment.length
        ? `Top comments by viewers:\n${sources.comment.map((c) => `- ${c}`).join('\n')}`
        : post?.platform === 'youtube'
          ? 'Top comments by viewers: none, or comments are off.'
          : 'Only the caption could be read on this platform; the comments could not.'
    );
  } else if (kind === 'agency') {
    sources.site = flat(lead.profile?.siteText);
    sources.listing = flat([lead.name, ...(lead.types || []), lead.address].filter(Boolean).join('. '));
    const p = lead.profile || {};
    blocks.push(
      'THE AGENCY:',
      `Google listing: ${sources.listing || '(none)'}`,
      p.destinations?.length ? `Destinations their own site names: ${p.destinations.map((d) => d.name).join(', ')}` : '',
      p.clientele?.length ? `Who they say their clients are: ${p.clientele.map((c) => c.label).join(', ')}` : '',
      lead.kosher ? `Kosher or religious audience: yes (their site says "${lead.kosher}")` : '',
      `Their website, as text:\n${sources.site || '(could not be read)'}`
    );
  } else if (kind === 'reply') {
    sources.question = flat(post?.title);
    blocks.push('THEIR QUESTION:', sources.question || '(none)');
  }
  if (site) blocks.push('', 'OUR SITE\'S DATA FOR THE DESTINATION:', site);
  if (extra.route) {
    const r = extra.route;
    blocks.push(
      '',
      `THE ROUTE ON OUR SITE (${kind === 'agency' ? 'the example for them' : 'their route'}): ${r.cityName}, ${r.days.length} days, ${r.stops} stops.`,
      ...r.days.map((d, i) => `Day ${i + 1}: ${(d.names || []).join(', ')}`)
    );
  }
  if (kind === 'creator' && extra.channel) blocks.push('', `HOW IT REACHES THEM: ${CHANNEL_LINE[extra.channel.known ? extra.channel.channel : 'none'] || CHANNEL_LINE.none}`, extra.commented ? 'Netanel commented on this video from @tiyulplus.' : 'Netanel has not commented on this video and has never written to them.');
  if (extra.exampleHe) blocks.push(`The example destination, to name in the message: ${extra.exampleHe}`);
  if (extra.offer) blocks.push(`Offer that may be mentioned once: ${extra.offer}`);
  const text = blocks.filter((b) => b !== '').join('\n');
  // Every text a number may legitimately come from.
  const numbers = [text];
  return { text, sources, numbers };
}

/**
 * Write one item: three variants, checked, reviewed. Returns the record to store.
 *
 * `examples` are the owner's last sent texts of this kind (learn.js).
 */
export async function draftItem(kind, { state, settings, lead, post = null, site = '', extra = {}, examples = [], model = settings.models.draft, reviewer = settings.models.review, tag = null }) {
  const ctx = contextFor(kind, { lead, post, site, extra });
  const gender = kind === 'agency' ? 'plural' : lead.gender || 'unknown';
  const checkGender = kind === 'agency' ? 'unknown' : gender;
  const nameHint = kind === 'creator' ? `Their display name: ${lead.name || '(none)'}. Handle: ${lead.handle || '(none)'}. Return the first name to greet them with in "firstName" only if the display name clearly has one (in Hebrew if it is written in Hebrew); else an empty string. Never guess a name from a handle.` : 'Return an empty "firstName".';

  const check = (v, firstName) => {
    const text = clean(v?.text);
    const problems = checkDraft(text, { kind: CHECK_KIND[kind], sources: ctx.numbers, gender: checkGender });
    const sp = specificProblem(text, v?.specific, ctx.sources);
    if (sp) problems.push(sp);
    if (!firstName) {
      // A name the model did not return may still be in the text: only one that
      // is really in their display name may greet them.
      const greet = /^היי\s+([א-תA-Za-z]{2,})/.exec(text)?.[1];
      if (kind === 'creator' && greet && !String(lead.name || '').includes(greet)) problems.push(`greets them as "${greet}", which is not in their display name`);
    }
    return { text, specific: v?.specific ? { quote: flat(v.specific.quote), source: v.specific.source } : null, problems };
  };

  const ask = async (want, feedback) => {
    const user = [
      fewShotBlock(examples),
      addressLine(gender === 'plural' ? 'unknown' : gender, kind),
      nameHint,
      '',
      ctx.text,
      '',
      `Write exactly ${want} draft${want === 1 ? '' : 's'}.`,
      feedback,
    ]
      .filter((x) => x !== '' && x != null)
      .join('\n');
    return askJson({
      state,
      settings,
      model,
      system: systemFor(kind),
      user,
      schema: schemaFor(kind),
      maxTokens: 12000,
      effort: settings.effort || 'medium',
      estimate: draftEstimate(model),
      tag: tag || `draft:${kind}`,
    });
  };

  let out = await ask(VARIANTS, '');
  let firstName = clean(out.firstName);
  if (firstName && !String(lead.name || '').includes(firstName)) firstName = '';
  let checked = (out.variants || []).slice(0, VARIANTS).map((v) => check(v, firstName));
  let good = checked.filter((c) => !c.problems.length);

  if (good.length < VARIANTS) {
    const failed = checked.filter((c) => c.problems.length);
    const feedback = [
      '',
      'Some earlier drafts were refused. Do not repeat them. The reasons:',
      ...failed.map((c) => `- "${c.text.slice(0, 120)}": ${c.problems.join('; ')}`),
      good.length ? `These were kept, so write different ones:\n${good.map((c) => `- ${c.text}`).join('\n')}` : '',
    ].join('\n');
    out = await ask(VARIANTS - good.length, feedback);
    const again = (out.variants || []).slice(0, VARIANTS - good.length).map((v) => check(v, firstName));
    good = [...good, ...again.filter((c) => !c.problems.length)];
    checked = [...checked, ...again];
  }
  if (!good.length) {
    const last = checked.flatMap((c) => c.problems);
    throw new DraftError(`no draft passed the checks: ${[...new Set(last)].slice(0, 4).join('; ')}`, last);
  }

  // The skeptical reader. Rewrites go through the same checks; one that passes
  // replaces its draft, and every replaced draft is scored once more, so the
  // number on the card is about the text that will be copied.
  const reviewKind = kind;
  const reviews = await reviewTexts({ state, settings, kind: reviewKind, texts: good.map((g) => g.text), context: ctx.text, model: reviewer, tag: `review:${kind}` });
  const variants = good.map((g, i) => ({ ...g, score: reviews[i].botScore, tells: reviews[i].tells, factProblem: reviews[i].factProblem, rewritten: false }));
  const rewritten = [];
  for (const [i, r] of reviews.entries()) {
    if (r.botScore < REWRITE_AT || !r.rewrite) continue;
    const c = check({ text: r.rewrite, specific: variants[i].specific }, firstName);
    if (c.problems.length) {
      variants[i].rewriteRefused = c.problems.slice(0, 3);
      continue;
    }
    variants[i] = { ...variants[i], original: variants[i].text, originalScore: variants[i].score, text: c.text, rewritten: true };
    rewritten.push(i);
  }
  if (rewritten.length) {
    const second = await reviewTexts({ state, settings, kind: reviewKind, texts: rewritten.map((i) => variants[i].text), context: ctx.text, rewrite: false, model: reviewer, tag: `rescore:${kind}` });
    for (const [j, i] of rewritten.entries()) Object.assign(variants[i], { score: second[j].botScore, tells: second[j].tells, factProblem: second[j].factProblem });
  }

  // A FACT THE REVIEWER COULD NOT FIND IN THE CONTEXT IS NOT OFFERED. The number
  // rule in code catches an invented number; a misplaced fact ("London's season,
  // said of a walk in the South Downs", from the first proof run) only a reader
  // catches. A flagged variant is dropped while a clean one remains; when every
  // variant is flagged they stay, each with its warning on the card.
  const factual = variants.filter((v) => !v.factProblem);
  const kept = factual.length ? factual : variants;

  return {
    variants: kept.map(({ problems, ...v }) => v).sort((a, b) => a.score - b.score),
    droppedForFacts: variants.length - kept.length,
    firstName,
    model,
    reviewer,
    at: new Date().toISOString(),
  };
}
