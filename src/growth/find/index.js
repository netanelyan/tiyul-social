import { fetchCities, siteSlugFor, SLUG_BATCH } from '../../plan/site.js';
import { BudgetError, guard, marginal, monthSpend, record } from '../../clients/budget.js';
import { claudeConfigured } from '../claude.js';
import { destinationSupported, normHe, postDestination, refreshSite } from '../prepare/site.js';
import { blockedBy, leadFor, markSeen, personKeys, postKey } from '../rules.js';
import { braveConfigured, braveSearch, IG_BOILERPLATE, instagramPost, instagramProfile, instagramTime, stripIgCounts, parseEngagement, parseFollowers, tiktokPost, tiktokProfile, tiktokTime } from '../../clients/brave.js';
import { classify, classifyAgencies } from './classify.js';
import { enrichAgency, placesConfigured, searchAgencies } from './places.js';
import { destinations, fillDest, todaysSearches } from './queries.js';
import { scoreAgency, scoreCreator, scoreCustomer } from './score.js';
import { oembed, saveThumb } from './tiktok.js';
import { channelStats, contactsIn, hebrewLetters, searchShorts, youtubeConfigured } from '../../clients/youtube.js';
import { harvestHandles, knownHandle, normHandle, readLinktree, sortOldInstagram } from './igHandles.js';
import { descriptions } from './videoContext.js';

// One discovery run: search, dedupe, sort, score, store.
//
// Every source is optional and says so when it is missing, in the run summary
// the Today page prints, so a column that stays empty because a key is missing
// never looks like a quiet day. Every paid call passes the budget gate first; a
// run that reaches the cap stops where it is and keeps what it found.
//
// The network functions arrive as `deps`, so the selftest can run the whole
// thing against fakes and prove the caps, the dedupe and the budget stop
// without a single request.

export const DEFAULT_DEPS = {
  refreshSite,
  fetchCities,
  brave: braveSearch,
  oembed,
  saveThumb,
  classify,
  classifyAgencies,
  searchAgencies,
  enrichAgency,
  searchShorts,
  channelStats,
  descriptions,
  linktree: readLinktree,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const PLATFORM_KEY = { tiktok: 'tt', instagram: 'ig', youtube: 'yt' };

/** An Instagram result's own words, without the counter line and the login wall. */
const igText = (r) => stripIgCounts([r.title, IG_BOILERPLATE.test(r.description) ? '' : r.description].filter(Boolean).join('\n'));

const iso = (t) => new Date(t).toISOString();
const ageDaysOf = (publishedAt, now) => {
  const t = Date.parse(publishedAt || '');
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : 0;
};

/** The slugs destinations.json prefers, for resolving a country to a city. */
const preferredSlugs = () => destinations().map(siteSlugFor).filter(Boolean);

export async function runDiscovery({ store, settings, trigger = 'button', now = Date.now(), deps = DEFAULT_DEPS, env = process.env } = {}) {
  const state = store.data;
  const run = { at: iso(now), trigger, queries: 0, candidates: 0, found: { creator: 0, customer: 0, agency: 0 }, attached: 0, rejected: 0, igHandles: 0, skipped: [], errors: [], stopped: null };
  const finish = () => {
    run.igHandlesTotal = Object.keys(state.igHandles || {}).length;
    run.spentUsd = Number(monthSpend(state, settings, now).billable.toFixed(4));
    run.ms = Date.now() - now;
    state.runs.unshift(run);
    state.runs.length = Math.min(state.runs.length, 60);
    store.save();
    return run;
  };

  if (monthSpend(state, settings, now).reached) {
    run.stopped = 'budget';
    return finish();
  }
  if (!claudeConfigured(env)) {
    run.errors.push('ANTHROPIC_API_KEY is missing, so nothing found could be sorted.');
    return finish();
  }

  await deps.refreshSite(state, { now });
  if (!state.site?.options?.length) run.errors.push('The destination list from our site did not load, so nothing could be matched to a destination.');
  const plan = todaysSearches(settings, { now });
  run.dests = plan.dests.map((d) => d.he);

  try {
    await findSocial({ state, settings, plan, run, now, deps, env });
    if (settings.youtube && !run.stopped) await findYoutube({ state, settings, plan, run, now, deps, env });
    if (!run.stopped) await findAgencies({ state, settings, plan, run, now, deps, env });
  } catch (e) {
    if (e instanceof BudgetError) run.stopped = 'budget';
    else run.errors.push(e.message);
  }
  return finish();
}

/* ------------------------------------------------------------ TikTok + Instagram */

async function findSocial({ state, settings, plan, run, now, deps, env }) {
  if (!braveConfigured(env)) {
    run.skipped.push('BRAVE_API_KEY is missing, so TikTok and Instagram were not searched.');
    return;
  }

  const cands = new Map();
  const followers = new Map();
  // Authors of Instagram finds that cannot be leads (too old, a profile page), for
  // the trend watcher's list of handles (igHandles.js). Each handle judged once.
  const oldIg = new Map();
  const rememberIg = (handle, url, r) => {
    const h = normHandle(handle);
    if (h && !oldIg.has(h) && !knownHandle(state, h) && !blockedBy(state, personKeys({ platform: 'ig', handle: h }))) oldIg.set(h, { handle: h, url, text: igText(r) });
  };
  for (const [i, q] of plan.brave.entries()) {
    try {
      guard(state, settings, 'brave', marginal(state, settings, 'brave', now), now);
    } catch (e) {
      // Stop searching, and still sort what was found: those posts are paid for.
      if (!(e instanceof BudgetError)) throw e;
      run.stopped = 'budget';
      break;
    }
    let results = [];
    try {
      results = await deps.brave(q.text, q.site, { env });
    } catch (e) {
      run.errors.push(`Brave "${q.text}": ${e.message}`);
      if (e.status === 401 || e.status === 403) break;
      continue;
    } finally {
      record(state, 'brave', { now });
      run.queries++;
    }
    if (q.hashtag) state.hashtagLog.push({ tag: q.hashtag, at: iso(now) });

    for (const r of results) {
      const text = `${r.title} ${r.description} ${r.extra.join(' ')}`;
      const prof = q.platform === 'tiktok' ? tiktokProfile(r.url) : null;
      if (prof) {
        const n = parseFollowers(text);
        if (n) followers.set(`tt:${prof.toLowerCase()}`, n);
        continue;
      }
      const post = q.platform === 'tiktok' ? tiktokPost(r.url) : instagramPost(r);
      if (!post) {
        if (q.platform === 'instagram') rememberIg(instagramProfile(r.url), r.url, r);
        continue;
      }
      // Instagram's indexed snippet often carries the account's own counts
      // ("19K Followers, 2,192 Following"), which is public and free.
      if (q.platform === 'instagram' && post.handle) {
        const n = parseFollowers(text);
        if (n) followers.set(`ig:${post.handle.toLowerCase()}`, n);
      }
      const pk = postKey(PLATFORM_KEY[q.platform], post.id);
      if (state.seen[pk] || cands.has(pk)) continue;
      // Too old for any column, known from the id alone: dropped before it costs
      // an oEmbed or a sorting call. Not marked seen, so raising the age limit in
      // Settings brings these back. Brave's social index is mostly this.
      const born = q.platform === 'tiktok' ? tiktokTime(post.id) : instagramTime(post.id);
      if (born && ageDaysOf(born, now) > Math.max(settings.maxPostAgeDays, settings.maxCustomerAgeDays)) {
        run.tooOld = (run.tooOld || 0) + 1;
        if (q.platform === 'instagram') rememberIg(post.handle, post.url, r);
        continue;
      }
      const keys = personKeys({ platform: PLATFORM_KEY[q.platform], handle: post.handle });
      if (blockedBy(state, keys)) {
        markSeen(state, [pk], { at: now, rejected: 'do-not-contact' });
        continue;
      }
      const eng = q.platform === 'instagram' ? parseEngagement(text) : {};
      cands.set(pk, {
        pk,
        platform: q.platform,
        id: post.id,
        url: post.url,
        handle: post.handle,
        text: q.platform === 'instagram' ? igText(r) : r.description,
        thumbUrl: r.thumb,
        publishedAt: q.platform === 'tiktok' ? tiktokTime(post.id) : instagramTime(post.id) || r.pageAge,
        likes: eng.likes ?? null,
        comments: eng.comments ?? null,
        query: q.query || null,
        hashtag: q.hashtag || null,
        searched: q.text,
        destHint: q.dest?.he || '',
      });
    }
    if (i < plan.brave.length - 1) await deps.sleep(1100);
  }

  // oEmbed: the caption and the author, from TikTok itself. Free.
  for (const c of cands.values()) {
    if (c.platform !== 'tiktok') continue;
    try {
      const o = await deps.oembed(c.url);
      c.text = o.title || c.text;
      c.name = o.authorName;
      c.handle = o.handle || c.handle;
      c.thumbUrl = o.thumbUrl || c.thumbUrl;
      c.profileUrl = o.authorUrl || `https://www.tiktok.com/@${c.handle}`;
    } catch (e) {
      // A video that oEmbed will not describe is private or gone.
      markSeen(state, [c.pk], { at: now, rejected: `oembed: ${e.message}` });
      cands.delete(c.pk);
    }
    await deps.sleep(250);
  }
  for (const c of cands.values()) {
    if (c.platform === 'instagram') c.profileUrl = c.handle ? `https://www.instagram.com/${c.handle}/` : null;
  }

  await judge({ state, settings, cands: [...cands.values()], followers, run, now, deps });
  // After the leads, which matter more if the budget runs out in between.
  for (const c of cands.values()) oldIg.delete(normHandle(c.handle));
  await sortOldInstagram({ state, settings, old: oldIg, run, now, deps });
}

/* ------------------------------------------------------------ YouTube */

async function findYoutube({ state, settings, plan, run, now, deps, env }) {
  if (!youtubeConfigured(env)) {
    run.skipped.push('YouTube is on in Settings but YOUTUBE_API_KEY is missing.');
    return;
  }
  // The same Hebrew templates as TikTok, without the "video" that only Brave
  // needs, over more destinations than Brave searches (YouTube's searches are
  // free, 100 a day), plus the day's hashtags, which find Hebrew Shorts
  // wherever they were filmed. At the defaults: 8 x 5 + 2 = 42 a day.
  const searches = [
    ...plan.youtubeDests.flatMap((d) => settings.tiktokQueries.map((q) => ({ text: fillDest(q, d), query: q, dest: d }))),
    ...plan.hashtags.map((tag) => ({ text: tag, hashtag: tag })),
  ];
  const cands = new Map();
  for (const s of searches) {
    let items = [];
    try {
      items = await deps.searchShorts(s.text, { env, now, days: settings.maxPostAgeDays });
    } catch (e) {
      run.errors.push(`YouTube "${s.text}": ${e.message}`);
      if (e.status === 400 || e.status === 403) break;
      continue;
    } finally {
      record(state, 'youtube', { now });
      run.queries++;
    }
    for (const v of items) {
      const pk = postKey('yt', v.id);
      if (cands.has(pk) || state.seen[pk] || blockedBy(state, [`yt:channel:${v.channelId}`])) continue;
      // No Hebrew at all: dropped here, for free, and only this Short. A Hebrew
      // creator can title one Short in English, so the channel is not judged.
      if (hebrewLetters(`${v.title} ${v.description}`) < 3) {
        run.notHebrew = (run.notHebrew || 0) + 1;
        markSeen(state, [pk], { at: now, rejected: 'אין עברית בכותרת ובתיאור' });
        continue;
      }
      cands.set(pk, { pk, platform: 'youtube', id: v.id, url: v.url, channelId: v.channelId, handle: null, name: v.channelTitle, text: `${v.title}\n${v.description}`, thumbUrl: v.thumb, publishedAt: v.publishedAt, query: s.query || null, hashtag: s.hashtag || null, searched: s.text, destHint: s.dest?.he || '' });
    }
  }
  const followers = new Map();
  if (cands.size) {
    try {
      const stats = await deps.channelStats([...cands.values()].map((c) => c.channelId), { env });
      record(state, 'youtube', { now });
      for (const c of cands.values()) {
        const s = stats.get(c.channelId);
        if (s?.handle) c.handle = s.handle;
        c.profileUrl = s?.handle ? `https://www.youtube.com/@${s.handle}` : `https://www.youtube.com/channel/${c.channelId}`;
        c.socials = s?.socials || [];
        c.linktree = s?.linktree || [];
        c.email = s?.email || null;
        if (s?.subscribers) followers.set(`yt:${String(c.handle || c.channelId).toLowerCase()}`, s.subscribers);
      }
    } catch (e) {
      run.errors.push(`YouTube stats: ${e.message}`);
    }
    // A creator names their Instagram (or a Linktree) under the Short more often
    // than in the channel's own description, and search gives only 160 characters
    // of it. videos.list, one unit for 50, from the general quota.
    try {
      const full = await deps.descriptions([...cands.values()].map((c) => c.id), { env });
      record(state, 'youtube', { units: Math.ceil(cands.size / 50), now });
      for (const c of cands.values()) {
        const more = contactsIn(full.get(c.id));
        c.socials = [...(c.socials || []), ...more.socials.filter((u) => !(c.socials || []).some((s) => s.toLowerCase() === u.toLowerCase()))].slice(0, 4);
        c.linktree = [...new Set([...(c.linktree || []), ...more.linktree])];
      }
    } catch (e) {
      run.errors.push(`YouTube descriptions: ${e.message}`);
    }
  }
  await judge({ state, settings, cands: [...cands.values()], followers, run, now, deps });
}

/* ------------------------------------------------------------ sorting into leads */

async function judge({ state, settings, cands, followers, run, now, deps }) {
  if (!cands.length) return;
  run.candidates += cands.length;
  // The site's destinations, minus the countries we skip, are what the sorter
  // chooses from: it knows Pai is in northern Thailand, and a name match does not.
  const options = (state.site?.options || []).filter((o) => !settings.skipCountries.includes(o.country));
  const verdicts = await deps.classify(
    cands.map((c) => ({ text: c.text, author: c.name || c.handle, platform: c.platform })),
    { state, settings, destinations: options.map((o) => o.name) }
  );
  await harvestHandles({ state, cands, verdicts, run, now, deps });
  const preferred = preferredSlugs();

  // THE SORTER'S CHOICE IS CHECKED, NOT TRUSTED. On the first live runs it
  // filed three Corfu posts under Santorini and a Phi Phi post under Palawan:
  // told "Corfu is not Athens", it picked the next Greek island. So a chosen
  // destination stands only when something the post itself names is in that
  // destination's names or in its place catalog, read from our own site.
  const optionFor = (v) => (v?.siteDestination ? options.find((o) => o.name === String(v.siteDestination).trim()) : null);
  const slugs = [...new Set(verdicts.map(optionFor).filter(Boolean).map((o) => o.slug))];
  const cities = new Map();
  for (let at = 0; at < slugs.length; at += SLUG_BATCH) {
    const got = await deps.fetchCities(slugs.slice(at, at + SLUG_BATCH)).catch(() => new Map());
    for (const [k, city] of got) cities.set(k, city);
  }
  const countries = new Set((state.site?.options || []).map((o) => normHe(o.country)));
  const supported = (opt, v) => destinationSupported(opt, v, { countries, city: cities.get(opt.slug) });

  for (const [i, c] of cands.entries()) {
    const v = verdicts[i];
    if (!v) continue;
    const pf = PLATFORM_KEY[c.platform];
    const keys = personKeys({ platform: pf, handle: c.handle, channelId: c.channelId });
    const pick = optionFor(v);
    const chosen = pick && supported(pick, v) ? pick : null;
    const dest = chosen || postDestination(v.destination, c.destHint, state.site?.options || [], preferred, settings.skipCountries);
    const ageDays = ageDaysOf(c.publishedAt, now);
    const fol = followers.get(`${pf}:${String(c.handle || c.channelId || '').toLowerCase()}`);
    const type = v.kind === 'customer' ? 'customer' : 'creator';
    const scored =
      type === 'customer'
        ? scoreCustomer({ verdict: v, ageDays, onSite: dest?.name }, settings)
        : scoreCreator({ verdict: v, followers: fol, ageDays, onSite: dest?.name, comments: c.comments }, settings);

    if (scored.reject) {
      run.rejected++;
      markSeen(state, [c.pk], { at: now, rejected: scored.reject });
      if (scored.rejectPerson && keys.length) markSeen(state, keys, { at: now, rejected: scored.reject });
      continue;
    }

    const post = {
      id: c.id,
      platform: c.platform,
      url: c.url,
      title: String(c.text || '').trim(),
      thumb: null,
      publishedAt: c.publishedAt || null,
      status: 'open',
      score: scored.score,
      why: scored.why,
      places: v.places || [],
      days: v.days || null,
      routeDemand: Boolean(v.routeDemand),
      asksForRoute: Boolean(v.asksForRoute),
      likes: c.likes ?? null,
      comments: c.comments ?? null,
      // Per post, not per person: one creator films Athens and then Tirana, and
      // a comment on the Tirana video has to be written from Tirana's page.
      dest: dest ? { he: dest.name, slug: dest.slug } : null,
      // What the post itself says it is about, beside the page we matched it
      // to, so the lead page shows both and a wrong match is visible.
      said: v.destination || '',
      drafts: {},
    };

    const existing = keys.length ? leadFor(state, keys) : null;
    if (existing) {
      // A handled lead never comes back. An open creator gains a new video,
      // which is how a skipped video's creator returns to the queue.
      if (!existing.closed && existing.type === 'creator' && type === 'creator' && !existing.posts.some((p) => p.id === post.id)) {
        post.thumb = await deps.saveThumb(c.thumbUrl, c.platform, c.id);
        existing.posts.push(post);
        existing.score = Math.max(existing.score || 0, scored.score);
        existing.routeDemand ||= post.routeDemand;
        run.attached++;
        markSeen(state, [c.pk], { at: now, lead: existing.id });
      } else {
        markSeen(state, [c.pk], { at: now, rejected: existing.closed ? `handled (${existing.closed})` : 'known' });
      }
      continue;
    }

    const who = c.handle ? `@${c.handle}` : `p:${c.id}`;
    const id = type === 'customer' ? `cust:${pf}:${who}` : `${pf}:${who}`;
    post.thumb = await deps.saveThumb(c.thumbUrl, c.platform, c.id);
    // Only the post's own grammar says who wrote it; otherwise nobody knows, and
    // the drafts use the plural. Every lead used to start as female.
    const gender = v.gender === 'f' || v.gender === 'm' ? v.gender : 'unknown';
    state.leads[id] = {
      id,
      type,
      source: c.platform,
      foundAt: iso(now),
      query: c.query,
      hashtag: c.hashtag,
      searched: c.searched,
      name: c.name || null,
      handle: c.handle || null,
      channelId: c.channelId || null,
      profileUrl: c.profileUrl || null,
      // Where a YouTube creator can actually be written to: YouTube has no DMs.
      socials: c.socials || [],
      email: c.email || null,
      followers: Number.isFinite(fol) ? fol : null,
      followersFrom: Number.isFinite(fol) ? (c.platform === 'youtube' ? 'youtube' : 'search') : null,
      dest: dest ? { he: dest.name, slug: dest.slug } : null,
      posts: [post],
      score: scored.score,
      why: [...scored.why, `found by searching "${c.searched}"`],
      reason: v.reason,
      gender,
      genderFrom: v.gender === 'f' || v.gender === 'm' ? 'post' : 'default',
      routeDemand: post.routeDemand,
      stage: 'found',
      closed: null,
      drafts: {},
      edits: {},
      history: [{ at: iso(now), what: 'found' }],
    };
    markSeen(state, [c.pk, ...keys], { at: now, lead: id });
    run.found[type]++;
  }
}

/* ------------------------------------------------------------ agencies */

async function findAgencies({ state, settings, plan, run, now, deps, env }) {
  if (!placesConfigured(env)) {
    run.skipped.push('GOOGLE_MAPS_KEY is missing, so agencies were not searched.');
    return;
  }
  // No search while there is a week of agencies waiting: a backlog bigger than
  // the next five days of the cap is money spent on leads nobody will reach.
  const backlog = Object.values(state.leads).filter((l) => l.type === 'agency' && !l.closed && l.stage === 'found').length;
  if (backlog >= settings.caps.agency * 5) {
    run.skipped.push(`${backlog} agencies are still waiting for you, so I did not look for more.`);
    return;
  }
  if (!plan.agency) return;

  guard(state, settings, 'places', marginal(state, settings, 'places', now), now);
  let found = [];
  try {
    found = await deps.searchAgencies(plan.agency.text, { env });
  } catch (e) {
    run.errors.push(`Places "${plan.agency.text}": ${e.message}`);
    return;
  } finally {
    record(state, 'places', { now });
    run.queries++;
  }

  const fresh = [];
  for (const a of found) {
    const keys = personKeys({ placeId: a.placeId, phone: a.phone, website: a.website });
    if (blockedBy(state, keys) || leadFor(state, keys) || state.seen[`place:${a.placeId}`]) continue;
    fresh.push({ a, keys, extra: await deps.enrichAgency(a) });
  }
  // One read of the whole page of businesses: does each one sell trips abroad?
  // Without an answer (no key, a failed call), the keyword check stands.
  let verdicts = [];
  try {
    verdicts = await deps.classifyAgencies(fresh.map(({ a, extra }) => ({ ...a, snippet: extra.snippet })), { state, settings });
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    run.errors.push(`Sorting the agencies failed: ${e.message}`);
  }

  for (const [i, { a, keys, extra: raw }] of fresh.entries()) {
    const v = verdicts[i];
    const { snippet, ...extra } = raw;
    if (v) {
      extra.abroad = v.sellsAbroad ? v.reason || 'טיולים לחו"ל' : null;
      extra.siteRead = true;
      extra.kosher ||= v.kosherAudience ? 'קהל דתי' : null;
    }
    const scored = scoreAgency({ ...a, ...extra });
    if (scored.reject) {
      run.rejected++;
      markSeen(state, keys, { at: now, rejected: scored.reject });
      continue;
    }
    const id = `ag:${a.placeId}`;
    state.leads[id] = {
      id,
      type: 'agency',
      source: 'places',
      foundAt: iso(now),
      query: plan.agency.query,
      hashtag: null,
      searched: plan.agency.text,
      name: a.name,
      placeId: a.placeId,
      phone: a.phone,
      whatsapp: extra.whatsapp,
      email: extra.email,
      website: a.website,
      socials: extra.socials,
      address: a.address,
      mapsUrl: a.mapsUrl,
      kosher: extra.kosher,
      siteError: extra.siteError,
      score: scored.score,
      why: [...scored.why, `found by searching "${plan.agency.text}"`],
      // An agency is a business, addressed in the plural.
      gender: 'unknown',
      genderFrom: 'default',
      stage: 'found',
      closed: null,
      posts: [],
      drafts: {},
      edits: {},
      history: [{ at: iso(now), what: 'found' }],
    };
    markSeen(state, [...keys, ...personKeys({ whatsapp: extra.whatsapp })], { at: now, lead: id });
    run.found.agency++;
  }
}
