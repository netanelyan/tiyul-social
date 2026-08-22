import { reasonHe } from './verify.js';
import { pillarHe, PILLAR_KEYS, quotaConfig } from './pillars.js';

// The Hebrew status messages, as pure formatters plus one thin `send` — same
// split BrickDeal uses, for the same reason: the strings can be built and
// eyeballed in a plain script without booting the bot.
//
// No parse_mode anywhere. These embed scraped titles and source URLs, and a
// stray `*` or `_` in either would break Telegram's Markdown parser and drop
// the message entirely. Not asking for Markdown can't fail.

export async function send(telegram, chatId, text) {
  if (!chatId) return null;
  return telegram
    .sendMessage(chatId, text, { link_preview_options: { is_disabled: true } })
    .catch((e) => {
      console.error('notify: send failed:', e.message);
      return null;
    });
}

export function startupPing({ sourceCount, queueSize, stagingSize, instagram, images }) {
  return [
    '🟢 tiyul+ עלה',
    `${sourceCount} מקורות פעילים · ${stagingSize} ממתינים לאישור · ${queueSize} בתור לפרסום`,
    `אינסטגרם: ${instagram ? 'מוגדר' : 'לא מוגדר (טלגרם בלבד)'} · תמונות: ${images ? 'זמינות' : 'כרטיסי טקסט בלבד'}`,
  ].join('\n');
}

/** After a daily gather run — what came in, what survived, what was dropped. */
export function runReport({ gathered, ranked, staged, rejected, sourceErrors, perSource }) {
  const lines = [
    '📥 סבב איסוף הסתיים',
    `${gathered} פריטים נאספו · ${ranked} נבדקו · ${staged} עלו לאישור · ${rejected} נפסלו`,
  ];

  const bySource = Object.entries(perSource || {})
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `   • ${id}: ${n}`);
  if (bySource.length) lines.push('', 'לפי מקור:', ...bySource);

  if (sourceErrors?.length) {
    lines.push('', '⚠️ מקורות שנכשלו:');
    for (const e of sourceErrors) lines.push(`   • ${e.name}: ${e.message}`);
  }

  return lines.join('\n');
}

/**
 * Rejected candidates, with their reason and their URL.
 *
 * This exists because of the note in BrickDeal's own README: its quality filter
 * used to drop things silently, which made it impossible to tell whether it was
 * saving you from junk or quietly throwing away good posts. The filters here are
 * more opinionated than that one — a primary-source rule, a quote check, topic
 * quotas — so seeing what they killed matters more, not less.
 */
export function rejectDigest(items, hours) {
  if (!items.length) return null;
  const lines = items.map((it, i) => {
    const detail = it.detail ? ` — ${String(it.detail).slice(0, 160)}` : '';
    return `${i + 1}. [${reasonHe(it.reason)}] ${it.title}${detail}\n   ${it.url}`;
  });
  return `🗑️ ${items.length} מועמדים נפסלו ב-${hours} השעות האחרונות:\n\n${lines.join('\n\n')}`;
}

export function rejectSingle(item) {
  const detail = item.detail ? ` — ${String(item.detail).slice(0, 200)}` : '';
  return `🗑️ נפסל [${reasonHe(item.reason)}] ${item.title}${detail}\n${item.url}`;
}

export function published({ headline, telegram, instagram, error }) {
  const where = [telegram ? 'טלגרם' : null, instagram ? 'אינסטגרם' : null].filter(Boolean);
  const head = where.length ? `📤 פורסם ל${where.join(' ול')}` : '📤 פורסם';
  return error ? `${head}\n${headline}\n⚠️ ${error}` : `${head}\n${headline}`;
}

export function publishFailed(headline, where, message) {
  return `🔴 פרסום ל${where} נכשל\n${headline}\n${message}`;
}

export function quietAlert(hours) {
  return `⚠️ שקט: לא עלה שום מועמד חדש לאישור כבר ${hours} שעות`;
}

// "3 שעות ו-14 דק'" / "14 דק'" — enough precision for a status readout.
export function humanDuration(ms) {
  if (ms == null) return null;
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} שעות ו-${m} דק'` : `${m} דק'`;
}

/** /status — a fixed last-24h window, so it answers "why nothing today". */
export function statusReport({
  sourceCount,
  stagingSize,
  queueSize,
  gathered,
  staged,
  rejected,
  rejectedByReason,
  publishedToday,
  lastRunAgoMs,
  postIntervalMinutes,
  instagram,
}) {
  const breakdown = Object.entries(rejectedByReason || {})
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `   • ${reasonHe(reason)} (${reason}): ${n}`);

  return [
    '🔎 סטטוס',
    `📚 ${sourceCount} מקורות פעילים`,
    `⏳ ${stagingSize} ממתינים לאישור · 📦 ${queueSize} בתור לפרסום`,
    `📤 ${publishedToday} פורסמו היום`,
    '',
    'ב-24 השעות האחרונות:',
    `👀 נאספו: ${gathered}`,
    `✅ עלו לאישור: ${staged}`,
    `🗑️ נפסלו: ${rejected}`,
    ...breakdown,
    '',
    `⏱️ סבב אחרון: ${lastRunAgoMs == null ? 'עדיין לא רץ' : `לפני ${humanDuration(lastRunAgoMs)}`}`,
    `⚙️ דריפ כל ${postIntervalMinutes} דק' · אינסטגרם ${instagram ? 'מוגדר' : 'לא מוגדר'}`,
  ].join('\n');
}

/** /mix — the pillar and tag balance the quotas are actually computed from. */
export function mixReport(history) {
  if (!history.length) return '📊 עדיין לא פורסם כלום — אין ממה לחשב תמהיל';

  const total = history.length;
  const counts = Object.fromEntries(PILLAR_KEYS.map((k) => [k, 0]));
  for (const p of history) if (counts[p.pillar] !== undefined) counts[p.pillar]++;

  const rows = PILLAR_KEYS.map((k) => {
    const n = counts[k];
    const pct = Math.round((n / total) * 100);
    const bar = '█'.repeat(Math.round(pct / 5)) || '·';
    return `${pillarHe(k).padEnd(14)} ${String(pct).padStart(3)}%  ${bar}`;
  });

  const kosher = history.filter((p) => (p.tags || []).includes('kosher')).length;
  const kosherPct = Math.round((kosher / total) * 100);
  const { kosherMaxShare, pillarMaxShare } = quotaConfig();

  return [
    `📊 תמהיל ${total} הפוסטים האחרונים`,
    '',
    ...rows,
    '',
    `כשרות/שבת: ${kosherPct}% (תקרה ${Math.round(kosherMaxShare * 100)}%)`,
    `תקרה לנושא בודד: ${Math.round(pillarMaxShare * 100)}%`,
  ].join('\n');
}
