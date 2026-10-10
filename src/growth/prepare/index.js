import { siteSlugFor } from '../../plan/site.js';
import { braveConfigured, braveSearch } from '../find/brave.js';
import { destinations } from '../find/queries.js';
import { BudgetError, guard, marginal, record } from '../budget.js';
import { claudeConfigured } from '../claude.js';
import { itineraryPath } from '../links.js';
import { ilDate, itemDone, parseItem, pickToday } from '../rules.js';
import { draftComments, draftCreatorLine, draftCustomerReply } from './draft.js';
import { publishRoute } from './publish.js';
import { buildRoute } from './route.js';
import { cityFor, siteContext } from './site.js';

// Preparing what Today shows: only today's picks, only what is missing.
//
// Drafting costs money, so it happens for the items inside the caps and for
// nothing else. A lead that is found and never picked costs one classification
// and no draft.

export const DEFAULT_DEPS = { cityFor, draftComments, draftCreatorLine, draftCustomerReply, publishRoute, brave: braveSearch };

let running = null;

/** Single-flight: a second call while one is running waits for the same one. */
export function prepareToday(args) {
  running ??= doPrepare(args).finally(() => {
    running = null;
  });
  return running;
}

async function doPrepare({ store, settings, now = Date.now(), deps = DEFAULT_DEPS, env = process.env }) {
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
  for (const key of items) {
    const { col, leadId, what } = parseItem(key);
    const lead = state.leads[leadId];
    if (!lead) continue;
    try {
      if (col === 'comment') {
        const post = lead.posts.find((p) => p.id === what);
        if (!post || post.drafts?.comments?.length || !canDraft) continue;
        // The video's own destination, which is not always the one the creator
        // was first found for.
        const c = await city(post.dest?.slug || lead.dest?.slug);
        post.drafts = { ...post.drafts, comments: await deps.draftComments({ state, settings, lead, post, context: siteContext(c) }), at: new Date(now).toISOString() };
        delete post.draftError;
        report.drafted++;
      } else if (col === 'creator' && what === 'dm') {
        // The DM is about the video that was commented on, so its destination
        // decides the route and the [יעד] in the message.
        const post = lead.posts.find((p) => p.status === 'commented') || lead.posts[0];
        if (post?.dest) lead.dest = post.dest;
        const c = await city(lead.dest?.slug);
        if (!lead.route && c) lead.route = buildRoute(c, { places: post?.places, days: post?.days });
        // Shown today, so this is the moment the route goes public, and the only
        // place in the desk that publishes. A failed attempt is retried at most
        // once an hour, so a refusal the site will repeat is not hammered.
        const retry = lead.trip?.status === 'failed' && now - Date.parse(lead.trip.failedAt || 0) > 3_600_000;
        if (!lead.trip || ['waiting-for-site', 'no-route'].includes(lead.trip.status) || retry) {
          lead.trip = await deps.publishRoute(lead, { env, now });
          report.published = (report.published || 0) + (lead.trip.status === 'published' ? 1 : 0);
        }
        if (!lead.drafts?.dm && canDraft && post) {
          lead.drafts = { ...lead.drafts, dm: await deps.draftCreatorLine({ state, settings, lead, post }) };
          report.drafted++;
        }
      } else if (col === 'agency' && what === 'message') {
        if (!lead.agencyDest) lead.agencyDest = agencySample(state, lead);
        if (!lead.socials?.length && !lead.socialsLooked && braveConfigured(env)) await findSocials({ state, settings, lead, now, deps, env });
      } else if (col === 'customer') {
        const post = lead.posts[0];
        if (lead.drafts?.reply || !canDraft || !post) continue;
        const c = await city(lead.dest?.slug);
        lead.drafts = { ...lead.drafts, reply: await deps.draftCustomerReply({ state, settings, lead, post, context: siteContext(c) }) };
        report.drafted++;
      }
      delete lead.draftError;
    } catch (e) {
      if (e instanceof BudgetError) {
        report.stopped = 'budget';
        break;
      }
      report.failed++;
      const msg = e.problems?.length ? `${e.message}` : e.message;
      if (col === 'comment') {
        const post = lead.posts.find((p) => p.id === what);
        if (post) post.draftError = msg;
      } else {
        lead.draftError = msg;
      }
    }
  }
  store.save();
  return { date: ilDate(now), ...report };
}

/**
 * The agency's sample: one of the site's live itinerary pages.
 *
 * From the destinations this audience actually flies to, in destinations.json's
 * order, first eight that have a live page: an agency shown "שווייץ הבוהמית" (the
 * first live run did exactly that) learns nothing about whether the tool fits
 * the trips it sells. The choice rotates by the lead's id, so three agencies on
 * one day do not all get Athens.
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
