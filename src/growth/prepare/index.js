import { siteSlugFor } from '../../plan/site.js';
import { braveConfigured, braveSearch } from '../../clients/brave.js';
import { destinations } from '../find/queries.js';
import { fillVideoContext } from '../find/videoContext.js';
import { BudgetError, guard, marginal, record } from '../../clients/budget.js';
import { claudeConfigured } from '../claude.js';
import { itineraryPath } from '../links.js';
import { ilDate, itemDone, parseItem, pickToday } from '../rules.js';
import { chooseExample, extractProfile, readAgencySite } from './agencyProfile.js';
import { draftItem } from './draft.js';
import { targetFor } from './compose.js';
import { examplesFor } from './learn.js';
import { canPublishNew, publishRoute } from './publish.js';
import { shortLinkFor } from './short.js';
import { campaignFor } from '../links.js';
import { buildRoute } from './route.js';
import { cityFor, siteContext } from './site.js';

// Preparing what Today shows: only today's picks, only what is missing.
//
// Drafting costs money, so it happens for the items inside the caps and for
// nothing else. A lead that is found and never picked costs one classification
// and no draft. The same holds for the two new reads: a video's description and
// comments, and an agency's own site, are read only for what is on Today.
//
// TWO THINGS GO PUBLIC HERE, AND NOWHERE ELSE: a creator's route, the day they
// reach the Creators column, and an agency's sample route, the day it is picked
// for a message. Both go through the site's trips endpoint, and both count
// against the one daily limit the site sets for new pages (canPublishNew).

export const DEFAULT_DEPS = {
  cityFor,
  draftItem,
  publishRoute,
  brave: braveSearch,
  fillVideoContext,
  readAgencySite,
  extractProfile,
  shortLink: shortLinkFor,
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

/** Publish a lead's route, inside the daily limit. Returns the trip state. */
async function publishWithin({ state, settings, lead, now, deps, env, report }) {
  if (lead.trip?.status === 'published' || !retryPublish(lead.trip, now)) return lead.trip;
  if (!canPublishNew(state, settings, now)) {
    return {
      status: 'waiting-limit',
      reason: `The site takes ${settings.publishPerDay} new route pages a day and today's are used. This one goes up on a later pass.`,
    };
  }
  const trip = await deps.publishRoute(lead, { env, now });
  if (trip.status === 'published') report.published = (report.published || 0) + 1;
  return trip;
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

  const items = [...day.comment, ...day.creator, ...day.agency, ...day.customer].filter((k) => !itemDone(state, k));

  // The videos' descriptions and top comments, for every video today's items
  // will write about, in one batch.
  const videos = [];
  for (const key of items) {
    const { col, leadId, what } = parseItem(key);
    const lead = state.leads[leadId];
    if (!lead) continue;
    if (col === 'comment') videos.push(...lead.posts.filter((p) => p.id === what));
    if (col === 'creator' && what === 'dm') videos.push(lead.posts.find((p) => p.status === 'commented') || lead.posts[0]);
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
        // The DM is about the video that was commented on, so its destination
        // decides the route and the destination in the message.
        const post = lead.posts.find((p) => p.status === 'commented') || lead.posts[0];
        if (post?.dest) lead.dest = post.dest;
        const c = await city(lead.dest?.slug);
        if (!lead.route && c) lead.route = buildRoute(c, { places: post?.places, days: post?.days });
        lead.trip = await publishWithin({ state, settings, lead, now, deps, env, report });
        await linkUp({ state, lead, what: 'dm', deps, env, now });
        if (!lead.drafts?.dm?.variants?.length && canDraft && post) {
          lead.drafts = {
            ...lead.drafts,
            dm: await deps.draftItem('creator', { state, settings, lead, post, site: siteContext(c), extra: { route: lead.route, offer: settings.offers.creator }, examples: examplesFor(state, 'creator') }),
          };
          report.drafted++;
        }
      } else if (col === 'agency' && what === 'message') {
        await prepareAgency({ state, settings, lead, now, deps, env, report, city, canDraft });
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
 * One agency, ready to message: who they are, the example, the route on our
 * site when they sell a city we cover, and the drafts.
 */
async function prepareAgency({ state, settings, lead, now, deps, env, report, city, canDraft }) {
  if (!lead.profile && canDraft) {
    let site = { text: '' };
    try {
      site = await deps.readAgencySite(lead);
    } catch (e) {
      lead.siteError = e.message;
    }
    lead.profile = await deps.extractProfile({ state, settings, lead, siteText: site.text, now });
  }
  if (!lead.example) lead.example = chooseExample(state, lead, { fallback: agencySample });
  const ex = lead.example;
  let c = null;
  if (ex?.kind === 'route') {
    // An agency drafted before this read had a rotation page; the route replaces it.
    delete lead.agencyDest;
    c = await city(ex.slug);
    if (!lead.route && c) lead.route = buildRoute(c, {});
    lead.trip = await publishWithin({ state, settings, lead, now, deps, env, report });
  } else if (ex?.kind === 'page') {
    lead.agencyDest = { slug: ex.slug, he: ex.he, path: ex.path };
    c = await city(ex.slug);
  }
  await linkUp({ state, lead, what: 'message', deps, env, now });
  if (!lead.socials?.length && !lead.socialsLooked && braveConfigured(env)) await findSocials({ state, settings, lead, now, deps, env });
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
