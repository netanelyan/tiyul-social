import { postConfig } from '../postConfig.js';
import { practicalOf, seasonLine, bookingLines, firstClause, verdictOf } from './source.js';
import { costLine } from './verdict.js';

// DOES THE POST CONTAIN WHAT ITS COVER SAID IT WOULD?
//
// THE EVIDENCE, AND IT IS OUR OWN. The two highest-reach posts this account has ever
// published are both slideshows that opened on a specific promise:
//
//   לפני שאתם מזמינים לסנטוריני, שתי דקות    1993 views    9 likes   0.5%
//   נתנו לטוקיו 4.8, וזה למה                  711 views     9 likes   1.3%
//
// Four to ten times the reach of the best video and a fifth of its like rate. The
// feed showed those posts to more people than anything else here, and the people it
// showed them to did not think they got anything. A promise earns the view and only
// the payoff earns the like.
//
// WHAT WAS ACTUALLY MISSING, found while writing this. The verdict post's own price
// line had been returning null for every destination in the catalogue since it was
// written, because it read the site's `dailyCost.mid` as a number and the site
// publishes it as an object or a pair. So the post that says "two minutes before you
// book" carried no price, and nothing noticed, because a missing fact just makes a
// slide shorter. See costLine in ./verdict.js.
//
// SO THIS COUNTS, RATHER THAN TRUSTING. A promise is a measurable claim and the
// slides are a finite list of lines, so whether one contains the other is a question
// with an answer. It runs over the FINISHED post, like assertPostVoice and for the
// same reason: a builder is where a line gets added, and a line added without a
// guard is the likeliest way a cover comes to over-promise again.
//
// IT REFUSES THE POST RATHER THAN FIXING IT. There is no honest automatic fix: the
// facts either are on the page or they are not, and a post that cannot keep its own
// promise should not be built with a weaker cover silently substituted. A refusal
// names the destination and the hook, which is something somebody can act on.

// What counts as a CONCRETE specific, as patterns over the finished lines.
//
// Each of these is a fact somebody could act on or be wrong about, which is the test.
// "העיר יפה" is neither. A number, a month, a currency, a booking instruction and a
// quoted drawback all are.
const SPECIFIC = [
  // A price or any figure with a unit on it.
  { id: 'price', re: /(יורו|דולר|שקלים|ליש״ט|יין|באט|קורונה|זלוטי|פורינט|לארי|דירהם|דונג|רופיה|ריאל|פסו|לב|ליי|דראם|טנגה|מאנאט|וון|פרנק|ראנד|שילינג|סול|טנגה|₪|\d+\s*(?:לאדם|ליום))/ },
  // When to go, as a month or a season the page named.
  { id: 'season', re: /(העונה הטובה|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|קיץ|חורף|אביב|סתיו)/ },
  // What to book, or when a thing is open.
  { id: 'booking', re: /(מראש|כרטיס|הזמנה|להזמין|שעת כניסה|שעות כניסה|כניסה חופשית|סגור|תורים|התורים)/ },
  // How long the flight is, or that there is not one.
  { id: 'flight', re: /(טיסה|טיסות|שעות טיסה|נחיתה|נתב״ג)/ },
  // How you move once there.
  { id: 'transport', re: /(מטרו|רכבת|אוטובוס|מונית|רכב|חשמלית|שכירות|הליכה|ברגל)/ },
];

/**
 * Which specifics this post actually carries, by id, and where.
 *
 * Reads the slides' own text, every field of it: a title, a note, a quoted line and a
 * badge are all things a viewer reads, and a fact only counts if it is on screen.
 */
export function specificsIn(post) {
  const text = [];
  for (const slide of post?.slides || []) {
    text.push(String(slide.titleHe || ''), String(slide.noteHe || ''), String(slide.badgeHe || ''));
    for (const line of slide.lines || []) text.push(String(line?.text || ''));
  }
  const joined = text.filter(Boolean).join('\n');
  return SPECIFIC.filter((s) => s.re.test(joined)).map((s) => s.id);
}

/**
 * Which specific facts the PAGE could supply, before anything is spent.
 *
 * THE SAME QUESTION ASKED EARLY, AND THAT IS THE POINT. `specificsIn` reads finished
 * slides, which exist only after the photograph pass, and the photograph pass is the
 * one step in a post build that costs money. A page that cannot supply two kinds of
 * concrete fact is a page that cannot carry a practical promise, and it is answerable
 * from the city payload alone - the same bargain canBuild already makes for the
 * drawbacks clause.
 *
 * MEASURED AGAINST THE FINISHED POSTS, which is the only way to know a predictor is
 * not lying. Over the 61 pages: this gate refuses one, Kathmandu, whose quotable text
 * carries a flight note and nothing else. It passes 54, of which 53 build a post that
 * the finished-post check also accepts; the one that slips through is Phuket, which
 * spends a photograph pass and is then refused by assertDelivers.
 *
 * One wasted pass in 54 is the right side to be wrong on. The alternative version of
 * this function, which counted only the practical paragraphs, refused four pages
 * including two whose finished posts were fine.
 */
export function pageSpecifics(city) {
  const practical = practicalOf(city);
  const verdict = verdictOf(city);

  // THE LINES THIS PAGE WOULD ACTUALLY PUT ON SLIDES, and then the same count run
  // over them. Not a hand-written list of five field checks, which is what this was
  // first and which got the answer wrong in both directions at once.
  //
  // Too lenient on one side: every one of the 61 pages publishes a flights
  // paragraph, so "does the field exist" passed on all of them and the gate never
  // fired. Too strict on the other: counting only the practical paragraphs refused
  // Batumi and Abu Dhabi, whose practical openings are too long to quote but whose
  // VERDICT clauses carry a flight time and a season between them. Those two posts
  // pass the finished-post check, so refusing them before building deletes content
  // that was fine.
  //
  // A PREDICTOR MUST NOT BE STRICTER THAN THE THING IT PREDICTS. Over-predicting
  // costs a wasted photograph pass on a post that is then refused; under-predicting
  // silently removes a destination from a format for good. So this counts the same
  // kinds, with the same patterns, over the text the builder is going to quote: the
  // page's own drawbacks and pros, the practical openings that fit, the season, the
  // price and the booking note.
  const text = [
    costLine(city),
    seasonLine(practical),
    ...bookingLines(city, { want: 2 }),
    firstClause(practical.flightsHe),
    firstClause(practical.aroundHe),
    ...(verdict?.prosHe || []).slice(0, 3),
    ...(verdict?.consHe || []).slice(0, 4),
  ]
    .filter(Boolean)
    .join('\n');

  return SPECIFIC.filter((s) => s.re.test(text)).map((s) => s.id);
}

/**
 * What the cover promised, read off the hook shape rather than guessed from the text.
 *
 * `counted` is the number at the head of the line, which is a promise of that many
 * things. `specifics` is whether the hook claims the post is USEFUL rather than
 * pretty: "before you book", "and here is why", "what you should know". Those are the
 * two shapes that can be broken, and the second is the one that was.
 */
const PROMISES_SPECIFICS = /(לפני שאתם|לפני ש|וזה למה|כדאי לדעת|שווה או לא|מה טוב ומה|הטעות|לא כתוב|שתי דקות)/;

export function promisedBy(titleHe) {
  const s = String(titleHe || '').trim();
  const counted = s.match(/^\s*(\d{1,2})\s/);
  return {
    counted: counted ? Number(counted[1]) : null,
    specifics: PROMISES_SPECIFICS.test(s),
  };
}

/**
 * Throw when the cover promises something the slides do not contain.
 *
 * `where` is the destination and the type, for the message. Returns the audit so a
 * caller that wants to log what it carried can, which the lab does.
 */
export function assertDelivers(post, { where = '' } = {}) {
  const cfg = postConfig().posts.deliver;
  const audit = { promised: promisedBy(post?.titleHe), carries: specificsIn(post), ok: true, why: null };
  if (!cfg.on) return audit;

  const { counted, specifics } = audit.promised;

  // A COUNTED COVER AND A POST WITH FEWER THINGS ON IT. Counted against the slides
  // that carry an item rather than the total, because a cover, a summary and a
  // closing slide are not items.
  if (counted != null) {
    const items = (post?.slides || []).filter((s) => s.placeId || s.number || s.day).length;
    if (items && items < counted) {
      audit.ok = false;
      audit.why = `the cover promises ${counted} and the post has ${items} items`;
    }
  }

  // A COVER THAT PROMISES THE PRACTICAL ANSWER. This is the 0.5% post.
  if (audit.ok && specifics && audit.carries.length < cfg.minSpecifics) {
    audit.ok = false;
    audit.why =
      `the cover promises something practical and the slides carry ${audit.carries.length} concrete ` +
      `fact kind(s) (${audit.carries.join(', ') || 'none'}), needs ${cfg.minSpecifics}`;
  }

  if (!audit.ok) throw new DeliveryError(`${where ? `${where}: ` : ''}${audit.why}`, audit);
  return audit;
}

export class DeliveryError extends Error {
  constructor(message, audit) {
    super(message);
    this.name = 'DeliveryError';
    this.audit = audit;
  }
}
