import { siteSlugFor } from '../../plan/site.js';
import { braveConfigured, braveSearch } from '../../clients/brave.js';
import { destinations } from '../find/queries.js';
import { fillVideoContext } from '../find/videoContext.js';
import { BudgetError, guard, marginal, record } from '../../clients/budget.js';
import { claudeConfigured } from '../claude.js';
import { creatorContact, itineraryPath } from '../links.js';
import { ilDate, itemDone, nextInLine, parseItem, pickToday } from '../rules.js';
import { chooseExample, extractProfile, readAgencySite } from './agencyProfile.js';
import { draftItem } from './draft.js';
import { messagePost, targetFor } from './compose.js';
import { lookupInstagram } from './igLookup.js';
import { examplesFor } from './learn.js';
import { canPublishNew, publishRoute } from './publish.js';
import { shortLinkFor } from './short.js';
import { campaignFor } from '../links.js';
import { BUILDER, buildRoute } from './route.js';
import { checkRoute, routeKey } from './routeCheck.js';
import { readyRoute } from './sampleRoute.js';
import { cityFor, siteContext } from './site.js';

// Preparing what Today shows: only today's picks, only what is missing.
//
// Drafting costs money, so it happens for the items inside the caps and for
// nothing else. A lead that is found and never picked costs one classification
// and no draft. The same holds for the two new reads: a video's description and
// comments, and an agency's own site, are read only for what is on Today.
//
// TWO THINGS GO PUBLIC HERE, AND NOWHERE ELSE: a creator's route, the day they
// reach the Creators column (the day they are found, when the cap has room),
// and an agency's sample route, the day it is picked for a message. Both go
// through the site's trips endpoint, and both count against the one daily
// limit the site sets for new pages (canPublishNew).

export const DEFAULT_DEPS = {
  cityFor,
  draftItem,
  publishRoute,
  brave: braveSearch,
  fillVideoContext,
  readAgencySite,
  extractProfile,
  shortLink: shortLinkFor,
  checkRoute,
  lookupInstagram,
};

/** Ask the site for this item's short link once; the card reads it from the lead. */
async function linkUp({ state, lead, what, deps, env, now }) {
  const url = targetFor(lead, what, { state });
  if (url) await deps.shortLink(state, lead, url, { env, now, campaign: campaignFor(lead) });
}

let running = null;

/** Single-flight: a second call while one is running waits for the same one. */
export function prepareToday(args) {
  running ??= doPrepare(args).finally(() => {
    running = null;
  });
  return running;
}

// A route the site has not taken yet is tried again on the next pass; a refusal
// it will repeat waits an hour.
const retryPublish = (trip, now) =>
  !trip || ['waiting-for-site', 'no-route', 'waiting-limit'].includes(trip.status) || (trip.status === 'failed' && now - Date.parse(trip.failedAt || 0) > 3_600_000);

/**
 * Publish a lead's route, inside the daily limit. Returns the trip state.
 *
 * A route that changed since it went up (rebuilt around a stop Google says is
 * closed, or by a newer builder) is re-sent under the same externalId: an edit
 * of the same page, at the same address, not a new page. `routeKey` on the trip
 * is the route it shows.
 */
async function publishWithin({ state, settings, lead, now, deps, env, report }) {
  const key = routeKey(lead.route);
  if (lead.trip?.status === 'published') {
    if (lead.trip.routeKey === key || now - Date.parse(lead.trip.resendFailedAt || 0) < 3_600_000) return lead.trip;
    const trip = await deps.publishRoute(lead, { env, now });
    return trip.status === 'published' ? { ...trip, routeKey: key } : { ...lead.trip, resendError: trip.reason, resendFailedAt: new Date(now).toISOString() };
  }
  if (!retryPublish(lead.trip, now)) return lead.trip;
  if (!canPublishNew(state, settings, now)) {
    return {
      status: 'waiting-limit',
      reason: `The site takes ${settings.publishPerDay} new route pages a day and today's are used. This one goes up on a later pass.`,
    };
  }
  const trip = await deps.publishRoute(lead, { env, now });
  if (trip.status !== 'published') return trip;
  report.published = (report.published || 0) + 1;
  return { ...trip, routeKey: key };
}

async function doPrepare({ store, settings, now = Date.now(), deps = DEFAULT_DEPS, env = process.env }) {
  deps = { ...DEFAULT_DEPS, ...deps };
  const state = store.data;
  const day = pickToday(state, settings, now);
  const report = { drafted: 0, failed: 0, stopped: null };
  const cities = new Map();
  const city = async (slug) => {
    if (!slug) return null;
    if (!cities.has(slug)) cities.set(slug, await deps.cityFor(slug).catch(() => null));
    return cities.get(slug);
  };
  const canDraft = claudeConfigured(env);

  try {
    await refreshSent({ state, settings, now, deps, env, report, city });
    if (settings.agencyPaused) await readyNext({ state, settings, now, deps, env, report, city, canDraft });
  } catch (e) {
    if (!(e instanceof BudgetError)) throw e;
    report.stopped = 'budget';
  }

  // The optional comments last: if the budget runs out mid-pass, it runs out on them.
  const items = [...day.creator, ...day.agency, ...day.customer, ...day.comment].filter((k) => !itemDone(state, k));

  // The videos' descriptions and top comments, for every video today's items
  // will write about, in one batch.
  const videos = [];
  for (const key of items) {
    const { col, leadId, what } = parseItem(key);
    const lead = state.leads[leadId];
    if (!lead) continue;
    if (col === 'comment') videos.push(...lead.posts.filter((p) => p.id === what));
    if (col === 'creator' && what === 'dm') videos.push(messagePost(lead));
  }
  try {
    await deps.fillVideoContext(state, videos.filter(Boolean), { env, now });
  } catch (e) {
    report.contextError = e.message;
  }

  for (const key of items) {
    const { col, leadId, what } = parseItem(key);
    const lead = state.leads[leadId];
    if (!lead) continue;
    try {
      if (col === 'comment') {
        const post = lead.posts.find((p) => p.id === what);
        if (!post || post.drafts?.variants?.length || !canDraft) continue;
        // The video's own destination, which is not always the one the creator
        // was first found for.
        const c = await city(post.dest?.slug || lead.dest?.slug);
        post.drafts = await deps.draftItem('comment', { state, settings, lead, post, site: siteContext(c), examples: examplesFor(state, 'comment') });
        delete post.draftError;
        report.drafted++;
      } else if (col === 'creator' && what === 'dm') {
        // A YouTube creator listing no Instagram and no email: one search for
        // their Instagram first (igLookup.js), so the message is written for it.
        await deps.lookupInstagram({ state, settings, lead, now, brave: deps.brave, env });
        // The DM is about one video (messagePost), so its destination decides
        // the route and the destination in the message.
        const post = messagePost(lead);
        if (post?.dest) lead.dest = post.dest;
        const c = await city(lead.dest?.slug);
        if (!lead.route && c) lead.route = buildRoute(c, { places: post?.places, days: post?.days });
        lead.trip = await publishWithin({ state, settings, lead, now, deps, env, report });
        await linkUp({ state, lead, what: 'dm', deps, env, now });
        if (!lead.drafts?.dm?.variants?.length && canDraft && post) {
          lead.drafts = { ...lead.drafts, dm: await draftDm(deps.draftItem, { state, settings, lead, post, c }) };
          report.drafted++;
        }
      } else if (col === 'agency' && what === 'message') {
        await prepareAgency({ state, settings, lead, now, deps, env, report, city, canDraft });
        if (lead.routeCheck?.status === 'fail' && setAside(state, lead, key, settings, now)) report.setAside = (report.setAside || 0) + 1;
      } else if (col === 'customer') {
        const post = lead.posts[0];
        if (lead.drafts?.reply?.variants?.length || !canDraft || !post) continue;
        const c = await city(lead.dest?.slug);
        await linkUp({ state, lead, what: 'reply', deps, env, now });
        lead.drafts = { ...lead.drafts, reply: await deps.draftItem('reply', { state, settings, lead, post, site: siteContext(c), examples: examplesFor(state, 'reply') }) };
        report.drafted++;
      }
      delete lead.draftError;
    } catch (e) {
      if (e instanceof BudgetError) {
        report.stopped = 'budget';
        break;
      }
      report.failed++;
      if (col === 'comment') {
        const post = lead.posts.find((p) => p.id === what);
        if (post) post.draftError = e.message;
      } else {
        lead.draftError = e.message;
      }
    }
  }
  store.save();
  return { date: ilDate(now), ...report };
}

/**
 * A creator's first message, written for the channel it goes out on, about
 * `post`, with the route built from it. The video it was written about is kept
 * on the record, so the card and a later redraft stay on the same one.
 */
export async function draftDm(draftItem, { state, settings, lead, post, c }) {
  const extra = { route: lead.route, offer: settings.offers.creator, channel: creatorContact(lead), commented: post.status === 'commented' };
  const dm = await draftItem('creator', { state, settings, lead, post, site: siteContext(c), extra, examples: examplesFor(state, 'creator') });
  return { ...dm, postId: post.id };
}

/**
 * One agency, ready to message: who they are, the example, the route on our
 * site when they sell a city we cover, and the drafts.
 */
async function prepareAgency({ state, settings, lead, now, deps, env, report, city, canDraft }) {
  const { ex, c } = await readyAgency({ state, settings, lead, now, deps, env, city, canDraft });
  // THE ROUTE IS CHECKED BEFORE IT GOES PUBLIC, and only a route that passed is
  // published (the owner's rule of 2026-10-11).
  if (ex?.kind === 'route' && lead.routeCheck?.status === 'pass') lead.trip = await publishWithin({ state, settings, lead, now, deps, env, report });
  await linkUp({ state, lead, what: 'message', deps, env, now });
  if (!lead.socials?.length && !lead.socialsLooked && braveConfigured(env)) await findSocials({ state, settings, lead, now, deps, env });
  // No message is written for a route that has not passed: it could not be sent.
  if (ex && lead.routeCheck?.status !== 'pass') return;
  if (!lead.drafts?.message?.variants?.length && canDraft && ex) {
    lead.drafts = {
      ...lead.drafts,
      message: await deps.draftItem('agency', {
        state,
        settings,
        lead,
        site: siteContext(c, { maxPlaces: 8 }),
        extra: { route: ex.kind === 'route' ? lead.route : null, exampleHe: ex.he },
        examples: examplesFor(state, 'agency'),
      }),
    };
    report.drafted++;
  }
}

/**
 * An agency made ready to be messaged, short of anything that goes out: its
 * site read, its example chosen, and its route built and checked (built from
 * the site's itinerary and rebuilt around any stop Google says is closed,
 * sampleRoute.js). Returns { ex, c }.
 */
async function readyAgency({ state, settings, lead, now, deps, env, city, canDraft }) {
  if (!lead.profile && canDraft) {
    let site = { text: '' };
    try {
      site = await deps.readAgencySite(lead);
    } catch (e) {
      lead.siteError = e.message;
    }
    lead.profile = await deps.extractProfile({ state, settings, lead, siteText: site.text, now });
  }
  // An example of a site itinerary PAGE (chosen before 2026-10-11's builder) is
  // the site's own days, which cannot be repaired: chosen again, it becomes a
  // route built from the same itinerary (agencyProfile.js).
  if (lead.example?.kind === 'page' && !lead.messagedAt) {
    delete lead.example;
    delete lead.agencyDest;
    delete lead.routeCheck;
  }
  if (!lead.example) lead.example = chooseExample(state, lead, { fallback: agencySample });
  const ex = lead.example;
  let c = null;
  if (ex?.kind === 'route') {
    // An agency drafted before this read had a rotation page; the route replaces it.
    delete lead.agencyDest;
    c = await city(ex.slug);
    if (c) Object.assign(lead, await readyRouteFor(c, { lead, state, settings, env, now, deps }));
  } else if (ex?.kind === 'page') {
    // A page already sent: the agency has that link, and it stays what it is.
    lead.agencyDest = { slug: ex.slug, he: ex.he, path: ex.path };
    c = await city(ex.slug);
  }
  return { ex, c };
}

/**
 * While new agency messages are paused (Settings), the next agencies in line
 * are made ready: site read, route built and checked on Google, nothing
 * published, drafted or put on Today. The owner unpauses once their routes pass
 * (2026-10-11), and the desk then picks them with these same routes. One that
 * still fails after the rebuild is set aside, as on Today, and the next agency
 * moves into line.
 */
async function readyNext({ state, settings, now, deps, env, report, city, canDraft }) {
  for (const lead of nextInLine(state, settings, now)) {
    try {
      await readyAgency({ state, settings, lead, now, deps, env, city, canDraft });
      delete lead.readyError;
      if (lead.routeCheck?.status === 'fail' && setAside(state, lead, null, settings, now)) report.setAside = (report.setAside || 0) + 1;
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      lead.readyError = e.message;
    }
  }
}

/** The lead's route and check, made ready: { route, routeCheck }. */
async function readyRouteFor(c, { lead, state, settings, env, now, deps }) {
  const ready = await readyRoute(c, { state, settings, env, now, route: lead.route || null, check: lead.routeCheck || null, deps: { checkRoute: deps.checkRoute, buildRoute: deps.buildRoute } });
  return { route: ready.route, routeCheck: ready.check };
}

/**
 * An agency whose sample route still fails after the rebuild gives its slot
 * back (the owner's rule of 2026-10-11: a failing route must not use one of the
 * day's three). It leaves Today, set aside with its check on the lead page, and
 * the next agency takes the slot on the next pass. At most `caps.agency` a day,
 * so a run of failures cannot read every waiting agency's site in one day.
 * Returns whether it was set aside.
 */
export function setAside(state, lead, key, settings, now = Date.now()) {
  const date = ilDate(now);
  const today = Object.values(state.leads).filter((l) => l.routeSetAside && ilDate(l.routeSetAside.at) === date).length;
  if (today >= (Number(settings.caps?.agency) || 0)) return false;
  const at = new Date(now).toISOString();
  lead.routeSetAside = { at, builder: BUILDER, issues: lead.routeCheck.issues.length };
  (lead.history ??= []).push({ at, what: `set aside: its sample route failed the check (${lead.routeCheck.issues.length} issues) after the rebuild` });
  const day = state.daily[date];
  if (day?.agency) day.agency = day.agency.filter((k) => k !== key);
  return true;
}

/**
 * The routes already sent to agencies, rebuilt by the current builder and
 * re-sent under the same externalId (the owner, 2026-10-11), so the link each
 * agency has shows the new route. Only once the new route passes the check;
 * until then the page they have stays as it is, and `routeRefresh` on the lead
 * says why. A re-send is an edit of the same page, not a new one.
 */
async function refreshSent({ state, settings, now, deps, env, report, city }) {
  for (const lead of Object.values(state.leads)) {
    if (lead.type !== 'agency' || !lead.messagedAt || lead.closed || lead.trip?.status !== 'published') continue;
    if (lead.example?.kind !== 'route' || lead.route?.builder === BUILDER) continue;
    const c = await city(lead.example.slug || lead.route?.citySlug);
    if (!c) continue;
    const prev = lead.routeRefresh || {};
    const ready = await readyRoute(c, { state, settings, env, now, route: prev.route || null, check: prev.check || null, deps: { checkRoute: deps.checkRoute, buildRoute: deps.buildRoute } });
    lead.routeRefresh = { at: new Date(now).toISOString(), route: ready.route, check: ready.check };
    if (ready.check?.status !== 'pass') continue;
    const was = lead.trip;
    const trip = await deps.publishRoute({ ...lead, route: ready.route }, { env, now });
    if (trip.status !== 'published') {
      lead.routeRefresh.error = trip.reason;
      continue;
    }
    lead.route = ready.route;
    lead.routeCheck = ready.check;
    lead.trip = { ...trip, routeKey: routeKey(ready.route) };
    delete lead.routeRefresh;
    (lead.history ??= []).push({
      at: new Date(now).toISOString(),
      what: `route rebuilt and re-sent to the same page${trip.url !== was.url ? ` (its address changed: ${was.url} is now ${trip.url})` : ''}`,
    });
    report.resent = (report.resent || 0) + 1;
  }
}

/**
 * The fallback example: one of the site's live itinerary pages.
 *
 * Used only when nothing the agency sells is in our catalog (chooseExample). From
 * the destinations this audience actually flies to, in destinations.json's order,
 * first eight that have a live page; the choice rotates by the lead's id, so three
 * agencies on one day do not all get Athens.
 */
export function agencySample(state, lead, preferred = destinations().map(siteSlugFor)) {
  const pages = state.site?.itineraries || [];
  if (!pages.length) return null;
  const live = new Set(pages.map((p) => p.slug));
  const popular = [...new Set(preferred.filter((s) => live.has(s)))].slice(0, 8);
  const slugs = popular.length ? popular : [...live];
  let h = 0;
  for (const ch of String(lead.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const slug = slugs[h % slugs.length];
  const opt = (state.site.options || []).find((o) => o.slug === slug);
  const path = itineraryPath(pages, slug, 5);
  return { slug, he: opt?.name || slug, path };
}

/** Two Brave lookups for an agency's Instagram and Facebook pages. */
async function findSocials({ state, settings, lead, now, deps, env }) {
  lead.socialsLooked = true;
  const found = [];
  for (const site of ['instagram.com', 'facebook.com']) {
    guard(state, settings, 'brave', marginal(state, settings, 'brave', now), now);
    try {
      const results = await deps.brave(`"${lead.name}"`, site, { env, count: 5, freshness: '' });
      const hit = results.find((r) => new RegExp(`^https?://(www\\.)?${site.replace('.', '\\.')}/[A-Za-z0-9._-]+/?$`).test(r.url));
      if (hit) found.push(hit.url);
    } catch {
      /* a missing social page is not an error worth showing */
    } finally {
      record(state, 'brave', { now });
    }
  }
  lead.socials = found;
}
