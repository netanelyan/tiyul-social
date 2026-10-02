import { listPlaces, daysOf, ratingBadge } from './source.js';
import { line, fill } from './voice.js';
import { postConfig } from '../postConfig.js';

// TYPE F: THE CAMERA ROLL. A cover, a run of photographs, and one ask.
//
// THE REFERENCE, supplied by the owner: a serif headline in a soft pink over a shot of
// Seceda - "My camera roll after 10 days in the Dolomites" - then a run of gorgeous
// photographs with NO TEXT ON THEM AT ALL, and a call to action in the middle or at the
// end.
//
// WHY IT IS WORTH A TYPE WHEN WE ALREADY HAVE FIVE.
//
// Every other type here is information with pictures attached: a list labels each
// photograph, a plan annotates it with distances, a verdict quotes the page over it.
// They all compete on the same axis and they all ask the viewer to READ. This one
// competes on the axis the account has never used: it asks the viewer to LOOK. The
// photographs we pull from Wikimedia Commons are, on a good destination, genuinely
// beautiful and they are currently always carrying a line of Hebrew across their lower
// third. One format where they do not is one format where the pictures get to do the
// work, and it is the cheapest post here to build - no clause selection, no quoting, no
// honesty surface at all beyond the cover.
//
// THE HONESTY PROBLEM, AND WHY THE HEBREW COVER IS NOT A TRANSLATION.
//
// "My camera roll after 10 days in the Dolomites" is a first-person claim to have spent
// ten days in the Dolomites. We did not. The standing rule for this project is that a
// post may not invent a personal experience - no "כשהייתי שם", no fake memories - and
// assertNoExperience in ./voice.js would throw on a direct translation, correctly.
//
// What makes the reference work is not the first person, it is the PROMISE OF A VOLUME
// OF PICTURES and a number of days. Both survive translation into a claim about the
// post rather than about us: "ככה נראים 10 ימים בדולומיטים" says what the slides are,
// which is true, and keeps the number that makes it a trip rather than a mood board.
//
// WHERE THE CTA GOES, and why it is a rotation rather than a constant. The owner's note
// was "with a cta at the middle or the end". Both are real: at the end it catches the
// people who watched everything, in the middle it catches the larger number who will
// not get that far. Which one a given post uses rotates, and the metrics module can
// then answer which actually works instead of us guessing.

/**
 * One camera-roll post.
 *
 * `ctaAt` is 'mid' or 'end'; anything else means the renderer's own closing slide is the
 * only ask, which is the quietest version.
 */
export function buildRollPost(city, { hook, dest, days = null, ctaAt = 'end', want = null } = {}) {
  const type = postConfig().posts.types.find((t) => t.id === 'roll');
  const destHe = dest?.he || city.name;
  // HOW MANY DAYS, AS A NUMBER. daysOf returns the day OBJECTS - each with its stops
  // and their page descriptions - so using it directly put the whole itinerary into
  // `stats`, where assertPostVoice walked it and threw on a word of page prose that was
  // never going anywhere near a slide. The cover wants a count.
  const span = days || daysOf(city)?.days?.length || null;

  // PHOTOGRAPHS ONLY, AND MORE OF THEM THAN ANY OTHER TYPE USES.
  //
  // needPhoto is the whole filter here. A place with no picture contributes nothing to
  // this format - there is no line to read in its absence - so unlike every other type
  // it is not degraded by dropping them, only shortened.
  const pool = listPlaces(city, { want: (want || type?.slidesMax || 12) + 6, needPhoto: false })
    .filter((p) => p.image?.src)
    .slice(0, want || type?.slidesMax || 12);

  const floor = type?.slidesMin || 7;
  if (pool.length < floor) {
    throw new Error(`only ${pool.length} places have a photograph, and a camera-roll post needs ${floor}`);
  }

  // THE COVER IS THE ONLY SLIDE WITH WORDS ON IT, so it carries the whole promise.
  const cover = {
    look: 'roll',
    cover: true,
    titleHe: line(fill(hook.he, { dest: destHe, days: span ?? '', n: pool.length }).replace(/\s+/g, ' ').trim(), {
      where: 'cover',
    }),
    noteHe: line(`${pool.length} תמונות`, { where: 'cover.note' }),
    ...(ratingBadge(city) || {}),
    image: pool[0].image,
  };

  const slides = [cover];

  // The CTA, mid-roll. Placed after the viewer has seen enough to want the rest, which
  // is about a third in - early enough that most of the audience reaches it, late enough
  // that it is interrupting something they are enjoying rather than opening with an ask.
  const ctaIndex = ctaAt === 'mid' ? Math.max(3, Math.floor(pool.length / 3)) : -1;

  for (const [i, p] of pool.entries()) {
    if (i === ctaIndex) slides.push(ctaSlide(destHe, span, p));
    // NO TEXT. Not a name, not a number, not a caption. This is the format.
    slides.push({
      look: 'roll',
      image: p.image,
      placeId: p.id,
      bare: true,
    });
  }

  if (ctaAt === 'end') slides.push(ctaSlide(destHe, span, pool[pool.length - 1]));

  return {
    slides,
    captionHookHe: line(
      span ? `${span} ימים ב${destHe}, בתמונות` : `${destHe}, בתמונות`,
      { where: 'caption.hook' }
    ),
    stats: { photos: pool.length, ctaAt, days: span },
  };
}

/**
 * The one ask on the post.
 *
 * Over a photograph like everything else, because a text card in the middle of a run of
 * pictures is where a viewer leaves. It says what the site has rather than asking for a
 * follow: the whole premise of this format is that the pictures already sold the place,
 * so the only useful thing left to say is "there is a plan for it".
 */
function ctaSlide(destHe, days, place) {
  return {
    look: 'roll',
    titleHe: line(days ? `מסלול ${days} ימים ל${destHe}` : `מסלול מלא ל${destHe}`, { where: 'cta.title' }),
    noteHe: line('באתר, עם מפה ומחירים', { where: 'cta.note' }),
    image: place?.image || null,
    cta: true,
  };
}
