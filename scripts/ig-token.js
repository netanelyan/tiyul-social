import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

// Turns the short-lived token from the Graph API Explorer into the two values
// .env actually needs: IG_USER_ID and IG_ACCESS_TOKEN.
//
// This exists because the manual version is three curls that each return
// something called "access_token", and only the third one is correct. Picking
// the wrong one is not an error you find out about now — it works perfectly
// and then the pipeline dies 60 days later. So the script does the whole chain
// and then *verifies* the result with debug_token instead of asking you to
// eyeball a web page.
//
//   npm run ig-token
//
// Nothing is written to disk and nothing is passed as a shell argument, so the
// app secret stays out of your shell history.

const V = process.env.GRAPH_API_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${V}`;

async function get(path, params) {
  const url = `${GRAPH}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`${e.message || `HTTP ${res.status}`}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return json;
}

const line = () => console.log('─'.repeat(64));

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log(`
Before running this, get a SHORT-LIVED token:

  1. https://developers.facebook.com/tools/explorer/
  2. "Meta App" dropdown       -> your app (TiyulPlus)
  3. "User or Page" dropdown   -> User Token
  4. Add these four permissions:
       instagram_basic
       instagram_content_publish
       pages_show_list
       pages_read_engagement
  5. Click "Generate Access Token", approve, and pick your Page and
     Instagram account in the popup.
  6. Copy the long string from the "Access Token" box.

That token expires in about an hour. That is expected — it is only the
starting point, and this script trades it for the durable one.
`);

  const appId = (await rl.question('App ID: ')).trim();
  const appSecret = (await rl.question('App secret: ')).trim();
  const shortToken = (await rl.question('Short-lived token from the Explorer: ')).trim();
  rl.close();

  if (!appId || !appSecret || !shortToken) {
    console.error('\nAll three are required.');
    process.exitCode = 1;
    return;
  }

  // 1. short-lived user token -> long-lived user token (~60 days).
  console.log('\n1/4  exchanging for a long-lived user token...');
  const longLived = await get('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const userToken = longLived.access_token;
  console.log('     ok');

  // 2. long-lived user token -> Page token. THIS is the one that matters: a
  //    Page token derived from a long-lived user token carries no expiry.
  console.log('2/4  finding your Page...');
  const pages = await get('me/accounts', { access_token: userToken });
  const list = pages.data || [];

  if (!list.length) {
    console.error(`
No Pages came back. Usually one of:
  - the Instagram account is not linked to a Facebook Page yet
  - you did not tick the Page in the Explorer's login popup
  - pages_show_list was not among the granted permissions
`);
    process.exitCode = 1;
    return;
  }

  let page = list[0];
  if (list.length > 1) {
    const rl2 = createInterface({ input: stdin, output: stdout });
    console.log('');
    list.forEach((p, i) => console.log(`     [${i + 1}] ${p.name}`));
    const pick = Number(await rl2.question('     which Page? '));
    rl2.close();
    page = list[Number.isFinite(pick) && list[pick - 1] ? pick - 1 : 0];
  }
  console.log(`     ${page.name}`);

  // 3. Page -> the Instagram account attached to it.
  console.log('3/4  finding the Instagram account on that Page...');
  const linked = await get(page.id, {
    fields: 'instagram_business_account',
    access_token: page.access_token,
  });
  const igUserId = linked.instagram_business_account?.id;

  if (!igUserId) {
    console.error(`
That Page has no Instagram Business account attached.

Fix it in the Instagram app: Settings -> Account type and tools ->
Switch to professional account, then link "${page.name}". A personal
Instagram account cannot publish through the API at all.
`);
    process.exitCode = 1;
    return;
  }
  console.log(`     ${igUserId}`);

  // 4. Verify rather than trust. This is the whole point of the script: the
  //    wrong token behaves identically today and fails silently in two months.
  console.log('4/4  verifying the token...');
  const debug = await get('debug_token', {
    input_token: page.access_token,
    access_token: `${appId}|${appSecret}`,
  });
  const d = debug.data || {};
  const neverExpires = d.expires_at === 0;
  const scopes = d.scopes || [];
  const missing = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'].filter(
    (s) => !scopes.includes(s)
  );

  console.log(`     type: ${d.type || 'unknown'}`);
  console.log(`     expires: ${neverExpires ? 'never ✓' : new Date((d.expires_at || 0) * 1000).toISOString()}`);
  if (missing.length) console.log(`     ⚠ missing permissions: ${missing.join(', ')}`);

  line();
  if (!neverExpires) {
    console.log(`
⚠  This token has an expiry date, which means it is a USER token, not a
   PAGE token — it will stop working on the date above and publishing will
   fail silently from then on.

   Re-run and make sure you are copying the token from the Explorer's
   "Access Token" box while "User Token" is selected. If it keeps happening,
   the Page may not be properly linked.
`);
    process.exitCode = 1;
    return;
  }
  if (missing.length) {
    console.log(`
⚠  The token works but is missing permissions the pipeline needs. Re-generate
   it in the Explorer with all four ticked.
`);
    process.exitCode = 1;
    return;
  }

  console.log(`
Done. Put these two lines in .env:

IG_USER_ID=${igUserId}
IG_ACCESS_TOKEN=${page.access_token}

Then check it end to end without publishing anything:

  npm start        and send /igquota in the Telegram DM
`);
  line();
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  console.error('\nIf it mentions an invalid or expired token, the short-lived one timed out —');
  console.error('generate a fresh one in the Explorer and run this again.');
  process.exitCode = 1;
});
