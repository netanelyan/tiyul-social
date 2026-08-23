import { reasonHe } from './verify.js';
import { pillarHe, PILLAR_KEYS, quotaConfig } from './pillars.js';
import { TARGET_HE, targetsHe } from './publish/targets.js';

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

export function startupPing({ sourceCount, queueSize, stagingSize, targets, images }) {
  return [
    '🟢 tiyul+ עלה',
    `${sourceCount} מקורות פעילים · ${stagingSize} ממתינים לאישור · ${queueSize} בתור לפרסום`,
    `מפרסם ל: ${targetsHe(targets)}`,
    `תמונות: ${images ? 'זמינות' : 'כרטיסי טקסט בלבד'}`,
  ].join('\n');
}

/** After a daily gather run — what came in, what survived, what was dropped. */
export function runReport({
  gathered,
  ranked,
  staged,
  rejected,
  sourceErrors,
  perSource,
  draftCalls,
  budgetExhausted,
}) {
  const lines = [
    '📥 סבב איסוף הסתיים',
    `${gathered} פריטים נאספו · ${ranked} נבדקו · ${staged} עלו לאישור · ${rejected} נפסלו`,
  ];

  if (draftCalls) lines.push(`✍️ ${draftCalls} קריאות כתיבה`);

  // A run that ran out of budget looks exactly like a quiet news day unless it
  // says so. The difference matters: one means there was nothing to post, the
  // other means we stopped looking.
  if (budgetExhausted) {
    lines.push('⚠️ תקציב הקריאות נגמר לפני שהושלם היעד - ייתכן שנשארו פריטים טובים');
  }

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

export function published({ headline, succeeded, failed = [] }) {
  const lines = [`📤 פורסם ל${targetsHe(succeeded)}`, headline];
  // A partial publish is NOT retried — retrying would duplicate whichever
  // destination succeeded — so this line is the whole record of it. It has to
  // be unmissable, and it has to say what to do.
  for (const f of failed) {
    lines.push(`⚠️ ${TARGET_HE[f.target] || f.target} נכשל: ${f.message}`);
  }
  if (failed.length) lines.push('לא ינוסה שוב אוטומטית — פרסום חוזר היה משכפל את מה שכבר עלה.');
  return lines.join('\n');
}

/** Nothing published at all — safe to retry, so it went back on the queue. */
export function publishRetrying(headline, failed, attempt, max) {
  const lines = [`🔁 שום דבר לא פורסם — חזר לתור (ניסיון ${attempt}/${max})`, headline];
  for (const f of failed) lines.push(`   ${TARGET_HE[f.target] || f.target}: ${f.message}`);
  return lines.join('\n');
}

/** Out of retries. Dropped from the queue, but never silently. */
export function publishGaveUp(headline, failed, attempts) {
  const lines = [`🔴 פרסום נכשל ${attempts} פעמים — הפריט יורד מהתור`, headline];
  for (const f of failed) lines.push(`   ${TARGET_HE[f.target] || f.target}: ${f.message}`);
  lines.push('הכרטיס נשמר. אפשר לפרסם ידנית, או לשלוח שוב את הקישור אחרי שהתקלה נפתרה.');
  return lines.join('\n');
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
  stagedToday,
  dailyTarget: target,
  nextGatherInMin,
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
  targets,
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
    // The two questions "why is it quiet" actually splits into: have we already
    // filled today's quota, and when does it next look? Both, in one line.
    `🎯 עלו היום: ${stagedToday ?? 0}/${target ?? '?'}` +
      (stagedToday >= target ? ' (הושלמה המכסה היומית)' : ` · סבב הבא בעוד ${nextGatherInMin ?? '?'} דק'`),
    `⚙️ דריפ כל ${postIntervalMinutes} דק' · מפרסם ל${targetsHe(targets)}`,
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
