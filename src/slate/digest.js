import { postConfig, tiktokGoesAsDraft } from '../postConfig.js';
import { clipPublicUrl } from '../publish/imageHosts.js';
import { soundLine } from '../video/tracks.js';
import { STATUS_HE } from './state.js';

// The morning message: every post of the day, and one button. Pure.
//
// An album of the covers first (Telegram takes up to ten in one, photos and
// videos mixed, and a video plays in the chat), then one line per post and the
// buttons: ✅ אשר הכל, and ⏭ דלג for each post. Nothing about a post that the
// owner would want before tapping is left for after: the time, the platform, the
// type, the destination, the slide count or the video's length and sound, the
// caption's first line.

const TYPE_HE = () => Object.fromEntries((postConfig().posts.types || []).map((t) => [t.id, t.he]));
// A video by its format's own name in formats.mix; the three stock shapes are one format there.
const VIDEO_HE = () => ({
  ...Object.fromEntries((postConfig().formats.mix || []).map((f) => [f.id, f.he])),
  held: 'קליפ',
  cuts: 'קליפ',
  montage: 'קליפ',
  narrated: 'מדריך',
});
const HHMM = (iso) =>
  iso
    ? new Intl.DateTimeFormat('he-IL', { timeZone: postConfig().schedule.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
    : null;

const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';

/** What the line says about the post itself: its type, its place, its size. */
function whatLine(it) {
  const cand = it.cand || {};
  if (cand.kind === 'clip') {
    const c = cand.clip || {};
    const name = VIDEO_HE()[c.format] || VIDEO_HE()[c.shape] || 'סרטון';
    return `🎬 ${name} · ${cand.place || ''} · ${c.seconds ? `${c.seconds} שניות` : 'סרטון'}`;
  }
  if (cand.kind === 'card') return `📰 כרטיס · ${cand.trip?.where || cand.place || ''}`;
  const d = cand.deck || {};
  // Per platform: an Instagram set can be a trimmed one, and an inbox post can be Instagram only.
  const counts = [it.tiktokAt && d.urls?.tiktok?.length, it.instagramAt && d.urls?.instagram?.length].filter(Boolean);
  const slides = counts.length === 2 && counts[0] !== counts[1] ? `${counts[0]} שקפים, ${counts[1]} באינסטגרם` : `${counts[0] || d.slides?.length || 0} שקפים`;
  const type = TYPE_HE()[d.type] || d.type || (cand.kind === 'deck' ? 'מצגת' : cand.kind);
  return `${type} · ${d.where || ''} · ${slides}`;
}

export function itemLine(it) {
  const d = it.cand?.deck || {};
  // A TikTok draft goes to the inbox on approval, so it has no time of its own.
  const when = [it.tiktokAt && (tiktokGoesAsDraft(it.cand) ? 'טיקטוק: טיוטה מיד עם האישור' : `טיקטוק ${HHMM(it.tiktokAt)}`), it.instagramAt && `${it.cand?.kind === 'clip' ? 'רילס' : 'אינסטגרם'} ${HHMM(it.instagramAt)}`]
    .filter(Boolean)
    .join(' · ');
  const extra = [
    it.cand?.kind === 'clip' && `   ${soundLine(it.cand)}`,
    d.instagramTrimmed && it.instagramAt && `   ✂️ באינסטגרם ${d.instagramTrimmed}`,
    it.note && `   ${it.note}`,
  ].filter(Boolean);
  const state = it.skipped
    ? ' · דולג'
    : ['tiktok', 'instagram']
        .map((p) => it[p]?.status)
        .filter((s) => s && !['planned', 'approved', 'none'].includes(s))
        .map((s) => ` · ${STATUS_HE[s] || s}`)
        .join('');
  return [`${it.n}. ${when}`, `   ${whatLine(it)}${state}`, `   "${firstLine(it.cand?.headline)}"`, ...extra].join('\n');
}

/** The album entry for one item: the video itself, the card, or the cover slide. */
export function coverOf(it) {
  const cand = it.cand || {};
  if (cand.kind === 'clip') {
    const url = clipPublicUrl(cand);
    return url ? { type: 'video', media: url } : null;
  }
  if (cand.kind === 'card') return cand.card?.url ? { type: 'photo', media: cand.card.url } : null;
  const url = cand.deck?.urls?.[it.tiktokAt ? 'tiktok' : 'instagram']?.[0] || cand.deck?.urls?.tiktok?.[0];
  return url ? { type: 'photo', media: url } : null;
}

/** { media, text, keyboard } for a slate. `media` is for sendMediaGroup, `keyboard` an inline keyboard. */
export function digestMessage(slate) {
  const media = slate.items
    .map((it) => ({ it, cover: coverOf(it) }))
    .filter((x) => x.cover)
    .slice(0, 10)
    .map(({ it, cover }) => ({ ...cover, caption: `${it.n}. ${it.cand.deck?.where || it.cand.place || it.cand.trip?.where || ''}` }));

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
