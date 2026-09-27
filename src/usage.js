import { AsyncLocalStorage } from 'node:async_hooks';

// Token accounting for the drafting step — the only part of this pipeline that
// costs money per run.
//
// This exists because "is it efficient?" is not answerable by reading code. The
// three numbers that decide the bill are how many calls a run makes, how many
// of those calls were spent on candidates that got rejected afterwards, and
// what share of input tokens hit the prompt cache. All three are invisible
// without recording them, and all three moved once they were visible.
//
// Costs are computed from the model's published rates rather than guessed, and
// cache reads are billed at a tenth of the input rate — which is the entire
// reason the system prompt is a frozen string.
//
// AND NOW BY KIND OF POST, BECAUSE "WHICH ONE IS EXPENSIVE" WAS UNANSWERABLE.
//
// The per-model split says whether the cheap tier took the volume. It cannot
// say whether the money went on clips or on decks, which is the question an
// owner actually asks — the one that decides whether a format is worth keeping
// on a timer. Working it out meant reading the code and estimating, and the one
// time that was done properly the estimate was out by a factor of three.
//
// AsyncLocalStorage rather than an argument at twenty call sites, for the same
// reason src/override.js uses it: a parameter threaded by hand is a parameter
// dropped in the one path nobody tested. It also gets the shared call sites
// right, which an argument could not — src/images/curate.js picks photographs
// for cards and for decks, and it is the CALLER that knows which.
//
// Anything outside a forKind() scope is recorded as `other` rather than guessed
// at. A readout with an honest unattributed bucket is worth more than one that
// files every stray call under whatever ran last.

const RATES = {
  // $ per 1M tokens. input / output / cache write (1.25x) / cache read (0.1x).
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};
const DEFAULT_RATE = RATES['claude-opus-5'];

export function costOf(usage, model = 'claude-opus-5') {
  const r = RATES[model] || DEFAULT_RATE;
  const fresh = usage.input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  return (fresh * r.in + write * r.in * 1.25 + read * r.in * 0.1 + out * r.out) / 1e6;
}

// A rolling record, kept in memory. It is deliberately not persisted: this is
// an operational readout for the running process, not an accounting ledger, and
// a store write per drafting call is a worse trade than losing it on restart.
const state = {
  since: new Date().toISOString(),
  calls: 0,
  wasted: 0, // calls whose candidate was rejected after the call was paid for
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
  cost: 0,
  wastedCost: 0,
  // Per model, because the pipeline no longer runs on one. Without this the
  // readout cannot answer the only question worth asking after splitting the
  // work by role: did the cheap tier actually take the volume, or is everything
  // still landing on the expensive one because a default went unchanged.
  byModel: new Map(),
  // Same shape, different question: which KIND of post spent it.
  byKind: new Map(),
};

const kinds = new AsyncLocalStorage();

/**
 * Run `fn` with every model call inside it billed to `kind`.
 *
 * Wrap the job, not the call. A clip suggestion is a search, up to
 * twenty-four judgements and a hook writer across three modules, and the only
 * place that knows all of that is one clip is the function that started it.
 */
export const forKind = (kind, fn) => kinds.run(String(kind), fn);

/** Which kind is being billed here, or `other` outside any scope. */
export const currentKind = () => kinds.getStore() || 'other';

let lastCost = 0;
let lastKind = 'other';

export function record(usage, model) {
  if (!usage) return;
  state.calls++;
  state.input += usage.input_tokens || 0;
  state.cacheWrite += usage.cache_creation_input_tokens || 0;
  state.cacheRead += usage.cache_read_input_tokens || 0;
  state.output += usage.output_tokens || 0;
  lastCost = costOf(usage, model);
  state.cost += lastCost;

  const key = model || 'unknown';
  const m = state.byModel.get(key) || { calls: 0, cost: 0 };
  m.calls++;
  m.cost += lastCost;
  state.byModel.set(key, m);

  lastKind = currentKind();
  const k = state.byKind.get(lastKind) || { calls: 0, cost: 0, wasted: 0, wastedCost: 0 };
  k.calls++;
  k.cost += lastCost;
  state.byKind.set(lastKind, k);
}

/**
 * Called when a candidate dies AFTER its drafting call was made. The call is
 * already paid for; recording it separately is what makes the difference
 * between "we made 12 calls" and "we made 12 calls and threw 9 away" legible.
 */
export function recordWasted() {
  if (!state.calls) return;
  state.wasted++;
  state.wastedCost += lastCost;
  // Charged to the kind the LAST CALL was billed to, not to whatever scope is
  // current now. A candidate is usually thrown away a few lines after the call
  // that drafted it, but not always inside the same scope, and "which kind
  // wasted the money" has to follow the money.
  const k = state.byKind.get(lastKind);
  if (k) {
    k.wasted++;
    k.wastedCost += lastCost;
  }
}

export function snapshot() {
  const totalIn = state.input + state.cacheWrite + state.cacheRead;
  return {
    ...state,
    // Flattened out of the Map, dearest first — the expensive tier is the one
    // worth looking at.
    byModel: [...state.byModel.entries()]
      .map(([model, m]) => ({ model, ...m }))
      .sort((a, b) => b.cost - a.cost),
    byKind: [...state.byKind.entries()]
      .map(([kind, k]) => ({ kind, ...k }))
      .sort((a, b) => b.cost - a.cost),
    cacheHitRate: totalIn ? state.cacheRead / totalIn : 0,
    wasteRate: state.calls ? state.wasted / state.calls : 0,
    perCall: state.calls ? state.cost / state.calls : 0,
  };
}

export function reset() {
  state.byModel.clear();
  state.byKind.clear();
  lastKind = 'other';
  Object.assign(state, {
    since: new Date().toISOString(),
    calls: 0,
    wasted: 0,
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    cost: 0,
    wastedCost: 0,
  });
  lastCost = 0;
}

const usd = (n) => (n < 0.01 ? `${(n * 100).toFixed(2)}¢` : `$${n.toFixed(2)}`);
const pct = (n) => `${Math.round(n * 100)}%`;

// What each scope is in Hebrew. `other` is deliberately named as unattributed
// rather than dressed up: a bucket nobody can act on should say so.
const KIND_HE = {
  card: '📰 כרטיסים',
  deck: '🎞️ מצגות',
  clip: '🎬 קליפים',
  plan: '🗺️ מסלולים',
  shoot: '🎥 תדריכי צילום',
  other: '❔ לא משויך',
};

/** Hebrew readout for /usage in the bot. */
export function usageReport() {
  const s = snapshot();
  if (!s.calls) return '📊 עוד לא בוצעו קריאות כתיבה מאז ההפעלה.';
  return [
    '📊 *צריכת טוקנים*',
    '',
    `קריאות כתיבה: ${s.calls}`,
    `מתוכן נזרקו אחרי התשלום: ${s.wasted} (${pct(s.wasteRate)})`,
    '',
    `קלט טרי: ${s.input.toLocaleString()}`,
    `נכתב למטמון: ${s.cacheWrite.toLocaleString()}`,
    `נקרא מהמטמון: ${s.cacheRead.toLocaleString()} (${pct(s.cacheHitRate)})`,
    `פלט: ${s.output.toLocaleString()}`,
    '',
    `עלות: ${usd(s.cost)} · לקריאה: ${usd(s.perCall)}`,
    `בזבוז: ${usd(s.wastedCost)}`,
    // FIRST of the two breakdowns, above the models, because it is the one that
    // decides something. "Sonnet took the volume" is a check that the split is
    // wired up; "clips cost four times what decks did" is a reason to change
    // what runs on the timer.
    ...(s.byKind.length
      ? [
          '',
          '🧾 לפי סוג:',
          ...s.byKind.map(
            (k) =>
              `   ${KIND_HE[k.kind] || k.kind}: ${k.calls} · ${usd(k.cost)}` +
              (k.wasted ? ` (נזרק ${usd(k.wastedCost)})` : '')
          ),
        ]
      : []),
    // Only when the work actually split. On a run pinned to one model via
    // ANTHROPIC_MODEL this is noise; on a normal run it is the line that says
    // whether the cheap tier took the volume it was supposed to.
    ...(s.byModel.length > 1
      ? ['', '🧮 לפי מודל:', ...s.byModel.map((m) => `   ${m.model}: ${m.calls} · ${usd(m.cost)}`)]
      : []),
  ].join('\n');
}
