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
        'Is the camera a participant - handlebars, feet, hands or a body edge in frame, moving through the place - rather than filming a person from outside?',
    },
    aerial: { type: 'boolean', description: 'Drone or high aerial vantage' },
    staged: { type: 'boolean', description: 'A posed lifestyle or model shoot rather than someone doing the thing' },
    personSubject: {
      type: 'boolean',
      description:
        'Is a person filmed FROM OUTSIDE the subject of this frame - standing in front of the view, facing or walking for the camera, or large enough in frame to be the point of the shot? False for a POV body edge (hands, feet, handlebars, a shoulder at the edge), and false for distant or incidental figures that only give a landscape its scale.',
    },
    urban: { type: 'boolean', description: 'Predominantly street/city/traffic rather than nature or a scenic town' },
    subject: {
      type: 'string',
      description:
        'Up to 12 words naming what is in frame, for the caption writer. Describe what is SEEN. Do not guess a country if it is not obvious.',
    },
    place: {
      type: 'string',
      description:
        'The country, in English. The search phrase and title below usually name it; your job is to confirm the frame is consistent with what they say, not to identify it unaided. Empty string when they name no country and the frame is not unmistakable, or when the frame contradicts them.',
    },
    placeConfidence: {
      type: 'integer',
      description:
        '0-10 certainty in `place`. Score the CONSISTENCY between the name and the frame, not your ability to recognise the country unaided. Below the configured floor the name is discarded.',
    },
    site: {
      type: 'string',
      description:
        'The specific place and NOTHING ELSE - "Lago di Braies", "Lauterbrunnen", "Dolomites", "Cinque Terre". A landmark, a town, a valley or a named region all count; a country does not, and neither does a comma - the country is a separate field and gets added separately. Empty string when the frame is a generic valley or coastline that the search phrase and title do not pin down.',
    },
    siteConfidence: {
      type: 'integer',
      description:
        '0-10 certainty in `site`. Score the CONSISTENCY between the name and the frame, not your ability to recognise the place unaided: a search phrase and title naming the Dolomites over a frame of limestone spires is a 9, the same words over a frame of a tropical beach is a 0.',
    },
    siteHe: {
      type: 'string',
      description:
        'The SAME name written in Hebrew letters, as an Israeli travel account would spell it - "Lauterbrunnen" -> "לאוטרברונן", "Lago di Braies" -> "לאגו די בראייס". Transliterate by SOUND; never translate the words and never leave any Latin letters in it. Empty string when `site` is empty.',
    },
  },
  required: [
    'destination', 'pov', 'aerial', 'staged', 'personSubject', 'urban', 'subject',
    'place', 'placeConfidence', 'site', 'siteConfidence', 'siteHe',
  ],
};

const PROMPT =
  'Judge this frame from a short vertical travel video.\n\n' +
  'The single most important field is `destination`: would somebody watching this want to go there? ' +
  'An iconic landmark, a dramatic landscape or a beautiful town scores high. An empty road, a car park, ' +
  'a generic path through trees or anything that could be anywhere scores 0-3, however pretty the light is.\n\n' +
  '`personSubject` is the other one that decides whether this clip is used at all. Somebody standing in ' +
  'front of the view, facing the camera or walking for it, means another person was standing back filming ' +
  'them - and the post is then about that person rather than about the place. Judge it by who the shot is ' +
  'OF: a figure the frame is built around is true; a hand on a railing, a boot on a step or two walkers the ' +
  'size of a thumbnail on a ridge are not.\n\n' +
  'WHERE IT IS: YOU ARE CONFIRMING A LEAD, NOT GUESSING.\n\n' +
  'The search phrase and title below come from the stock library. The phrase is what was asked for and the ' +
  'title is what the person who uploaded the clip called it, so between them they usually name the place ' +
  'already. Your job is to say whether the FRAME IS CONSISTENT with what they say - which is a question ' +
  'about the picture in front of you, and a far more answerable one than naming a valley from memory.\n\n' +
  'So: if they name a place and the frame fits it, use that name and score the confidence high. If they ' +
  'name a place and the frame contradicts it - the phrase says Iceland and this is a palm beach - leave ' +
  'both fields empty and the confidence at 0; the library is wrong and a wrong pin is worse than no pin. ' +
  'If they name nothing specific, name only what the frame itself makes unmistakable, and leave it empty ' +
  'otherwise. Never invent a name to fill the field.\n\n' +
  '`site` is the one that matters most and it is not only for landmarks. A town, a valley or a named ' +
  'region - "Lauterbrunnen", "Dolomites", "Cinque Terre" - all count. What does not count is a country, ' +
  'because that goes in `place` and a post labelled with nothing but a country is the thing this field ' +
  'exists to avoid.\n\n' +
  'When you do name a `site`, also write it in Hebrew letters in `siteHe`. The post is published in Hebrew ' +
  'and the name is read aloud by an Israeli audience, so transliterate the SOUND of it - never translate ' +
  'the words, and never leave a Latin letter in that field.';

/** What the stock library already says about this clip, as a block for the prompt. */
const leadFor = ({ query, title }) => {
  const lines = [];
  if (query) lines.push(`Search phrase it was returned for: "${query}"`);
  if (title) lines.push(`Title the uploader gave it: "${title}"`);
  return lines.length ? `\n\nWHAT THE LIBRARY SAYS:\n${lines.join('\n')}` : '';
};

/**
 * Judge one clip from its thumbnail.
 *
 * Returns null rather than throwing. A judge that fails should cost that one
 * candidate, not the batch — and a null is filtered out downstream, which is
 * the safe direction: an unjudged clip is never published.
 *
 * `query` AND `title` ARE WHY THE PLACE FIELDS WORK AT ALL.
 *
 * This used to be the thumbnail and nothing else, and it named a place on about
 * one candidate in fifteen — measured, on a batch where the search had asked
 * Pexels for "dolomites italy" and got back a clip its uploader had titled
 * "scenic mountainous pathway in dolomites". The judge was being asked to
 * recognise a valley from a bare picture, which is the hardest possible version
 * of the question, and it was answering honestly: not sure. Meanwhile the answer
 * was sitting in two strings nobody passed it.
 *
 * So the lead goes in and the question changes from "what is this" to "is this
 * consistent with what the library says". The claim is then SOURCED — our own
 * search phrase plus the uploader's title, checked against the frame — which is
 * the same standard every other published fact in this pipeline is held to, and
 * a considerably better one than a model's unaided recall.
 *
 * It also makes the contradiction case reachable: a phrase saying Iceland over a
 * frame of palm trees now scores 0 and discards the name, where before the judge
 * would simply have said "unsure" about a mislabelled clip and looked identical
 * to the fifteen it was unsure about for good reason.
 */
export async function judgeThumb(url, { timeoutMs = 20_000, query = null, title = null } = {}) {
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
            { type: 'text', text: PROMPT + leadFor({ query, title }) },
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
    // Both names are dropped unless the judge is sure. Everything else here
    // only decides whether a clip is used; these get PRINTED, so the bar is
    // higher — an unverifiable claim about where footage was shot is the exact
    // thing the rest of this pipeline refuses to publish.
    const floor = postConfig().clips.search.placeMinConfidence;
    if ((v.placeConfidence ?? 0) < floor) v.place = '';
    if ((v.siteConfidence ?? 0) < floor) v.site = '';
    // A site without its country is a name nobody can place. Naming the
    // country is strictly easier than naming the landmark in it, so if the
    // country did not survive the floor, the site has not really been
    // identified either.
    if (!v.place) v.site = '';
    // The Hebrew spelling is a spelling OF the site, so it cannot outlive it.
    // Left behind, it would put a name on a post whose English original had
    // just been discarded for being an unverifiable claim.
    if (!v.site) v.siteHe = '';
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
  // A person filmed in front of the place, which the owner prohibits outright.
  //
  // `staged` did not catch it and was never going to: it asks whether the shot
  // is a MODEL SHOOT, and a man simply standing at a viewpoint is not posed,
  // not a lifestyle setup and not selling anything — so the judge answered no
  // and a clip of somebody's back went out over a Hebrew line about the place.
  //
  // The fault is not that the shot is fake. It is that the camera is a
  // SPECTATOR, which is the distinction pexels.js draws from the title and the
  // one thing the title cannot be trusted on. A viewer is being shown a
  // stranger; the account is supposed to be showing them somewhere to go.
  //
  // A veto rather than a penalty, unlike an aerial. A drone shot is the right
  // subject from the wrong height and is worth having on a day nothing else
  // cleared the gate; a stranger in the frame is the wrong subject, and there
  // is no destination score that makes it the right one.
  //
  // On unless it is explicitly turned off, because a key missing from a config
  // should not quietly re-admit the one thing that is prohibited by name.
  if (cfg.rejectPersonSubject !== false && v.personSubject) return null;
  if (cfg.rejectAerialOnly && v.aerial) return null;

  let score = v.destination;
  // POV is a preference now, not the axis. Worth about one point of
  // destination — enough to break a tie, never enough to rescue nowhere.
  if (cfg.preferPov && v.pov) score += 1.5;
  // An aerial of Lauterbrunnen is still Lauterbrunnen; it just reads more like
  // stock than a shot taken from inside the place — which is the thing BRIEF.md
  // lists under Never. The penalty is a dial rather than the 1 it used to be,
  // and at its configured 4 the arithmetic is deliberate: the gate is 7 and the
  // scale ends at 10, so the best possible drone shot ranks 6 and loses to the
  // weakest clip that cleared the gate on the ground. A drone shot is therefore
  // built only when nothing on the ground survived at all, which is the whole
  // point of penalising rather than vetoing — see rejectAerialOnly.
  if (v.aerial) score -= cfg.aerialPenalty;
  if (v.urban) score -= 0.5;
  return score;
}
