import Anthropic from '@anthropic-ai/sdk';
import { outputConfig } from '../models.js';
import { claudeCost, guard, record } from '../clients/budget.js';

// Every Claude call the desk makes, through one function, so each one is
// budget-checked before it is paid for and recorded after.
//
// The client is built the way every module in this repo builds it (the SDK,
// reading ANTHROPIC_API_KEY), and the call shape comes from src/models.js:
// outputConfig is what keeps `effort` away from models that reject it, which is
// a 400 nobody should have to rediscover.
//
// THINKING IS ALWAYS ON for Opus 5.5 and Fable 5.1, the drafting models, and
// cannot be turned off: no `thinking` parameter is sent, and `effort` is the
// dial. Thinking tokens are output tokens, so max_tokens has room for them; a
// draft cut off mid-thought is a failed draft.
//
// A REFUSAL IS ANSWERED BY ANOTHER MODEL, not shown as a failure. Those models
// can decline a request their safety checks misread, and the server-side
// fallback re-runs the same request on a model chosen for that refusal, inside
// the same call. Asked for on every call to a model that takes it; if the API
// ever answers that it does not, the call is sent again without it and the desk
// stops asking for the rest of the process.

let client = null;
const getClient = () => (client ??= new Anthropic());

/** For the selftest: a stand-in with the same `messages.create`. */
export const setClient = (c) => {
  client = c;
};

// Every call's model, tokens and dollars, for whoever is listening: the proof
// run measures cost per item with it. Nothing in the desk listens by default.
let listener = null;
export const onUsage = (fn) => {
  listener = fn;
};

export const claudeConfigured = (env = process.env) => Boolean(String(env.ANTHROPIC_API_KEY || '').trim());

export class ClaudeError extends Error {}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const TAKES_FALLBACK = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
let fallbackRefused = false;

/**
 * Ask for JSON against a schema. Returns the parsed object.
 *
 * `estimate` is the most this call should cost, used only for the budget
 * check; what is recorded afterwards is the real cost from the usage block.
 * `tag` names the call for the usage listener.
 */
export async function askJson({ state, settings, model, system, user, schema, maxTokens = 1500, effort = 'low', estimate = 0.03, tag = null }) {
  guard(state, settings, 'claude', estimate);
  const body = {
    model,
    max_tokens: maxTokens,
    output_config: outputConfig(model, effort, schema),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };
  const withFallback = TAKES_FALLBACK.test(model) && !fallbackRefused;
  let res;
  try {
    res = withFallback
      ? await getClient().messages.create({ ...body, fallbacks: 'default' }, { headers: { 'anthropic-beta': FALLBACK_BETA } })
      : await getClient().messages.create(body);
  } catch (e) {
    if (!withFallback || e?.status !== 400 || !/fallback/i.test(String(e?.message || ''))) throw e;
    fallbackRefused = true;
    res = await getClient().messages.create(body);
  }
  // The model that actually answered, which after a fallback is not the one
  // asked for, and is what the tokens are billed at.
  const served = res.model || model;
  const usd = claudeCost(res.usage, served);
  record(state, 'claude', { units: 1, usd });
  listener?.({ tag, model: served, asked: model, usage: res.usage || {}, usd });
  if (res.stop_reason === 'refusal') throw new ClaudeError('the model declined to write this one');
  if (res.stop_reason === 'max_tokens') throw new ClaudeError('the model ran out of room before it finished');
  const text = res.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new ClaudeError('the model returned no text');
  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeError('the model returned something that is not JSON');
  }
}
