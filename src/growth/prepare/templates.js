import { readFileSync, writeFileSync } from 'node:fs';
import { stripDashes, hasLongDash } from '../../dashes.js';
import { URL_LIKE } from '../../urlLike.js';
import { PLACEHOLDERS, TEMPLATE_NAMES } from '../config.js';

// The message templates: reading, checking, saving and filling them.
//
// The owner's words, verbatim. A DM is the template plus ONE generated line
// about the post, and nothing else a model wrote; that is most of what makes
// "no invented compliments or claims" enforceable rather than hoped for.
//
// Three small pieces of syntax, all of them visible in the file:
//
//   {זכר|נקבה}        the female/male toggle picks a side, instantly, for free
//   [שם] [יעד] ...    placeholders; [שם] and the personal line vanish cleanly
//                     when there is nothing true to put there
//   {{אם שואלים: ...}} kept only when the post itself shows people asking for
//                     the route. The desk cannot read TikTok comments, so the
//                     template's "שמתי לב שהרבה שואלים אותך על המסלול" is a
//                     claim it can only stand behind when the caption says so.

const DIR = new URL('../templates/', import.meta.url);

export class TemplateError extends Error {}

export function readTemplate(name, dir = DIR) {
  if (!TEMPLATE_NAMES.includes(name)) throw new TemplateError(`no template called ${name}`);
  return readFileSync(new URL(`${name}.txt`, dir), 'utf8').trim();
}

export const readTemplates = (dir = DIR) => Object.fromEntries(TEMPLATE_NAMES.map((n) => [n, readTemplate(n, dir)]));

/** Problems with a template, as Hebrew sentences. Empty means it may be saved. */
export function checkTemplate(name, text) {
  const out = [];
  const t = String(text || '');
  if (!t.trim()) out.push('התבנית ריקה');
  if (hasLongDash(t)) out.push('יש בתבנית קו מפריד ארוך. מקף רגיל בלבד');
  for (const m of t.matchAll(/\[[^\]]*\]/g)) {
    if (!PLACEHOLDERS.includes(m[0])) out.push(`${m[0]} אינו שדה מוכר. השדות: ${PLACEHOLDERS.join(' ')}`);
  }
  const bare = t.replace(/\{\{[^}]*\}\}/g, '');
  if ((bare.match(/\{/g) || []).length !== (bare.match(/\}/g) || []).length) out.push('סוגריים מסולסלים לא מאוזנים');
  for (const m of bare.matchAll(/\{([^{}]*)\}/g)) {
    if (m[1].split('|').length !== 2) out.push(`{${m[1]}} צריך להיות {זכר|נקבה}`);
  }
  for (const m of t.matchAll(/\{\{([^}]*)\}\}/g)) {
    if (!/^אם שואלים:/.test(m[1].trim())) out.push('התנאי היחיד שמוכר הוא {{אם שואלים: ...}}');
  }
  if (URL_LIKE.test(t.replace(/\[קישור\]/g, ''))) out.push('אין כתובות בתבנית. הקישור נכנס רק דרך [קישור]');
  if (['creator', 'agency', 'customer-link'].includes(name) && !t.includes('[קישור]')) out.push('התבנית הזו צריכה [קישור]');
  return out;
}

export function saveTemplate(name, text, dir = DIR) {
  const problems = checkTemplate(name, text);
  if (problems.length) throw new TemplateError(problems.join('. '));
  writeFileSync(new URL(`${name}.txt`, dir), `${String(text).trim()}\n`);
}

/** The female or male side of every {זכר|נקבה} pair. */
export const pickGender = (text, gender) =>
  String(text).replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_, m, f) => (gender === 'm' ? m : f));

/**
 * A template, filled.
 *
 * `vars`: name, dest, line, link, gift, gender ('f' | 'm'), demand (bool).
 * Every value is put in as plain text; long dashes are reduced line by line so
 * a destination name or an edited line cannot bring one in.
 */
export function fill(template, vars = {}) {
  let t = String(template || '');
  t = t.replace(/\{\{\s*אם שואלים:\s*([^}]*)\}\}/g, (_, inner) => (vars.demand ? inner.trim() : ''));
  t = pickGender(t, vars.gender);

  const name = String(vars.name || '').trim();
  t = name ? t.replaceAll('[שם]', name) : t.replace(/\s*\[שם\]/g, '');

  const line = String(vars.line || '').trim().replace(/[.!]+$/, '');
  t = line ? t.replaceAll('[שורה אישית אחת על הפוסט]', line) : t.replace(/\s*,?\s*\[שורה אישית אחת על הפוסט\]/g, '');

  t = t.replaceAll('[יעד]', String(vars.dest || '').trim());
  t = t.replaceAll('[מתנה]', String(vars.gift || '').trim());
  t = t.replaceAll('[קישור]', String(vars.link || '[קישור]').trim());

  return t
    .split('\n')
    .map((l) => stripDashes(l).replace(/\s+([,.!?])/g, '$1'))
    .join('\n')
    .trim();
}
