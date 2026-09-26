import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readUsers, configured, checkLogin, signSession, readSession,
  createThrottle, cookieFor, readCookie, SESSION_HOURS,
} from './auth.js';

// The admin site: the same decisions the Telegram bot offers, in a browser.
//
// IN THE BOT'S OWN PROCESS, AND THAT IS THE WHOLE ARCHITECTURE.
//
// It is tempting to make this a separate service — it is a web server, it has
// nothing to do with Telegram, and separate processes are the usual advice. It
// would also be broken, quietly, in a way nobody would find for weeks. The store
// is held entirely in memory and saved entirely on every write (see the note at
// the top of src/store.js, and scripts/redraw.js, which exists because of this).
// A second process holding its own copy would save a snapshot it read a minute
// ago and silently revert every decision the bot made in between. Two writers,
// one file, last write wins.
//
// So there is one process, one store object, and one implementation of each
// action — bot.js passes them in as `ops`. This file does routing, auth and
// JSON, and it knows nothing about what approving a card means.
//
// IT DOES NOT IMPORT bot.js, deliberately. bot.js launches a Telegram bot as a
// side effect of being imported, so anything importing it cannot be tested and
// cannot be run twice. The dependency points the other way: bot.js builds the
// `ops` object and hands it here.
//
// TLS IS CADDY'S JOB. This binds to 127.0.0.1 by default and Caddy reverse-
// proxies to it, which is how cards.tiyulplus.com already works. Nothing here
// should ever be exposed to the internet directly.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// A PATH, not a URL. `resolve` takes strings, and an import.meta.url-derived URL
// object silently becomes "[object URL]" or throws depending on the Node version
// — the traversal guard is built on resolve, so this is load-bearing rather than
// a style choice.
const UI_DIR = fileURLToPath(new URL('../../public/admin/', import.meta.url));

/**
 * Recent console output, for admins who cannot read pm2 logs.
 *
 * A ring buffer over console.log and console.error. Patching a global is not
 * something to do lightly, and the case for it is that the single most useful
 * thing when a post does not appear is the line the bot printed about it — and
 * "ssh in and read pm2 logs" is exactly the capability an admin who is not the
 * owner does not have. That is most of why the site was asked for.
 *
 * The original functions are still called, so pm2 sees everything it saw before.
 */
export function createLogTap({ keep = 300 } = {}) {
  const lines = [];
  const push = (level, args) => {
    const text = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : safeJson(a)))
      .join(' ');
    lines.push({ at: Date.now(), level, text });
    if (lines.length > keep) lines.splice(0, lines.length - keep);
  };
  const real = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...a) => { push('log', a); real.log(...a); };
  console.error = (...a) => { push('error', a); real.error(...a); };
  console.warn = (...a) => { push('warn', a); real.warn(...a); };
  return {
    lines: () => lines.slice(),
    restore() { Object.assign(console, real); },
  };
}

const safeJson = (v) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    // Nothing here is cacheable and some of it is a decision queue.
    'cache-control': 'no-store',
    // A browser should never be guessing at content types on an admin panel.
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const json = (res, body, headers) => send(res, 200, body, headers);
const fail = (res, code, said) => send(res, code, { ok: false, said });

/** The client's address, honouring one proxy hop, because Caddy is in front. */
function clientIp(req, { trustProxy }) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

/** Read a JSON body, bounded. An admin request is never large. */
async function readJson(req, { limit = 64 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('body is not JSON');
  }
}

/**
 * Serve one file out of a directory, with no way to leave it.
 *
 * The check is on the RESOLVED path rather than on the requested string. Testing
 * the string for ".." is the version everybody writes and it misses url-encoded
 * traversal, backslashes on Windows and symlinks; resolving first and then asking
 * "is this still inside" is the only form that answers the actual question.
 */
function serveFile(res, dir, name) {
  const root = resolve(dir);
  const path = resolve(root, name);
  if (path !== root && !path.startsWith(root + sep)) return fail(res, 403, 'outside the directory');
  if (!existsSync(path) || !statSync(path).isFile()) return fail(res, 404, 'not found');

  const type = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': statSync(path).size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(path).pipe(res);
}

/**
 * Start the admin site, or do not.
 *
 * Returns null when ADMIN_USERS is unset, and says so on stdout. That is the
 * documented way to keep the site off, and returning null rather than throwing
 * means the bot starts normally on a box that has never been configured for it.
 *
 * `ops` is everything this can do, supplied by bot.js. See the note at the top.
 */
export function startAdminServer(ops, {
  port = Number(process.env.ADMIN_PORT || 8787),
  host = process.env.ADMIN_BIND || '127.0.0.1',
  secureCookies = process.env.ADMIN_INSECURE_COOKIES !== '1',
  users = readUsers(),
  log = null,
} = {}) {
  if (!configured(users)) {
    console.log('admin site: off (ADMIN_USERS is not set)');
    return null;
  }

  const throttle = createThrottle();
  // Trusted only when bound to localhost, where the only thing that can reach us
  // IS the proxy. Bound to a public address, X-Forwarded-For is attacker-supplied
  // and trusting it would let one address wear a new name on every guess — which
  // turns the login throttle off completely.
  const trustProxy = host === '127.0.0.1' || host === '::1' || host === 'localhost';

  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (e) {
      console.error(`admin: ${req.method} ${req.url} - ${e?.stack || e}`);
      if (!res.headersSent) fail(res, 500, e?.message || 'server error');
    }
  });

  async function route(req, res) {
    const url = new URL(req.url, 'http://admin.local');
    const path = url.pathname;
    const ip = clientIp(req, { trustProxy });

    // --- login, the only unauthenticated route that does anything ------------
    if (path === '/api/login' && req.method === 'POST') {
      const wait = throttle.delayFor(ip);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const body = await readJson(req).catch(() => ({}));
      if (!checkLogin(body.name, body.password, users)) {
        const n = throttle.fail(ip);
        console.log(`admin: failed login as "${String(body.name || '').slice(0, 32)}" from ${ip} (${n})`);
        return fail(res, 401, 'שם או סיסמה שגויים');
      }
      throttle.pass(ip);
      const name = String(body.name).trim();
      console.log(`admin: ${name} signed in from ${ip}`);
      return json(res, { ok: true, me: name, hours: SESSION_HOURS },
        { 'set-cookie': cookieFor(signSession(name), { secure: secureCookies }) });
    }

    if (path === '/api/logout' && req.method === 'POST') {
      return json(res, { ok: true }, { 'set-cookie': cookieFor('', { secure: secureCookies }) });
    }

    // --- the UI itself, which is public because it is just a login form ------
    if (!path.startsWith('/api/')) {
      const name = path === '/' || path === '' ? 'index.html' : path.slice(1);
      return serveFile(res, UI_DIR, name);
    }

    // --- everything below needs a session ------------------------------------
    const me = readSession(readCookie(req.headers.cookie));
    if (!me) return fail(res, 401, 'not signed in');
    // The name could have been removed from ADMIN_USERS since the cookie was
    // signed. Checked on every request rather than at login, because taking
    // somebody's access away should not wait for their session to expire.
    if (!users.has(me)) return fail(res, 401, 'no longer an admin');

    // CSRF: a cross-site form post cannot set this header, and SameSite=Strict
    // means the cookie would not be sent anyway. Belt and braces, because the
    // cost is one line and the failure mode is somebody else publishing.
    if (req.method !== 'GET' && req.headers['x-tiyul-admin'] !== '1') {
      return fail(res, 403, 'missing x-tiyul-admin header');
    }

    if (path === '/api/state' && req.method === 'GET') {
      return json(res, { ok: true, me, ...(await ops.state()) });
    }

    if (path === '/api/log' && req.method === 'GET') {
      return json(res, { ok: true, lines: log ? log.lines() : [] });
    }

    // Media for the UI, served from here rather than from the public card host.
    //
    // Two reasons, and the second is the one that matters: CARD_PUBLIC_BASE_URL
    // may not be set at all, and a draft nobody has approved should not need a
    // public URL to be looked at. A basename only — see serveFile.
    if (path === '/api/media' && req.method === 'GET') {
      const file = basename(url.searchParams.get('file') || '');
      if (!file) return fail(res, 400, 'no file');
      return serveFile(res, ops.mediaDir(), file);
    }

    const staged = /^\/api\/staging\/([^/]+)\/(approve|reject|privacy|headline|evidence)$/.exec(path);
    if (staged) {
      const [, key, what] = staged;
      const who = { by: me };
      if (what === 'evidence' && req.method === 'GET') return json(res, await ops.evidence(key));
      if (what === 'approve' && req.method === 'POST') return json(res, await ops.approve(key, who));
      if (what === 'reject' && req.method === 'POST') return json(res, await ops.reject(key, who));
      if (what === 'privacy' && req.method === 'POST') return json(res, await ops.privacy(key, who));
      if (what === 'headline' && req.method === 'POST') {
        const body = await readJson(req);
        return json(res, await ops.retitle(key, body.headline, who));
      }
      return fail(res, 405, 'wrong method');
    }

    const proposal = /^\/api\/proposals\/([^/]+)\/(build|reject)$/.exec(path);
    if (proposal && req.method === 'POST') {
      const [, key, what] = proposal;
      const body = await readJson(req).catch(() => ({}));
      return json(res, what === 'build'
        ? await ops.buildProposal(key, body.targets, { by: me })
        : await ops.rejectProposal(key, { by: me }));
    }

    if (path === '/api/queue/publish' && req.method === 'POST') {
      const body = await readJson(req).catch(() => ({}));
      return json(res, await ops.publish(body.n ?? null, { by: me }));
    }
    if (path === '/api/queue/draft' && req.method === 'POST') {
      const body = await readJson(req).catch(() => ({}));
      return json(res, await ops.draft(body.n, { by: me }));
    }
    if (path === '/api/held/retry' && req.method === 'POST') {
      return json(res, await ops.retryHeld({ by: me }));
    }
    if (path === '/api/held/clear' && req.method === 'POST') {
      return json(res, await ops.clearHeld({ by: me }));
    }
    if (path === '/api/build' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, await ops.build(body, { by: me }));
    }

    return fail(res, 404, 'no such route');
  }

  server.listen(port, host, () => {
    console.log(`admin site: http://${host}:${port} · ${users.size} admin(s): ${[...users.keys()].join(', ')}`);
  });
  server.on('error', (e) => console.error(`admin site: ${e.message}`));
  return server;
}

/** Is the UI on disk? Checked at boot so a missing page is not a 404 at login. */
export function uiPresent() {
  try {
    return readFileSync(resolve(UI_DIR, 'index.html'), 'utf8').length > 0;
  } catch {
    return false;
  }
}
