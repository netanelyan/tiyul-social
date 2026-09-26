import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Who may use the admin site, and how a browser proves it is one of them.
//
// THE SITE IS OFF UNLESS ADMIN_USERS IS SET. Not "off by a flag" — there is no
// flag. An admin site with no configured users is a login page with no valid
// password, which is a door rather than a wall, and the one thing this must not
// be is a second way in that nobody remembered to lock. No users, no listener.
//
// ONE PASSWORD PER PERSON, not one shared secret. The owner asked for "me and
// admins", and the difference between those two shows up the moment something
// is approved: a card that left the queue should say who decided, and a shared
// password makes that unanswerable. It also makes removing one person mean
// telling everybody else a new password, which is how a password stops being
// changed at all.
//
// Passwords are compared in constant time and never logged. They are plaintext
// in .env, which is a real limitation and a deliberate one: hashing them would
// need a way to generate the hashes, and a setup step nobody can perform on a
// phone is a setup step that ends in one password for everyone. The file is
// gitignored, it is on a box only these people can reach, and the passwords
// guard a posting queue rather than a bank.

/** `name:password,name2:password2` — see the note above. */
export function readUsers(raw = process.env.ADMIN_USERS) {
  const out = new Map();
  for (const pair of String(raw || '').split(',')) {
    const at = pair.indexOf(':');
    if (at < 1) continue;
    const name = pair.slice(0, at).trim();
    const password = pair.slice(at + 1);
    // A blank password would authenticate anybody who guessed the name, and a
    // typo in the env is the likeliest way to write one. Dropped rather than
    // accepted, and the caller reports how many survived so a dropped entry is
    // visible at startup instead of at the first login attempt.
    if (name && password) out.set(name, password);
  }
  return out;
}

export const configured = (users = readUsers()) => users.size > 0;

/**
 * The key sessions are signed with.
 *
 * ADMIN_SECRET when set. Otherwise derived from the bot token, which is already
 * the most sensitive string on the box and is already required for anything to
 * run — so the derived key is as strong as the weakest thing an attacker would
 * need anyway, and there is one fewer secret to lose.
 *
 * Derived rather than used directly, so a leaked session cookie cannot be
 * walked back to the bot token by anybody who knows this file exists.
 *
 * Random when neither is set, which only happens in a test: sessions then die
 * on restart, which is the safe direction for a key nobody chose.
 */
export function sessionKey() {
  if (process.env.ADMIN_SECRET) return Buffer.from(process.env.ADMIN_SECRET);
  if (process.env.TG_BOT_TOKEN) {
    return createHmac('sha256', 'tiyul-admin-session').update(process.env.TG_BOT_TOKEN).digest();
  }
  return randomBytes(32);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

/** How long a login lasts. Long enough not to be a nuisance, short enough to expire. */
export const SESSION_HOURS = Math.max(1, Number(process.env.ADMIN_SESSION_HOURS || 72));

/**
 * A signed session token: name, expiry, and an HMAC over both.
 *
 * Self-contained rather than a server-side session table, because the bot
 * restarts — on every deploy, and on purpose — and a table in memory logs
 * everybody out each time. A restart should not be a security event.
 *
 * The expiry is INSIDE the signed payload. A cookie's own Max-Age is a request
 * to the browser and nothing more; a client that ignores it would otherwise
 * hold a session forever.
 */
export function signSession(name, { now = Date.now(), key = sessionKey(), hours = SESSION_HOURS } = {}) {
  const body = `${b64(name)}.${now + hours * 3_600_000}`;
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}

/** The name in a valid, unexpired token, or null. Never throws on junk input. */
export function readSession(token, { now = Date.now(), key = sessionKey() } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [name64, expiry, sig] = parts;
  const want = createHmac('sha256', key).update(`${name64}.${expiry}`).digest('base64url');
  if (!safeEqual(sig, want)) return null;
  if (!(Number(expiry) > now)) return null;
  try {
    return unb64(name64) || null;
  } catch {
    return null;
  }
}

/** Constant-time compare that does not leak length through an early return. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  // timingSafeEqual throws on a length mismatch, which would itself be a timing
  // signal. Both sides are hashed to a fixed width first, so every comparison
  // costs the same regardless of what was sent.
  const hx = createHmac('sha256', 'cmp').update(x).digest();
  const hy = createHmac('sha256', 'cmp').update(y).digest();
  return timingSafeEqual(hx, hy);
}

/**
 * Wrong passwords, counted per address, with a delay that grows.
 *
 * Not a lockout. A lockout on a site with a handful of users is a denial of
 * service anybody can trigger on the owner's behalf by guessing wrong five
 * times. A delay costs an attacker everything and costs somebody who fat-
 * fingered their password a few seconds.
 *
 * In memory on purpose: a restart clearing it is fine, because the thing being
 * slowed down is an online guessing run, and an attacker cannot restart the bot.
 */
export function createThrottle({ base = 400, max = 20_000, forget = 15 * 60_000 } = {}) {
  const fails = new Map();

  const prune = (now) => {
    for (const [ip, rec] of fails) if (now - rec.at > forget) fails.delete(ip);
  };

  return {
    /** How long this address must wait before its next attempt is even read. */
    delayFor(ip, now = Date.now()) {
      prune(now);
      const rec = fails.get(ip);
      if (!rec) return 0;
      return Math.min(max, base * 2 ** (rec.n - 1));
    },
    fail(ip, now = Date.now()) {
      const rec = fails.get(ip) || { n: 0, at: now };
      rec.n += 1;
      rec.at = now;
      fails.set(ip, rec);
      return rec.n;
    },
    pass(ip) {
      fails.delete(ip);
    },
    get size() {
      return fails.size;
    },
  };
}

/**
 * Check a name and password against the configured users.
 *
 * An unknown NAME is compared anyway, against a value that cannot match, so a
 * name that exists and a name that does not take the same time to reject. Free
 * to do, and the alternative hands out a list of who the admins are.
 */
export function checkLogin(name, password, users = readUsers()) {
  const stored = users.get(String(name || '').trim());
  const ok = safeEqual(password, stored ?? randomBytes(32).toString('hex'));
  return ok && stored !== undefined;
}

export const COOKIE = 'tiyul_admin';

/** The Set-Cookie line for a session, or for clearing one. */
export function cookieFor(token, { secure = true, hours = SESSION_HOURS } = {}) {
  const bits = [
    `${COOKIE}=${token || ''}`,
    'Path=/',
    'HttpOnly',
    // Strict, not Lax. Nothing here is meant to be reachable by following a link
    // from somewhere else, and Strict is most of a CSRF defence on its own — the
    // custom-header check in the server is the rest of it.
    'SameSite=Strict',
    `Max-Age=${token ? Math.round(hours * 3600) : 0}`,
  ];
  // Caddy terminates TLS in front of this, so the browser always speaks https.
  // Off only for a local run over plain http, where a Secure cookie is simply
  // never sent back and the site appears to reject every correct password.
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/** The one cookie we care about, out of a request's Cookie header. */
export function readCookie(header, name = COOKIE) {
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}
