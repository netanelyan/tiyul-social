import { publishedSlideCount } from '../deck/follow.js';
import { provenanceHe } from '../images.js';
import { targetsHe } from '../publish/targets.js';

// What you are shown before deciding.
//
// THE QUESTIONS THIS CARD HAS TO ANSWER, in the order they can be got wrong:
//
//   1. WHAT IS IT. A type, a look and an aspect ratio, because all three were chosen by
//      a rotation and none of them is visible in a thumbnail row. "Another plan in the
//      route look" is the thing to notice, and the album cannot say it.
//   2. WHICH PHOTOGRAPHS ARE REAL. A photograph off our own page is known to show the
//      place it is labelled with; a stock photograph passed a vision check, which is
//      weaker. The count of each is the single most useful line here.
//   3. WHAT IS QUOTED. Every opinion on these slides is a verbatim clause from the
//      destination page, and the card prints them so they can be read against it - the
//      same bargain the card format strikes with its evidence button.
//   4. WHAT IS MISSING. A day that arrived with five stops and shows four, a place that
//      lost its photograph, a map whose day trips were left off.
//
// AND THE SOUND, which nothing in this pipeline can choose. The post lands in TikTok's
// inbox as a draft precisely so a trending sound can be picked by hand, and a card that
// does not say so is a card that lets a draft sit there unposted.

const sizeHe = { tiktok: 'טיקטוק', instagram: 'אינסטגרם' };
const frameHe = { tall: '9:16', phone: '3:4' };

export function postApprovalMessage(cand) {
  const post = cand.deck || {};
  const lines = [];

  const counts = Object.entries(post.slideCounts || {})
    .map(([size, n]) => `${sizeHe[size] || size} ${n}`)
    .join(' · ');

  lines.push(
    `🧭 ${post.type} · ${post.look} · ${frameHe[post.frame] || post.frame} · ${post.where} · ${counts || '-'} שקופיות`
  );
  if (post.url) lines.push(`🔗 ${post.url}`);
  lines.push('');
  lines.push(`✍️ ${cand.headline}`);
  lines.push('');

  // WHERE THE PHOTOGRAPHS CAME FROM. The line this card exists for as much as any
  // other: a post whose pictures are all off our own page is a different post from one
  // that fell back to a stock library for half of them, and they look identical in a
  // thumbnail row.
  const p = post.photos || {};
  if (p.commons || p.stock || p.missing) {
    lines.push(
      `📷 ${p.commons || 0} מהדף שלנו (${provenanceHe('commons')}) · ${p.stock || 0} מסטוק · ${p.missing || 0} בלי צילום`
    );
    if (p.stock) lines.push('   צילומי סטוק עברו בדיקת ראייה, אבל הם חלשים יותר מצילום שהעורך שלנו בחר');
    lines.push('');
  }

  // THE SLIDES, named by what they are. A route card and a checklist are the same
  // length in a list of filenames and completely different posts.
  lines.push(`📑 ${publishedSlideCount({ ...post, slides: post.slides || [] })} שקופיות:`);
  for (const [i, s] of (post.slides || []).entries()) {
    const label = s.titleHe || s.nameHe || '(ללא כותרת)';
    const extra = s.noteHe || (s.lines || [])[0]?.text || (s.stops || []).map((t) => t.nameHe).join(' · ') || '';
    lines.push(`   ${i + 1}. [${s.look}] ${label}${extra ? ` - ${String(extra).slice(0, 70)}` : ''}`);
  }
  lines.push(`   ${(post.slides || []).length + 1}. [site] עמוד היעד${post.siteSlug ? ` - /destinations/${post.siteSlug}` : ' (לא נוצר)'}`);
  lines.push('');

  // EVERY QUOTED OPINION, so it can be read against the page whose URL is at the top.
  // These are the only judgements on the post and none of them was written here.
  const quotes = (post.slides || []).flatMap((s) => (s.lines || []).map((l) => l.text).filter(Boolean));
  if (quotes.length) {
    lines.push('💬 מה שמצוטט מהדף:');
    for (const q of quotes.slice(0, 8)) lines.push(`   ״${String(q).slice(0, 90)}״`);
    if (quotes.length > 8) lines.push(`   ועוד ${quotes.length - 8}`);
    lines.push('');
  }

  if ((post.dropped || []).length) {
    lines.push(`⚠️ ${post.dropped.length} שורות נפסלו בבנייה:`);
    for (const why of post.dropped.slice(0, 4)) lines.push(`   ✗ ${String(why).slice(0, 80)}`);
    lines.push('');
  }

  lines.push(`📝 התיאור:`);
  for (const l of String(cand.tiktokCaption || '').split('\n')) lines.push(`   ${l}`.trimEnd());

  const targets = cand.publishTargets?.length ? cand.publishTargets : [];
  lines.push('');
  lines.push(targets.length ? `📤 יפורסם ל${targetsHe(targets)}` : '⛔ אין יעד פרסום מוגדר');
  if (post.instagramSkipped) lines.push(`📵 לא לאינסטגרם: ${post.instagramSkipped}`);

  // THE ONE THING THE PIPELINE CANNOT DO, said every time. A carousel published without
  // a sound is a post with no sound for ever - the API has no field for it and it cannot
  // be changed afterwards - which is why every TikTok post here is a draft.
  if (targets.includes('tiktok')) {
    lines.push('🎵 נשמר כטיוטה בטיקטוק - צריך לבחור סאונד טרנדי ולפרסם מהאפליקציה');
  }

  return lines.join('\n');
}
