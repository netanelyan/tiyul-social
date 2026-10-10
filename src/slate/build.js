import { templateOf } from './plan.js';

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
 *   pickType()            the next post type (buildPost's own rotation)
 *   pickDest(type, avoid) a destination row not in `avoid`, or null
 *   buildOne(dest, type)  a built candidate (buildPost)
 *   recentPlaces          Hebrew place names inside the destination window
 *   recentOpenings        opening lines inside the opening window
 */
export async function buildSlateDecks({ count, pickType, pickDest, buildOne, recentPlaces = [], recentOpenings = [], tries = 3, onProgress = () => {} }) {
  const decks = [];
  const failures = [];
  const usedPlaces = new Set(recentPlaces);
  const usedOpenings = new Set(recentOpenings.map(openingKey));

  for (let i = 0; i < count; i++) {
    const type = pickType();
    const tried = [];
    let built = null;
    for (let t = 0; t < tries && !built; t++) {
      const dest = pickDest(type, [...usedPlaces, ...tried]);
      if (!dest) break;
      tried.push(dest.he);
      try {
        const cand = await buildOne(dest, type);
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
      decks.push({ cand: built, template: templateOf(built.deck) });
      onProgress(`slate: ${decks.length}/${count} ${built.deck?.type} ${built.deck?.where}`);
    } else {
      failures.push(`פוסט ${i + 1} (${type}): לא נבנה`);
    }
  }
  return { decks, failures };
}
