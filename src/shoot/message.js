import { postConfig } from '../postConfig.js';
import { captionQuestion, captionCta } from '../hashtags.js';
import { windowsHe } from '../schedule.js';

// What a shoot looks like when it arrives.
//
// WRITTEN TO BE READ ON A PHONE, STANDING UP, ONCE. That is the only design
// constraint and it decides everything else: the hook is at the top because it
// is the first thing said to camera, the shot list is numbered because it is
// followed in order, and the caption block is at the bottom in one contiguous
// run so it can be copied out with a single long-press rather than reassembled
// from four places.
//
// Deliberately NOT the shape of the other approval messages in this project. A
// card's message is a case for a decision — provenance, evidence, quota state,
// everything needed to judge whether to publish. There is nothing to judge
// here; the video does not exist yet. This is a set of instructions, and the
// question it answers is "what do I do now", not "is this good".

/** The five tags, drawn the same way every other post's are. */
function tags(shoot, opts = {}) {
  const cfg = postConfig().hashtags;
  const rand = opts.rand || Math.random;
  const taken = new Set();

  const draw = (pool, n) => {
    const left = pool.filter((t) => !taken.has(t));
    const out = [];
    while (out.length < n && left.length) {
      const [t] = left.splice(Math.floor(rand() * left.length), 1);
      taken.add(t);
      out.push(t);
    }
    return out;
  };

  const broad = draw(cfg.broad, cfg.broadCount);
  const niche = [];
  // The destination tag spends one of the niche slots rather than adding a
  // sixth, exactly as it does for a deck and a clip. A shoot always HAS a
  // destination — it was chosen before the model was called — so unlike the
  // other two this never falls back.
  const word = String(shoot.destination || '').replace(/\s+/g, '').replace(/[^\p{L}\p{N}׳״'"]/gu, '');
  if (cfg.useDestination && word.length >= 2) {
    taken.add(`#${word}`);
    niche.push(`#${word}`);
  }
  niche.push(...draw(cfg.niche, cfg.nicheCount - niche.length));
  return [...broad, ...niche];
}

/**
 * The caption exactly as it should be pasted.
 *
 * Assembled here and shown as one block rather than described in pieces,
 * because a caption you have to assemble is a caption that gets posted with the
 * question missing. The question and the CTA come from the same two helpers the
 * clip captions use, so a shoot and a clip from this account sound alike.
 */
export function shootCaption(shoot, opts = {}) {
  const parts = [
    shoot.caption,
    shoot.seriesNext,
    captionQuestion(opts),
    captionCta(opts),
  ].filter(Boolean);
  return `${parts.join('\n\n')}\n\n${tags(shoot, opts).join(' ')}`;
}

/** The whole message. */
export function shootMessage(shoot, opts = {}) {
  const [lo, hi] = shoot.lengthSeconds || [15, 35];

  const head = [
    `🎬 לצילום · ${shoot.formatHe}${shoot.shape ? ` (${shoot.shape})` : ''} · ${shoot.destination}`,
    shoot.seriesLabel ? `📺 ${shoot.seriesLabel}` : null,
    `⏱️ ${lo}-${hi} שניות · ${windowsHe()}`,
    shoot.angle ? `🇮🇱 הזווית: ${shoot.angle}` : null,
  ].filter(Boolean);

  const script = [
    '',
    '━━━ מה אומרים ━━━',
    '',
    `🪝 ההוק (שנייה ראשונה, בקול ועל המסך):`,
    `   ${shoot.hook}`,
    '',
    '📋 הביטים:',
    ...shoot.beats.map((b, i) => `   ${i + 1}. ${b}`),
  ];

  // The product format's one extra field, and the reason it exists: "record a
  // screen recording of the app" is a task and "type this exact sentence" is an
  // action. The difference is about four minutes of deciding what to type.
  const prompt = shoot.prompt
    ? ['', '⌨️ מה להקליד ב-Tiyul+ (מילה במילה):', `   ${shoot.prompt}`]
    : [];

  const shots = shoot.shots?.length
    ? ['', '━━━ מה לצלם ━━━', '', ...shoot.shots.map((s, i) => `   ${i + 1}. ${s}`)]
    : [];

  const note = shoot.note ? ['', `💡 ${shoot.note}`] : [];

  const caption = [
    '',
    '━━━ הכיתוב (להעתקה) ━━━',
    '',
    shootCaption(shoot, opts),
  ];

  // Last, and stated rather than implied. Every other message in this bot ends
  // at a button; this one ends at a person, and the one thing that must not be
  // ambiguous is that nothing is going to happen unless they do it.
  // filter(x => x !== null), NOT filter(Boolean). The leading '' is a blank
  // line separating the copyable caption from this, and Boolean drops it —
  // which glues the tags to the sign-off and makes the block a long-press
  // selects the wrong thing.
  const tail = [
    '',
    '━━━',
    'אף אחד לא מפרסם את זה מלבדך. צלמו, העלו, והדביקו את הכיתוב.',
    shoot.rotationNote ? `(${shoot.rotationNote})` : null,
  ].filter((x) => x !== null);

  return [...head, ...script, ...prompt, ...shots, ...note, ...caption, ...tail].join('\n');
}
