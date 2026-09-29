import { verdictOf, practicalOf, listPlaces, placeLine, firstClause, seasonLine } from './source.js';
import { line, fill } from './voice.js';

// TYPE D: THE HONEST VERDICT. "{dest}: שווה או לא?"
//
// THE ONLY POST TYPE HERE WHOSE VALUE IS THAT IT MIGHT PUT SOMEBODY OFF.
//
// Every other type is an argument for going somewhere. This one answers the question
// people actually type into a search bar, and answering it honestly is the whole
// product: an account that says every destination is wonderful is an account whose
// recommendations mean nothing, which is precisely the aggregator signal the For You
// feed deprioritises. The 9-like flop is a poster of generic positive facts.
//
// WE HAPPEN TO HAVE THE RAREST THING NEEDED FOR THIS. Our own destination pages carry
// an `editorialRating.verdict` that names real drawbacks in the site's own voice -
// Prague's says the old town is crowded almost all year and central prices have risen
// significantly; Sicily's says a week trying to cover the island is mostly driving,
// the parking is a nightmare and the archaeological sites have no shade in August.
// Nobody has to write those, and nobody may: they are quoted verbatim.
//
// THE REFUSAL IS THE FEATURE. A verdict that names no drawbacks does not produce a
// one-sided verdict post - it produces no post. `canBuild` checks `verdict.cued`
// before anything is spent, and the reason it keys on a cue rather than on an empty
// list is in the note above CONS_CUE in ./source.js: an absent drawbacks clause means
// the text does not say where they are, which is not the same as there being none,
// and the two must never print the same.

/**
 * One verdict post.
 *
 * Six to eight slides: the question, what is good, what is not, who it is for, and
 * the best three places. The drawbacks get MORE slides than the good parts, and that
 * ordering is deliberate - the pros are why somebody is already considering it, so
 * they need one slide; the cons are the information they came for.
 */
export function buildVerdictPost(city, { hook, dest, questionHe = null } = {}) {
  const verdict = verdictOf(city);
  const practical = practicalOf(city);
  const destHe = dest?.he || city.name;

  if (!verdict?.cued || !verdict.consHe.length) {
    throw new Error('the page verdict names no drawbacks to quote - a one-sided verdict post is an advertisement');
  }
  if (!verdict.prosHe.length) throw new Error('the page verdict names nothing good either');

  // Shortest first, on both sides. A slide holds a line; the shortest clauses are
  // also the most concrete ones, because a long clause in these verdicts is usually
  // two claims joined by a comma.
  const byLength = (list) => [...list].sort((a, b) => a.length - b.length);
  const pros = byLength(verdict.prosHe).slice(0, 3);
  const cons = byLength(verdict.consHe).slice(0, 4);

  const best = listPlaces(city, { want: 3, needPhoto: false }).filter((p) => p.image?.src);

  const quote = (text, where) => line(text, { where, quote: verdict.source });

  const cover = {
    look: 'label',
    cover: true,
    // `{score}` is the page's own rating and it is a number we publish, which is the
    // only kind of number this project puts on a slide unsourced. A hook shape that
    // asks for it on a page with no score would print a gap, so the fill is checked.
    titleHe: line(fill(hook.he, { dest: destHe, score: verdict.score ?? '' }).replace(/\s+/g, ' ').trim(), {
      where: 'cover',
    }),
    noteHe: verdict.score ? line(`הדירוג שלנו: ${verdict.score}`, { where: 'cover.note' }) : null,
    band: 'mid',
    image: best[0]?.image || null,
  };

  const slides = [cover];

  slides.push({
    look: 'sheet',
    titleHe: line('מה טוב שם', { where: 'pros.title' }),
    lines: pros.map((p, i) => ({ text: quote(p, `pros[${i}]`) })),
    image: best[1]?.image || best[0]?.image || null,
  });

  // THE DRAWBACKS, QUOTED, ON THEIR OWN SLIDE OR TWO.
  //
  // Split when there are more than two, because four quoted clauses in one stack of
  // boxes is a wall of text and the format's whole claim is that these are readable.
  // Two slides of two is also two swipes, which on a post whose retention depends on
  // finishing is the right direction.
  const conChunks = cons.length > 2 ? [cons.slice(0, 2), cons.slice(2)] : [cons];
  for (const [i, chunk] of conChunks.entries()) {
    slides.push({
      look: 'sheet',
      titleHe: line(i === 0 ? 'ומה פחות' : 'ועוד משהו', { where: `cons${i}.title` }),
      lines: chunk.map((c, j) => ({ text: quote(c, `cons[${i}][${j}]`) })),
      image: best[2]?.image || best[0]?.image || null,
    });
  }

  // WHO IT IS FOR. Derived from fields rather than from the verdict, and it is the
  // one slide here that is a judgement of ours - so every line on it is a FACT with
  // the judgement left to the reader: the flight length, whether there is a real
  // kosher infrastructure, when the season is. "For families" would be the judgement
  // and it is not made, because nothing on the page supports it.
  const forWhom = [];
  const flight = firstClause(practical.flightsHe);
  if (flight) forWhom.push({ text: line(flight, { where: 'who.flight', quote: practical.flightsHe }) });
  const kosher = firstClause(practical.kosherHe);
  if (kosher) forWhom.push({ text: line(kosher, { where: 'who.kosher', quote: practical.kosherHe }) });
  const season = seasonLine(practical);
  if (season) forWhom.push({ text: line(season, { where: 'who.season' }) });
  if (forWhom.length) {
    slides.push({
      look: 'sheet',
      titleHe: line('למי זה מתאים', { where: 'who.title' }),
      lines: forWhom,
      image: best[0]?.image || null,
    });
  }

  // The best three, as label slides, so the post ends on photographs rather than on
  // text. A verdict post is four slides of reading; ending on three pictures is what
  // stops it feeling like an article.
  for (const [i, p] of best.slice(0, 3).entries()) {
    slides.push({
      look: 'label',
      number: `${i + 1}.`,
      titleHe: line(p.name, { where: `best${i}` }),
      noteHe: placeLine(p),
      image: p.image,
      band: 'lower',
      placeId: p.id,
    });
  }

  if (questionHe) {
    slides.push({
      look: 'sheet',
      titleHe: line(`${destHe}: שווה או לא?`, { where: 'close.title' }),
      lines: [{ text: line(questionHe, { where: 'close.question' }), mark: true }],
      image: cover.image,
    });
  }

  return {
    slides,
    verdict,
    practical,
    captionHookHe: line(`${destHe}: מה טוב ומה פחות, בלי לייפות`, { where: 'caption.hook' }),
    stats: { pros: pros.length, cons: cons.length, best: best.length, score: verdict.score },
  };
}

