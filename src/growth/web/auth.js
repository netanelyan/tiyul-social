import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// The login in front of every page and every button.
//
// WHY, NOW. On the owner's computer the desk answered on 127.0.0.1 only and
// that was the whole of its access control. On the VPS it is reached through
// Caddy at https://desk.tiyulplus.com, and it holds API keys and can publish
// route pages on tiyulplus.com, so nothing in it may answer a stranger.
//
//   - One password, GROWTH_PASSWORD in .env, never printed, never stored
//     anywhere but there. Compared in constant time (both sides hashed first,
//     so their lengths cannot leak).
//   - A session cookie signed with HMAC-SHA256: HttpOnly, SameSite=Strict,
//     Path=/, thirty days, and Secure with the __Host- prefix whenever the
//     request came over HTTPS. The key is GROWTH_SESSION_SECRET, or failing
//     that one derived from the password, so changing either logs everyone out
//     and a restart logs nobody out.
//   - Failed logins are limited: five per address in fifteen minutes, then 429
//     with Retry-After; twenty from anywhere in an hour locks the login for the
//     hour. Every failure waits half a second before it is answered.
//
// The client's address is read from X-Forwarded-For only when the connection
// itself came from Caddy on this machine; anybody else's header is ignored.

const DAY = 86_400_000;
export const SESSION_DAYS = 30;
export const PER_IP = { max: 5, windowMs: 15 * 60_000 };
export const GLOBAL = { max: 20, windowMs: 60 * 60_000 };

const sha = (s) => createHash('sha256').update(String(s)).digest();

/** The login settings from the environment. `on` is false only for a local desk with no password. */
export function authConfig(env = process.env) {
  const password = String(env.GROWTH_PASSWORD || '');
  const publicHost = String(env.GROWTH_PUBLIC_HOST || '').trim().toLowerCase() || null;
  const secret = String(env.GROWTH_SESSION_SECRET || '').trim() || (password ? createHmac('sha256', 'growth-desk-session').update(password).digest('hex') : '');
  return { on: Boolean(password) || Boolean(publicHost), password, publicHost, secret };
}

/** Refuse to start in public without a real password. Returns the problem, or null. */
export function startProblem(env = process.env) {
  const c = authConfig(env);
  if (c.publicHost && c.password.length < 12) return 'GROWTH_PUBLIC_HOST is set, so GROWTH_PASSWORD must be set in .env, at least 12 characters.';
  return null;
}

export const passwordOk = (given, { password }) => Boolean(password) && timingSafeEqual(sha(given), sha(password));

const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');

/** A new session value: version, expiry, signature. */
export function makeSession({ secret }, now = Date.now()) {
  const body = `v1.${now + SESSION_DAYS * DAY}`;
  return `${body}.${sign(body, secret)}`;
}

/** Is this cookie value a session we signed that has not expired? */
export function sessionOk(value, { secret }, now = Date.now()) {
  const m = /^(v1\.(\d+))\.([A-Za-z0-9_-]+)$/.exec(String(value || ''));
  if (!m || !secret) return false;
  const want = Buffer.from(sign(m[1], secret));
  const got = Buffer.from(m[3]);
  return want.length === got.length && timingSafeEqual(want, got) && Number(m[2]) > now;
}

/** Did this request reach us over HTTPS (Caddy says so, and only Caddy may)? */
export const isHttps = (req) => fromProxy(req) && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';

const fromProxy = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);

/** The client's address: the proxy's word for it, or the socket's. */
export function clientIp(req) {
  if (fromProxy(req)) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket?.remoteAddress || 'unknown';
}

export const cookieName = (secure) => (secure ? '__Host-desk' : 'desk');

/** The Set-Cookie header for a session (or for clearing it). */
export function sessionCookie(value, { secure, clear = false } = {}) {
  const parts = [`${cookieName(secure)}=${clear ? '' : value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86_400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** The session value from the request's cookies, under either name. */
export function sessionFrom(req) {
  const jar = Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k, v.join('=')])
  );
  return jar['__Host-desk'] || jar.desk || null;
}

/**
 * The limiter for failed logins. In memory: a restart forgets the counts, and
 * a restart is not something an attacker outside the box can cause.
 */
export function createLimiter({ perIp = PER_IP, global = GLOBAL } = {}) {
  const fails = new Map();
  let all = [];
  let lockedUntil = 0;
  const prune = (list, windowMs, now) => list.filter((t) => now - t < windowMs);
  return {
    /** Null when a login may be tried, else the seconds to wait. */
    check(ip, now = Date.now()) {
      if (lockedUntil > now) return Math.ceil((lockedUntil - now) / 1000);
      const mine = prune(fails.get(ip) || [], perIp.windowMs, now);
      fails.set(ip, mine);
      if (mine.length >= perIp.max) return Math.ceil((perIp.windowMs - (now - mine[0])) / 1000);
      return null;
    },
    fail(ip, now = Date.now()) {
      fails.set(ip, [...prune(fails.get(ip) || [], perIp.windowMs, now), now]);
      all = [...prune(all, global.windowMs, now), now];
      if (all.length >= global.max) lockedUntil = now + global.windowMs;
    },
    succeed(ip) {
      fails.delete(ip);
    },
  };
}
