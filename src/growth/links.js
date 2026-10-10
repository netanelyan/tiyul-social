// Every link the desk puts in front of anybody, and the tags on it.
//
// One builder, so "UTM tags are on every link" is a property of this file
// rather than of every call site remembering. utm_source says which kind of
// lead (creator, agency, customer), utm_medium how it reached them, and
// utm_campaign who: the creator's handle, the agency's website or place, the
// customer's post. The Reports page joins GA4's sessionCampaignName back to
// leads on exactly that value.

export const SITE = (process.env.TIYULPLUS_BASE || 'https://www.tiyulplus.com').replace(/\/$/, '');

const MEDIUM = { creator: 'dm', agency: 'whatsapp', customer: 'comment' };

/** A campaign value: lowercase, URL-safe, recognisable in a GA4 table. */
export function campaignFor(lead) {
  const clean = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/^@/, '')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  if (lead.type === 'creator') return clean(lead.handle) || clean(lead.id);
  if (lead.type === 'agency') {
    try {
      if (lead.website) return clean(new URL(lead.website).hostname.replace(/^www\./, ''));
    } catch {
      /* fall through to the place id */
    }
    return `place-${clean(String(lead.placeId || lead.id).slice(-10))}`;
  }
  const post = (lead.posts || [])[0];
  return `post-${clean(post?.platform || 'x')}-${clean(post?.id || lead.id)}`;
}

/** `url` with the three tags set for this lead, replacing any already there. */
export function tagged(url, lead, { medium } = {}) {
  const u = new URL(url, SITE);
  u.searchParams.set('utm_source', lead.type);
  u.searchParams.set('utm_medium', medium || MEDIUM[lead.type] || 'dm');
  u.searchParams.set('utm_campaign', campaignFor(lead));
  return u.toString();
}

export const hasUtm = (url) => {
  try {
    const p = new URL(url).searchParams;
    return Boolean(p.get('utm_source') && p.get('utm_medium') && p.get('utm_campaign'));
  } catch {
    return false;
  }
};

/** Is this a link to our own site? */
export const isOurs = (url) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'tiyulplus.com' || h.endsWith('.tiyulplus.com');
  } catch {
    return false;
  }
};

/** The itinerary page closest to `days` for a slug, from the sitemap list. */
export function itineraryPath(itineraries, slug, days = 5) {
  const mine = (itineraries || []).filter((x) => x.slug === slug);
  if (!mine.length) return null;
  mine.sort((a, b) => Math.abs(a.days - days) - Math.abs(b.days - days) || b.days - a.days);
  return `/itinerary/${slug}/${mine[0].days}`;
}

/** The page a customer or agency is sent to for a destination. */
export function destinationPage(itineraries, slug, days) {
  return itineraryPath(itineraries, slug, days) || `/destinations/${slug}`;
}

/**
 * Where [העתק ופתח] goes: the person's profile, their WhatsApp, or the post.
 *
 * Never a link with the message in it. The message goes to the clipboard and
 * the owner pastes and sends it, which is the whole contract.
 */
export function openTarget(lead, what) {
  if (lead.type === 'customer' || what === 'comment') {
    return (lead.posts || []).find((p) => p.status === 'open')?.url || lead.posts?.[0]?.url || lead.profileUrl || null;
  }
  if (lead.type === 'agency') {
    const wa = lead.whatsapp || (isMobile(lead.phone) ? lead.phone : null);
    if (wa) return `https://wa.me/${toIntl(wa)}`;
    if (lead.email) return `mailto:${lead.email}`;
    return lead.website || lead.mapsUrl || null;
  }
  return lead.profileUrl || lead.posts?.[0]?.url || null;
}

const digits = (s) => String(s || '').replace(/\D/g, '');

/** An Israeli number in international form, digits only: 972501234567. */
export function toIntl(phone) {
  let d = digits(phone);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `972${d.slice(1)}`;
  return d;
}

/** Israeli mobile numbers are 05x; only those are worth a WhatsApp link by default. */
export const isMobile = (phone) => /^9725\d{8}$/.test(toIntl(phone));
