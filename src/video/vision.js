import Anthropic from '@anthropic-ai/sdk';
import { record as recordUsage } from '../usage.js';
import { postConfig } from '../postConfig.js';
import { modelFor, outputConfig } from '../models.js';

// What is actually in the clip, judged by looking at it.
//
// This replaces title-keyword scoring, and the reason is measurable. A Pexels
// title is a string an uploader typed, and it is a poor proxy for the only
// question that matters. "pov cycling through scenic swiss streets" scored 9
// on the keyword filter — pov, scenic, cycling — and the frame is a car park
// with a supermarket in it. Judged on the picture, the same clip scores 3 out
// of 10 for "would a viewer want to travel here".
//
// Calibration, run before this file was written: 14 clips the keyword filter
// had ranked highly were scored by eye and by model. Every POV clip the old
// queries returned came back 0-4. The two the owner had already rejected by
// name scored 0 and 3 with no knowledge of that. Santorini scored 8.
//
// Cheap on purpose: the judge reads the THUMBNAIL, which the search response
// already contains, so there is no download and no decode. One low-effort call
// per candidate, and candidates are capped.

// This is the whole clip filter. A wrong destination score publishes a road.
const MODEL = modelFor('judgement');
const EFFORT = process.env.VISION_EFFORT || 'low';

let client = null;
const getClient = () => (client ??= new Anthropic());
export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    destination: {
      type: 'integer',
      description:
        '0-10: would a viewer want to TRAVEL to this place? 10 = an iconic landmark or a landscape worth a flight. 0 = an anonymous road, car park, generic field or path that could be anywhere.',
    },
    pov: {
      type: 'boolean',
      description:
        'Is the camera a participant — handlebars, feet, hands or a body edge in frame, moving through the place — rather than filming a person from outside?',
    },
    aerial: { type: 'boolean', description: 'Drone or high aerial vantage' },
    staged: { type: 'boolean', description: 'A posed lifestyle or model shoot rather than someone doing the thing' },
    urban: { type: 'boolean', description: 'Predominantly street/city/traffic rather than nature or a scenic town' },
    subject: {
      type: 'string',
      description:
        'Up to 12 words naming what is in frame, for the caption writer. Describe what is SEEN. Do not guess a country if it is not obvious.',
    },
    place: {
      type: 'string',
      description:
        'The country, in English, ONLY if the frame is unmistakably identifiable — a famous landmark, or architecture and landscape that could not be anywhere else. Empty string when unsure. A guess here becomes a factual claim on a published post.',
    },
    placeConfidence: {
      type: 'integer',
      description: '0-10 certainty in `place`. Below the configured floor the name is discarded.',
    },
  },
  required: ['destination', 'pov', 'aerial', 'staged', 'urban', 'subject', 'place', 'placeConfidence'],
};

const PROMPT =
  'Judge this frame from a short vertical travel video.\n\n' +
  'The single most important field is `destination`: would somebody watching this want to go there? ' +
  'An iconic landmark, a dramatic landscape or a beautiful town scores high. An empty road, a car park, ' +
  'a generic path through trees or anything that could be anywhere scores 0-3, however pretty the light is.\n\n' +
  'Name `place` only if you are certain. It is printed on a published post, and a confident guess that is ' +
  'wrong is worse than saying nothing — leave it empty and set placeConfidence low whenever there is doubt.';

/**
 * Judge one clip from its thumbnail.
 *
 * Returns null rather than throwing. A judge that fails should cost that one
 * candidate, not the batch — and a null is filtered out downstream, which is
 * the safe direction: an unjudged clip is never published.
 */
export async function judgeThumb(url, { timeoutMs = 20_000 } = {}) {
  if (!hasApiKey()) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');

    const out = await getClient().messages.create({
      model: MODEL,
      max_tokens: 600,
      output_config: outputConfig(MODEL, EFFORT, SCHEMA),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    recordUsage(out.usage, MODEL);
    const text = out.content.find((b) => b.type === 'text')?.text;
    if (!text) return null;
    const v = JSON.parse(text);
    // The place name is dropped unless the judge is sure. Everything else here
    // only decides whether a clip is used; this one gets PRINTED, so the bar is
    // higher — an unverifiable claim about where footage was shot is the exact
    // thing the rest of this pipeline refuses to publish.
    if ((v.placeConfidence ?? 0) < postConfig().clips.search.placeMinConfidence) v.place = '';
    return v;
  } catch {
    return null;
  }
}

/**
 * Rank a judged clip.
 *
 * `destination` is a gate rather than a term in a sum: below the threshold the
 * clip is out no matter how good everything else is, because a beautifully shot
 * POV of nowhere is still nowhere. That was the fault this whole module exists
 * to fix, and folding it into a weighted score would let POV buy its way back.
 */
export function rankVision(v, cfg = postConfig().clips.search) {
  if (!v) return null;
  if (v.destination < cfg.visionMinDestination) return null;
  if (cfg.rejectStaged && v.staged) return null;
  if (cfg.rejectAerialOnly && v.aerial) return null;

  let score = v.destination;
  // POV is a preference now, not the axis. Worth about one point of
  // destination — enough to break a tie, never enough to rescue nowhere.
  if (cfg.preferPov && v.pov) score += 1.5;
  // An aerial of Lauterbrunnen is still Lauterbrunnen; it just reads more like
  // stock than a shot taken from inside the place.
  if (v.aerial) score -= 1;
  if (v.urban) score -= 0.5;
  return score;
}
