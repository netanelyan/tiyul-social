import { loadEnv } from '../src/env.js';
import { authMode, currentToken } from '../src/publish/instagram.js';

// Subscribe the account to comment webhooks, and print what it is subscribed to.
//
//   npm run ig-subscribe            show the current subscription
//   npm run ig-subscribe -- --on    subscribe to `comments`
//   npm run ig-subscribe -- --off   unsubscribe entirely
//
// WHY THIS IS A SCRIPT AND NOT A STARTUP CALL. Subscribing is a one-time
// account-level change, the same shape as connecting TikTok: it survives
// restarts, it is not per-post, and doing it on boot would re-issue the same
// write every time the process came up while hiding the one moment anybody
// would want to read the answer. It is also the step most likely to fail for a
// reason that needs a human - a token without the right permissions - and a
// boot-time failure of something optional is a warning nobody reads.
//
// THE SUBSCRIPTION IS ONLY HALF OF IT. This tells Instagram to send comment
// events for this account. Where it sends them is configured in the Meta app
// dashboard (Webhooks -> Instagram -> callback URL and verify token), and that
// half cannot be done through the API. DEPLOY.md has the walkthrough.

loadEnv();

const VER = process.env.IG_API_VERSION || 'v21.0';
const FIELD = 'comments';

const host = authMode() === 'facebook' ? 'https://graph.facebook.com' : 'https://graph.instagram.com';
const id = authMode() === 'facebook' ? process.env.IG_PAGE_ID : process.env.IG_USER_ID;

if (!id) {
  console.error(authMode() === 'facebook' ? 'IG_PAGE_ID is not set' : 'IG_USER_ID is not set');
  process.exit(1);
}
const token = currentToken();
if (!token) {
  console.error('no Instagram token - set IG_ACCESS_TOKEN or connect the account first');
  process.exit(1);
}

const url = `${host}/${VER}/${id}/subscribed_apps`;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

async function call(method, body = null) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const e = json?.error || {};
    // The failure worth naming, because it is the likeliest one and the error
    // text does not explain it: a token minted before the permissions were
    // granted still works for publishing and cannot subscribe.
    const hint =
      e.code === 200 || /permission/i.test(e.message || '')
        ? '\n   the token probably predates the new permissions - regenerate it after granting\n   instagram_business_manage_messages and instagram_business_manage_comments'
        : '';
    console.error(`${method} failed: ${e.message || res.status}${hint}`);
    process.exit(1);
  }
  return json;
}

const arg = process.argv[2] || '';

if (arg === '--on') {
  await call('POST', { subscribed_fields: [FIELD] });
  console.log(`subscribed to "${FIELD}"`);
} else if (arg === '--off') {
  await call('DELETE');
  console.log('unsubscribed');
}

const now = await call('GET');
const apps = now?.data || [];
if (!apps.length) {
  console.log('not subscribed to anything');
} else {
  for (const a of apps) {
    console.log(`${a.name || a.id || 'app'}: ${(a.subscribed_fields || []).join(', ') || '(no fields)'}`);
  }
}
console.log(`\nmode ${authMode()} · ${host}/${VER}/${id}`);
console.log('the callback URL and verify token are set in the Meta app dashboard, not here - see DEPLOY.md');
