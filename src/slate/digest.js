import { postConfig } from '../postConfig.js';
import { STATUS_HE } from './state.js';

// The morning message: every post of the day, and one button. Pure.
//
// An album of the covers first (Telegram takes up to ten in one), then one line
// per post and the buttons: ✅ אשר הכל, and ⏭ דלג for each post. Nothing about a
// post that the owner would want before tapping is left for after: the time, the
// platform, the type, the destination, the slide count, the caption's first line.

const TYPE_HE = () => Object.fromEntries((postConfig().posts.types || []).map((t) => [t.id, t.he]));
const HHMM = (iso) =>
  iso
    ? new Intl.DateTimeFormat('he-IL', { timeZone: postConfig().schedule.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
    : null;

const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';

export function itemLine(it) {
  const d = it.cand?.deck || {};
  const when = [it.tiktokAt && `טיקטוק ${HHMM(it.tiktokAt)}`, it.instagramAt && `אינסטגרם ${HHMM(it.instagramAt)}`].filter(Boolean).join(' · ');
  // Per platform: an Instagram set can be a trimmed one, and an inbox post can be Instagram only.
  const counts = [it.tiktokAt && d.urls?.tiktok?.length, it.instagramAt && d.urls?.instagram?.length].filter(Boolean);
  const slides = counts.length === 2 && counts[0] !== counts[1] ? `${counts[0]} שקפים, ${counts[1]} באינסטגרם` : `${counts[0] || d.slides?.length || 0} שקפים`;
  const extra = [d.instagramTrimmed && it.instagramAt && `   ✂️ באינסטגרם ${d.instagramTrimmed}`, it.note && `   ${it.note}`].filter(Boolean);
  const state = it.skipped
    ? ' · דולג'
    : ['tiktok', 'instagram']
        .map((p) => it[p]?.status)
        .filter((s) => s && !['planned', 'approved', 'none'].includes(s))
        .map((s) => ` · ${STATUS_HE[s] || s}`)
        .join('');
  return [`${it.n}. ${when}`, `   ${TYPE_HE()[d.type] || d.type} · ${d.where || ''} · ${slides}${state}`, `   "${firstLine(it.cand?.headline)}"`, ...extra].join('\n');
}

/** { media, text, keyboard } for a slate. `media` is for sendMediaGroup, `keyboard` an inline keyboard. */
export function digestMessage(slate) {
  const cover = (it) => it.cand?.deck?.urls?.[it.tiktokAt ? 'tiktok' : 'instagram']?.[0] || it.cand?.deck?.urls?.tiktok?.[0];
  const media = slate.items
    .filter(cover)
    .slice(0, 10)
    .map((it) => ({ type: 'photo', media: cover(it), caption: `${it.n}. ${it.cand.deck.where || ''}` }));

  const head = slate.approved
    ? `📅 התוכנית להיום (${slate.date}) - ${slate.auto ? 'אושרה אוטומטית' : 'מאושרת'}`
    : `📅 התוכנית להיום (${slate.date}) - ממתינה לאישור. שום דבר לא יוצא בלי אישור.`;
  const notes = [...(slate.dropped || []).map((d) => `⚠️ ${d}`), ...(slate.warnings || []).map((w) => `⚠️ ${w}`)];
  const text = [head, '', ...slate.items.map(itemLine), ...(notes.length ? ['', ...notes] : [])].join('\n');

  const open = slate.items.filter((it) => !it.skipped);
  const keyboard = [];
  if (!slate.approved && open.length) keyboard.push([{ text: '✅ אשר הכל', callback_data: `sa:${slate.date}` }]);
  const skips = open
    .filter((it) => ['tiktok', 'instagram'].some((p) => ['planned', 'approved'].includes(it[p].status)))
    .map((it) => ({ text: `⏭ דלג ${it.n}`, callback_data: `ss:${slate.date}:${it.n}` }));
  for (let i = 0; i < skips.length; i += 4) keyboard.push(skips.slice(i, i + 4));
  return { media, text, keyboard };
}
