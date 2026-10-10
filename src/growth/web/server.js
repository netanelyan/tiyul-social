import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THUMB_DIR } from '../store.js';
import { leadPage, leadsPage, notFoundPage, reportsPage, settingsPage, todayPage } from './pages.js';

// The desk's web server. 127.0.0.1, always.
//
// THE HOST IS NOT CONFIGURABLE, only the port. This is a tool that prepares
// messages to real people from a local file of leads; nothing about it should
// ever answer on a network interface, and a setting that could make it do so
// is a setting someone eventually flips.
//
// TWO CHECKS A LOCAL SERVER NEEDS AND USUALLY LACKS. A page on any website open
// in the same browser can send a POST to 127.0.0.1:4600, and can reach it by
// name through DNS rebinding. Either would let a stranger's page spend the
// budget or mark leads as sent. So:
//   - the Host header must be 127.0.0.1:<port> or localhost:<port>, on every
//     request, which defeats rebinding;
//   - every POST must carry the per-run token the pages embed, as a header a
//     cross-site form cannot set, and a JSON body.
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
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...extra,
  });
  res.end(body);
};

const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');

async function readBody(req, limit = 200_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
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

/**
 * Build the request handler. Exported apart from listen() so the selftest can
 * drive it without a socket where it does not need one.
 */
export function createHandler({ ops, port, token = randomBytes(18).toString('hex') }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  const handler = async (req, res) => {
    try {
      if (!hosts.has(String(req.headers.host || '').toLowerCase())) return send(res, 421, 'wrong host', 'text/plain; charset=utf-8');
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = decodeURIComponent(url.pathname);

      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && !origins.has(origin)) return json(res, 403, { error: 'cross-origin request refused' });
        if (!same(req.headers['x-growth-token'], token)) return json(res, 403, { error: 'missing or wrong token; reload the page' });
        if (!/^application\/json/.test(String(req.headers['content-type'] || ''))) return json(res, 415, { error: 'JSON only' });
        const body = await readBody(req);
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
        return send(res, 200, readFileSync(file), 'image/jpeg', { 'cache-control': 'max-age=86400' });
      }
      if (path === '/api/status') return json(res, 200, ops.status());

      const ctx = { ...ops.context(), token };
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
      const status = e.status || 500;
      if (req.method === 'POST') return json(res, status, { error: e.message });
      return send(res, status, `<pre>${String(e.stack || e.message).replace(/</g, '&lt;')}</pre>`);
    }
  };
  return { handler, token };
}

/** Listen on 127.0.0.1:<port>. Resolves with the server once it is bound. */
export function listen({ ops, port }) {
  // The handler is built after binding, so the Host check knows the real port
  // even when the selftest asks for port 0.
  let inner = null;
  const server = createServer((req, res) => inner(req, res));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      const actual = server.address().port;
      const built = createHandler({ ops, port: actual });
      inner = built.handler;
      resolve({ server, token: built.token, port: actual });
    });
  });
}
