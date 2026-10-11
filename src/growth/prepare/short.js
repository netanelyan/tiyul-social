import { postJson } from '../../clients/http.js';
import { plainLink, SITE } from '../links.js';
import { publishingConfigured } from './publish.js';

// The link a person sees in a message: short, or plain, never a tail of tags.
//
// THE OWNER'S POINT, 2026-10-11: WhatsApp shows a link in full, and
// "?utm_source=agency&utm_medium=whatsapp&utm_campaign=roniellatours.com" on the
// end of it looks like spam. The site's /t/<code> links are its shared-trip
// viewer and cannot carry attribution, so a short link needs a small change on
// tiyulplus.com: a /go/<code> redirect that adds the tags on our side, and an
// internal endpoint that makes one (the exact change is in README.md, "Short
// links"). The desk is not allowed to make it.
//
// Until the site has it, every message carries the plain page link, no tags,
// and GA4 cannot tie those visits to a lead. The desk asks the endpoint once
// for each link; a 404 is remembered for a day, so the day the site ships it
// the desk switches over by itself.

const ENDPOINT = `${SITE}/api/internal/links`;
const DAY = 86_400_000;

const MEDIUM = { creator: 'dm', agency: 'whatsapp', customer: 'comment' };

/**
 * The link to show for `url`, stored on the lead: a short one when the site
 * makes them, else the plain page link. Never throws.
 */
export async function shortLinkFor(state, lead, url, { env = process.env, post = postJson, now = Date.now(), campaign } = {}) {
  if (!url) return null;
  const plain = plainLink(url);
  lead.links ??= {};
  if (lead.links[plain]?.short) return lead.links[plain].short;
  const missingAt = Date.parse(state.site?.shortLinksMissingAt || 0);
  if (!publishingConfigured(env) || now - missingAt < DAY) return plain;
  try {
    const u = new URL(url, SITE);
    const res = await post(
      ENDPOINT,
      { target: u.pathname, utm_source: lead.type, utm_medium: MEDIUM[lead.type] || 'dm', utm_campaign: campaign },
      { headers: { authorization: `Bearer ${String(env.GROWTH_PUBLISH_TOKEN).trim()}` }, timeoutMs: 15_000 }
    );
    if (res?.url) {
      lead.links[plain] = { short: res.url, at: new Date(now).toISOString() };
      return res.url;
    }
  } catch (e) {
    if (e.status === 404 || e.status === 405) (state.site ??= {}).shortLinksMissingAt = new Date(now).toISOString();
  }
  return plain;
}
