import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { record as recordUsage } from '../usage.js';
import { modelFor, outputConfig } from '../models.js';

// No nudity on a slide, and that includes art.
//
// THE OWNER'S RULE, 2026-10-11, after the first public TikTok candidate carried
// Michelangelo's David, full frontal, on the Accademia's slide. A real photograph of
// a real place and entirely ordinary in a museum, but TikTok's automatic checks do
// not tell art from anything else, and a flag on a public post costs its reach.
//
// WHY A SEPARATE LOOK. The site's own Commons photographs are trusted as SHOWING THE
// PLACE (an editor chose them), so nothing ever looked at them, and the Commons
// geosearch fallback takes the largest file near the place without looking either.
// Both are exactly where a statue gallery's photograph comes from. The stock judge in
// ./curate.js gets the same rule as a field of its own.
//
// One call per batch: every photograph a post is about to use, numbered, as the
// curator does it. Answers are kept per photograph for the life of the process, so a
// photograph seen once is not paid for again.

const MODEL = modelFor('mechanical');
const EFFORT = process.env.NUDITY_EFFORT || 'low';

let client = null;
const getClient = () => (client ??= new Anthropic());

/** For the selftest: a stand-in with the same `messages.create`. */
export const setClient = (c) => {
  client = c;
};

const SCHEMA = {
  type: 'object',
  properties: {
    nude: {
      type: 'array',
      items: { type: 'integer' },
      description: 'The 1-based numbers of every photograph that shows nudity. Empty when none does.',
    },
  },
  required: ['nude'],
  additionalProperties: false,
};

const SYSTEM = `You check photographs before they go on a public TikTok slide.

List every photograph that shows nudity of any kind:
- a nude or partly nude person, with genitals, buttocks or a female breast visible
- a nude statue or sculpture, however famous (Michelangelo's David counts)
- a nude painting, fresco, relief or any other nude art

A statue in the background still counts if the nudity is visible. Swimwear, bare
shoulders, bare backs and bare legs do not count.

When unsure, list it. Leaving a place without its photograph is fine; a flagged
public post is not.`;

const seen = new Map();
const keyOf = (src) => createHash('sha1').update(String(src)).digest('hex');

/** A data URI or a Buffer, as the API's image block. Null for anything else. */
function block(src) {
  if (Buffer.isBuffer(src)) return { type: 'base64', media_type: 'image/jpeg', data: src.toString('base64') };
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(String(src || ''));
  return m ? { type: 'base64', media_type: m[1], data: m[2] } : null;
}

/**
 * Which of these photographs show nudity. Returns a Set of their indexes.
 *
 * `srcs` are the images as the renderer will get them: data URIs or JPEG buffers. One
 * that cannot be shown to the model is counted as nude, because a photograph nobody
 * could look at is a photograph nobody checked. A failed call throws: the caller's
 * build fails rather than shipping unchecked photographs.
 */
export async function nudeIn(srcs) {
  const flagged = new Set();
  const ask = [];
  for (const [i, src] of srcs.entries()) {
    const k = keyOf(src);
    if (seen.has(k)) {
      if (seen.get(k)) flagged.add(i);
      continue;
    }
    const b = block(src);
    if (!b) {
      flagged.add(i);
      continue;
    }
    ask.push({ i, k, b });
  }
  if (!ask.length) return flagged;

  const content = [{ type: 'text', text: `${ask.length} photograph${ask.length === 1 ? '' : 's'}, numbered from 1.` }];
  for (const [n, a] of ask.entries()) {
    content.push({ type: 'text', text: `${n + 1}:` });
    content.push({ type: 'image', source: a.b });
  }

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1000,
    output_config: outputConfig(MODEL, EFFORT, SCHEMA),
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  });
  recordUsage(res.usage, MODEL);
  const text = res.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('the nudity check returned no answer');
  const nude = new Set((JSON.parse(text).nude || []).map(Number));

  for (const [n, a] of ask.entries()) {
    const isNude = nude.has(n + 1);
    seen.set(a.k, isNude);
    if (isNude) flagged.add(a.i);
  }
  return flagged;
}

/** One photograph. */
export const isNude = async (src) => (await nudeIn([src])).has(0);
