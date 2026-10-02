import { writeFileSync } from 'node:fs';

// Hebrew narration, and the timings that let subtitles follow it.
//
// WHY THIS IS A MODULE AND NOT TWO LINES OF FETCH.
//
// The narrated format needs two things from a speech provider and only one of them is
// what speech providers advertise. The audio is the easy half. The hard half is WHERE
// EACH WORD FALLS, because the reference video the owner supplied burns its subtitles
// in sync with the voice, and that sync is most of why it does not look automated.
//
// There are three ways to get word timings and only one of them is good:
//
//   ASK THE PROVIDER. ElevenLabs returns character-level alignment alongside the audio
//   from its with-timestamps endpoint. It is exact, it costs nothing extra, and it is
//   the reason this module is written against ElevenLabs rather than something cheaper.
//
//   FORCE-ALIGN AFTERWARDS. Run Whisper over the audio we just generated and read the
//   word offsets back out. Accurate, and it means shipping a second model and a second
//   inference per video for something the first call already knew.
//
//   ESTIMATE FROM DURATION. Divide the clip evenly by character count. This is what
//   every "add subtitles" tutorial does and it drifts visibly within two sentences,
//   because Hebrew words are not equal length and a speaker pauses at commas.
//
// So: ElevenLabs, with timestamps, and `estimateTimings` below exists only as the
// fallback for a provider that cannot answer - it is honest about being an estimate
// rather than pretending the subtitles are synced.
//
// NO KEY, NO NARRATION, AND IT SAYS SO. A missing key is not an error here: the format
// degrades to a silent video with the same subtitles, which is a real post. What it
// must not do is fail silently halfway through a render on the VPS at 7am.

const API = 'https://api.elevenlabs.io/v1/text-to-speech';

// eleven_multilingual_v2 handles Hebrew; the older monolingual models do not have it at
// all and return English phonemes for Hebrew text, which is worse than failing.
const MODEL = () => process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

// A default voice id is deliberately NOT hardcoded. Which voice reads these is an
// editorial decision - it is the account's narrator - and picking one here would make
// that decision invisibly. Set ELEVENLABS_VOICE_ID.
const VOICE = () => process.env.ELEVENLABS_VOICE_ID || null;

/** Whether narration is available at all, and why not when it is not. */
export function speechReady() {
  if (!process.env.ELEVENLABS_API_KEY) return { ok: false, why: 'ELEVENLABS_API_KEY is not set' };
  if (!VOICE()) return { ok: false, why: 'ELEVENLABS_VOICE_ID is not set - which voice reads these is an editorial choice' };
  return { ok: true, why: null };
}

/**
 * One Hebrew script, spoken, with the timing of every word.
 *
 * Returns `{ file, seconds, words: [{ text, start, end }] }`, or null when no provider
 * is configured - the caller then builds the silent version rather than failing.
 *
 * `words` is derived from the character alignment rather than requested separately:
 * ElevenLabs reports a start and end for every CHARACTER it spoke, so a word's span is
 * the first character's start to the last character's end. Doing it this way rather
 * than asking for word timings is not a workaround - characters are what the model
 * actually aligns, and words assembled from them are exact.
 */
export async function speak(scriptHe, { file, timeoutMs = 120_000 } = {}) {
  const ready = speechReady();
  if (!ready.ok) {
    console.error(`narration: no voice (${ready.why}) - building the silent version`);
    return null;
  }

  const text = String(scriptHe || '').trim();
  if (!text) throw new Error('speak: nothing to say');

  const res = await fetch(`${API}/${VOICE()}/with-timestamps`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL(),
      // Stability low enough to carry intonation, similarity high enough that the voice
      // is the same voice across a run of posts. An account whose narrator changes
      // timbre between videos reads as a content farm, which is the thing being avoided.
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`narration: ElevenLabs answered HTTP ${res.status} - ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  if (!json?.audio_base64) throw new Error('narration: the response carried no audio');

  writeFileSync(file, Buffer.from(json.audio_base64, 'base64'));

  const words = wordsFromAlignment(text, json.alignment || json.normalized_alignment);
  const seconds = words.length ? words[words.length - 1].end : null;
  return { file, seconds, words, estimated: false };
}

/**
 * Character alignment to word spans.
 *
 * The API returns three parallel arrays - the characters, each one's start time and
 * each one's end time. A word is a run of non-space characters, so its span is the
 * start of its first character to the end of its last.
 */
export function wordsFromAlignment(text, alignment) {
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) {
    return estimateTimings(text, null);
  }

  const words = [];
  let current = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) {
      if (current) {
        words.push(current);
        current = null;
      }
      continue;
    }
    if (!current) current = { text: '', start: starts[i], end: ends[i] };
    current.text += c;
    current.end = ends[i];
  }
  if (current) words.push(current);
  return words;
}

/**
 * Word timings guessed from a duration, for a provider that cannot report them.
 *
 * MARKED AS AN ESTIMATE, because a caller has to be able to tell. Subtitles built on
 * this drift - a long word and a short word get the same share, and a pause at a comma
 * is not modelled at all - so a format that cares about sync should fall back to
 * showing one line per sentence rather than one word at a time.
 *
 * Weighted by character count rather than split evenly, which is the cheapest thing
 * that is better than nothing.
 */
export function estimateTimings(text, seconds) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const total = words.reduce((n, w) => n + w.length, 0) || 1;
  // About 2.6 Hebrew words a second is a measured narration pace; used only when no
  // duration is known at all.
  const span = Number(seconds) > 0 ? Number(seconds) : words.length / 2.6;

  let at = 0;
  return words.map((w) => {
    const dur = (w.length / total) * span;
    const out = { text: w, start: at, end: at + dur, estimated: true };
    at += dur;
    return out;
  });
}

/**
 * Words grouped into subtitle lines.
 *
 * ONE SHORT LINE AT A TIME, which is what the reference does and what the platform's
 * own auto-captions do. A whole sentence on screen is read ahead of the voice and the
 * sync stops meaning anything; a single word at a time is a tic.
 *
 * Broken on word count and on gaps: a pause longer than `gap` ends a line wherever it
 * falls, because that pause is where the speaker ended a thought.
 */
export function subtitleLines(words, { maxWords = 4, maxSeconds = 2.4, gap = 0.34 } = {}) {
  const lines = [];
  let current = null;

  for (const w of words || []) {
    const tooLong = current && (current.words.length >= maxWords || w.end - current.start > maxSeconds);
    const paused = current && w.start - current.end > gap;
    // A LINE NEVER STRADDLES A FULL STOP.
    //
    // Grouping on word count alone produced "באירופה. טיסות ישירות מנתב״ג" - the end of
    // one sentence and the start of the next on one line, which reads as a line that
    // begins in the middle of a thought because it does. A sentence boundary is the
    // strongest break there is in the script and it has to win over the word count.
    const ended = current && /[.!?:]$/.test(current.words[current.words.length - 1].text);
    if (!current || tooLong || paused || ended) {
      if (current) lines.push(current);
      current = { text: w.text, start: w.start, end: w.end, words: [w] };
      continue;
    }
    current.text += ` ${w.text}`;
    current.end = w.end;
    current.words.push(w);
  }
  if (current) lines.push(current);

  // ORPHANS MERGED BACK. A sentence break can leave the last word or two of a sentence
  // alone on screen - "שעות." on its own line - which flashes past and reads as a
  // stutter. A one-word tail joins the line before it when that line has room and they
  // belong to the same sentence, which is the only case where merging is safe.
  for (let i = lines.length - 1; i > 0; i--) {
    const tail = lines[i];
    const before = lines[i - 1];
    const sameSentence = !/[.!?:]$/.test(before.words[before.words.length - 1].text);
    // NOT ACROSS A PAUSE. The gap is why the line broke there, and a merge that ignores
    // it puts a word back on a line the speaker had already left - which is the one
    // thing this whole module exists to get right. Found by the test for it.
    const continuous = tail.start - before.end <= gap;
    if (
      tail.words.length === 1 &&
      sameSentence &&
      continuous &&
      before.words.length < maxWords + 1 &&
      tail.end - before.start <= maxSeconds + 0.6
    ) {
      before.text += ` ${tail.text}`;
      before.end = tail.end;
      before.words.push(...tail.words);
      lines.splice(i, 1);
    }
  }

  return lines.map(({ text, start, end }) => ({ text, start, end }));
}
