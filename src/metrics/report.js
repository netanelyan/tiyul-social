import { allRows, rates } from './store.js';
import { available as tiktokAvailable } from './tiktok.js';
import { postConfig } from '../postConfig.js';

// The weekly report, and what it deliberately refuses to do.
//
// IT RANKS ON SAVES AND SHARES PER VIEW, NOT ON LIKES. The whole evidence base for this
// change is that the posts that work are saved and forwarded: every winner runs at 47
// to 95% saves per like, and our own prettiest deck ran at 22% with zero shares. A
// report that led with likes would rank the old posts top and quietly steer the account
// back to where it started.
//
// AND IT NEVER CHANGES A WEIGHT. It suggests, in words, and the edit is made by hand in
// post-config.json. Two reasons, and the second is the real one:
//
//   A week is a small sample. Four posts of a type is not evidence that the type works,
//   and an auto-tuner acting on four posts would chase noise into a corner and stay
//   there - the format that got unlucky twice never gets a third chance to prove
//   otherwise.
//
//   And the weights are an editorial position, not a parameter. "This account leads
//   with itineraries" is a decision about what the account IS. A number that drifts on
//   its own is a decision nobody made and nobody can find the argument for, which is
//   the opposite of what post-config.json's comments exist for.

/**
 * Rows published in the window, with their rates resolved and ONE of them chosen to
 * rank on.
 *
 * TIKTOK WINS WHERE IT EXISTS, and that is the whole point of letting numbers be typed
 * in. These posts are made for TikTok - the formats were read off TikTok, the drafts
 * land in TikTok's inbox - and ranking them on Instagram because Instagram is the
 * platform with an API would be measuring the wrong thing carefully. Instagram is the
 * fallback, not the default.
 *
 * `on` says which was used and `byHand` whether somebody typed it, because a ranking
 * built partly on read-off-the-screen numbers should say so rather than looking like it
 * came from an API.
 */
export function window(days = 7, { rows = null, now = Date.now() } = {}) {
  const cutoff = now - days * 86_400_000;
  return (rows || allRows())
    .filter((r) => Date.parse(r.at || '') >= cutoff)
    .map((r) => {
      const ig = rates(r.stats?.instagram);
      const tt = rates(r.stats?.tiktok);
      const useTt = tt.views != null;
      return {
        ...r,
        ig,
        tt,
        best: useTt ? tt : ig,
        on: useTt ? 'tiktok' : ig.views != null ? 'instagram' : null,
        byHand: (useTt ? r.stats?.tiktok?.by : r.stats?.instagram?.by) === 'hand',
      };
    });
}

/**
 * Group the window by one dimension of the shape and rank it.
 *
 * MEAN OF THE RATES, not the rate of the totals. Summing saves and dividing by summed
 * views lets one post that reached twenty thousand people decide the whole row - which
 * is exactly the post least like the others. The mean of per-post rates asks what a
 * typical post of this type did, which is the question the weights answer.
 *
 * A group with fewer than `min` posts is still reported, with its count, rather than
 * hidden: "plan: 1 post" is information, and a row that vanishes looks like a type that
 * was never tried.
 */
export function rankBy(entries, field, { min = 2 } = {}) {
  const groups = new Map();
  for (const row of entries) {
    const key = row.shape?.[field];
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const out = [];
  for (const [key, rows] of groups) {
    const saves = rows.map((r) => r.best.saveRate).filter((n) => n != null);
    const shares = rows.map((r) => r.best.shareRate).filter((n) => n != null);
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    out.push({
      key,
      posts: rows.length,
      measured: saves.length,
      saveRate: mean(saves),
      shareRate: mean(shares),
      views: mean(rows.map((r) => r.best.views).filter((n) => n != null)),
      // Whether there is enough here to say anything. Printed rather than used as a
      // filter, because "not enough data yet" is the most useful thing a young report
      // can say.
      thin: saves.length < min,
    });
  }
  // Ranked on saves, with shares breaking the tie. Unmeasured groups sink rather than
  // sorting as zero, which would put them below a format that genuinely failed.
  return out.sort((a, b) => (b.saveRate ?? -1) - (a.saveRate ?? -1) || (b.shareRate ?? -1) - (a.shareRate ?? -1));
}

const pct = (n) => (n == null ? '-' : `${(n * 100).toFixed(1)}%`);
const num = (n) => (n == null ? '-' : Math.round(n).toLocaleString('en-US'));
/** Hebrew counts one thing differently from several. "1 פוסטים" is what a program writes. */
const posts = (n) => (n === 1 ? 'פוסט אחד' : `${n} פוסטים`);

/**
 * The Telegram message.
 *
 * Deliberately plain text with no buttons. Nothing here is actionable by tapping: the
 * action is an edit to post-config.json, made after reading the numbers and looking at
 * the two covers named at the bottom.
 */
export function weeklyReport({ days = 7, rows = null, now = Date.now() } = {}) {
  const entries = window(days, { rows, now });
  const lines = [`📊 ${days} ימים · ${posts(entries.length)}`];

  if (!entries.length) {
    lines.push('', 'לא פורסם כלום בחלון הזה.');
    return lines.join('\n');
  }

  const measured = entries.filter((e) => e.best.saveRate != null).length;
  const onTt = entries.filter((e) => e.on === 'tiktok').length;
  const typed = entries.filter((e) => e.byHand).length;
  lines.push(`   ${measured} מהם עם מספרים · ${onTt} מטיקטוק, ${measured - onTt} מאינסטגרם`);
  if (typed) lines.push(`   ${typed} הוזנו ביד (/views)`);

  // TIKTOK, SAID IN WORDS RATHER THAN AS AN EMPTY TABLE. A section of dashes reads as a
  // bad week; naming the blocker is something somebody can act on.
  const tt = tiktokAvailable();
  if (!tt.ok && !onTt) lines.push(`   טיקטוק: אין מספרים - ${tt.why}. אפשר להזין ביד: /views`);

  for (const [field, titleHe] of [
    ['type', '🗂️ לפי סוג פוסט'],
    ['look', '🎨 לפי מראה'],
    ['hook', '🪝 לפי פתיח'],
    ['frame', '📐 לפי יחס גובה-רוחב'],
  ]) {
    const ranked = rankBy(entries, field);
    if (!ranked.length) continue;
    lines.push('');
    lines.push(`${titleHe} (שמירות / צפיות · שיתופים / צפיות)`);
    for (const r of ranked) {
      lines.push(
        `   ${r.key.padEnd(10)} ${pct(r.saveRate)} · ${pct(r.shareRate)}  (${posts(r.posts)}${r.thin ? ', מעט מדי למסקנה' : ''})`
      );
    }
  }

  // THE TOP AND BOTTOM THREE, BY NAME, because a ranking of types says what to do more
  // of and a list of posts says what actually happened. The covers are named so they
  // can be opened and looked at, which is the only way to tell a bad format from a bad
  // photograph.
  const scored = entries.filter((e) => e.best.saveRate != null).sort((a, b) => b.best.saveRate - a.best.saveRate);
  if (scored.length >= 2) {
    lines.push('');
    lines.push('🏅 הכי נשמרים');
    for (const r of scored.slice(0, 3)) lines.push(`   ${pct(r.best.saveRate)} · ${describe(r)}`);
    lines.push('');
    lines.push('🥀 הכי פחות');
    for (const r of scored.slice(-3).reverse()) lines.push(`   ${pct(r.best.saveRate)} · ${describe(r)}`);
  }

  // The suggestion, as a sentence, never as an edit.
  const byType = rankBy(entries, 'type');
  const solid = byType.filter((r) => !r.thin);
  if (solid.length >= 2) {
    const best = solid[0];
    const worst = solid[solid.length - 1];
    const weight = (id) => postConfig().posts.types.find((t) => t.id === id)?.weight ?? '?';
    lines.push('');
    lines.push('💡 הצעה (לא משנה כלום לבד):');
    lines.push(`   "${best.key}" מוביל ב-${pct(best.saveRate)} - המשקל שלו עכשיו ${weight(best.key)}`);
    lines.push(`   "${worst.key}" אחרון ב-${pct(worst.saveRate)} - המשקל שלו עכשיו ${weight(worst.key)}`);
    lines.push('   העריכה בקובץ post-config.json, ביד.');
  } else {
    lines.push('');
    lines.push('💡 עוד אין מספיק פוסטים מכל סוג כדי להציע שינוי משקלים.');
  }

  return lines.join('\n');
}

/**
 * The hook and format report, ranked by LIKES per view and by views.
 *
 * A SECOND REPORT RATHER THAN A CHANGE TO THE FIRST, and the reason is at the top of
 * this file: weeklyReport refuses to lead with likes because that would have ranked
 * the scenic decks top and steered the account back to where it started. That is
 * still true of the weekly table.
 *
 * It is also not the question the newest numbers ask. Those numbers are a like rate
 * comparison between a twelve second video and a slideshow, 6.1% against 0.5%, where
 * the slideshow had four times the reach. Saves cannot see that: it is about whether
 * a post paid off the promise that got it shown. So this ranks on likes per view,
 * prints views beside it so the trade is visible, and groups by the two dimensions
 * the brief names, the hook and the format.
 *
 * BOTH NUMBERS, ALWAYS, BECAUSE EITHER ONE ALONE PICKS THE WRONG WINNER. A format
 * with a 6% like rate and 197 views and one with 0.5% and 1993 views are 12 likes
 * and 9 likes: ranking on the rate says the first is twelve times better and ranking
 * on views says the second is ten times better, and the honest answer is that they
 * performed about the same and did it in different ways.
 */
export function hookReport({ days = 14, rows = null, now = Date.now() } = {}) {
  const entries = window(days, { rows, now });
  const lines = [`🪝 ${days} ימים · ${posts(entries.length)} · דירוג לפי לייקים לצפייה`];

  const measured = entries.filter((e) => e.best.likeRate != null);
  if (!measured.length) {
    lines.push('', 'אין מספרים עם לייקים בחלון הזה.', 'אפשר להזין ביד: /views <מספר> <צפיות> <לייקים>');
    return lines.join('\n');
  }
  lines.push(`   ${measured.length} עם לייקים · ${entries.length - measured.length} בלי`);

  for (const [field, titleHe] of [
    ['format', '🎬 לפי פורמט'],
    ['hookCategory', '🗂️ לפי קטגוריית פתיח'],
    ['type', '📄 לפי סוג פוסט'],
  ]) {
    const ranked = rankLikes(measured, field);
    if (!ranked.length) continue;
    lines.push('');
    lines.push(`${titleHe} (לייקים/צפיות · צפיות בממוצע)`);
    for (const r of ranked) {
      lines.push(
        `   ${String(r.key).slice(0, 18).padEnd(18)} ${pct(r.likeRate)} · ${num(r.views)}  (${posts(r.posts)}${r.thin ? ', מעט מדי' : ''})`
      );
    }
  }

  // THE HOOKS THEMSELVES, BY TEXT, which is the half a grouping cannot give you. A
  // category tells you which shape to write more of; the line tells you which line
  // did it, and the brief asks for the hooks to be ranked rather than only the
  // formats. One row per post because a hook text is close to unique per post.
  const byLikes = [...measured].sort((a, b) => b.best.likeRate - a.best.likeRate);
  const name = (r) => r.shape?.hookText || r.shape?.hook || r.shape?.where || r.id;
  lines.push('', '🏅 הפתיחים שעבדו');
  for (const r of byLikes.slice(0, 5)) {
    lines.push(`   ${pct(r.best.likeRate)} · ${num(r.best.views)} צפיות · ${name(r)}`);
  }
  if (byLikes.length > 5) {
    lines.push('', '🥀 והפחות');
    for (const r of byLikes.slice(-3).reverse()) {
      lines.push(`   ${pct(r.best.likeRate)} · ${num(r.best.views)} צפיות · ${name(r)}`);
    }
  }

  // REACH, SEPARATELY, because the two rankings disagree and that disagreement is
  // the finding. A reader who sees only the like rate concludes the slideshows do
  // not work; these two lists together say they reach people and do not land.
  const byViews = [...measured].sort((a, b) => b.best.views - a.best.views);
  if (byViews.length >= 2 && name(byViews[0]) !== name(byLikes[0])) {
    lines.push('', '👀 הכי נצפים (לא אותו דירוג)');
    for (const r of byViews.slice(0, 3)) {
      lines.push(`   ${num(r.best.views)} צפיות · ${pct(r.best.likeRate)} · ${name(r)}`);
    }
  }

  lines.push('', 'הדירוג השבועי ב-/report נשאר על שמירות ושיתופים. שניהם נכונים, ומודדים דברים שונים.');
  return lines.join('\n');
}

/**
 * Group by one shape field and rank on likes per view.
 *
 * MEAN OF THE RATES, not the rate of the totals, for the reason rankBy gives: summing
 * likes and dividing by summed views lets the one post that reached two thousand
 * people decide the row, and that is the post least like the others.
 */
export function rankLikes(entries, field, { min = 2 } = {}) {
  const groups = new Map();
  for (const row of entries) {
    const key = row.shape?.[field];
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...groups.entries()]
    .map(([key, rows]) => {
      const likes = rows.map((r) => r.best.likeRate).filter((n) => n != null);
      return {
        key,
        posts: rows.length,
        likeRate: mean(likes),
        views: mean(rows.map((r) => r.best.views).filter((n) => n != null)),
        thin: likes.length < min,
      };
    })
    .sort((a, b) => (b.likeRate ?? -1) - (a.likeRate ?? -1));
}

/** One post, in a line: what it was and where. */
function describe(row) {
  const s = row.shape || {};
  const bits = [s.where, s.type, s.look, s.frame].filter(Boolean);
  // Where the number came from, and whether somebody typed it. A ranking built partly
  // on read-off-the-screen figures must not look like it came from an API.
  const from = row.on === 'tiktok' ? 'טיקטוק' : 'אינסטגרם';
  return `${bits.join(' · ')} · ${num(row.best.views)} צפיות ב${from}${row.byHand ? ' (הוזן ביד)' : ''}`;
}
