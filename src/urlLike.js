/**
 * Anything that reads as a link: a scheme, a www host, or a .com / .co.il.
 *
 * Deliberately broader than a URL parser. What gets a post demoted is not a
 * well-formed URL, it is a domain a human can retype — "tiyulplus.com" with no
 * scheme and no www is the same signal to the platform and the same signal to
 * the reader, and a parser would pass it.
 *
 * IN ITS OWN MODULE, which looks like overkill for one regular expression and
 * is not. It lives at the bottom of three different import chains: format.js
 * guards captions with it, video/hooks.js guards a burned-in line with it, and
 * postConfig.js now guards the configured CTA with it — and postConfig.js is
 * imported BY hashtags.js, which is imported by format.js. Importing it from
 * format.js would close that loop into a cycle. Copying it into postConfig.js
 * would give the project two spellings of one rule, which is the failure mode
 * every guard in this codebase is written to avoid.
 *
 * format.js re-exports it, so every existing import of `URL_LIKE` from there
 * still resolves to exactly this object.
 */
export const URL_LIKE = /(?:https?:\/\/)|(?:\bwww\.)|(?:\.(?:com|co\.il)\b)/i;
