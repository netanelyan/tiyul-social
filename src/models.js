// Which model does which job.
//
// Every Anthropic call in this project ran on claude-opus-5, including the ones
// that transliterate a place name, parse a slash command, or decide whether a
// museum is visitable. Those are structured classification against a fixed
// schema — the sort of work where the expensive model returns the same answer
// as the cheap one, and the bill is five times larger for it.
//
// Published rates, $ per 1M tokens (see src/usage.js, which bills from the same
// table):
//
//     claude-opus-5      5 in / 25 out
//     claude-sonnet-5    3 in / 15 out
//     claude-haiku-4-5   1 in /  5 out
//
// So the saving on a moved call is 40% (sonnet) or 80% (haiku), on both sides.
//
// THE SPLIT IS BY CONSEQUENCE OF BEING WRONG, not by how hard the task looks.
//
//   editorial   A person reads the output and it IS the post. A worse idea, a
//               worse Hebrew line or a worse cover is a worse post, and no
//               downstream check catches "technically fine, but flat". Opus.
//
//   judgement   Wrong answers are cheap to catch but expensive to miss. A
//               place name in Hebrew is read by every viewer; a bad region
//               hint puts text on a mountain. Sonnet — most of the quality at
//               60% of the price.
//
//   mechanical  A schema with few right answers, and a wrong one fails loudly
//               or costs one candidate out of ten. Haiku.
//
// Overridable per role, because the right split is an empirical question and
// the next person to ask it should not have to edit this file to try an answer.

export const ROLES = {
  editorial: process.env.MODEL_EDITORIAL || process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  judgement: process.env.MODEL_JUDGEMENT || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  mechanical: process.env.MODEL_MECHANICAL || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
};

/**
 * The model for one job.
 *
 * ANTHROPIC_MODEL still overrides everything, which keeps the existing escape
 * hatch working: setting it pins the whole pipeline to one model, which is what
 * you want when comparing a new release against the current split.
 */
export function modelFor(role) {
  return ROLES[role] || ROLES.editorial;
}

/** What each role currently resolves to — for `/usage` and the selftest. */
export const modelSplit = () => ({ ...ROLES });

/**
 * Does this model take an `effort` setting?
 *
 * The Claude 5 family does; Haiku 4.5 does not, and sending it one is a 400
 * that fails the whole call — `This model does not support the effort
 * parameter`. Found the moment the mechanical tier was pointed at Haiku, which
 * is exactly the kind of incompatibility that would otherwise surface as a
 * broken deck at three in the morning.
 *
 * Matched on the family rather than on a list of exact ids, so a new Claude 5
 * release works without an edit here and an older model never gets a parameter
 * it will reject.
 */
export const supportsEffort = (model) => /claude-(opus|sonnet|fable)-5/.test(String(model || ''));

/**
 * The output_config for a call, with `effort` included only where it is legal.
 *
 * Every call site builds this the same way and every one of them would
 * otherwise need the same conditional, which is how one gets forgotten.
 */
export function outputConfig(model, effort, schema) {
  const format = { type: 'json_schema', schema };
  return supportsEffort(model) ? { effort, format } : { format };
}
