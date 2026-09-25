import { postConfig } from './postConfig.js';

// The Israeli angle, and which post it belongs to.
//
// BRIEF.md rule 2 has two halves and only one of them is obvious. "Be specific"
// is the easy half: name the destination, name the month, name the price. The
// half that keeps being forgotten is the sentence after it: *a post that would
// read identically to an American audience is a post with nothing in it for this
// one.* Direct flights from Ben Gurion, kosher food, what is open on Shabbat,
// whether an Israeli passport needs a visa, what a trip costs in shekels. That
// list is the only thing this account has that a hundred repost archives posting
// the same photographs do not.
//
// It lived in `shoot.angles` and reached exactly one kind of post: the shoot,
// which is the one thing here the bot cannot make. One a day, on the format
// that depends on somebody picking up a camera, while every format that
// actually runs unattended chose its subject with no angle at all.
//
// So the pool moved out of `shoot` and up a level, and a deck draws from it too.
//
// WHAT AN ANGLE MAY AND MAY NOT DO, WHICH IS THE WHOLE DESIGN.
//
// On a shoot the angle is the CONTENT: you are the source, you know whether the
// flight is direct, and the shot list says so. Nothing automated knows any of
// that. A pipeline that printed "טיסה ישירה מנתב״ג" on a slide would be
// inventing a fact of exactly the kind the rest of this project refuses to
// invent, and it would be inventing it on the claims an Israeli traveller is
// most likely to act on.
//
// So for anything the bot publishes by itself the angle steers SELECTION and
// stops there. It decides which destination is worth a deck this week, not what
// the deck says about it. "חופשת סוכות" makes an October-good destination the
// one that gets proposed; it does not put the word Sukkot on a slide. The
// prompts that receive an angle say this in as many words, because it is the
// one instruction a model will quietly disobey by being helpful.

/** The pool, from post-config.json. */
export const angles = () => postConfig().angles;

/**
 * One angle, avoiding what was used recently.
 *
 * `history` is newest first and each entry may carry an `angle`; anything
 * without one is ignored, so the same function reads a shoot log and a
 * published-post log without either having to be reshaped.
 *
 * Recently used angles are excluded OUTRIGHT rather than weighted down. The
 * pool is a dozen long and the window is five, so exclusion always leaves
 * something, and "kosher food" twice in one week is the repetition a viewer
 * actually notices, far more than a repeated format.
 */
export function pickAngle(history = [], { rand = Math.random } = {}) {
  const pool = angles();
  if (!pool.length) return null;
  const window = Math.min(5, pool.length - 1);
  const used = new Set(
    history.slice(0, window).map((h) => h?.angle).filter(Boolean)
  );
  const left = pool.filter((a) => !used.has(a));
  const choose = left.length ? left : pool;
  return choose[Math.floor(rand() * choose.length)];
}

/**
 * The paragraph a prompt is given about its angle.
 *
 * One string, built here rather than written out at each call site, because the
 * warning is the load-bearing part and two copies of a warning is one copy that
 * will be edited and one that will not. Returns null when there is no angle, so
 * a caller can drop it from the prompt entirely rather than saying "no angle".
 */
export function anglePrompt(angle) {
  if (!angle) return null;
  return [
    `הזווית הישראלית להצעה הזו: ${angle}`,
    'הזווית קובעת איזה יעד לבחור, לא מה לכתוב עליו. אל תדפיס אותה על שקופית,',
    'אל תטען שיש טיסה ישירה, שמשהו כשר, שפתוח בשבת או שלא צריך ויזה, ואל תנקוב',
    'במחיר בשקלים. שום עמוד לא פרסם את הדברים האלה ואנחנו לא יודעים אותם.',
    'מה שהיא כן עושה: היא הסיבה שדווקא היעד הזה שווה פוסט עכשיו.',
  ].join('\n');
}
