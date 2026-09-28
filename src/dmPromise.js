import { postConfig } from './postConfig.js';

// "We will send it to you in a message" — the one promise in this project that
// something other than the pipeline has to keep.
//
// WHY THIS NEEDS A GUARD AND THE OTHER ASKS DO NOT.
//
// Every other line a post can end on is true the moment it is written. "הלינק
// בביו" is true because the bio has a link in it. "שמרו את זה לטיול" asks for
// something the viewer does alone. But "תגיבו 'פראג' ונשלח לכם את המסלול" is a
// promise that a listener will see the comment, match the keyword and send a
// private reply — and that listener is `igReplies`, which is OFF
// (post-config.json, `igReplies.on: false`).
//
// With it off, the post still publishes, the comment still arrives, and nothing
// answers it. That is the giveaway's mistake in a new costume: the previous
// version of this account promised five commenters a month of premium and had no
// mechanism to pick them, and the fix recorded in BRIEF.md was to stop making
// promises the bot cannot keep. A comment that goes unanswered is worse than a
// bio pointer, because somebody did the thing that was asked.
//
// BOTH CALL SITES ALREADY GET THIS RIGHT, and that is exactly why the guard is
// worth having. `siteSlideFor` checks `replies?.on` before choosing `ctaDmHe`,
// and `captionCta` checks `cfg.igReplies.on` before choosing `siteCtaDmHe`. Two
// correct conditionals in two files, each one line long, each easy to lose in a
// refactor — and if either is lost the post looks completely normal. Nothing
// fails, nothing logs, and the only symptom is a stranger's unanswered comment.
// So the rule is asserted on the finished string rather than trusted to the
// branch that produced it, the same bargain assertNoUrl makes.

/**
 * Hebrew phrasings that say "we will send it to you privately".
 *
 * Matched on the SENDING rather than on the word for a message. "בהודעה" alone
 * appears in honest sentences — a slide could say the community takes Shabbat
 * bookings by message — so the pattern wants a first-person-plural verb of
 * sending, or one of the two platform words that can only mean a private reply.
 *
 * Deliberately not a list of every possible wording. It covers what the config
 * can actually produce plus the obvious neighbours somebody would reach for when
 * editing it, which is the population a guard on configured strings has to cover.
 */
export const DM_PROMISE =
  /(?:נשלח|אשלח|שולחים|נשגר)\s+(?:לך|לכם|לכן)|ב(?:הודעה|פרטי|פרטית)\s*$|\bDM\b|בדי\.?אם/i;

export class DmPromiseError extends Error {
  constructor(where, text) {
    super(`${where} promises a private message while igReplies is off: ${JSON.stringify(text)}`);
    this.name = 'DmPromiseError';
    this.reason = 'dm_promise_while_off';
    this.where = where;
  }
}

/** Would this string tell a reader to expect a private reply? */
export const promisesDm = (text) => DM_PROMISE.test(String(text || ''));

/**
 * Refuse a published string that promises a DM nothing will send.
 *
 * Returns the text, so it composes the way assertNoUrl does:
 *
 *   cand.tiktokCaption = assertNoDm(assertNoUrl(caption, 'the description'), 'the description');
 *
 * A THROW RATHER THAN A SILENT STRIP, for the reason every guard here throws: the
 * string came from a template somebody wrote, and quietly deleting a sentence out
 * of it publishes a post whose ending was edited by a regular expression. Failing
 * the build is how the person who edited the config finds out.
 *
 * `replies` is injectable because the tests need to prove BOTH directions — that
 * the promise is refused while the listener is off, and that it is permitted once
 * it is on. A guard that cannot be switched on is a guard nothing has ever seen
 * pass.
 */
export function assertNoDm(text, where = 'this text', { replies = null } = {}) {
  const on = Boolean((replies ?? postConfig().igReplies)?.on);
  if (on) return text;
  if (promisesDm(text)) throw new DmPromiseError(where, String(text).slice(0, 120));
  return text;
}
