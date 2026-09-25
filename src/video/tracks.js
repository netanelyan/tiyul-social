import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Which music bed goes under a clip, and whether we are allowed to use it.
//
// Every clip this pipeline rendered was silent. On TikTok that was survivable
// because a clip lands in your inbox and you add a sound in the app before
// posting; a Reel publishes the moment you approve and its audio cannot be
// changed afterwards, so the mp4 itself has to carry a track or the Instagram
// half goes out silent for ever.
//
// THE MANIFEST IS THE ALLOWLIST. This reads assets/audio/tracks.json, never the
// directory. A file present but undeclared is not a track, and that is the
// whole point: the one thing that can go badly wrong with a music bed is
// publishing something we do not have the right to publish, and "whatever is in
// the folder" is precisely the rule that lets a file somebody dropped in to
// listen to become the soundtrack of a post. It is the same argument
// src/publish/imageHosts.js makes about verified domains, and it is the same
// failure mode: a check derived from what is present agrees with every mistake
// it was written to catch.
//
// A DECLARED TRACK WITH A MISSING FILE THROWS. A declared track with no licence
// or no source throws. Both are loud rather than skipped, because skipping
// leaves a silent post, and a silent post is indistinguishable from the bug
// this module exists to fix.

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Where the audio lives. AUDIO_DIR overrides it, the way CLIP_OUT_DIR does. */
export const audioDir = () => process.env.AUDIO_DIR || join(HERE, '..', '..', 'assets', 'audio');

const manifestPath = () => join(audioDir(), 'tracks.json');

let cached = null;

/**
 * Every usable track, validated.
 *
 * Cached for the life of the process, like post-config.json, and for the same
 * reason: it is read once per clip and it does not change under a running bot.
 *
 * NO MANIFEST IS NOT AN ERROR. It means no music, which is exactly where this
 * project starts: there are no tracks in the repository and none can be added
 * for you. Clips render silent, as they always have, and both bot.js at boot
 * and the approval card per clip say so.
 */
export function tracks() {
  if (cached) return cached;

  const file = manifestPath();
  if (!existsSync(file)) return (cached = []);

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file} could not be read: ${e.message}`);
  }

  const out = [];
  for (const t of Array.isArray(raw.tracks) ? raw.tracks : []) {
    const name = String(t?.file || '').trim();
    if (!name) throw new Error(`${file}: a track has no "file"`);

    // Refused by name, every time, rather than skipped. Each of these is a
    // thing somebody meant to do and did not finish, and the cost of guessing
    // is a post carrying music whose terms nobody can state.
    for (const field of ['title', 'credit', 'licence', 'source']) {
      if (!String(t?.[field] || '').trim()) {
        throw new Error(`${file}: "${name}" has no ${field} - a track must say what it is and what it is licensed under`);
      }
    }

    const path = join(audioDir(), name);
    if (!existsSync(path)) {
      throw new Error(`${file}: "${name}" is declared but not on disk at ${path}`);
    }

    out.push({
      file: path,
      name,
      title: String(t.title).trim(),
      credit: String(t.credit).trim(),
      licence: String(t.licence).trim(),
      source: String(t.source).trim(),
      mood: String(t.mood || '').trim() || null,
    });
  }

  return (cached = out);
}

/** For the tests, which need the manifest re-read after pointing AUDIO_DIR somewhere. */
export const forgetTracks = () => {
  cached = null;
};

/** Is there anything to play? */
export const audioConfigured = () => tracks().length > 0;

/**
 * One track, avoiding the ones just used.
 *
 * `used` is the set of track names already spent, most often the other clips of
 * the same batch plus whatever the last few posts carried. Exclusion rather
 * than weighting, the same rule pickAngle uses: with a handful of tracks the
 * thing a viewer notices is the same bed twice in a row, and a weight permits
 * exactly that.
 *
 * Falls back to the whole list when everything has been used, because the
 * alternative is returning null and publishing silence to avoid a repeat, which
 * is the wrong way round.
 */
export function pickTrack(used = new Set(), { rand = Math.random } = {}) {
  const all = tracks();
  if (!all.length) return null;
  const left = all.filter((t) => !used.has(t.name));
  const pool = left.length ? left : all;
  return pool[Math.floor(rand() * pool.length)];
}

/**
 * Where in the track to start, in seconds.
 *
 * Derived from the clip id rather than drawn at random, so a re-render of the
 * same clip sounds the same and a test can assert something.
 *
 * It exists because eight seconds from the top of the same file is the most
 * automated-sounding thing a feed can do: with four tracks and no offset, every
 * post opens on one of four identical bars. The offset is applied to an input
 * that ffmpeg loops infinitely, so any value is legal and no track duration has
 * to be known or declared, which is the reason this is not an ffprobe call.
 */
export function trackOffset(id, maxOffsetSeconds) {
  if (!(maxOffsetSeconds > 0)) return 0;
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % Math.round(maxOffsetSeconds);
}
