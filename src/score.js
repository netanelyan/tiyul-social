import { pillarDeficits } from './pillars.js';
import * as store from './store.js';
import { candidateId } from './candidate.js';

// Ranking raw source items, before anything expensive happens to them.
//
// This runs on titles and summaries only — deliberately, because the next step
// is a drafting call per item. Scoring after drafting would mean paying for
// twenty drafts to publish three. So this is a cheap sort whose only job is to
// put the two or three most promising items at the front of the queue; the real
// quality gate is the drafting step's own "usable: false" and the verification
// that follows it.

const AUTHORITY_WEIGHT = {
  government: 1.0,
  intergovernmental: 0.95,
  'official-dmo': 0.85,
  airline: 0.85,
  dataset: 0.9,
};

// Concrete detail is the difference between a post worth reading and a headline
// that could have been written without the source. Numbers, dates and money are
// the cheapest available proxy for it.
const SPECIFIC = /\d{2,}|\d+\s*(?:%|km|℃|°C|€|\$|£)|\b(?:20\d\d|from \d|until \d)\b/i;

// Official tourism bodies publish to two audiences from one feed: travellers,
// and the travel trade. The trade half — operator recruitment, B2B showcases,
// press-briefing invitations, award announcements — is perfectly real and
// completely useless to someone planning a trip. Verified against JNTO's live
// feed, where these outranked everything else on authority alone.
//
// A penalty rather than a filter, and matched in both languages a bilingual DMO
// feed actually uses: on a quiet day a trade item that genuinely concerns
// travellers can still surface, and the drafting step gets the final say.
const TRADE_NOISE =
  /商談会|募集|フォーラム|取材|セミナー|説明会|出展|受賞|\b(?:trade (?:show|fair|mission)|b2b|webinar|roadshow|press (?:conference|briefing)|call for (?:applications|entries|papers)|now open for registration|appointment of|has been awarded)\b/i;

const DAY_MS = 86_400_000;

function recencyScore(publishedAt, now) {
  if (!publishedAt) return 0.4; // undated isn't disqualifying — a fact doesn't expire
  const age = (now - Date.parse(publishedAt)) / DAY_MS;
  if (!Number.isFinite(age)) return 0.4;
  if (age < 0) return 0.6; // clock skew or a future-dated post
  if (age <= 2) return 1.0;
  if (age <= 7) return 0.8;
  if (age <= 21) return 0.55;
  if (age <= 60) return 0.3;
  return 0.15;
}

export function scoreItem(item, { deficits = pillarDeficits(), now = Date.now() } = {}) {
  const authority = AUTHORITY_WEIGHT[item.authority] ?? 0.7;
  const recency = recencyScore(item.publishedAt, now);

  // Push toward whichever pillars the feed has been light on lately, so the mix
  // spreads out actively rather than merely staying under the cap.
  const hints = item.pillarHints?.length ? item.pillarHints : [];
  const deficit = hints.length ? Math.max(...hints.map((p) => deficits[p] ?? 0)) : 0;

  const text = `${item.title} ${item.summary || ''}`;
  const specific = SPECIFIC.test(text) ? 0.2 : 0;
  const trade = TRADE_NOISE.test(text) ? -0.5 : 0;

  // A thin *item* rarely drafts well — but a thin title alone doesn't mean
  // that. FCDO publishes one entry per country, titled just "Norway", with the
  // actual change described in the summary; penalising on title length alone
  // sent the single best entry-change source to the bottom of the ranking.
  const summaryLen = item.summary?.length || 0;
  const thin = item.title.length < 25 && summaryLen < 200 ? -0.25 : 0;

  // Enough text to work with. Past a couple of paragraphs more length stops
  // meaning more substance, so this saturates rather than growing.
  const body = Math.min(0.15, summaryLen / 4000);

  return authority * 0.35 + recency * 0.3 + deficit * 0.8 + specific + body + thin + trade;
}

/**
 * Rank items and return the most promising, newest-relevant first.
 *
 * Two things happen here that a plain sort wouldn't do:
 *   - already-seen items are dropped before ranking, so a feed that republishes
 *     the same entry daily can't crowd out everything else;
 *   - at most `perSource` items from any one source survive, so the single most
 *     prolific feed doesn't become the whole day's output.
 */
export function rank(items, { perSource = 2, limit = 12, now = Date.now() } = {}) {
  const deficits = pillarDeficits();

  const scored = items
    .filter((it) => !store.hasSeen(candidateId(it)))
    .map((it) => ({ item: it, score: scoreItem(it, { deficits, now }) }))
    .sort((a, b) => b.score - a.score);

  const perSourceCount = {};
  const out = [];
  for (const { item, score } of scored) {
    const n = perSourceCount[item.sourceId] || 0;
    if (n >= perSource) continue;
    perSourceCount[item.sourceId] = n + 1;
    out.push({ item, score });
    if (out.length >= limit) break;
  }
  return out;
}
