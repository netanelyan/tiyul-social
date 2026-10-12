import { fetchText, htmlToText } from '../fetchPage.js';

// The only way the growth desk (src/growth/) and the trend watcher (src/trends/)
// reach the network. Shared from src/clients/ because the bot may not import the
// desk, and the watcher runs inside the bot.
//
// THE RULE THIS FILE EXISTS FOR: the desk never sends a DM, a comment, a follow
// or a like, on any platform. Not "does not by default", not "only when asked":
// no such call exists. The cheapest way to make that true and keep it true is
// to give every request one door and write down, here, every place the door
// opens onto. A platform write would need a new line in RULES with a POST
// against a social host, and the selftest refuses any such line, and refuses
// any `fetch(` anywhere else in src/growth/, src/trends/ or src/clients/.
//
// The Anthropic SDK makes its own requests, to api.anthropic.com only, and is
// the one exception: it is a text model, not a platform.

// Hosts that are social platforms. Reading from them is limited to the
// endpoints listed below; writing to them is never allowed.
export const SOCIAL = [
  'tiktok.com', 'instagram.com', 'facebook.com', 'fb.com', 'threads.net', 'youtube.com',
  'x.com', 'twitter.com', 'whatsapp.com', 'wa.me', 'linkedin.com', 'telegram.org', 't.me',
];

const onHost = (host, domain) => host === domain || host.endsWith(`.${domain}`);
export const isSocial = (host) => SOCIAL.some((d) => onHost(host, d));

// Every request the desk makes. Method, host (exact, or `suffix` for a CDN
// family), and an optional path pattern. Read top to bottom: nothing here can
// change anything on a platform.
export const RULES = [
  { method: 'GET', host: 'api.search.brave.com', path: /^\/res\/v1\/web\/search$/, why: 'finding posts' },
  { method: 'GET', host: 'www.tiktok.com', path: /^\/oembed$/, why: 'a video title, author and thumbnail' },
  { method: 'GET', suffix: 'tiktokcdn.com', why: 'thumbnails' },
  { method: 'GET', suffix: 'tiktokcdn-us.com', why: 'thumbnails' },
  { method: 'GET', host: 'imgs.search.brave.com', why: 'thumbnails' },
  { method: 'GET', host: 'i.ytimg.com', why: 'thumbnails' },
  // Instagram's official Graph API, Facebook Login side, for the trend watcher:
  // a hashtag's id and top posts, and other accounts' public posts (Business
  // Discovery). Reads only, and nothing on graph.instagram.com.
  { method: 'GET', host: 'graph.facebook.com', path: /^\/v\d+\.\d+\/(ig_hashtag_search|\d+\/(top_media|recently_searched_hashtags)|\d+)$/, why: "Instagram hashtag top posts and other accounts' public posts, read only" },
  { method: 'GET', suffix: 'cdninstagram.com', why: 'thumbnails' },
  { method: 'GET', suffix: 'fbcdn.net', why: 'thumbnails' },
  { method: 'POST', host: 'places.googleapis.com', path: /^\/v1\/places:searchText$/, why: 'finding agencies' },
  { method: 'GET', host: 'www.googleapis.com', path: /^\/youtube\/v3\/(search|channels|videos|commentThreads)$/, why: 'YouTube search and a video\'s top comments, read only' },
  { method: 'POST', host: 'oauth2.googleapis.com', path: /^\/token$/, why: 'a GA4 access token' },
  { method: 'POST', host: 'analyticsdata.googleapis.com', path: /^\/v1beta\/properties\/\d+:runReport$/, why: 'GA4 reports' },
  { method: 'GET', host: 'www.tiyulplus.com', why: 'our own site data' },
  // The only writes to a site of ours: publishing a creator's route on
  // tiyulplus.com under the editor account, and taking it down again.
  { method: 'POST', host: 'www.tiyulplus.com', path: /^\/api\/internal\/trips$/, why: 'publishing a route on our own site' },
  { method: 'DELETE', host: 'www.tiyulplus.com', path: /^\/api\/internal\/trips$/, why: 'withdrawing that route' },
  // A short link for a message, once the site has the endpoint (links.js).
  { method: 'POST', host: 'www.tiyulplus.com', path: /^\/api\/internal\/links$/, why: 'a short link on our own site' },
];

export class HttpError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The rule that allows this request, or a throw. */
export function assertAllowed(method, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(`not a URL: ${url}`, { code: 'refused' });
  }
  const m = String(method || 'GET').toUpperCase();
  if (u.protocol !== 'https:') throw new HttpError(`refused ${m} ${u.protocol}`, { code: 'refused' });
  const host = u.hostname.toLowerCase();
  const rule = RULES.find(
    (r) => r.method === m && (r.host ? host === r.host : onHost(host, r.suffix)) && (!r.path || r.path.test(u.pathname))
  );
  if (!rule) throw new HttpError(`refused: ${m} ${host}${u.pathname} is not on the growth allowlist`, { code: 'refused' });
  return rule;
}

async function send(method, url, { headers = {}, body, timeoutMs = 20_000 } = {}) {
  assertAllowed(method, url);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'user-agent': 'tiyul-plus-growth/0.1 (+https://tiyulplus.com)', ...headers },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new HttpError(e.name === 'TimeoutError' ? 'timed out' : e.message, { code: 'network' });
  }
  return res;
}

async function readJson(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON; the status says enough */
  }
  if (!res.ok) {
    // Google nests the message; our own site answers { error: 'code', ...details }.
    const reason = body?.error?.message || (typeof body?.error === 'string' ? body.error : null) || body?.message || body?.error?.detail || `HTTP ${res.status}`;
    throw Object.assign(new HttpError(String(reason).slice(0, 300), { status: res.status, code: 'http' }), { body });
  }
  return body;
}

export async function getJson(url, opts = {}) {
  return readJson(await send('GET', url, { ...opts, headers: { accept: 'application/json', ...opts.headers } }));
}

export async function postJson(url, payload, opts = {}) {
  return readJson(
    await send('POST', url, {
      ...opts,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...opts.headers },
      body: JSON.stringify(payload),
    })
  );
}

export async function deleteJson(url, opts = {}) {
  return readJson(await send('DELETE', url, { ...opts, headers: { accept: 'application/json', ...opts.headers } }));
}

export async function postForm(url, fields, opts = {}) {
  return readJson(
    await send('POST', url, {
      ...opts,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...opts.headers },
      body: new URLSearchParams(fields).toString(),
    })
  );
}

/** A text body (the site's sitemap), with the status checked. */
export async function getText(url, opts = {}) {
  const res = await send('GET', url, opts);
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, { status: res.status, code: 'http' });
  return res.text();
}

/** An image, as bytes. Thumbnails only, and only from the CDNs above. */
export async function getBytes(url, { maxBytes = 2_000_000, ...opts } = {}) {
  const res = await send('GET', url, opts);
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, { status: res.status, code: 'http' });
  const type = res.headers.get('content-type') || '';
  if (!/^image\//.test(type)) throw new HttpError(`not an image (${type})`, { code: 'type' });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new HttpError(`${buf.length} bytes`, { code: 'too_large' });
  return { buf, type };
}

/**
 * An agency's own public website, as HTML and text.
 *
 * Through the shared page fetcher, which only ever GETs. Refused for any social
 * platform: an agency whose "website" is an Instagram page is recorded as a
 * social link, never fetched.
 */
export async function agencyPage(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError('not a URL', { code: 'refused' });
  }
  if (!/^https?:$/.test(u.protocol) || isSocial(u.hostname.toLowerCase())) {
    throw new HttpError(`refused: ${u.hostname} is a social platform`, { code: 'refused' });
  }
  const { body } = await fetchText(u.href, { timeoutMs: 12_000 });
  return { html: body, text: htmlToText(body) };
}
