import { templateOf, templateOfCand } from './plan.js';

// Building the day's decks: distinct destinations, distinct opening lines.
//
// The builders, the destination draw and the type draw are passed in, so this is
// the same buildPost every /make uses (no second implementation), and the tests
// can run the whole thing against stand-ins. Consecutive types already differ:
// buildPost records each shape as it builds, and the next draw reads that record.
//
// THE TWO REPEAT RULES THE OWNER SET for the daily volume:
//   - no destination twice within `destinationRepeatDays` (7), counting what has
//     published and what earlier slates planned
//   - no opening line twice within `openingRepeatDays` (14), on the rendered line

/** An opening line as compared: spaces, punctuation and emoji do not make it new. */
export const openingKey = (s) =>
  String(s || '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * `count` decks. Returns { decks: [{ cand, template }], failures: [why] }.
 *
 *   pickType(prevType)    the next post type (buildPost's own rotation), or a
 *                         format pick { type, hook, formatId, kind } from
 *                         src/trends/mix.js pickFormat
 *   pickDest(type, avoid) a destination row not in `avoid`, or null
 *   buildOne(dest, type, pick)  a built candidate (buildPost)
 *   recentPlaces          Hebrew place names inside the destination window
 *   recentOpenings        opening lines inside the opening window
 */
export async function buildSlateDecks({ count, pickType, pickDest, buildOne, recentPlaces = [], recentOpenings = [], tries = 3, onProgress = () => {} }) {
  const decks = [];
  const failures = [];
  const usedPlaces = new Set(recentPlaces);
  const usedOpenings = new Set(recentOpenings.map(openingKey));

  let prevType = null;
  for (let i = 0; i < count; i++) {
    const pick = pickType(prevType);
    const type = typeof pick === 'string' ? pick : pick.type;
    const format = typeof pick === 'string' ? null : pick;
    const tried = [];
    let built = null;
    for (let t = 0; t < tries && !built; t++) {
      const dest = pickDest(type, [...usedPlaces, ...tried]);
      if (!dest) break;
      tried.push(dest.he);
      try {
        const cand = await buildOne(dest, type, format);
        const opening = openingKey(cand.headline);
        if (usedOpenings.has(opening)) {
          failures.push(`${dest.he}: הפתיח "${cand.headline}" כבר היה ב-14 הימים האחרונים`);
          continue;
        }
        built = cand;
        usedPlaces.add(dest.he);
        usedOpenings.add(opening);
      } catch (e) {
        failures.push(`${dest.he} (${type}): ${e.message}`);
      }
    }
    if (built) {
      decks.push({ cand: built, template: templateOf(built.deck), formatId: format?.formatId || null, formatKind: format?.kind || null });
      prevType = type;
      onProgress(`slate: ${decks.length}/${count} ${built.deck?.type} ${built.deck?.where}`);
    } else {
      failures.push(`פוסט ${i + 1} (${type}${format?.formatId ? `, ${format.formatId}` : ''}): לא נבנה`);
    }
  }
  return { decks, failures };
}

/**
 * `count` videos for the day's video slots. Returns { videos: [{ cand, template, formatId }], failures: [why] }.
 *
 *   pick(tried)      the next clip format id not in `tried`, or null (the format
 *                    rotation's own weighted draw, src/formats/rotation.js)
 *   buildOne(id)     a built clip candidate
 *   check(cand)      { ok, why }: may this file be posted? The owner's sound rule,
 *                    read off the candidate and the file (bot.js)
 *
 * A video that fails the check is not a slot filled: the next format is tried,
 * and the failure goes to the digest with its reason.
 */
export async function buildSlateVideos({ count, pick, buildOne, check, tries = 2, onProgress = () => {} }) {
  const videos = [];
  const failures = [];
  for (let i = 0; i < count; i++) {
    const tried = [];
    let built = null;
    for (let t = 0; t < tries && !built; t++) {
      const id = pick(tried);
      if (!id) break;
      tried.push(id);
      try {
        const cand = await buildOne(id);
        const ok = await check(cand);
        if (!ok.ok) {
          failures.push(`סרטון ${id}: ${ok.why}`);
          continue;
        }
        built = cand;
      } catch (e) {
        failures.push(`סרטון ${id}: ${e.message}`);
      }
    }
    if (built) {
      videos.push({ cand: built, template: templateOfCand(built), formatId: built.clip?.format || built.clip?.shape || null });
      onProgress(`slate: video ${videos.length}/${count} ${built.clip?.shape}`);
    } else if (!tried.length) {
      failures.push(`סרטון ${i + 1}: אין פורמט שאפשר לבנות`);
    }
  }
  return { videos, failures };
}
