import Anthropic from '@anthropic-ai/sdk';
import { outputConfig } from '../models.js';
import { claudeCost, guard, record } from './budget.js';

// Every Claude call the desk makes, through one function, so each one is
// budget-checked before it is paid for and recorded after.
//
// The client is built the way every module in this repo builds it (the SDK,
// reading ANTHROPIC_API_KEY), and the call shape comes from src/models.js:
// outputConfig is what keeps `effort` away from models that reject it, which is
// a 400 nobody should have to rediscover.

let client = null;
const getClient = () => (client ??= new Anthropic());

/** For the selftest: a stand-in with the same `messages.create`. */
export const setClient = (c) => {
  client = c;
};

export const claudeConfigured = (env = process.env) => Boolean(String(env.ANTHROPIC_API_KEY || '').trim());

export class ClaudeError extends Error {}

/**
 * Ask for JSON against a schema. Returns the parsed object.
 *
 * `estimate` is the most this call should cost, used only for the budget
 * check; what is recorded afterwards is the real cost from the usage block.
 */
export async function askJson({ state, settings, model, system, user, schema, maxTokens = 1500, effort = 'low', estimate = 0.03 }) {
  guard(state, settings, 'claude', estimate);
  const res = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    output_config: outputConfig(model, effort, schema),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });
  record(state, 'claude', { units: 1, usd: claudeCost(res.usage, model) });
  if (res.stop_reason === 'refusal') throw new ClaudeError('the model refused');
  const text = res.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new ClaudeError('the model returned no text');
  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeError('the model returned something that is not JSON');
  }
}
