import { agencyPage, postJson } from '../../clients/http.js';

// Agencies: Google Places Text Search, then the agency's own website.
//
// One Text Search returns up to twenty businesses. The field mask asks for the
// website and the phone, which makes it an Enterprise request (1,000 a month
// free, $35 per 1,000 after); a week of three agencies a day needs one or two.
//
// The agency's own homepage is then read once, through the shared page fetcher:
// public business contacts only (a mailto, a WhatsApp link, their Instagram and
// Facebook pages), and the words that say who they serve. Nothing is submitted
// and nothing behind a login is touched.

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.websiteUri',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.googleMapsUri',
  'places.businessStatus', 'places.types',
].join(',');

export const placesConfigured = (env = process.env) => Boolean(String(env.GOOGLE_MAPS_KEY || '').trim());

export async function searchAgencies(text, { env = process.env } = {}) {
  const body = await postJson(
    ENDPOINT,
    { textQuery: text, languageCode: 'he', regionCode: 'IL', pageSize: 20 },
    { headers: { 'x-goog-api-key': String(env.GOOGLE_MAPS_KEY || '').trim(), 'x-goog-fieldmask': FIELDS } }
  );
  return (body?.places || []).map((p) => ({
    placeId: p.id,
    name: String(p.displayName?.text || '').trim(),
    address: p.formattedAddress || '',
    website: p.websiteUri || null,
    phone: p.internationalPhoneNumber || p.nationalPhoneNumber || null,
    mapsUrl: p.googleMapsUri || null,
    status: p.businessStatus || null,
    types: p.types || [],
  }));
}

// Who an agency serves, said the way they say it. Matched on the name, the
// Places types and the homepage text; any one is enough for the bonus.
export const KOSHER_WORDS = ['כשר', 'כשרות', 'גלאט', 'שומרי מסורת', 'שומרי שבת', 'דתי', 'דתיים', 'חרדי', 'חרדים', 'חסידי', 'מהדרין', 'בד"ץ', 'kosher', 'glatt', 'orthodox'];

export const kosherHit = (text) => KOSHER_WORDS.find((w) => String(text || '').toLowerCase().includes(w.toLowerCase())) || null;

// Signs that a business sells trips ABROAD. The first live run found a
// Jerusalem walking-tour operator and an organic farm under "טיולים לשומרי
// כשרות": both have a phone and a website, neither has a client flying anywhere.
export const ABROAD_WORDS = ['חו"ל', 'חו״ל', 'לחול', 'בחול', 'טיסות', 'טיסה', 'נסיעות', 'אירופה', 'יעדים', 'מסביב לעולם', 'חבילות נופש', 'abroad', 'flights', 'travel agency', 'worldwide'];

export const abroadHit = (text) => ABROAD_WORDS.find((w) => String(text || '').toLowerCase().includes(w.toLowerCase())) || null;

/** Contacts and socials linked from a homepage's HTML. */
export function contactsFrom(html) {
  const h = String(html || '');
  const first = (re) => re.exec(h)?.[1] || null;
  const email = first(/mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
  const wa =
    first(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send\/?\?phone=)\/?(\+?\d{9,15})/i) ||
    first(/whatsapp:\/\/send\?phone=(\+?\d{9,15})/i);
  const socials = [];
  for (const re of [
    /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})\/?["'?#]/gi,
    /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9.\-]{2,60})\/?["'?#]/gi,
    /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{2,30})\/?["'?#]/gi,
  ]) {
    for (const m of h.matchAll(re)) {
      const handle = m[1];
      if (/^(sharer|share|plugins|tr|dialog|p|reel|explore|login|watch)$/i.test(handle)) continue;
      const url = m[0].replace(/["'?#]$/, '').replace(/\/$/, '');
      if (!socials.includes(url)) socials.push(url);
    }
  }
  return { email, whatsapp: wa, socials: socials.slice(0, 4) };
}

/** Read the homepage once. Never throws: a site that will not load is just less known. */
export async function enrichAgency(agency) {
  const own = `${agency.name} ${agency.types.join(' ')}`;
  const none = { email: null, whatsapp: null, socials: [], kosher: kosherHit(own), abroad: abroadHit(agency.name) };
  if (!agency.website) return { ...none, siteError: null, siteRead: false };
  try {
    const { html, text } = await agencyPage(agency.website);
    const c = contactsFrom(html);
    const body = text.slice(0, 20_000);
    return { ...c, kosher: kosherHit(`${own} ${body}`), abroad: abroadHit(`${agency.name} ${body}`), siteError: null, siteRead: true, snippet: body.slice(0, 1500) };
  } catch (e) {
    return { ...none, siteError: e.message, siteRead: false };
  }
}
