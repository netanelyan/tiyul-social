import { readFileSync, writeFileSync } from 'node:fs';
import { stripDashes, hasLongDash } from '../../dashes.js';
import { URL_LIKE } from '../../urlLike.js';
import { PLACEHOLDERS, TEMPLATE_NAMES } from '../config.js';

// The short templates: the two follow-ups and the customer reply's link line.
//
// The owner's words, verbatim, editable on the Settings page. The first
// messages are no longer templates (see config.js); these stay templates
// because each is one short sentence, and the same sentence is the right one
// every time.
//
// TWO PLACEHOLDERS, [יעד] and [קישור], and no gendered forms. Every lead starts
// with its gender unknown, so a template that picks a gender would guess; the
// check refuses a {זכר|נקבה} pair and the text is written so it needs none.

const DIR = new URL('../templates/', import.meta.url);

export class TemplateError extends Error {}

export function readTemplate(name, dir = DIR) {
  if (!TEMPLATE_NAMES.includes(name)) throw new TemplateError(`no template called ${name}`);
  return readFileSync(new URL(`${name}.txt`, dir), 'utf8').trim();
}

export const readTemplates = (dir = DIR) => Object.fromEntries(TEMPLATE_NAMES.map((n) => [n, readTemplate(n, dir)]));

/** Problems with a template, as English sentences. Empty means it may be saved. */
export function checkTemplate(name, text) {
  const out = [];
  const t = String(text || '');
  if (!t.trim()) out.push('The template is empty.');
  if (hasLongDash(t)) out.push('It has a long dash. A plain hyphen only.');
  for (const m of t.matchAll(/\[[^\]]*\]/g)) {
    if (!PLACEHOLDERS.includes(m[0])) out.push(`${m[0]} is not a known field. The fields: ${PLACEHOLDERS.join(' ')}`);
  }
  if (/\{[^{}]*\|[^{}]*\}/.test(t)) out.push('No {male|female} pairs: most people\'s gender is not known. Write it so it needs none.');
  if (URL_LIKE.test(t.replace(/\[קישור\]/g, ''))) out.push('No web addresses. The link only ever goes in through [קישור].');
  if (name === 'customer-link' && !t.includes('[קישור]')) out.push('This template needs [קישור].');
  return out;
}

export function saveTemplate(name, text, dir = DIR) {
  const problems = checkTemplate(name, text);
  if (problems.length) throw new TemplateError(problems.join(' '));
  writeFileSync(new URL(`${name}.txt`, dir), `${String(text).trim()}\n`);
}

/**
 * A template, filled. `vars`: dest, link.
 *
 * Every value is put in as plain text; long dashes are reduced line by line so
 * a destination name cannot bring one in.
 */
export function fill(template, vars = {}) {
  let t = String(template || '');
  t = t.replaceAll('[יעד]', String(vars.dest || '').trim());
  t = t.replaceAll('[קישור]', String(vars.link || '[קישור]').trim());
  return t
    .split('\n')
    .map((l) => stripDashes(l).replace(/\s+([,.!?])/g, '$1'))
    .join('\n')
    .trim();
}
