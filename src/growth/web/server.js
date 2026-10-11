import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THUMB_DIR } from '../store.js';
import { authConfig, clientIp, createLimiter, isHttps, makeSession, passwordOk, sessionCookie, sessionFrom, sessionOk } from './auth.js';
import { leadPage, leadsPage, loginPage, notFoundPage, reportsPage, settingsPage, todayPage } from './pages.js';

// The desk's web server. It listens on 127.0.0.1, always.
//
// THE ADDRESS IS NOT CONFIGURABLE, only the port. On the owner's computer that
// is the whole story; on the VPS the desk is reached through Caddy, which holds
// the certificate for desk.tiyulplus.com and passes requests to this port on
// the same machine. Nothing here ever listens on a public interface, and a
// setting that could make it do so is a setting someone eventually flips.
//
// THE CHECKS, IN ORDER:
//   - the Host header must be 127.0.0.1:<port>, localhost:<port> or the public
//     name (GROWTH_PUBLIC_HOST), on every request, which defeats DNS rebinding;
//   - a request under the public name must have come over HTTPS, which only
//     Caddy on this machine can say (auth.js);
//   - every page, thumbnail and button needs a session, except the login page
//     and the stylesheet, whenever a password is set (always on the VPS);
//   - every POST must carry the per-run token the pages embed, as a header a
//     cross-site form cannot set, and a JSON body; the login form is the one
//     POST without it, and it is rate limited instead.
//
// Routing and HTML only. What a button DOES is in `ops`, built by desk.js.

export const HOST = '127.0.0.1';

const STATIC = {
  '/static/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/static/client.js': ['client.js', 'text/javascript; charset=utf-8'],
};

const send = (res, status, body, type = 'text/html; charset=utf-8', extra = {}) => {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    // SAME-ORIGIN, NOT NO-REFERRER. Under no-referrer a browser sends a form post
    // with "Origin: null" (the Fetch standard's rule for a non-CORS request), so
    // the login form's own post was refused as cross-origin and nobody could log
    // in. same-origin still sends nothing to another site, which is what
    // no-referrer was for, and lets the desk's own forms carry their real origin.
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...extra,
  });
  res.end(body);
};

const json = (res, status, obj, extra) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);

async function readRaw(req, limit = 200_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readBody(req) {
  const text = await readRaw(req);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error('not JSON'), { status: 400 });
  }
}

const same = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build the request handler. Exported apart from listen() so the selftest can
 * drive it without a socket where it does not need one.
 */
export function createHandler({ ops, port, token = randomBytes(18).toString('hex'), env = process.env, limiter = createLimiter(), failDelayMs = 500 }) {
  const auth = authConfig(env);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(auth.publicHost ? [auth.publicHost] : [])]);
  // The origins a POST may come from, exactly: the two local ones, and the public
  // name over HTTPS. Anything else is refused, "null" included: a sandboxed frame
  // or a data: page on any site can send that one.
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(auth.publicHost ? [`https://${auth.publicHost}`] : [])]);

  const handler = async (req, res) => {
    try {
      const host = String(req.headers.host || '').toLowerCase();
      if (!hosts.has(host)) return send(res, 421, 'wrong host', 'text/plain; charset=utf-8');
      const secure = isHttps(req);
      if (auth.publicHost && host === auth.publicHost && !secure) return send(res, 403, 'HTTPS only', 'text/plain; charset=utf-8');
      const url = new URL(req.url, `http://${host}`);
      const path = decodeURIComponent(url.pathname);
      const origin = req.headers.origin;
      if (req.method === 'POST' && origin && !origins.has(origin)) return json(res, 403, { error: 'cross-origin request refused' });

      // The login itself: the page, and the form it posts.
      if (path === '/login') {
        if (req.method === 'POST') {
          const ip = clientIp(req);
          const waitS = limiter.check(ip);
          if (waitS) return send(res, 429, loginPage({ error: `Too many wrong passwords. Try again in ${Math.ceil(waitS / 60)} minutes.` }), 'text/html; charset=utf-8', { 'retry-after': String(waitS) });
          const form = new URLSearchParams(await readRaw(req, 4_000));
          if (passwordOk(form.get('password') || '', auth)) {
            limiter.succeed(ip);
            return send(res, 303, '', 'text/plain; charset=utf-8', { location: '/', 'set-cookie': sessionCookie(makeSession(auth), { secure }) });
          }
          limiter.fail(ip);
          await wait(failDelayMs);
          return send(res, 401, loginPage({ error: 'That is not the password.' }));
        }
        return send(res, 200, loginPage({}));
      }
      if (path === '/static/style.css') return send(res, 200, readFileSync(new URL('style.css', import.meta.url)), 'text/css; charset=utf-8');

      // Everything else needs a session.
      if (auth.on && !sessionOk(sessionFrom(req), auth)) {
        if (req.method === 'POST' || path.startsWith('/api/') || path.startsWith('/thumb/')) return json(res, 401, { error: 'Log in first.' });
        return send(res, 302, '', 'text/plain; charset=utf-8', { location: '/login' });
      }

      if (req.method === 'POST') {
        if (!same(req.headers['x-growth-token'], token)) return json(res, 403, { error: 'This page is out of date. Reload it.' });
        if (!/^application\/json/.test(String(req.headers['content-type'] || ''))) return json(res, 415, { error: 'JSON only' });
        const body = await readBody(req);
        if (path === '/logout') return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', { secure, clear: true }) });
        return json(res, 200, await ops.post(path, body));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain; charset=utf-8');

      if (STATIC[path]) {
        const [file, type] = STATIC[path];
        return send(res, 200, readFileSync(new URL(file, import.meta.url)), type);
      }
      if (path.startsWith('/thumb/')) {
        const name = path.slice('/thumb/'.length);
        if (!/^[a-z]+-[A-Za-z0-9_-]+\.jpg$/.test(name)) return send(res, 400, 'bad name', 'text/plain; charset=utf-8');
        const file = join(THUMB_DIR, name);
        if (!existsSync(file)) return send(res, 404, 'no thumbnail', 'text/plain; charset=utf-8');
        return send(res, 200, readFileSync(file), 'image/jpeg', { 'cache-control': 'private, max-age=86400' });
      }
      if (path === '/api/status') return json(res, 200, ops.status());

      const ctx = { ...ops.context(), token, loggedIn: auth.on };
      if (path === '/') return send(res, 200, todayPage({ ...ctx, day: ops.today(), running: ops.status().running }));
      if (path === '/leads') return send(res, 200, leadsPage({ ...ctx, query: Object.fromEntries(url.searchParams) }));
      if (path === '/reports') return send(res, 200, reportsPage({ ...ctx, ga4: await ops.ga4() }));
      if (path === '/settings') return send(res, 200, settingsPage(ctx));
      if (path.startsWith('/lead/')) {
        const lead = ctx.state.leads[path.slice('/lead/'.length)];
        if (lead) return send(res, 200, leadPage({ ...ctx, lead }));
      }
      return send(res, 404, notFoundPage(ctx));
    } catch (e) {
      // The stack goes to the log, never to the page: on the VPS a stack trace
      // is a map of the box for whoever caused it.
      console.error(`[growth] ${req.method} ${req.url}: ${e.stack || e.message}`);
      const status = e.status || 500;
      if (req.method === 'POST') return json(res, status, { error: status === 500 ? 'Something went wrong. It is in the log.' : e.message });
      return send(res, status, status === 500 ? '<p>Something went wrong. It is in the log.</p>' : `<p>${String(e.message).replace(/</g, '&lt;')}</p>`);
    }
  };
  return { handler, token };
}

/** Listen on 127.0.0.1:<port>. Resolves with the server once it is bound. */
export function listen({ ops, port, env = process.env }) {
  // The handler is built after binding, so the Host check knows the real port
  // even when the selftest asks for port 0.
  let inner = null;
  const server = createServer((req, res) => inner(req, res));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      const actual = server.address().port;
      const built = createHandler({ ops, port: actual, env });
      inner = built.handler;
      resolve({ server, token: built.token, port: actual });
    });
  });
}
