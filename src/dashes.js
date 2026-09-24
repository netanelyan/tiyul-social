// The em dash, banned.
//
// An owner's instruction, and it is absolute: no em dash appears anywhere this
// project writes. Not on a slide, not in a caption, not in an approval card,
// not in an error. The reason it needs a module rather than a habit is that
// almost nothing here writes its own strings — a model writes them, and a model
// reaches for "—" constantly in both languages.
//
// This is not a new rule so much as a promotion. src/deck/build.js and
// src/deck/ideas.js already carried `const clean = (s) => s.replace(/[—–]/g,
// '-')` — the same three lines, copied into eight different functions, because
// a deck slide with an em dash on it looked wrong long before anybody said so.
// Eight copies of a rule is eight places for the ninth caller to forget it,
// which is exactly what the clip, shoot and plan writers did.
//
// THE EN DASH GOES TOO. It is not what was asked for and it is not what anybody
// types; it arrives the same way the em dash does, from a model imitating
// typeset English, and a reader cannot tell the two apart at 31px. What survives
// is the hyphen, which is on the keyboard.

/** Any dash a model reaches for that a person would not type. */
export const LONG_DASH = /[—–]/;

/**
 * The same string with its long dashes reduced to hyphens.
 *
 * A hyphen rather than a comma or nothing, because the substitution has to work
 * without reading the sentence: "טיסה הלוך ושוב — 700 ₪" is a label and its
 * value, and a comma there changes what the line means. A hyphen keeps the
 * break and costs the typography.
 *
 * Spaces are collapsed afterwards, so a dash that was the whole separator
 * ("א — ב") does not leave a double space behind it.
 */
export const stripDashes = (s) => String(s ?? '').replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();

/** Does this string carry one? For the guards that refuse rather than repair. */
export const hasLongDash = (s) => LONG_DASH.test(String(s ?? ''));
