import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Same tiny persistent store as BrickDeal: one JSON file, written atomically
// (tmp + rename), no database. Single process, a handful of posts a day.
//
// One collection is new here: `published`. The pillar quotas (src/pillars.js)
// are computed over a rolling window of what actually went out, so "kosher and
// Shabbat is an occasional thread, not the theme" is a number the code can
// check rather than a hope about the drafting prompt.
// Overridable so the test suite can point at a scratch file.
//
// This is not a convenience. On the VPS this file holds the refreshed Instagram
// token, the dedupe history and the published log — and merely importing this
// module prunes and rewrites it. `npm test` on the server would therefore touch
// live state, and the new dedupe test writes to it outright. Tests get their
// own file; nothing else sets this.
const FILE = process.env.STORE_PATH
  ? resolve(process.env.STORE_PATH)
  : fileURLToPath(new URL('../data/store.json', import.meta.url));

const DAY_MS = 24 * 60 * 60 * 1000;
// The auto-reply ledgers' window. Declared up here with the other clocks
// rather than beside the function that uses it, because load() runs at module
// init and would reach it inside its temporal dead zone.
const IG_REPLY_TTL_MS = 14 * DAY_MS;
// Read lazily rather than at module load — store.js can be evaluated before
// .env has been read. Same hoisting trap BrickDeal's deals.js documents.
const ttlMs = () => Math.max(0, Number(process.env.SEEN_TTL_DAYS ?? '45')) * DAY_MS;
const publishedWindowMs = () =>
  Math.max(1, Number(process.env.QUOTA_WINDOW_DAYS ?? '30')) * DAY_MS;

// How many clip shapes are remembered. Only the first is ever read — see
// lastClipShape — and the rest is there to be looked at when a feed feels
// repetitive, which is the one moment the sequence is worth more than the last
// value. Declared up here rather than beside its functions because load() reads
// it while backfilling, and load() runs before anything below this point.
const CLIP_SHAPES_KEPT = 12;
// Enough to answer "not the same as the last few" for three independent
// dimensions at once, and enough that the weekly report has a window to group by.
// Not a log: the numbers themselves live in the metrics store.
const POST_SHAPES_KEPT = 24;
// Which format each of the last few posts was. The rotation reads `maxRun` of
// these, two by default; the rest is there for the same reason the clip shapes
// are, which is the morning somebody asks why the feed feels samey.
const FORMATS_KEPT = 12;
// Which hook each of the last few gems reels opened on. Only the first one or two are
// read, by gems.hooks.memory; the rest is there for the morning somebody asks why
// every reel opens the same way.
const GEM_HOOKS_KEPT = 8;

const empty = {
  seen: {},
  queue: [],
  staging: {},
  // Deck ideas proposed as TEXT and awaiting a decision, before anything is
  // built. A deck costs an idea call, a search and a drafting call per place
  // and twelve renders; proposing it first means a slideshow you did not want
  // costs one message instead of all of that. Separate from `staging`, which
  // holds things that are already built and are awaiting publication.
  proposals: {},
  pendingEdit: {},
  published: [],
  // Destinations suggested lately, so five formats drawing independently do not all
  // land on the same one. See noteSuggestedPlace.
  suggestedPlaces: [],
  // Ids of everything ever published, kept separately from `published`.
  //
  // `published` is a 30-day quota window and gets pruned, so it cannot answer
  // "have we posted this before?" — after a month it says no. And `seen` cannot
  // answer it either, because /redo deliberately clears `seen` so a change to
  // the copy rules can be tested against the same sources. That left nothing
  // guarding the case that actually happened: an item published to Instagram,
  // then staged again by the next /redo as though it were new.
  publishedIds: {},
  // Pexels video ids that have already been made into a clip, by id -> when.
  //
  // Kept separately from everything above because none of them could answer the
  // question. `publishedIds` is keyed on the CANDIDATE id, which is a hash of
  // the footage AND the line — so the same video under a second line is a
  // different id and sails through. `published` is a 30-day quota window and
  // forgets. And both only know about clips that were approved: footage that
  // was built, staged and rejected, or is still sitting in the approval chat,
  // was invisible to all of it.
  //
  // Marked when the clip is BUILT rather than when it publishes, and that is
  // the point. The complaint this fixes is being handed footage that has been
  // seen before, and a clip waiting for a tap has been seen. There are ~1479
  // unique verticals behind the configured queries, so spending one on a
  // rejected clip costs nothing next to being offered it twice.
  clipsUsed: {},
  // The shapes of the clips already built, most recent first. What makes the two
  // shapes alternate across days rather than only inside one batch — see
  // lastClipShape further down.
  clipShapes: [],
  // What the last few posts of the new five types WERE, most recent first.
  //
  // THREE HISTORIES BECAUSE THREE THINGS HAVE TO VARY INDEPENDENTLY, and the
  // evidence for keeping them apart is the pair of flops: three accounts posted the
  // same template and got two to four likes each. A rotation that varies the type
  // but always draws it the same way is still one template; one that varies the
  // look but opens every caption with the same line is still one template in the
  // place nobody looks.
  //
  // Entries are `{ type, look, hook, frame, caption, at }`. Recorded when the post
  // is BUILT rather than when it publishes, for the same reason clipShapes is: a
  // rejected post was still produced, and replacing it with another post of the
  // same shape is the run of identical posts the rotation exists to prevent.
  postShapes: [],
  // Hebrew place label -> when a post last named it. The 14 day rule, which is
  // about the PLACE rather than about the footage. See notePlacesNamed.
  placesNamed: {},
  // Which format each of the last few posts was, most recent first. Read by the
  // format rotation to refuse a third of the same thing in a row.
  formats: [],
  // Which hook template each of the last few gems reels opened on, most recent
  // first. Read by the hook generator to refuse the line it used last time.
  gemHooks: [],
  // Instagram media id -> what that post was about, for the auto-reply.
  //
  // WITHOUT THIS THE WEBHOOK CANNOT ANSWER ANYTHING. A comment arrives naming
  // only the media it is on, and the reply has to carry the right destination
  // page with the right campaign tag on it. Neither is derivable from the
  // comment: the candidate that produced the post is long out of staging by
  // the time anybody comments, and the queue does not keep it.
  //
  // It is also the safety rule. A comment on a post with no row here is
  // IGNORED rather than answered generically, so a post from before this
  // existed, or one published by hand, cannot produce a DM about a page it was
  // never about.
  igPosts: {},
  // Comment ids already answered, and (media, commenter) pairs already
  // answered, both -> when.
  //
  // Two keys for one rule, because Meta redelivers. A webhook that is not
  // acknowledged fast enough arrives again, and a retry carries the SAME
  // comment id, so the comment id is what stops a double DM for one comment.
  // The pair is what stops somebody who comments five times under one post
  // getting five DMs, which is the same message five times and reads as a bot
  // malfunctioning.
  igReplied: {},
  // { date: 'YYYY-MM-DD', count: n, rejected: n } — the daily cap, survives restart.
  stagedDay: null,
  // When a card last reached the approval chat, and when something last went
  // out. Both are what the quiet alarm measures from, and both have to outlive
  // the process: held only in memory, a bot that restarts once a day can never
  // accumulate enough silence to notice it is silent.
  lastStagedAt: null,
  lastPublishedAt: null,
  // Which KIND went out last, so the drip can alternate card, deck, card.
  // Persisted for the same reason lastPublishedAt is: the drip fires every few
  // hours and the process restarts between posts, so holding this in memory
  // would reset the alternation to "whatever is at the front" on every deploy.
  lastPublishedKind: null,
  // Per destination: consecutive failures, the last error, and when it last
  // actually worked. A global "something published" is not enough — Telegram
  // succeeding while Instagram is blocked looks identical to a healthy day.
  // { instagram: { failures, lastError, lastFailAt, lastOkAt, degraded } }
  targetHealth: {},
  // The same, per source feed. A dead feed should stand itself down rather than
  // costing a timeout on every run forever — see noteSourceFailed.
  sourceHealth: {},
  // Sources switched off from Telegram rather than in sources.json. Keyed by
  // id, valued with when it happened.
  sourceOff: {},
  // Approved cards that could not reach a destination and are waiting for it to
  // come back, rather than being dropped. /retry replays them.
  held: [],
  igToken: null,
  // TikTok's pair. Kept separately from igToken because the two expire on
  // completely different clocks — 60 days against 24 hours — and the refresh
  // token here is the one that needs a browser to replace.
  tiktokToken: null,
};

// How long a published id is remembered. Long, because the cost of forgetting
// is posting the same thing twice to real followers, and the cost of
// remembering is a few hundred bytes a year.
const PUBLISHED_ID_TTL_MS = Math.max(1, Number(process.env.PUBLISHED_TTL_DAYS ?? '730')) * 86_400_000;
let state = load();

function pruneSeen(s) {
  const cutoff = Date.now() - ttlMs();
  let changed = false;
  for (const [id, ts] of Object.entries(s.seen)) {
    if (ts < cutoff) {
      delete s.seen[id];
      changed = true;
    }
  }
  return changed;
}

// The published log only exists to answer quota questions over a rolling
// window, so anything older than that window is dead weight.
function prunePublished(s) {
  const cutoff = Date.now() - publishedWindowMs();
  const before = s.published.length;
  s.published = s.published.filter((p) => p.ts >= cutoff);
  return s.published.length !== before;
}

function prunePublishedIds(s) {
  const cutoff = Date.now() - PUBLISHED_ID_TTL_MS;
  let changed = false;
  for (const [id, ts] of Object.entries(s.publishedIds || {})) {
    if (ts < cutoff) {
      delete s.publishedIds[id];
      changed = true;
    }
  }
  return changed;
}

/**
 * Both auto-reply ledgers, aged out on Meta's own window.
 *
 * SEVEN DAYS IS NOT A TIDINESS NUMBER HERE. Meta refuses a private reply more
 * than seven days after the comment was made, so a post older than that can
 * no longer be answered and a row for it can never be used again. Keeping a
 * fortnight is slack for clock skew and for a comment that arrives on day
 * seven; keeping them forever would grow the file that gets rewritten on every
 * save with rows that are, by the platform's own rule, dead.
 *
 * The dedupe ledger outlives the post ledger deliberately. If a row expired
 * first, a redelivered webhook for a comment already answered would find no
 * record, and the reply that cannot be sent twice would be attempted twice.
 */
function pruneIgReplies(s) {
  const cutoff = Date.now() - IG_REPLY_TTL_MS;
  let changed = false;
  for (const key of ['igPosts', 'igReplied']) {
    for (const [id, row] of Object.entries(s[key] || {})) {
      const ts = typeof row === 'number' ? row : row?.ts || 0;
      if (ts < cutoff) {
        delete s[key][id];
        changed = true;
      }
    }
  }
  return changed;
}

// A fortnight plus a margin. The rule the brief states is 14 days, and a ledger
// pruned at exactly 14 would drop an entry the same hour the rule stops caring
// about it, so a reel built one minute early could name a place a reel built one
// minute later could not. 21 keeps a week of slack and costs nothing.
const PLACES_NAMED_TTL_MS = 21 * 86_400_000;

function prunePlacesNamed(s) {
  const cutoff = Date.now() - PLACES_NAMED_TTL_MS;
  let changed = false;
  for (const [label, ts] of Object.entries(s.placesNamed || {})) {
    if (Number(ts) < cutoff) {
      delete s.placesNamed[label];
      changed = true;
    }
  }
  return changed;
}

// Same clock as a published id, for the same reason: forgetting costs a repeat
// on a real feed, remembering costs a few hundred bytes a year.
function pruneClipsUsed(s) {
  const cutoff = Date.now() - PUBLISHED_ID_TTL_MS;
  let changed = false;
  for (const [id, ts] of Object.entries(s.clipsUsed || {})) {
    if (ts < cutoff) {
      delete s.clipsUsed[id];
      changed = true;
    }
  }
  return changed;
}

/**
 * The Pexels id behind a stored clip, across both shapes it has had.
 *
 * Clips built before `clip.pexelsId` existed used the Pexels id AS the
 * candidate id, and three of them are sitting in staging right now. They are
 * exactly the footage that must not come back, so the old shape is read rather
 * than written off — bounded to a plausible id so a 12-hex candidate id that
 * happens to be all digits cannot be mistaken for one.
 *
 * Exported because there were three copies of this rule — here, in the /clip
 * dedupe set, and nowhere at all in what the published log records — and the
 * copy that did not exist is the one that mattered: a legacy clip published
 * with `pexelsId: null`, so the row that is supposed to answer "have we used
 * this footage" answered no about the footage it had just spent.
 */
export function clipPexelsId(cand) {
  return clipPexelsIds(cand)[0] ?? null;
}

/**
 * EVERY stock video one clip was built from.
 *
 * A held clip spends one. A cuts clip spends four or five, it is several shots
 * joined, and each one is footage this account has now shown. The ledger was
 * built when there was only ever one, and left that way a cuts clip would
 * record its first shot and quietly re-offer the other four on the next batch:
 * the exact repeat the ledger exists to stop, arriving through the one clip
 * shape that spends the most footage per post.
 *
 * The singular `clipPexelsId` is kept and now reads the first of these, so the
 * published row's own `pexelsId` field and every older caller keep working.
 */
export function clipPexelsIds(cand) {
  if (!cand || cand.kind !== 'clip') return [];

  const cuts = cand.clip?.cuts;
  if (Array.isArray(cuts) && cuts.length) {
    return [...new Set(cuts.map((c) => c?.pexelsId).filter(Boolean).map(String))];
  }

  // A postcard reel spends one clip per place, recorded as a flat list - the same
  // problem a cuts clip has and the same answer. Without this the reel would record
  // nothing and re-offer all four of its clips tomorrow.
  const postcard = cand.clip?.pexelsIds;
  if (Array.isArray(postcard) && postcard.length) {
    return [...new Set(postcard.filter(Boolean).map(String))];
  }

  const direct = cand.clip?.pexelsId;
  if (direct) return [String(direct)];
  // Clips built before `clip.pexelsId` existed used the Pexels id AS the
  // candidate id, and three of them are in staging. Bounded to a plausible id so
  // a 12-hex candidate id that happens to be all digits cannot be mistaken for
  // one.
  const legacy = String(cand.id || '');
  return /^\d{1,9}$/.test(legacy) ? [legacy] : [];
}

function load() {
  let s;
  try {
    s = { ...empty, ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch {
    s = structuredClone(empty);
  }
  if (!Array.isArray(s.published)) s.published = [];
  if (!Array.isArray(s.held)) s.held = [];
  if (!s.proposals || typeof s.proposals !== 'object') s.proposals = {};
  if (!s.targetHealth || typeof s.targetHealth !== 'object') s.targetHealth = {};
  if (!s.sourceHealth || typeof s.sourceHealth !== 'object') s.sourceHealth = {};
  if (!s.sourceOff || typeof s.sourceOff !== 'object') s.sourceOff = {};
  // A history rather than a queue: what the clip shapes have to
  // alternate against is what was built last. Backfilled below from the clips
  // the store already holds, so a box that has been running does not restart the
  // alternation from nothing.
  if (!Array.isArray(s.clipShapes)) s.clipShapes = [];
  // The same, for the five post types. No backfill: nothing before this existed to
  // read, and an empty history simply means the first post of each kind is free to
  // be anything - which is correct rather than a gap.
  if (!Array.isArray(s.postShapes)) s.postShapes = [];

  // Migration for stores written before publishedIds existed. Backfill from the
  // quota window — it is the only record of what went out, and recovering the
  // last 30 days is strictly better than starting empty and re-posting them.
  let migrated = false;
  if (!s.publishedIds || typeof s.publishedIds !== 'object') {
    s.publishedIds = {};
    migrated = true;
  }
  // Stores written before the auto-reply existed. Nothing to backfill - a post
  // published before this shipped has no record of which page it was about and
  // is correctly unanswerable - so this only has to make the keys exist, or
  // every read below would be against undefined.
  for (const key of ['igPosts', 'igReplied']) {
    if (!s[key] || typeof s[key] !== 'object') {
      s[key] = {};
      migrated = true;
    }
  }
  for (const p of s.published) {
    if (p?.id && !s.publishedIds[p.id]) {
      s.publishedIds[p.id] = p.ts || Date.now();
      migrated = true;
    }
  }

  // Same idea for the quiet alarm's anchor: the published log already knows when
  // the last post went out, so a store written before this field existed starts
  // with the real answer rather than looking like it has never published.
  if (!s.lastPublishedAt && s.published.length) {
    s.lastPublishedAt = Math.max(...s.published.map((p) => p.ts || 0)) || null;
    migrated = Boolean(s.lastPublishedAt) || migrated;
  }

  // And for the clip ledger. Everything the store already holds that names a
  // Pexels id is footage this account has spent, so a store written before the
  // ledger existed starts knowing about it rather than offering it all again on
  // the next /clip — which, for the clips currently awaiting a tap, would be
  // the exact repeat the ledger is here to stop.
  if (!s.clipsUsed || typeof s.clipsUsed !== 'object') {
    s.clipsUsed = {};
    migrated = true;
  }
  // Through clipPexelsIds rather than the singular, so a cuts clip contributes
  // every shot it was built from instead of only its first.
  const at = (c) => Date.parse(c?.createdAt || '') || Date.now();
  const spent = [
    ...Object.values(s.staging || {}).flatMap((c) => clipPexelsIds(c).map((id) => [id, at(c)])),
    ...(s.queue || []).flatMap((c) => clipPexelsIds(c).map((id) => [id, at(c)])),
    ...(s.held || []).flatMap((h) => clipPexelsIds(h?.cand).map((id) => [id, at(h?.cand)])),
    ...(s.published || []).flatMap((p) => {
      const ids = Array.isArray(p?.pexelsIds) && p.pexelsIds.length
        ? p.pexelsIds
        : p?.pexelsId
          ? [p.pexelsId]
          : [];
      return ids.map((id) => [String(id), p?.ts || Date.now()]);
    }),
  ];
  for (const [id, ts] of spent) {
    if (id && !s.clipsUsed[id]) {
      s.clipsUsed[id] = ts;
      migrated = true;
    }
  }

  // And the shape history, from the clips the store still holds.
  //
  // Worth doing rather than starting empty, because an empty history makes
  // nextShapes open on cuts — and on the box this shipped to, the clip the owner
  // was unhappy with was a cuts clip. Starting from nothing would hand them
  // another one, which is the complaint rather than the fix.
  //
  // Newest first, matching the live order. Only candidates still on the box are
  // readable: the published log records no shape, so a clip that went out and
  // aged past the quota window is not recoverable and does not need to be — one
  // entry is all the alternation reads.
  if (!s.clipShapes.length) {
    const clips = [
      ...Object.values(s.staging || {}),
      ...(s.queue || []),
      ...(s.held || []).map((h) => h?.cand),
    ].filter((c) => c?.kind === 'clip');
    const shapes = clips
      .sort((a, b) => at(b) - at(a))
      .map((c) => (c.clip?.shape === 'cuts' ? 'cuts' : 'held'))
      .slice(0, CLIP_SHAPES_KEPT);
    if (shapes.length) {
      s.clipShapes = shapes;
      migrated = true;
    }
  }

  // Each prune runs. `||` short-circuits, so chaining them meant the first one
  // with something to drop was the last one to run at all — harmless while
  // every collection was pruned again on write, and not something to build a
  // fifth collection on top of.
  const pruned = [pruneSeen(s), prunePublished(s), prunePublishedIds(s), pruneClipsUsed(s), pruneIgReplies(s)];
  if (pruned.some(Boolean) || migrated) save(s);
  return s;
}

function save(s = state) {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
  } catch {}
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, FILE);
}

// --- dedupe -----------------------------------------------------------------
// Keyed by a candidate's stable id (src/candidate.js derives it from the
// canonical source URL). TTL defaults to 45 days here rather than BrickDeal's
// 10: a deal's price moves, but "the Alhambra caps daily tickets" doesn't
// become news again in a fortnight.
export const hasSeen = (id) => {
  const ts = state.seen[id];
  return Boolean(ts) && Date.now() - ts < ttlMs();
};
export function markSeen(id) {
  state.seen[id] = Date.now();
  pruneSeen(state);
  save();
}
// Roll back a claim when the pipeline fails *after* claiming it, so a transient
// error doesn't permanently bury a source item that would otherwise be fine.
export function forgetSeen(id) {
  delete state.seen[id];
  save();
}

/**
 * Forget every claimed item, so the next run rebuilds today's candidates from
 * scratch. Returns how many were dropped.
 *
 * This is for iterating on how the cards look and read: a change to the layout
 * or the copy rules is invisible until the same sources are drafted again, and
 * they are all marked seen the moment the first run claims them. Without this
 * the only way to see the effect of a change was to wait for tomorrow's news.
 *
 * Deliberately touches `seen` and nothing else. The published log stays (the
 * topic quotas are computed from it) and so does the Instagram token, which
 * lives in the same file and is expensive to replace — deleting store.json to
 * get the same effect would take both with it.
 */
export function forgetAllSeen() {
  const n = Object.keys(state.seen).length;
  state.seen = {};
  save();
  return n;
}

/**
 * Has this exact item already gone out?
 *
 * Checked independently of `seen`, and never cleared by /redo. The two answer
 * different questions: `seen` is "have we already tried this today", which is
 * the thing you WANT to reset when testing a change to the copy rules;
 * this is "did real followers already receive this", which you never do.
 *
 * Missing this distinction put an iceberg post that had already published to
 * Instagram straight back into the approval queue with a different photograph.
 */
export const hasPublished = (id) => Boolean(id && state.publishedIds[id]);

/** Deliberately allow a published item to be built again. */
export function forgetPublished(id) {
  delete state.publishedIds[id];
  save();
}
export const publishedCount = () => Object.keys(state.publishedIds).length;

// --- clip footage already spent ---------------------------------------------
/**
 * Has this Pexels video already been made into a clip?
 *
 * The question `hasPublished` could not answer. A candidate id is a hash of the
 * footage and the line together, so the same video written up a second way is a
 * different id — and the search that produced it never asked the store anything
 * at all, because the set of ids it was handed was mapped off a field the
 * published log had never stored. Every clip ever built was offered from the
 * full catalogue, and a repeat was a matter of when rather than whether.
 */
export const clipUsed = (pexelsId) => Boolean(pexelsId && state.clipsUsed[String(pexelsId)]);

/** Spend one. Called when the clip is built, not when it publishes. */
export function markClipUsed(pexelsId) {
  if (!pexelsId) return;
  state.clipsUsed[String(pexelsId)] = Date.now();
  pruneClipsUsed(state);
  save();
}

// --- which PLACES a post has named lately -----------------------------------
//
// A SECOND LEDGER BESIDE `clipsUsed`, AND THE DIFFERENCE IS THE SUBJECT.
//
// `clipsUsed` is about the FOOTAGE: this Pexels video has been published, do not
// publish it again. It cannot answer the question the brief asks, which is about
// the PLACE: a reel that names Lauterbrunnen must not go out a week after another
// reel named Lauterbrunnen, and the two would be different files from different
// queries with different ids.
//
// Keyed on the printed Hebrew label, which is the only form of the place both the
// label and the hook use, and the form `clipPlaceLabel` already guarantees is
// consistent. Timestamps rather than a ring, because the rule is "in the last 14
// days" rather than "in the last N posts": a quiet fortnight should forget, and a
// busy one should not.
export function notePlacesNamed(labels, { at = Date.now() } = {}) {
  const list = (Array.isArray(labels) ? labels : [labels]).map((s) => String(s || '').trim()).filter(Boolean);
  if (!list.length) return;
  if (!state.placesNamed || typeof state.placesNamed !== 'object') state.placesNamed = {};
  for (const label of list) state.placesNamed[label] = at;
  prunePlacesNamed(state);
  save();
}

/**
 * The labels named within the window, with WHEN, as a Map.
 *
 * A Map rather than a Set because the caller needs to rank them. The fortnight rule
 * is a preference rather than a refusal - see the note in sortShots - and a reel that
 * has to reuse a place should reuse the one named longest ago, which is a question a
 * Set cannot answer.
 */
export function placesNamedSince(days = 14, { now = Date.now() } = {}) {
  const cutoff = now - Math.max(0, days) * 86_400_000;
  const out = new Map();
  for (const [label, ts] of Object.entries(state.placesNamed || {})) {
    if (Number(ts) >= cutoff) out.set(label, Number(ts));
  }
  return out;
}

// --- which HOOK the last few gems reels opened on ---------------------------
//
// THE SAME MEMORY EVERY OTHER DIMENSION HERE HAS, and the dry run is why it exists.
// The hook generator scores ten candidates and ships the best, which is
// deterministic: four reels built in a row all opened on "N יעדים שאנשים לא חושבים
// עליהם מספיק", because it is the best line and it wins every time it is offered.
//
// That is the failure this project has written down more times than any other. A
// pool is a template with extra steps; the look, the type, the caption shape and the
// clip shape all keep a history for exactly this reason, and a hook is the most
// visible thing on a post. Keyed on the TEMPLATE id rather than on the text, because
// the text varies with the shot count and "5 יעדים ש..." and "3 יעדים ש..." are the
// same line twice.
export const gemHookHistory = () => (state.gemHooks || []).slice();

/** Record one. Called when the reel is built, like every other shape ledger here. */
export function noteGemHook(templateId) {
  const s = String(templateId || '').trim();
  if (!s) return;
  state.gemHooks = [s, ...(state.gemHooks || [])].slice(0, GEM_HOOKS_KEPT);
  save();
}

// --- which FORMAT the last few posts were -----------------------------------
//
// The run history the format rotation reads. A list rather than one field for the
// reason noteClipShape gives: "not the same as last time" needs one entry and "not
// three times in a row" needs two, and a single field cannot answer the second.
export const formatHistory = () => (state.formats || []).slice();

/** Record one. Called when the format is CHOSEN, so a failed build still counts. */
export function noteFormat(id) {
  const s = String(id || '').trim();
  if (!s) return;
  state.formats = [s, ...(state.formats || [])].slice(0, FORMATS_KEPT);
  save();
}

// --- the Instagram auto-reply ledgers ---------------------------------------

/**
 * Remember what a published Instagram post was about.
 *
 * Called after a SUCCESSFUL publish, with the media id Instagram returned.
 * Everything the reply needs is here, because none of it can be recovered
 * later: the candidate is gone from staging, and the comment that arrives in
 * three days names only the media.
 */
export function noteIgPost(mediaId, { slug, destHe, candidateId }) {
  if (!mediaId || !slug) return;
  state.igPosts[String(mediaId)] = {
    slug: String(slug),
    destHe: String(destHe || ''),
    candidateId: String(candidateId || ''),
    ts: Date.now(),
  };
  pruneIgReplies(state);
  save();
}

/** What that post was about, or null for one this program did not publish. */
export const igPost = (mediaId) => state.igPosts[String(mediaId || '')] || null;

/** How many posts are currently answerable. For /status. */
export const igPostCount = () => Object.keys(state.igPosts || {}).length;

/**
 * Claim the right to answer one comment, or find it already claimed.
 *
 * WRITTEN BEFORE THE SEND, NOT AFTER, and that is the whole design. Meta
 * redelivers a webhook it did not get a fast 200 for, and the send is the slow
 * part: recording afterwards leaves a window in which the same comment is
 * being answered twice concurrently, which is the one failure Meta itself
 * punishes (error 2534014, one private reply per comment). Claiming first
 * means a duplicate delivery loses the race and does nothing.
 *
 * The cost of claiming first is that a send which then fails is never
 * retried. That is the right trade here: a missed reply is a disappointment,
 * and a double reply is a spam report.
 *
 * Returns true when the claim was granted.
 */
export function claimIgReply(commentId, { mediaId = '', userId = '' } = {}) {
  const keys = [`c:${commentId}`, userId ? `u:${mediaId}:${userId}` : null].filter(Boolean);
  if (!commentId) return false;
  if (keys.some((k) => state.igReplied[k])) return false;
  const now = Date.now();
  for (const k of keys) state.igReplied[k] = { ts: now };
  pruneIgReplies(state);
  save();
  return true;
}

/** Whether this comment, or this person under this post, has been answered. */
export const igReplied = (commentId, { mediaId = '', userId = '' } = {}) =>
  Boolean(
    state.igReplied[`c:${commentId}`] || (userId && state.igReplied[`u:${mediaId}:${userId}`])
  );

/**
 * Give a claim back, for a send that failed before it reached Meta.
 *
 * Only safe for failures that happened BEFORE the request went out - a config
 * error, a missing token. A failure after the request cannot be told apart
 * from a success that lost its response, and releasing that one is how the
 * same person gets two DMs.
 */
export function releaseIgReply(commentId, { mediaId = '', userId = '' } = {}) {
  delete state.igReplied[`c:${commentId}`];
  if (userId) delete state.igReplied[`u:${mediaId}:${userId}`];
  save();
}

/** How many replies went out in the last hour, for the cap. */
export function igRepliesLastHour(now = Date.now()) {
  const cutoff = now - 60 * 60 * 1000;
  return Object.entries(state.igReplied || {}).filter(
    ([k, row]) => k.startsWith('c:') && (row?.ts || 0) >= cutoff
  ).length;
}

/**
 * Every Pexels id this account has spent, as the search wants it.
 *
 * A Set of strings, because that is what findClips checks against, and built
 * here rather than at the call site so there is one answer to "what counts as
 * used" instead of one per caller.
 */
export const usedClipIds = () => new Set(Object.keys(state.clipsUsed));

/** Put one back, for footage worth using again under a different line. */
export function forgetClip(pexelsId) {
  const had = clipUsed(pexelsId);
  delete state.clipsUsed[String(pexelsId)];
  save();
  return had;
}
export const usedClipCount = () => Object.keys(state.clipsUsed).length;

// --- which clip shape was built last ----------------------------------------
//
// The two clip shapes alternate, and the alternation needs a memory. It used to
// be the batch index, which is right for `/clip 4` and wrong for the path that
// actually runs unattended: one clip a day is index 0 every day, so every clip
// the timer ever built was a cuts clip and the held shape was reachable only by
// hand. See nextShapes in video/clip.js.
//
// A short HISTORY rather than one field, for the same reason `clipsUsed` records
// a clip when it is BUILT and not when it publishes: what has to alternate is
// what the account has produced, and a rejected clip was produced. A rejected
// cuts clip that left no trace would be replaced by another cuts clip, which is
// the run of identical posts the alternation exists to prevent.
/** The shape of the last clip built, or null on a box that has built none. */
export const lastClipShape = () => state.clipShapes?.[0] || null;

/** The shapes built, most recent first. */
export const clipShapeHistory = () => (state.clipShapes || []).slice();

/** Record one. Called when the clip is built, like the footage ledger. */
export function noteClipShape(shape) {
  const s = String(shape || '').trim();
  if (s !== 'cuts' && s !== 'held') return;
  state.clipShapes = [s, ...(state.clipShapes || [])].slice(0, CLIP_SHAPES_KEPT);
  save();
}

// --- what the last few posts of the five new types were ---------------------

/** The shapes built, most recent first. Read by the rotation in src/posts/types.js. */
export const postShapeHistory = () => (state.postShapes || []).slice();

/** The last one, or null on a box that has built none. */
export const lastPostShape = () => state.postShapes?.[0] || null;

/**
 * Record one. Called when the post is BUILT, not when it publishes.
 *
 * `at` is stamped here rather than passed, so the caller cannot forget it and two
 * callers cannot disagree about the format. Everything else is whatever the builder
 * chose, and unknown keys are kept: section 7's report groups by these fields, and a
 * field the store silently dropped is a column of the report that is always empty.
 */
export function notePostShape(shape) {
  if (!shape?.type) return;
  state.postShapes = [{ ...shape, at: new Date().toISOString() }, ...(state.postShapes || [])].slice(
    0,
    POST_SHAPES_KEPT
  );
  save();
}

// --- how many were staged today --------------------------------------------
//
// The gather used to run once a day, so "the best two or three a day" was a
// property of running once. Now it runs through the day, which is what you want
// when a source publishes at 14:00 and the morning pass has already been and
// gone — but it means the daily cap has to be counted rather than assumed.
//
// Persisted, so a restart cannot reset the count and hand you a second full
// day's worth. `day` is the local date string the caller computes; the store
// does not decide what "today" means.
//
// Two numbers, not one. `count` is how many cards were put in front of you
// today; `rejected` is how many of those you turned down. They answer different
// questions and the caller needs both: a card you rejected is not one of "the
// best two or three a day" and should not spend the day's quota, but it was
// still something the bot asked you to look at, and the ceiling on *that* is
// what keeps the approval queue from becoming a rubber stamp.
//
// Counting only `count` meant three rejections at breakfast ended the day: the
// remaining quota hit zero, the gather stopped looking, and nothing could
// possibly publish until tomorrow.
export function stagedToday(day) {
  return state.stagedDay?.date === day ? state.stagedDay.count : 0;
}
export function rejectedToday(day) {
  return state.stagedDay?.date === day ? state.stagedDay.rejected || 0 : 0;
}

function dayRecord(day) {
  if (state.stagedDay?.date !== day) state.stagedDay = { date: day, count: 0, rejected: 0 };
  // Stores written before rejections were counted.
  if (typeof state.stagedDay.rejected !== 'number') state.stagedDay.rejected = 0;
  return state.stagedDay;
}

export function noteStaged(day) {
  const rec = dayRecord(day);
  rec.count++;
  save();
  return rec.count;
}

/**
 * Give back the quota slot a rejected card was holding.
 *
 * Bounded by what was actually offered that day, so rejecting a card that was
 * staged yesterday cannot mint today a slot it never spent.
 */
export function noteRejected(day) {
  const rec = dayRecord(day);
  if (rec.rejected >= rec.count) return rec.rejected;
  rec.rejected++;
  save();
  return rec.rejected;
}

// --- the quiet alarm's anchors ----------------------------------------------
// Stamped rather than derived. `published` is pruned to the quota window and
// `staging` empties on every decision, so neither can answer "when did this bot
// last actually do something" once enough time has passed — which is precisely
// the moment the question is worth asking.
export const lastStagedAt = () => state.lastStagedAt || null;
export const lastPublishedAt = () => state.lastPublishedAt || null;

/**
 * A card reached the approval chat.
 *
 * Separate from noteStaged() because the two have different scopes: only the
 * pipeline's cards count against the daily quota, but a manual submission is
 * still a card, and a day full of them is not a quiet day.
 */
export function noteStagedAt() {
  state.lastStagedAt = Date.now();
  save();
}

// --- staging (awaiting your approve/reject tap) ------------------------------
export function addStaging(item) {
  const key = Math.random().toString(36).slice(2, 9);
  state.staging[key] = item;
  // WHERE EACH KIND KEEPS ITS DESTINATION, which is four different fields.
  //
  //   post     where         (set from the destinations.json row)
  //   deck     where         (the idea's subject)
  //   clip     place         (the postcard reel's places, or the narrated guide's city)
  //   card     card.place    (the drafted claim's own place, nested)
  //
  // Checked in that order rather than normalised at the call sites, because every one of
  // those fields is load-bearing somewhere else and renaming them to agree would be a
  // much larger change than this is worth.
  noteSuggestedPlace(item?.where || item?.place || item?.card?.place || null, { save: false });
  save();
  return key;
}

/**
 * The destinations that have been SUGGESTED lately, whatever happened to them next.
 *
 * `recentPublished` answers a different question and was being used for this one. A
 * destination suggested this morning and not yet approved is not in `published`, so the
 * afternoon's post could pick it again - and with five formats each drawing
 * independently, a day could easily offer Prague four times in four shapes. The owner's
 * ask was "different topics each time", and "each time" means each suggestion, not each
 * publication.
 *
 * A short ring, because the point is variety across a few days rather than a permanent
 * ban: with sixty-one destinations carrying a page, remembering the last twenty keeps
 * two thirds of the catalogue available at any moment.
 */
const SUGGESTED_RING = 20;

export function noteSuggestedPlace(place, { save: persist = true } = {}) {
  const name = String(place || '').trim();
  if (!name) return;
  if (!Array.isArray(state.suggestedPlaces)) state.suggestedPlaces = [];
  // Moved to the front rather than skipped when it is already there, so a repeat
  // pushes it back to the end of the queue instead of letting it age out early.
  state.suggestedPlaces = [name, ...state.suggestedPlaces.filter((p) => p !== name)].slice(0, SUGGESTED_RING);
  if (persist) save();
}

export function recentSuggested({ limit = SUGGESTED_RING } = {}) {
  return (Array.isArray(state.suggestedPlaces) ? state.suggestedPlaces : []).slice(0, limit);
}
export function takeStaging(key) {
  const item = state.staging[key];
  delete state.staging[key];
  save();
  return item || null;
}
export const getStaging = (key) => state.staging[key] || null;

/**
 * Everything waiting for approval, with its key.
 *
 * There was no way to list this. /pending answered with a count, which is fine
 * until the count and the number of cards in the chat disagree — and then it is
 * the one question you cannot ask. An item is added here BEFORE its approval
 * card is sent, so a send that fails leaves a staged item nothing can see.
 */
export const stagingItems = () =>
  Object.entries(state.staging).map(([key, cand]) => ({ key, cand: { ...cand } }));
export function updateStaging(key, patch) {
  if (!state.staging[key]) return false;
  state.staging[key] = { ...state.staging[key], ...patch };
  save();
  return true;
}
export const hasStaging = (key) => Boolean(state.staging[key]);
export const stagingSize = () => Object.keys(state.staging).length;
export function clearStaging() {
  const n = Object.keys(state.staging).length + Object.keys(state.proposals).length;
  state.staging = {};
  // Proposals go too. They are the same thing at an earlier stage — something
  // awaiting a tap from you — and leaving them behind would mean "clear
  // everything pending" quietly left a queue of them to be answered later.
  state.proposals = {};
  state.pendingEdit = {};
  save();
  return n;
}

// --- proposals --------------------------------------------------------------
// A deck idea that has been suggested and not yet decided on. Keyed the same
// way staging is, and deliberately persisted: a proposal that evaporates on
// restart is one you answer into a void, and the build it was waiting for never
// happens.
export function addProposal(proposal) {
  const key = Math.random().toString(36).slice(2, 9);
  state.proposals[key] = { ...proposal, proposedAt: Date.now() };
  save();
  return key;
}
export const getProposal = (key) => state.proposals[key] || null;
export function updateProposal(key, proposal) {
  if (!state.proposals[key]) return false;
  state.proposals[key] = { ...state.proposals[key], ...proposal };
  save();
  return true;
}
export function clearProposal(key) {
  delete state.proposals[key];
  save();
}
export const proposalSize = () => Object.keys(state.proposals).length;

/**
 * Every unanswered proposal, with its key, oldest first.
 *
 * The twin of stagingItems, and it did not exist because Telegram never needed
 * it: a proposal arrives as a message with two buttons and the key is in the
 * button. A page has to be able to LIST them, and `proposalSize` — the only
 * thing that could see this collection — answers with a number.
 *
 * Oldest first, because that is the order they were offered in and the order a
 * queue of decisions should be worked through.
 */
export const proposalItems = () =>
  Object.entries(state.proposals)
    .map(([key, proposal]) => ({ key, proposal }))
    .sort((a, b) => (a.proposal.proposedAt || 0) - (b.proposal.proposedAt || 0));

// --- pending edits ----------------------------------------------------------
// Keyed by the staging key, never by chat: BrickDeal learned the hard way that
// a single "currently editing" value per chat lets the second of two in-flight
// edits steal the reply meant for the first. Routing is by the prompt's own
// message id (see bot.js), not by "whatever text arrived next".
export function setPendingEdit(key, edit) {
  state.pendingEdit[key] = edit;
  save();
}
export const getPendingEdit = (key) => state.pendingEdit[key] || null;
export function clearPendingEdit(key) {
  delete state.pendingEdit[key];
  save();
}
export function findPendingEditByPrompt(promptMessageId) {
  for (const [key, edit] of Object.entries(state.pendingEdit)) {
    if (edit.promptMessageId === promptMessageId) return key;
  }
  return null;
}

// --- publish queue ----------------------------------------------------------
export function enqueue(item) {
  state.queue.push(item);
  save();
}

/**
 * Which item to publish next, alternating between the two kinds.
 *
 * Approve five decks and then five cards and a plain queue posts five decks in
 * a row — a day of nothing but slideshows followed by a day of nothing but
 * news, which reads as two different accounts taking turns. The feed should
 * alternate whatever order you happened to approve things in.
 *
 * The head of the queue when nothing has published yet, or when every waiting
 * item is the same kind as the last one. That fallback is the important half:
 * alternation is a preference about ORDER, never a reason to hold a post back.
 * A queue of six decks publishes six decks.
 */
function nextIndex(queue, lastKind) {
  if (!queue.length) return -1;
  if (!lastKind) return 0;
  const other = queue.findIndex((c) => (c?.kind || 'card') !== lastKind);
  return other === -1 ? 0 : other;
}

export function dequeue() {
  const i = nextIndex(state.queue, state.lastPublishedKind);
  if (i === -1) return null;
  const [item] = state.queue.splice(i, 1);
  state.lastPublishedKind = item?.kind || 'card';
  save();
  return item;
}
export const queueSize = () => state.queue.length;
export const peekQueue = () => state.queue.slice(0, 10);

/**
 * Everything waiting, in the order it will actually go out.
 *
 * Not the array order. The drip alternates kinds, so the array and the running
 * order are different things — and a list that showed one while /post acted on
 * the other would be a list that publishes the wrong post. The alternation is
 * replayed here rather than approximated.
 */
export function queuedItems() {
  const rest = state.queue.map((c, i) => ({ item: c, at: i }));
  let last = state.lastPublishedKind;
  const out = [];
  while (rest.length) {
    const i = nextIndex(rest.map((r) => r.item), last);
    const [row] = rest.splice(i, 1);
    last = row.item?.kind || 'card';
    out.push({ ...row.item, queuedAt: row.at });
  }
  return out;
}

/**
 * Take one specific post out of the queue, by its 1-based position.
 *
 * The position is the one /queue printed, which is why it is 1-based: the list
 * a person is reading from starts at 1, and asking them to subtract one is how
 * the wrong post gets published.
 *
 * Returns null for anything out of range rather than clamping. Clamping would
 * publish item 5 when 6 was asked for, which is precisely the case where the
 * person has misread the list and the last thing they need is for the bot to
 * confidently pick a neighbour.
 */
export function takeQueuedAt(n) {
  const i = Number(n) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= state.queue.length) return null;
  // Indexed against the order /queue PRINTED, which is the running order rather
  // than the array's. Splicing state.queue[i] directly would publish whatever
  // happened to sit at that array position — a different post from the one on
  // the line you read.
  const target = queuedItems()[i];
  const [item] = state.queue.splice(target.queuedAt, 1);
  state.lastPublishedKind = item?.kind || 'card';
  save();
  return item;
}

// --- published log (drives the pillar quotas) -------------------------------
/**
 * Record that a card went out, or that it reached one more destination.
 *
 * Upserts by id rather than always pushing. A card can now reach Telegram on one
 * attempt and Instagram on a later one; two rows for one post would double-count
 * it in the quota window and skew the pillar mix the scorer reads back.
 */
export function recordPublished({
  id,
  pillar,
  tags = [],
  layout,
  sourceId,
  topic = null,
  headline = null,
  place = null,
  // Which format this was, and which hook category, for the rows that have one.
  // Read back by /views so a hand-typed view count can be grouped by format, which
  // is the one grouping the account's own evidence is expressed in. See
  // publishedFacts in bot.js.
  format = null,
  hookCategory = null,
  // The video's own length and which open loop it opened on, for the watch ratio and
  // for the grouping that answers whether the loop held anybody. See publishedFacts.
  seconds = null,
  openLoopId = null,
  pexelsId = null,
  pexelsIds = [],
  angle = null,
  telegram,
  instagram,
  tiktok,
  tiktokDraft = false,
}) {
  // A clip's footage is spent for good the moment it goes out. Normally it was
  // already marked at build time; this covers the paths that do not build,
  // a re-render, a restore, anything that hands a finished candidate straight
  // to the publisher, so the ledger can never be behind the feed.
  //
  // EVERY shot, not the first. A cuts clip is built from four or five and the
  // singular field can only carry one; marking that one leaves the rest looking
  // unspent to the next batch, which is the repeat this ledger exists to stop.
  const spent = pexelsIds.length ? pexelsIds : pexelsId ? [pexelsId] : [];
  for (const one of spent) markClipUsed(one);
  if (id) state.publishedIds[id] = Date.now();
  state.lastPublishedAt = Date.now();

  const existing = id ? state.published.find((p) => p.id === id) : null;
  if (existing) {
    // Sticky: a destination that has already published must never be recorded
    // as un-published by a later attempt that only covered the other one.
    // Stamped when TikTok specifically succeeds, because `ts` is when the POST
    // was first published anywhere and TikTok's 5-per-24h cap is counted
    // against when it reached TIKTOK. A card that went to Telegram on Monday
    // and TikTok on Tuesday is a Tuesday post as far as the cap is concerned,
    // and reading `ts` would spend Monday's budget twice.
    if (tiktok && !existing.tiktokAt) existing.tiktokAt = Date.now();
    existing.telegram = existing.telegram || Boolean(telegram);
    existing.instagram = existing.instagram || Boolean(instagram);
    existing.tiktok = existing.tiktok || Boolean(tiktok);
    // Sticky the other way round: a row that reached the inbox and was later
    // published for real stops being a draft. The flag says "as far as this
    // process knows, nothing was posted", and a direct post is that knowledge
    // arriving.
    if (tiktok && !tiktokDraft) existing.tiktokDraft = false;
  } else {
    state.published.push({
      ts: Date.now(),
      id,
      pillar,
      tags,
      layout,
      // What the post was made from, so the quota window can answer "how much of
      // the feed is one source" — see sourceMaxShare in src/pillars.js.
      sourceId,
      // What it was ABOUT, for posts where that is not the same question. Every
      // deck files as pillar `day` with no sourceId, so three Dolomites decks
      // running are indistinguishable from three unrelated ones in this log —
      // which is exactly the repeat the owner override is supposed to name.
      topic,
      // What it SAID, and WHERE it was about. Both are read back: `headline`
      // is what the /deck idea prompt is shown as already-published, and
      // `place` is the axis the geographic quota measures.
      //
      // Their absence was not a gap in the log, it was a silent failure. The
      // idea prompt mapped `p.headline || p.id` over rows that had never
      // stored a headline, so every entry fell through to a sha1 and the model
      // was handed twelve hashes under the heading "do not repeat". It could
      // not read them and repeated itself, which is how a feed meant to span
      // the world became a run of one city.
      headline,
      place,
      format,
      hookCategory,
      seconds,
      openLoopId,
      // Which stock video this was, for clips. The field the /clip dedupe was
      // already reading — `recentPublished().map(p => p.pexelsId)` — on rows
      // that had never carried it, so the set of "already used" ids handed to
      // the search was empty on every single run and the filter it fed was
      // doing nothing at all.
      pexelsId: pexelsId ? String(pexelsId) : null,
      // And all of them, for a cuts clip. The singular field above is kept
      // because every older row has one and several readers still ask for it;
      // this is the one the dedupe reads when it is present.
      pexelsIds: spent.map(String),
      // WHICH ISRAELI ANGLE this post was chosen for, on the kinds that choose
      // one. Recorded for the same reason `topic` is: it is the axis the next
      // choice is made against, and pickAngle excludes what was used recently.
      // Held only in memory it would reset on every restart, and a bot that
      // restarts daily would keep proposing the same angle.
      angle: angle ? String(angle) : null,
      telegram: Boolean(telegram),
      instagram: Boolean(instagram),
      tiktok: Boolean(tiktok),
      tiktokAt: tiktok ? Date.now() : null,
      // Reached your inbox rather than the feed. Recorded so the row does not
      // claim something that has not happened: the deck is finished, approved
      // and delivered, and whether it was ever POSTED is a fact this process
      // cannot observe. Everything downstream that says "published" should say
      // something else about these.
      tiktokDraft: Boolean(tiktok && tiktokDraft),
    });
  }
  prunePublished(state);
  save();
}

/**
 * How many posts reached TikTok in the last 24 hours.
 *
 * TikTok caps an unaudited client at 5 a day and this is the number that cap is
 * measured against. It is counted from our own record rather than asked of the
 * API, because there is no endpoint that answers it — the only way to discover
 * the cap at TikTok's end is to be refused by it, which costs a post and
 * degrades the destination on the way through.
 *
 * Rows written before `tiktokAt` existed fall back to `ts`. That is the right
 * way to be wrong: it can only ever over-count a post near the boundary, and
 * over-counting pauses a post whereas under-counting spends the cap.
 */
export function tiktokPostsInLast24h(now = Date.now()) {
  const cutoff = now - DAY_MS;
  // Drafts are excluded, and this is the whole reason the flag is stored. The
  // cap counts posts PUBLISHED through the API in 24 hours; a deck handed to
  // your inbox publishes nothing until you tap post in the app, and TikTok does
  // not charge it. Counting it here would spend a limit that was never touched
  // and hold back direct posts that could have gone out.
  return state.published.filter(
    (p) => p.tiktok && !p.tiktokDraft && (p.tiktokAt ?? p.ts ?? 0) >= cutoff
  ).length;
}

/** When the oldest TikTok post inside the 24h window falls out of it. */
export function tiktokCapFreesAt(now = Date.now()) {
  const inWindow = state.published
    .filter((p) => p.tiktok && (p.tiktokAt ?? p.ts ?? 0) >= now - DAY_MS)
    .map((p) => p.tiktokAt ?? p.ts ?? 0)
    .sort((a, b) => a - b);
  return inWindow.length ? inWindow[0] + DAY_MS : null;
}
// Newest first, already inside the quota window.
export function recentPublished() {
  prunePublished(state);
  return [...state.published].sort((a, b) => b.ts - a.ts);
}

/**
 * What went out, in words — the memory the /deck idea prompt is given.
 *
 * Exported rather than mapped at the call site so it can be tested, because the
 * inline version was wrong for as long as it existed and nothing could see it:
 * it read `p.headline` from rows that had never stored one and fell through to
 * `p.id`, so the prompt's "do not repeat" list was twelve sha1 hashes. A model
 * cannot avoid repeating what it cannot read.
 *
 * Rows predating these fields yield an empty string and are dropped, so the
 * list is short and true rather than long and meaningless.
 */
export function recentTitles({ limit = 12, history = recentPublished() } = {}) {
  return history
    .map((p) =>
      // The place is appended to a headline, which rarely names it in a form
      // the model can match on, and never to a topic, which is already
      // "<where> · <category>" — "Vienna · city (Vienna)" says it twice.
      p.headline ? [p.headline, p.place && `(${p.place})`].filter(Boolean).join(' ') : p.topic || ''
    )
    .filter(Boolean)
    .slice(0, limit);
}
export const publishedToday = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return state.published.filter((p) => p.ts >= start.getTime()).length;
};

// --- per-destination health --------------------------------------------------
//
// A post that reaches Telegram and fails on Instagram used to be recorded as
// published and forgotten: `succeeded.length` was non-zero, so it was not
// retried, and the only trace was one warning line in a chat full of them. With
// Instagram blocked at the API, that repeated for every post — the Instagram
// account went dark for days while every individual message read as a handled
// edge case, and the global "when did we last publish" stayed fresh because
// Telegram kept working.
//
// So health is tracked per destination. `failures` counts CONSECUTIVE failures
// and resets on any success, which is what separates a blip from a block.

const DEGRADE_AFTER = () => Math.max(1, Number(process.env.TARGET_DEGRADE_AFTER ?? '3'));

const healthOf = (target) =>
  state.targetHealth[target] || { failures: 0, lastError: null, lastFailAt: null, lastOkAt: null, degraded: false };

export const targetHealth = (target) => ({ ...healthOf(target) });

export function noteTargetOk(target) {
  state.targetHealth[target] = {
    ...healthOf(target),
    failures: 0,
    lastError: null,
    lastOkAt: Date.now(),
    degraded: false,
  };
  save();
}

/**
 * Record a failed publish to one destination.
 *
 * Returns the updated record, including whether this failure is the one that
 * tipped the destination into `degraded` — the caller escalates on that edge so
 * the alert fires once per outage rather than once per card.
 */
export function noteTargetFailed(target, error) {
  const prev = healthOf(target);
  const failures = prev.failures + 1;
  const degraded = failures >= DEGRADE_AFTER();
  state.targetHealth[target] = {
    ...prev,
    failures,
    lastError: error ? String(error).slice(0, 300) : null,
    lastFailAt: Date.now(),
    degraded,
  };
  save();
  return { ...state.targetHealth[target], justDegraded: degraded && !prev.degraded };
}

/**
 * Stand a destination down now, without counting to three first.
 *
 * For failures that are certain rather than probable: a scope the connection
 * was never granted refuses every post identically, so the usual "three strikes
 * and it might be an outage" is three posts spending three calls each to learn
 * what the first refusal already said.
 *
 * Deliberately sets `failures` to the threshold rather than inventing a second
 * kind of degraded. Everything downstream — the cooldown, the one card let
 * through to test it, the recovery — then behaves exactly as it does for a
 * destination that got there the slow way, which also means a reconnect fixes
 * it without needing /retry.
 */
export function degrade(target, error) {
  const prev = healthOf(target);
  state.targetHealth[target] = {
    ...prev,
    failures: Math.max(prev.failures + 1, DEGRADE_AFTER()),
    lastError: error ? String(error).slice(0, 300) : null,
    lastFailAt: Date.now(),
    degraded: true,
  };
  save();
  return { ...state.targetHealth[target], justDegraded: !prev.degraded };
}

// How long a degraded destination is left alone before one card is allowed
// through to test it, and the ceiling that backoff grows to.
//
// `degraded` used to be a latch with exactly one key: /retry. That is the wrong
// shape for the thing it models. Every reason a destination degrades — an API
// having an hour, an expired token, a rate limit — ends by itself, and a flag
// that only a human can clear turns a thirty-minute outage into however long it
// takes someone to notice and type a command. Worse, the alert fires once, on
// the edge, so the longer it stays broken the quieter it gets.
//
// So the flag still latches, but it expires. After the cooldown one card is let
// through: if it publishes, noteTargetOk clears everything; if it fails,
// lastFailAt moves and the next cooldown is longer. That is a probe, not a
// retry storm — at most one card per cooldown reaches a destination that is
// still down.
const RECOVER_AFTER_MS = () =>
  Math.max(0, Number(process.env.TARGET_RECOVER_AFTER_MIN ?? '30')) * 60_000;
const RECOVER_MAX_MS = () =>
  Math.max(1, Number(process.env.TARGET_RECOVER_MAX_MIN ?? '360')) * 60_000;

/**
 * How long this destination should be left alone, given how badly it is going.
 *
 * Doubles per failure past the degrade threshold, capped. A destination that is
 * properly down is probed roughly hourly rather than every four hours, and one
 * that is dead for a day is not probed sixty times to prove it.
 */
export function recoveryDelayMs(target) {
  const base = RECOVER_AFTER_MS();
  if (base <= 0) return 0;
  const over = Math.max(0, healthOf(target).failures - DEGRADE_AFTER());
  return Math.min(base * 2 ** over, RECOVER_MAX_MS());
}

/** When a degraded destination is next due a probe, or null if it is not degraded. */
export function recoveryDueAt(target) {
  const h = healthOf(target);
  if (!h.degraded || !h.lastFailAt) return null;
  return h.lastFailAt + recoveryDelayMs(target);
}

/**
 * A destination that has failed enough times running to stop hammering it.
 *
 * False once the cooldown has elapsed, which is what lets the backlog drain on
 * its own. The stored flag is deliberately NOT cleared here — a read should not
 * write, and leaving it set is what makes the difference between "recovered"
 * and "due a probe" visible to /health.
 */
export function isDegraded(target) {
  const h = healthOf(target);
  if (!h.degraded) return false;
  const due = recoveryDueAt(target);
  if (due !== null && Date.now() >= due) return false;
  return true;
}

/** Degraded and still inside its cooldown — the flag as stored, not as applied. */
export const isDegradedLatched = (target) => Boolean(healthOf(target).degraded);

/** When this destination last actually published, or null if it never has. */
export const lastOkAt = (target) => healthOf(target).lastOkAt || null;

/** Clear the degraded flag so the next attempt goes through. Used by /retry. */
export function clearDegraded(target) {
  const prev = healthOf(target);
  state.targetHealth[target] = { ...prev, failures: 0, degraded: false };
  save();
}

/** Every destination we hold a health record for. */
export const healthTargets = () => Object.keys(state.targetHealth);

// --- per-source health -------------------------------------------------------
//
// The same shape as targetHealth, for the same reason and a different failure.
//
// gather() already survives a dead feed: every source runs under allSettled and
// a rejection is tallied rather than thrown. What it could not do is REMEMBER.
// A feed that has been 404 for three weeks was fetched on every run, timed out,
// and reported in the digest next to the genuinely new failures — so the one
// line that meant "this broke today" sat in a list of lines that meant "this
// broke last month", which is how a source registry rots without anyone
// noticing. Twenty-one enabled feeds fetched every two hours is also twenty-one
// chances to spend twenty seconds of timeout on something known to be gone.
//
// So a source that fails repeatedly is stood down, and — exactly like a
// destination — it is stood down with an expiry rather than a latch, because
// feeds come back and nobody should have to notice that they have.

const SOURCE_DEGRADE_AFTER = () => Math.max(1, Number(process.env.SOURCE_DEGRADE_AFTER ?? '3'));
const SOURCE_RECOVER_AFTER_MS = () =>
  Math.max(0, Number(process.env.SOURCE_RECOVER_AFTER_MIN ?? '360')) * 60_000;
const SOURCE_RECOVER_MAX_MS = () =>
  Math.max(1, Number(process.env.SOURCE_RECOVER_MAX_MIN ?? '2880')) * 60_000;

const sourceHealthOf = (id) =>
  state.sourceHealth?.[id] || {
    failures: 0,
    lastError: null,
    lastFailAt: null,
    lastOkAt: null,
    lastItems: null,
    degraded: false,
  };

export const sourceHealth = (id) => ({ ...sourceHealthOf(id) });
export const sourceHealthAll = () => ({ ...(state.sourceHealth || {}) });

export function noteSourceOk(id, items = 0) {
  if (!state.sourceHealth) state.sourceHealth = {};
  state.sourceHealth[id] = {
    ...sourceHealthOf(id),
    failures: 0,
    lastError: null,
    lastOkAt: Date.now(),
    lastItems: items,
    degraded: false,
  };
  save();
}

export function noteSourceFailed(id, error) {
  if (!state.sourceHealth) state.sourceHealth = {};
  const prev = sourceHealthOf(id);
  const failures = prev.failures + 1;
  const degraded = failures >= SOURCE_DEGRADE_AFTER();
  state.sourceHealth[id] = {
    ...prev,
    failures,
    lastError: error ? String(error).slice(0, 300) : null,
    lastFailAt: Date.now(),
    degraded,
  };
  save();
  return { ...state.sourceHealth[id], justDegraded: degraded && !prev.degraded };
}

function sourceRecoveryDelayMs(id) {
  const base = SOURCE_RECOVER_AFTER_MS();
  if (base <= 0) return 0;
  const over = Math.max(0, sourceHealthOf(id).failures - SOURCE_DEGRADE_AFTER());
  return Math.min(base * 2 ** over, SOURCE_RECOVER_MAX_MS());
}

/** When a stood-down source is next due a try, or null if it is not stood down. */
export function sourceRecoveryDueAt(id) {
  const h = sourceHealthOf(id);
  if (!h.degraded || !h.lastFailAt) return null;
  return h.lastFailAt + sourceRecoveryDelayMs(id);
}

/** Should this run skip the source? False once its cooldown has elapsed. */
export function isSourceDegraded(id) {
  const h = sourceHealthOf(id);
  if (!h.degraded) return false;
  const due = sourceRecoveryDueAt(id);
  if (due !== null && Date.now() >= due) return false;
  return true;
}

export const isSourceDegradedLatched = (id) => Boolean(sourceHealthOf(id).degraded);

export function clearSourceDegraded(id) {
  if (!state.sourceHealth?.[id]) return;
  state.sourceHealth[id] = { ...sourceHealthOf(id), failures: 0, degraded: false };
  save();
}

// --- per-source manual switch -------------------------------------------------
//
// sources.json already has `enabled`, and it stays the place a source is
// declared on or off for good — with the probe result in its `note`, which is
// the half that makes the registry worth reading. This is the other thing:
// turning one off RIGHT NOW, from Telegram, without editing a file on the
// server and restarting the bot. A feed that starts publishing something it
// should not is a thing you want stopped in ten seconds.
export function setSourceEnabled(id, on) {
  if (!state.sourceOff || typeof state.sourceOff !== 'object') state.sourceOff = {};
  if (on) delete state.sourceOff[id];
  else state.sourceOff[id] = Date.now();
  save();
}
export const isSourceOff = (id) => Boolean(state.sourceOff?.[id]);
export const sourcesOff = () => Object.keys(state.sourceOff || {});

// --- held posts --------------------------------------------------------------
//
// An approved card that a destination refused is kept here instead of being
// dropped. Losing an approved post is the one outcome worth avoiding, and while
// a destination is blocked for days there is nothing useful to retry against —
// but there will be, and then the backlog should still exist.

export function hold(cand, targets, error) {
  state.held.push({ ts: Date.now(), targets, error: error ? String(error).slice(0, 300) : null, cand });
  save();
}
export const heldCount = () => state.held.length;
export const heldItems = () => state.held.map((h) => ({ ...h }));

/** Take everything held back out, for requeueing. Returns the rows. */
export function releaseHeld() {
  const rows = state.held;
  state.held = [];
  save();
  return rows;
}

/**
 * Throw everything held away. Returns how many went.
 *
 * The opposite of releaseHeld, and it exists because not every held post CAN
 * be retried. A card is frozen at approval with whatever its destinations said
 * at the time — for TikTok that includes the privacy level, which is attached
 * once and never re-read. A card approved while TikTok was unreachable carries
 * no privacy level, so it fails the moment it is picked up, and /retry cannot
 * help: it re-enqueues the stored candidate verbatim, so the same card fails
 * the same way forever while re-degrading the destination behind it.
 *
 * That is a small trap with no exit, because clearing the degraded flag is
 * what /retry does and /retry also drags the unpublishable cards back in. This
 * is the exit. It only ever discards what a destination still OWES — the
 * targets that already published are long gone from this row — so the post
 * itself is not lost, only the copy that was never going to be made.
 */
export function clearHeld() {
  const n = state.held.length;
  state.held = [];
  save();
  return n;
}

// --- Instagram token ---------------------------------------------------------
// The Instagram Login path issues 60-day tokens that must be refreshed. The
// refreshed value has to outlive the process, or every restart would fall back
// to the stale seed in .env and the pipeline would still die on day 60. So the
// env var is the starting point and this is the source of truth thereafter.
export function setIgToken({ token, expiresAt }) {
  state.igToken = { token, expiresAt, updatedAt: Date.now() };
  save();
}
export const getIgToken = () => state.igToken || null;

// --- TikTok token -------------------------------------------------------------
// Two clocks, both persisted. The access token lasts a day and is refreshed on
// the publish path; the refresh token lasts about a year and cannot be renewed
// without opening a browser, so its expiry is worth being able to report before
// it arrives rather than after.
export function setTikTokToken({ accessToken, refreshToken, expiresAt, refreshExpiresAt, openId, scope }) {
  state.tiktokToken = {
    accessToken,
    refreshToken,
    expiresAt,
    refreshExpiresAt,
    openId: openId ?? state.tiktokToken?.openId ?? null,
    scope: scope ?? state.tiktokToken?.scope ?? null,
    updatedAt: Date.now(),
  };
  save();
}
export const getTikTokToken = () => state.tiktokToken || null;
export function clearTikTokToken() {
  state.tiktokToken = null;
  save();
}

export { existsSync };
