import { verdictOf, practicalOf, listPlaces, placeLine, firstClause, seasonLine, ratingBadge } from './source.js';
import { line, fill, bestClause, openClause, isKosherLine, assertKosherIsANote } from './voice.js';

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
  const byLength = (list) => [...list].map(openClause).filter(Boolean).sort((a, b) => a.length - b.length);
  const cons = byLength(verdict.consHe).slice(0, 4);

  // EVERY CLAUSE IS SPENT ONCE.
  //
  // The pros slide, the "who is this for" slide and the closing slide each asked the
  // page for its best clause, and the page's best clause is the same clause each time -
  // so Batumi's "טיסה ישירה קצרה" appeared on three of five slides. A post with eight
  // slides and four distinct sentences reads as having run out of things to say,
  // because it has.
  //
  // assertNoEcho now catches this at the end, but catching it means refusing to build
  // the post. Spending each clause once means the post is built correctly in the first
  // place, and the assertion is there for the next builder that forgets.
  const spent = new Set();
  const take = (candidates, opts = {}) => {
    const fresh = (candidates || []).map(openClause).filter((c) => c && !spent.has(c));
    const picked = bestClause(fresh, opts);
    if (picked) spent.add(picked);
    return picked;
  };

  // THE PRACTICAL FACTS ARE CLAIMED BEFORE THE PROS ARE.
  //
  // Order matters here and the first version had it backwards. The pros slide was built
  // first and marked its three clauses spent, and on Batumi the page's flight note and
  // its best pro are the same sentence - so the "who is this for" slide found every
  // candidate already taken, fell below its two-line floor, and vanished. The post lost
  // a slide to a rule meant to improve it.
  //
  // The practical paragraphs are the narrower pool: there are at most five of them and
  // nothing else can say what they say. The pros are the wider one. So the narrow pool
  // draws first, and the pros slide takes what is left, which is the direction that
  // always leaves both slides with something.
  const practicalFacts = [
    [firstClause(practical.flightsHe), 'who.flight', practical.flightsHe],
    [firstClause(practical.aroundHe), 'who.around', practical.aroundHe],
    [seasonLine(practical), 'who.season', null],
    [costLine(city), 'who.cost', null],
  ]
    .map(([text, where, source]) => [openClause(text), where, source])
    .filter(([text]) => text && !spent.has(text));
  practicalFacts.forEach(([text]) => spent.add(text));
  // The drawbacks are claimed too. They are chosen above by length rather than through
  // `take`, so without this the closing slide's fallback could - and on Sicily did -
  // pick a con already quoted two slides earlier.
  cons.forEach((c) => spent.add(c));

  // SIX ASKED FOR, SO FIVE SURVIVE THE PHOTOGRAPH FILTER.
  //
  // "2 places in a post about a whole city is not enough" - and two is what came out:
  // the old call asked listPlaces for three and then dropped the ones with no
  // photograph, so the post about Batumi ended on two. Asking for three and keeping
  // whatever survives is asking for the wrong thing; the post needs a FLOOR on what it
  // ends with, so it asks for twice that and lets the filter take its cut.
  const best = listPlaces(city, { want: 8, needPhoto: false }).filter((p) => p.image?.src);

  const quote = (text, where) => line(text, { where, quote: verdict.source });

  // THE COVER MUST NOT ANSWER ITS OWN QUESTION, which is what the published one did.
  //
  // "סנטוריני: שווה או לא?" over "הדירוג שלנו: 4.5" is a hook and its answer on the
  // same slide. The viewer has the verdict before the first swipe, so there is nothing
  // to swipe for - and the two lines actively fight: the hook implies caution and the
  // score implies "obviously yes". The live post had the same fault under a different
  // hook, "לפני שאתם מזמינים לסנטוריני, שתי דקות" over 4.5: a warning defused by a
  // score.
  //
  // So the second line is now the PROMISE OF CONTENTS - how many drawbacks are coming -
  // and the score moves into the badge, where it is a credential rather than a verdict.
  // A number in a badge says "somebody graded this"; the same number in a sentence
  // under a question says "and here is the grade".
  //
  // The one exception is the `score` hook shape, which is BUILT on the number: "נתנו
  // לסנטוריני 4.5. וזה למה" uses it as the setup, and the thing withheld is the why.
  // There the badge would print it twice.
  const usesScore = hook.id === 'score';
  const cover = {
    look: 'label',
    cover: true,
    // `{score}` is the page's own rating and it is a number we publish, which is the
    // only kind of number this project puts on a slide unsourced. A hook shape that
    // asks for it on a page with no score would print a gap, so the fill is checked.
    titleHe: line(fill(hook.he, { dest: destHe, score: verdict.score ?? '' }).replace(/\s+/g, ' ').trim(), {
      where: 'cover',
    }),
    noteHe: line(coverPromise(cons.length, practical), { where: 'cover.note' }),
    // "4.3/5" with a star rather than a bare number beside a label. The bare version
    // read as a statistic; a star and a denominator read as a verdict somebody gave.
    ...(usesScore ? {} : ratingBadge(city) || {}),
    band: 'mid',
    image: best[0]?.image || null,
  };

  const slides = [cover];

  // Whatever the practical pass left. Three at most, and at least one or the type would
  // not have built - canBuild already refused a verdict with no pros.
  // AT MOST ONE KASHRUT CLAUSE HERE TOO, and never as the only one.
  //
  // The rule is not about the "who is this for" slide, it is about the post - and
  // Bangkok proved it: the page's two shortest pros are both about kosher food, so the
  // "what is good there" slide came out as two kashrut lines and nothing else. Same
  // misrepresentation, different slide. So the non-kosher clauses are taken first and a
  // single kosher one may follow them.
  const fresh = byLength(verdict.prosHe).filter((p) => !spent.has(p));
  const pros = fresh.filter((p) => !isKosherLine(p)).slice(0, 3);
  const oneKosher = fresh.find(isKosherLine);
  if (oneKosher && pros.length >= 1 && pros.length < 3) pros.push(oneKosher);
  pros.forEach((p) => spent.add(p));
  if (pros.length) {
    slides.push({
      look: 'sheet',
      titleHe: line('מה טוב שם', { where: 'pros.title' }),
      lines: pros.map((p, i) => ({ text: quote(p, `pros[${i}]`) })),
      image: best[1]?.image || best[0]?.image || null,
    });
  }

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
  // MORE THAN THE KOSHER LINE. The first version of this slide was, on most
  // destinations, one sentence about kosher food and one about flights - which reads as
  // though the only reason to consider the place is the kashrut, and that is both
  // untrue and a much smaller post than the page supports. Batumi is worth going to for
  // the Black Sea, the old town and the prices; the kosher note is one of five facts,
  // not the headline.
  //
  // So every practical paragraph the page publishes gets a line, in the order they
  // decide a trip: how you get there, how you move once there, when to go, what it
  // costs, and the kashrut. All verbatim.
  const forWhom = practicalFacts
    .slice(0, 4)
    .map(([text, where, source]) => ({ text: line(text, { where, quote: source }) }));

  // MORE REASONS, FROM THE VERDICT ITSELF, WHEN THE PRACTICAL PARAGRAPHS ARE THIN.
  //
  // The five practical paragraphs are not all published for every destination. On
  // Batumi only two of them were, and one of those was the kashrut note - so a slide
  // meant to carry five facts carried one, about kosher food, and the post read as
  // though that is the only reason to go. The page itself says otherwise at length; the
  // builder simply was not reading the part that says so.
  //
  // So the remaining slots are filled from the verdict's own pros, which are the
  // destination's actual case, before the kashrut line is considered at all.
  while (forWhom.length < 4) {
    const fresh = take((verdict?.prosHe || []).filter((p) => !isKosherLine(p)), { max: 110 });
    if (!fresh) break;
    forWhom.push({ text: line(fresh, { where: `who.pro${forWhom.length}`, quote: verdict.source }) });
  }

  // THE KASHRUT LINE IS LAST, AND ONLY WHERE SOMETHING ELSE IS ALREADY ON THE SLIDE.
  //
  // See assertKosherIsANote in voice.js for the rule and why it is a rule. In short: a
  // slide whose every line is about kashrut tells a reader who does not keep kosher
  // that this destination is not for them, which is untrue of Batumi and of almost
  // everywhere else the site covers. It is a note among facts or it is not on the post.
  const kosher = firstClause(practical.kosherHe, { max: 90 });
  if (kosher && forWhom.length >= 2 && !spent.has(openClause(kosher))) {
    spent.add(openClause(kosher));
    forWhom.push({ text: line(openClause(kosher), { where: 'who.kosher', quote: practical.kosherHe }) });
  }

  // Two facts minimum, or the slide is not worth a swipe.
  if (forWhom.length >= 2) {
    slides.push(
      assertKosherIsANote(
        {
          look: 'sheet',
          titleHe: line('למי זה מתאים', { where: 'who.title' }),
          lines: forWhom,
          image: best[0]?.image || null,
        },
        'verdict "who"'
      )
    );
  }

  // The best three, as label slides, so the post ends on photographs rather than on
  // text. A verdict post is four slides of reading; ending on three pictures is what
  // stops it feeling like an article.
  for (const [i, p] of best.slice(0, 5).entries()) {
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

  // THE CLOSING SLIDE ANSWERS, THEN ASKS.
  //
  // It used to repeat the cover word for word - "בטומי: שווה או לא?" on slide one and
  // "בטומי: שווה או לא?" again on the last slide - with the question under it. That
  // spends the most-watched slide on nothing, and it is now caught by assertNoEcho
  // rather than relied on to stay fixed.
  //
  // What goes there instead is the one thing a verdict post has and has withheld for
  // seven slides: OUR ANSWER, as the rating, with the single clearest reason under it.
  // A viewer who swiped to the end came for the verdict.
  const bestPro = take(verdict.prosHe, { max: 90 }) || take(verdict.consHe, { max: 90 });
  const badge = ratingBadge(city);
  slides.push({
    look: 'sheet',
    titleHe: line(badge?.badgeHe ? `התשובה שלנו: ${badge.badgeHe} ⭐` : 'התשובה שלנו', { where: 'close.title' }),
    lines: [
      ...(bestPro ? [{ text: line(bestPro, { where: 'close.why', quote: verdict.source }) }] : []),
      ...(questionHe ? [{ text: line(questionHe, { where: 'close.question' }), mark: true }] : []),
    ],
    image: cover.image,
  });

  return {
    slides,
    verdict,
    practical,
    captionHookHe: line(`${destHe}: מה טוב ומה פחות, בלי לייפות`, { where: 'caption.hook' }),
    stats: { pros: pros.length, cons: cons.length, best: best.length, score: verdict.score },
  };
}


/**
 * What the cover promises, in place of the answer it used to give away.
 *
 * COUNTED, because a count is a promise a viewer can hold you to and "מה טוב ומה פחות"
 * is not. "4 דברים שכדאי לדעת לפני" tells somebody exactly how long this will take and
 * exactly what they get, which is the completion loop the 21-slide reference post runs
 * on, applied to a post a quarter the length.
 *
 * The flight is named when it is a negative, because on a verdict post that IS the
 * headline drawback and it is the one people are deciding on - Santorini's page opens
 * its practical note with "אין טיסות ישירות מנתב״ג", and a cover that says so is a
 * cover somebody stops for.
 */
export function coverPromise(consCount, practical) {
  const flight = firstClause(practical?.flightsHe, { max: 60 });
  if (flight && /^\s*(?:אין|לא\s)/.test(flight)) return `מתחילים מזה: ${flight}`;
  const n = Math.max(1, consCount);
  return n === 1 ? 'דבר אחד שכדאי לדעת לפני' : `${n} דברים שכדאי לדעת לפני`;
}

/**
 * What a day there costs, from the page's own daily figure.
 *
 * IN THE LOCAL CURRENCY, AND SAYING SO. The site publishes `dailyCost` with a currency
 * and a source; converting it to shekels would need an exchange rate nobody published,
 * which is the invented number src/plan/site.js exists to refuse. So it prints what the
 * page prints and names the currency, and the reader does the sum they were going to do
 * anyway.
 */
export function costLine(city) {
  const c = city?.dailyCost || city?.dailyBudget;
  const mid = Number(c?.mid ?? c?.midRange ?? c?.budget);
  if (!c?.currency || !Number.isFinite(mid) || mid <= 0) return null;
  return `יום טיפוסי: כ-${Math.round(mid).toLocaleString('en-US')} ${c.currency} לאדם`;
}
