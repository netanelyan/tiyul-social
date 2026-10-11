import { draftEstimate } from '../../clients/budget.js';
import { askJson } from '../claude.js';
import { LIMITS } from '../config.js';
import { systemFor } from './voice.js';

// The second pass: a skeptical Israeli reads each draft and says whether a bot
// wrote it.
//
// A separate call with a different job. The drafting call is asked to write
// like a person; this one is asked to catch the ones that did not, the way the
// owner caught "נקודה שמתחברת" and the guidebook paragraph. It scores every
// draft from 0 (a person wrote it) to 10 (obviously a bot), names the tells it
// noticed, and rewrites any draft scoring 4 or more. The rewrite is checked by
// the same code as the draft (prepare/draft.js) before it can replace it.
//
// The score is shown on the card, beside the draft, so the owner sees what the
// reviewer thought rather than only what survived it.

export const REWRITE_AT = 4;

const SYSTEM = `You are a sharp Israeli in your twenties. You read a lot of WhatsApp messages and a lot of comments under travel videos, and you can smell a bot, a marketer or a ChatGPT text from the first line.

You will get a few drafts and the context they were written from. For each draft, answer honestly: would you guess a bot or a marketer wrote this?

- botScore: 0 means clearly a person wrote it, 10 means obviously a bot. Be strict: a text that is correct, balanced and complete, that covers every case, that sounds like a guidebook or a brochure, that praises in general terms or that opens with a stock phrase scores high.
- tells: only the specific things that give it away, in a few English words each ("opens with a stock phrase", "reads like a guidebook", "three features in a row", "too polished", "generic praise", "no reaction to the video"). Never what is good about it. An empty list when nothing gives it away.
- factProblem: if the draft states a fact that is not in the context, say which; else an empty string.
- rewrite: when botScore is ${REWRITE_AT} or more, the same message rewritten so a person would have written it. Keep its one specific detail, keep every fact (and only facts from the context), keep [קישור] exactly as it is when there is one. When botScore is below ${REWRITE_AT}, an empty string.

The rewrite follows the writer's rules, which are these:

`;

const SCHEMA = {
  type: 'object',
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          botScore: { type: 'integer' },
          tells: { type: 'array', items: { type: 'string' } },
          factProblem: { type: 'string' },
          rewrite: { type: 'string' },
        },
        required: ['index', 'botScore', 'tells', 'factProblem', 'rewrite'],
        additionalProperties: false,
      },
    },
  },
  required: ['reviews'],
  additionalProperties: false,
};

const clamp = (n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

/**
 * Score these texts. Returns [{ botScore, tells, factProblem, rewrite }] in order.
 *
 * kind:     'comment' | 'reply' | 'agency' | 'creator', for the writer's rules
 * context:  the same context block the drafts were written from
 * rewrite:  false for a score-only pass (the second look at rewrites, and the
 *           proof run's scoring of old drafts)
 */
export async function reviewTexts({ state, settings, kind, texts, context, rewrite = true, model = settings.models.review, tag = null }) {
  const lim = LIMITS[kind === 'agency' || kind === 'creator' ? 'message' : kind] || LIMITS.message;
  const user = [
    'CONTEXT THE DRAFTS WERE WRITTEN FROM:',
    context || '(none)',
    '',
    `DRAFTS (each about ${lim.target} characters at most):`,
    ...texts.map((t, i) => `[${i}] ${t}`),
    '',
    rewrite ? 'Review every draft.' : 'Review every draft. Score only: return an empty rewrite for all of them.',
  ].join('\n');
  const out = await askJson({
    state,
    settings,
    model,
    system: `${SYSTEM}${systemFor(kind)}`,
    user,
    schema: SCHEMA,
    maxTokens: 8000,
    effort: settings.effort || 'medium',
    estimate: draftEstimate(model, { inTokens: 6000, outTokens: 3000 }),
    tag: tag || `review:${kind}`,
  });
  return texts.map((_, i) => {
    const r = (out.reviews || []).find((x) => x.index === i) || {};
    return {
      botScore: clamp(r.botScore),
      tells: (r.tells || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5),
      factProblem: String(r.factProblem || '').trim(),
      rewrite: rewrite ? String(r.rewrite || '').trim() : '',
    };
  });
}
