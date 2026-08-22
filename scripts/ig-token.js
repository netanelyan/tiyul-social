import { loadEnv } from '../src/env.js';
loadEnv();

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as store from '../src/store.js';

// Turns the 1-hour token from the App Dashboard into the two values .env needs,
// and seeds the refresh clock so the bot can keep it alive afterwards.
//
// Supports both auth paths. The default (Instagram Login) is the one worth
// using: no Facebook Page, no permissions dropdown, no Graph API Explorer —
// just a "Generate token" button in the dashboard.
//
//   npm run ig-token
//
// Reads its inputs interactively, so the app secret never lands in shell
// history, and prints only what you need to paste.

const IG_HOST = 'https://graph.instagram.com';
const FB_HOST = 'https://graph.facebook.com';
const V = process.env.GRAPH_API_VERSION || 'v21.0';

async function get(host, path, params, { versioned = true } = {}) {
  const url = `${host}${versioned ? `/${V}` : ''}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`${e.message || `HTTP ${res.status}`}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return json;
}

const line = () => console.log('─'.repeat(66));
const ask = async (q) => {
  const rl = createInterface({ input: stdin, output: stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a;
};

/* -------------------------------------------------------------------------- */
/* Instagram Login (default)                                                  */
/* -------------------------------------------------------------------------- */

async function instagramLogin() {
  console.log(`
INSTAGRAM LOGIN  (no Facebook Page needed)

In the App Dashboard:

  1. Left menu -> Instagram -> "API setup with Instagram business login"
  2. Step 1 adds your Instagram account, if it isn't there already
  3. Step 3, "Generate access token" -> click Generate token next to your
     account -> log in to Instagram -> copy the token
  4. On that same page, copy the "Instagram app secret" (step 1). It is NOT
     the same value as the Facebook app secret on the Basic Settings page.

Whatever the dashboard hands you — a 1-hour token or an already-long-lived one
— this sorts it out and records when it expires, so the bot can refresh it.
`);

  const appSecret = await ask('Instagram app secret: ');
  const shortToken = await ask('Token from "Generate token": ');
  if (!appSecret || !shortToken) throw new Error('both values are required');

  // The dashboard's "Generate token" button already hands back a LONG-LIVED
  // token, while the OAuth Business Login flow hands back a 1-hour one. They
  // need opposite calls and there is no field distinguishing them, so try the
  // exchange and fall back to a refresh.
  //
  // Getting this wrong is not obvious: exchanging an already-long-lived token
  // fails with "Session key invalid (code 452)", which reads exactly like an
  // expired token and sends you back to the dashboard to generate another one
  // that fails the same way.
  console.log('\n1/3  getting a 60-day token...');
  let token = null;
  let expiresIn = null;

  try {
    const long = await get(
      IG_HOST,
      'access_token',
      { grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken },
      { versioned: false }
    );
    token = long.access_token;
    expiresIn = Number(long.expires_in);
    console.log('     exchanged a short-lived token');
  } catch (exchangeError) {
    const refreshed = await get(
      IG_HOST,
      'refresh_access_token',
      { grant_type: 'ig_refresh_token', access_token: shortToken },
      { versioned: false }
    ).catch(() => null);

    if (!refreshed?.access_token) {
      throw new Error(
        `neither exchange nor refresh worked. Exchange said: ${exchangeError.message}. ` +
          'If it mentions an invalid session, generate a fresh token in the dashboard and retry.'
      );
    }
    token = refreshed.access_token;
    expiresIn = Number(refreshed.expires_in);
    console.log('     token was already long-lived — refreshed it instead');
  }

  if (!token) throw new Error('no long-lived token came back');
  expiresIn = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 60 * 24 * 3600;
  console.log(`     valid ${Math.round(expiresIn / 86400)} days`);

  // 2. Who is it for. The id MUST come from /me, not from the number shown
  //    beside the account in the dashboard — those are different namespaces on
  //    this path, and the dashboard one is rejected by the publish endpoints.
  console.log('2/3  resolving the account...');
  const me = await get(IG_HOST, 'me', { fields: 'id,username', access_token: token });
  if (!me.id) throw new Error('/me returned no id');
  console.log(`     @${me.username || '?'} (${me.id})`);

  // 3. Seed the refresh clock now. Without a recorded expiry the bot cannot
  //    tell how long is left, and the whole point of storing it is that the
  //    refreshed value has to outlive .env.
  console.log('3/3  recording the expiry so the bot can auto-refresh...');
  store.setIgToken({ token, expiresAt: Date.now() + expiresIn * 1000 });
  console.log('     saved to data/store.json');

  return { igUserId: me.id, token, expiresIn, mode: 'instagram' };
}

/* -------------------------------------------------------------------------- */
/* Facebook Login (fallback)                                                  */
/* -------------------------------------------------------------------------- */

async function facebookLogin() {
  console.log(`
FACEBOOK LOGIN  (requires a Facebook Page linked to the Instagram account)

Graph API Explorer -> your app -> "Get User Access Token" -> permissions
instagram_basic, instagram_content_publish, pages_show_list,
pages_read_engagement -> Generate -> copy the EAAG... token.
`);

  const appId = await ask('Facebook App ID: ');
  const appSecret = await ask('Facebook App secret: ');
  const shortToken = await ask('Short-lived user token: ');
  if (!appId || !appSecret || !shortToken) throw new Error('all three are required');

  console.log('\n1/4  exchanging for a long-lived user token...');
  const long = await get(FB_HOST, 'oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });

  console.log('2/4  finding your Page...');
  const pages = await get(FB_HOST, 'me/accounts', { access_token: long.access_token });
  const list = pages.data || [];
  if (!list.length) throw new Error('no Pages — the Instagram account is probably not linked to one');
  const page = list[0];
  console.log(`     ${page.name}`);

  console.log('3/4  finding the Instagram account on that Page...');
  const linked = await get(FB_HOST, page.id, {
    fields: 'instagram_business_account',
    access_token: page.access_token,
  });
  const igUserId = linked.instagram_business_account?.id;
  if (!igUserId) throw new Error(`the Page "${page.name}" has no Instagram Business account attached`);

  console.log('4/4  verifying the token never expires...');
  const debug = await get(FB_HOST, 'debug_token', {
    input_token: page.access_token,
    access_token: `${appId}|${appSecret}`,
  });
  if (debug.data?.expires_at !== 0) {
    throw new Error('that is a user token, not a Page token — it would die in ~60 days');
  }
  console.log('     ok — never expires');

  return { igUserId, token: page.access_token, mode: 'facebook' };
}

/* -------------------------------------------------------------------------- */

async function main() {
  const mode = (process.env.IG_AUTH || 'instagram').toLowerCase();
  const result = mode === 'facebook' ? await facebookLogin() : await instagramLogin();

  line();
  console.log(`
Put these in .env:

IG_USER_ID=${result.igUserId}
IG_ACCESS_TOKEN=${result.token}
${result.mode === 'facebook' ? 'IG_AUTH=facebook\n' : ''}
Also make sure CARD_PUBLIC_BASE_URL points at a PUBLIC https directory —
Instagram fetches the card image from that URL itself, so a card that only
exists on local disk cannot be published.

Then:  npm start   and send /igquota in the Telegram DM.
`);
  line();
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}\n`);
  if (/expired|invalid|OAuth/i.test(e.message)) {
    console.error('That usually means the 1-hour token timed out — generate a fresh one and rerun.');
  }
  process.exitCode = 1;
});
