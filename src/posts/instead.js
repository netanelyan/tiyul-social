import { verdictOf, practicalOf, firstClause, seasonLine, listPlaces, ratingBadge } from './source.js';
import { line, fill } from './voice.js';

// TYPE C: STOP ONLY GOING TO X. "תפסיקו לטוס רק לרודוס כשיש את האיים האלה"
//
// THE HIGHEST-SHARING SHAPE IN THE STUDY, and shares are the mechanism nothing else
// here reaches. @shiraztravel's version runs at 0.31 shares per like and
// @travel.with.dorina's itinerary at 0.52; our own lakes deck got zero shares out of
// 536 views.
//
// WHY A CONTRARIAN HOOK GETS FORWARDED AND A RECOMMENDATION DOES NOT. A trip is
// planned by more than one person, so the unit of decision is a conversation. "The
// most beautiful lakes in Italy" is a thing to look at alone. "Stop only flying to
// Rhodes" is a position somebody either agrees or disagrees with, and both of those
// end with the post being sent to the person they are planning the trip with.
//
// WHAT MAKES IT HONEST RATHER THAN CLICKBAIT. The alternatives are real destinations
// we have pages for, the default is a real Israeli habit, and each alternative's
// reason is a verbatim clause from that destination's own verdict or flight note. The
// post is not saying Rhodes is bad - nothing here says that, and the hook deliberately
// says "only", which is the true claim. It is saying these four exist, here is what is
// on each, and here is the flight.
//
// THE DEFAULTS ARE A JUDGEMENT AND THEY LIVE IN THE CONFIG, not here. Which
// destination "everybody flies to" is a claim about Israeli travel habits that no API
// answers, so it is the owner's to make and it is written down where it can be argued
// with rather than inferred from data that does not support it.

/**
 * One "stop only going to X" post.
 *
 * `cities` is the alternatives, already loaded and already photographed. `defaultHe`
 * is the habit being argued with.
 *
 * NEEDS THREE ALTERNATIVES MINIMUM. Two is not a list, it is a comparison, and a
 * comparison invites the reader to pick the one they already knew. Three or more reads
 * as a field they had not considered.
 */
export function buildInsteadPost(cities, { hook, defaultHe, regionHe = null, questionHe = null } = {}) {
  const usable = (cities || []).filter((c) => c?.name && (c.places || []).some((p) => p.image?.src));
  if (usable.length < 3) {
    throw new Error(`only ${usable.length} alternative(s) have a photograph, and this post needs 3`);
  }
  if (!defaultHe) throw new Error('no default destination to argue with - see posts.instead.defaults in post-config.json');

  const alts = usable.slice(0, 5);

  const cover = {
    look: 'label',
    cover: true,
    titleHe: line(
      fill(hook.he, {
        default: defaultHe,
        // `{alt}` is what the alternatives ARE rather than a list of them: five names
        // on a cover is unreadable at thumbnail size, and the region is the thing being
        // offered. With "כולה" after it the hook reads "...when you have the whole of
        // Spain", which is the bigger claim and the one worth arguing with.
        alt: regionHe || `${alts.length} היעדים האלה`,
        n: alts.length,
      }),
      { where: 'cover' }
    ),
    noteHe: line(`${alts.length} יעדים, כולם עם מסלול מלא באתר`, { where: 'cover.note' }),
    // THE RATING OF THE FIRST ALTERNATIVE, not a count. The badge used to read "4
    // במקום", which is a phrase nobody parses - it looks like a price or a position.
    // The rating of the destination this post is actually recommending is a number that
    // means something on its own.
    ...(ratingBadge(alts[0]) || {}),
    band: 'mid',
    // The cover takes the FIRST alternative's photograph rather than a picture of the
    // default. A post arguing against flying only to Rhodes must not open on Rhodes:
    // the cover is what the post is offering, not what it is arguing with.
    image: alts[0].places.find((p) => p.image?.src)?.image || null,
  };

  const slides = [cover];

  for (const [i, city] of alts.entries()) {
    const verdict = verdictOf(city);
    const practical = practicalOf(city);

    // ONE REAL REASON, QUOTED. The shortest pro from that destination's own verdict,
    // because the shortest is the most concrete - and because the slide has one line.
    const reason = [...(verdict?.prosHe || [])].sort((a, b) => a.length - b.length)[0] || null;

    // THE SECOND LINE IS THE FLIGHT, BUT ONLY WHEN THE FLIGHT IS AN ARGUMENT.
    //
    // "Why not Rhodes" is usually "because Rhodes is a direct three-hour flight", so an
    // alternative that says nothing about getting there has not made its case. But the
    // flights paragraph is not always good news: Santorini's begins "אין טיסות ישירות
    // מנתב״ג לסנטוריני או למיקונוס ברוב השנה", and the first render of this post duly
    // argued for Santorini by telling the reader there are no direct flights to it.
    //
    // The fix is NOT to suppress the fact - it is true and it belongs on a verdict
    // post, which is the type whose job is the whole picture. It is to stop using a
    // negative as a selling point on the one type that is making a case, and to use the
    // season instead, which is a neutral fact and the other thing somebody choosing
    // between islands actually needs.
    const flight = firstClause(practical.flightsHe, { max: 80 });
    const positiveFlight = flight && !/^\s*(?:אין|לא\s)/.test(flight) ? flight : null;
    const second = positiveFlight
      ? { text: line(positiveFlight, { where: `alt${i}.flight`, quote: practical.flightsHe }) }
      : seasonLine(practical)
        ? { text: line(seasonLine(practical), { where: `alt${i}.season` }) }
        : null;

    slides.push({
      look: 'sheet',
      titleHe: line(city.name, { where: `alt${i}.title` }),
      // THE FLAG AS AN EMOJI ROW, NOT INSIDE THE TITLE. Concatenated into the title
      // string it is escaped as text and drawn by whatever font the page resolves - and
      // the renderer has no flag font, so "🇬🇷" came out as the letters "GR" set in the
      // middle of a Hebrew line. The emoji row goes through emojiHtml, which substitutes
      // a real image, and it is also where post-config.json says emoji belong.
      emojis: city.flag ? [city.flag] : [],
      lines: [
        ...(reason ? [{ text: line(reason, { where: `alt${i}.reason`, quote: verdict.source }) }] : []),
        ...(second ? [second] : []),
      ],
      image: bestPhoto(city),
      slug: city.slug,
    });
  }

  if (questionHe) {
    slides.push({
      look: 'sheet',
      titleHe: line(`אז לאן?`, { where: 'close.title' }),
      lines: [{ text: line(questionHe, { where: 'close.question' }), mark: true }],
      image: bestPhoto(alts[alts.length - 1]),
    });
  }

  return {
    slides,
    alts: alts.map((c) => ({ slug: c.slug, name: c.name })),
    captionHookHe: line(`${alts.length} יעדים במקום ${defaultHe}, כולם עם מסלול מלא`, { where: 'caption.hook' }),
    stats: { alts: alts.length, defaultHe },
  };
}

/** The best photographed place on a page, for a slide that is about the whole destination. */
function bestPhoto(city) {
  const ranked = listPlaces(city, { want: 4, needPhoto: false }).filter((p) => p.image?.src);
  return ranked[0]?.image || (city.places || []).find((p) => p.image?.src)?.image || null;
}
