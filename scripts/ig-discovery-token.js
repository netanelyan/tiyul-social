import { loadEnv } from '../src/env.js';
loadEnv();

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { postConfig } from '../src/postConfig.js';
import { businessDiscovery, discoveryConfigured, graphCode, hashtagId, notAllowed, recentHashtags } from '../src/clients/instagramGraph.js';

// The trend watcher's Instagram connection: a Facebook Login token for Hashtag
// Search and Business Discovery (src/clients/instagramGraph.js).
//
//   npm run ig-discovery              make the token, from a Graph API Explorer one
//   npm run ig-discovery -- --check   test the one in .env, print no secret
//
// It never touches the publisher's Instagram Login token (IG_ACCESS_TOKEN) or the
// bot's store: it prints two lines for .env and nothing else is written.
//
// THE CHECK ASKS META: Business Discovery on our own account and, only while
// trends.instagram.hashtagSearch is on, the hashtags this account searched this
// week and one Hashtag Search, for the first of trends.instagram.hashtags. That
// search counts as one of the 30 a week, the same one the watcher's next run would
// spend on that hashtag anyway.

const V = process.env.GRAPH_API_VERSION || 'v21.0';
const FB = `https://graph.facebook.com/${V}`;
const args = process.argv.slice(2);

async function get(path, params) {
  const res = await fetch(`${FB}/${path}?${new URLSearchParams(params)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`${e.message || `HTTP ${res.status}`}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return json;
}

const ask = async (q) => {
  const rl = createInterface({ input: stdin, output: stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a;
};

const why = (e) => `${e.message}${graphCode(e) != null ? ` (code ${graphCode(e)})` : ''}`;

/** Each endpoint, with this token: { discovery, hashtags } as 'ok' or the reason. */
async function probe(env, username) {
  const out = {};
  try {
    const bd = await businessDiscovery(username, { env, max: 3 });
    out.discovery = `ok: @${bd.username}, ${bd.followers ?? '?'} followers, ${bd.posts.length} posts read, the latest with ${bd.posts[0]?.likes ?? '?'} likes`;
  } catch (e) {
    out.discovery = why(e);
  }
  const { hashtagSearch, hashtags } = postConfig().trends.instagram;
  const tag = hashtags[0];
  if (!hashtagSearch) {
    out.week = out.hashtags = 'parked (trends.instagram.hashtagSearch is off), not asked';
    return out;
  }
  try {
    const recent = await recentHashtags({ env });
    out.week = `ok: ${recent.length} of 30 hashtags used this week`;
  } catch (e) {
    out.week = why(e);
  }
  if (!tag) out.hashtags = 'no hashtag in trends.instagram.hashtags to try';
  else {
    try {
      const id = await hashtagId(tag, { env });
      out.hashtags = id ? `ok: #${tag} is ${id}` : `ok, but Meta knows no #${tag}`;
    } catch (e) {
      out.hashtags = notAllowed(e) ? `refused, ${why(e)}: needs App Review for Instagram Public Content Access` : why(e);
    }
  }
  return out;
}

const show = (label, r) => {
  console.log(`\n  ${label}`);
  console.log(`    Business Discovery: ${r.discovery}`);
  console.log(`    This week's hashtags: ${r.week}`);
  console.log(`    Hashtag Search:     ${r.hashtags}`);
};
const score = (r) => [r.discovery, r.hashtags].filter((x) => x.startsWith('ok')).length;

async function check() {
  if (!discoveryConfigured()) throw new Error('IG_DISCOVERY_TOKEN and IG_DISCOVERY_USER_ID are not both in .env; run npm run ig-discovery first');
  const me = await get(process.env.IG_DISCOVERY_USER_ID, { fields: 'username', access_token: process.env.IG_DISCOVERY_TOKEN });
  show(`@${me.username} (${process.env.IG_DISCOVERY_USER_ID}), the token in .env:`, await probe(process.env, me.username));
}

async function setup() {
  console.log(`
INSTAGRAM FOR THE TREND WATCHER  (Facebook Login, read only)

In Graph API Explorer (developers.facebook.com/tools/explorer):
  1. Meta App: the tiyul+ app
  2. User or Page: "Get User Access Token"
  3. Permissions: instagram_basic, pages_show_list, pages_read_engagement,
     instagram_manage_insights, business_management
  4. Generate Access Token, log in to Facebook as an admin of the Page that
     is linked to the tiyul+ Instagram account, allow it, copy the token
`);
  const appId = await ask('Facebook App ID: ');
  const appSecret = await ask('Facebook App secret (Settings > Basic): ');
  const short = await ask('Token from Graph API Explorer: ');
  if (!appId || !appSecret || !short) throw new Error('all three are required');

  console.log('\n1/4  exchanging for a long-lived user token...');
  const long = await get('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: short });
  const userToken = long.access_token;

  console.log('2/4  finding the Page linked to Instagram...');
  const pages = (await get('me/accounts', { fields: 'name,access_token,instagram_business_account{id,username}', access_token: userToken })).data || [];
  const linked = pages.filter((p) => p.instagram_business_account?.id);
  if (!pages.length) throw new Error('this Facebook user manages no Page (or pages_show_list was not granted)');
  if (!linked.length) throw new Error(`none of these Pages has an Instagram professional account linked: ${pages.map((p) => p.name).join(', ')}`);
  let page = linked[0];
  if (linked.length > 1) {
    linked.forEach((p, i) => console.log(`     ${i + 1}. ${p.name} -> @${p.instagram_business_account.username}`));
    page = linked[Number(await ask('Which one? ')) - 1] || linked[0];
  }
  const ig = page.instagram_business_account;
  console.log(`     ${page.name} -> @${ig.username} (${ig.id})`);

  console.log('3/4  what the token was granted...');
  const debug = (await get('debug_token', { input_token: userToken, access_token: `${appId}|${appSecret}` })).data || {};
  console.log(`     ${(debug.scopes || []).join(', ') || '(none listed)'}`);
  const missing = ['instagram_basic', 'pages_read_engagement', 'instagram_manage_insights'].filter((s) => !(debug.scopes || []).includes(s));
  if (missing.length) console.log(`     missing: ${missing.join(', ')}; Business Discovery will be refused without them`);

  // A Page token made from a long-lived user token never expires; the user token
  // lasts about 60 days. Both are asked, and the Page token wins a tie.
  console.log('4/4  asking Meta with each token...');
  const asPage = await probe({ IG_DISCOVERY_TOKEN: page.access_token, IG_DISCOVERY_USER_ID: ig.id }, ig.username);
  show('Page token (never expires):', asPage);
  const asUser = await probe({ IG_DISCOVERY_TOKEN: userToken, IG_DISCOVERY_USER_ID: ig.id }, ig.username);
  const days = Number(long.expires_in) > 0 ? Math.round(Number(long.expires_in) / 86400) : 60;
  show(`User token (about ${days} days):`, asUser);
  const useUser = score(asUser) > score(asPage);
  if (!score(asPage) && !score(asUser)) console.log('\n  Neither token reached either endpoint. The reasons above say what Meta wants.');

  console.log(`\n${'-'.repeat(66)}\nPut these in the bot's .env (on the VPS: /opt/tiyul-social/.env):\n`);
  console.log(`IG_DISCOVERY_USER_ID=${ig.id}`);
  console.log(`IG_DISCOVERY_TOKEN=${useUser ? userToken : page.access_token}`);
  console.log(`GROWTH_STORE_PATH=/var/lib/tiyul-growth/growth.json`);
  if (useUser) console.log(`\nThat is the USER token: it expires in about ${days} days. Run this again before then.`);
  console.log(`\nThen: npm run ig-discovery -- --check\n${'-'.repeat(66)}`);
}

(args.includes('--check') ? check() : setup()).catch((e) => {
  console.error(`\nFailed: ${e.message}\n`);
  process.exitCode = 1;
});
