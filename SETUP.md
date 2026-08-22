# Setup

Getting tiyul+ from a clone to publishing. Telegram first, because it works on
its own and is the fastest path to seeing a real card; Instagram second, because
it has the longest lead time and depends on hosting being in place.

Nothing in here goes in the repo. Every value lands in `.env`, which is
gitignored.

```
npm install
npx playwright install chromium
cp .env.example .env
```

---

## 1. Telegram

### 1.1 Create the bot

Message [@BotFather](https://t.me/BotFather) → `/newbot` → pick a name and a
username. It replies with a token like `8123456789:AAF...`.

```
TG_BOT_TOKEN=8123456789:AAF...
```

### 1.2 Get your own user id

Message [@userinfobot](https://t.me/userinfobot). It replies with your numeric
id. It goes in **both** of these — one is where approval cards are sent, the
other is the lock on who may use the bot at all:

```
STAGING_CHAT_ID=123456789
OWNER_ID=123456789
```

`OWNER_ID` is checked in a middleware registered before every other handler. The
bot refuses to start without it — it can publish, so a missing config value
fails closed rather than leaving it open to whoever finds the username.

### 1.3 Open the DM

Send your new bot `/start`. **This is not optional and it is the most common
first-run failure**: Telegram does not let a bot message a user who has never
messaged it, so without this the bot starts fine and then silently cannot send
you a single approval card.

### 1.4 Create the channel and add the bot

Create your channel, then Channel → Administrators → Add Administrator → your
bot. The only permission it needs is **Post Messages**.

For the channel id, either form works:

- **Public channel:** just the handle — `CHANNEL_ID=@tiyulplus`
- **Private channel:** the numeric `-100…` id. Post any message in the channel,
  forward it to [@userinfobot](https://t.me/userinfobot), and it reports the
  channel id.

```
CHANNEL_ID=@tiyulplus
```

### 1.5 Drafting key

```
ANTHROPIC_API_KEY=sk-ant-...
```

Not optional. Unlike BrickDeal, where the AI step was a cosmetic title polish
that no-oped without a key, drafting *is* the pipeline here — without it there
are no candidates.

### 1.6 Test it

Point `CHANNEL_ID` at a **throwaway private channel** for the first run.

```
npm test                 # 82 offline checks, no credentials needed
npm run check-sources    # are the feeds alive?
npm run render-samples   # then look at samples/*.jpg
npm run run-once         # full pass, printed, publishes nothing
npm start
```

Then in the DM: `/run`. Within a minute or two you should get approval cards
with the rendered image, the source URL, and the buttons. Tap **✅ אשר ופרסם**
on one and it lands in the channel on the next drip tick (`POST_INTERVAL_MINUTES`,
or `/next` to publish immediately).

Useful once it's running: `/status`, `/why`, `/mix`, `/sources`, `/pending`,
`/queue`, `/help`.

**At this point you have a working pipeline.** Everything below is Instagram.

---

## 2. Hosting the cards

Do this before Instagram, because Instagram depends on it.

The Graph API's `POST /{ig-user-id}/media` takes an `image_url` that
**Instagram's own servers fetch** — the bytes never travel through our request.
So a card that exists only on local disk cannot be published, no matter how
correct everything else is.

Write cards into a directory your web server already serves, exactly as
BrickDeal's `DEALS_PATH` points into the web root:

```
CARD_OUTPUT_DIR=/var/www/tiyul/cards
CARD_PUBLIC_BASE_URL=https://tiyul.example.com/cards
```

Caddy:

```
tiyul.example.com {
    root * /var/www/tiyul
    file_server
}
```

```
sudo mkdir -p /var/www/tiyul/cards
sudo chown -R $USER:www-data /var/www/tiyul
```

Verify from **outside** the box before going further — the check that matters is
that a stranger on the internet can fetch it, not that it works over localhost:

```
curl -sI https://tiyul.example.com/cards/sample-fact.jpg | head -3
```

It must be `200`, `content-type: image/jpeg`, and **https**. Instagram will not
fetch over plain http; the code rejects a non-https URL up front so you get a
clear error rather than Graph's generic "media could not be fetched".

---

## 3. Instagram

Allow an afternoon. Most of this is Meta's setup, not ours.

### 3.1 Account shape

Instagram must be a **Business or Creator** account, and it must be **linked to a
Facebook Page**. In the Instagram app: Settings → Account type and tools →
Switch to professional account, then link the Page. A personal Instagram account
cannot publish via the API at all.

### 3.2 Create a Meta app

[developers.facebook.com](https://developers.facebook.com) → My Apps → Create App
→ type **Business**. Add the **Instagram** product (in older console versions,
"Instagram Graph API"). Note the **App ID** and **App Secret**.

You do **not** need App Review to publish to your own accounts: while the app is
in Development mode, anyone with an Admin/Developer/Tester role on it can use
these permissions. App Review is only required to act on accounts you don't
control.

### 3.3 Get a token

Graph API Explorer → select your app → **User Token** → request these scopes:

```
instagram_basic
instagram_content_publish
pages_show_list
pages_read_engagement
```

Generate. That token is **short-lived (~1 hour)** — it is not the one you want.
Three steps to the durable one:

```sh
APP_ID=...; APP_SECRET=...; SHORT=...

# 1. short-lived user token -> long-lived user token (~60 days)
curl -s "https://graph.facebook.com/v21.0/oauth/access_token\
?grant_type=fb_exchange_token&client_id=$APP_ID\
&client_secret=$APP_SECRET&fb_exchange_token=$SHORT"

# 2. long-lived user token -> the Page token (this is the one to keep)
LONG=...
curl -s "https://graph.facebook.com/v21.0/me/accounts?access_token=$LONG"

# 3. Page id -> the Instagram user id
PAGE_ID=...; PAGE_TOKEN=...
curl -s "https://graph.facebook.com/v21.0/$PAGE_ID\
?fields=instagram_business_account&access_token=$PAGE_TOKEN"
```

Use the **Page** access token from step 2, not the user token. A Page token
derived from a long-lived user token does not carry a 60-day expiry, so it
survives without a refresh job. Confirm that before trusting it — paste it into
the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/)
and check **Expires: Never**. If it shows a date, you exchanged the wrong token
at step 1 and will get a dead pipeline in two months.

```
IG_USER_ID=17841400000000000
IG_ACCESS_TOKEN=EAAG...
GRAPH_API_VERSION=v21.0
```

### 3.4 Check it before publishing

```
npm start
```

Then `/igquota` in the DM. It should report how many posts remain in the rolling
24-hour window. That call exercises the token, the app permissions and the IG
user id in one go, without posting anything — if it errors, fix that before
approving a card.

Instagram's cap is **25 posts per 24 hours**. At two or three a day it should
never bind; if it ever does, something upstream is wrong.

### 3.5 What publishing actually does

On approve, the queue drips one item every `POST_INTERVAL_MINUTES`:

1. Telegram first. If it fails, the item goes **back on the queue** and you get
   an alert — an outage must not silently eat something you approved.
2. Then Instagram: `POST /media` → poll the container until `FINISHED` →
   `POST /media_publish`.

If Instagram fails the post is **already live in the channel**, so it is
deliberately not re-queued — retrying would double-post to Telegram. You get a
failure DM and decide manually. That is a real tradeoff, chosen on purpose.

Cards are 1080×1350 (4:5), JPEG — inside Instagram's accepted range (4:5 to
1.91:1) and its 8 MB limit, with room to spare.

---

## 4. Running it for real

```sh
npm install -g pm2
pm2 start bot.js --name tiyul
pm2 save && pm2 startup      # follow the printed command
pm2 logs tiyul
```

- **One instance only.** `data/store.json` is not safe for concurrent writers —
  no cluster mode, no `-i max`.
- `.env` is read once at process start, so `pm2 restart tiyul` after any change.
- Back up `data/` if you care about dedupe history and the published log (the
  topic quotas are computed from it) surviving a redeploy.
- The daily gather fires at `RUN_HOUR`, guarded by the date — a restart mid-day
  won't re-run. If the process is down all day, that day is skipped.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Bot starts, no approval cards ever arrive | You never sent it `/start`. Telegram forbids a bot messaging a user who hasn't messaged it first. |
| `⛔ not authorized` to your own messages | `OWNER_ID` doesn't match your real user id. Check with @userinfobot. |
| Refuses to start, complains about `OWNER_ID` / `STAGING_CHAT_ID` | Working as intended. It can publish, so it fails closed. |
| `/run` stages nothing | Try `/why`. Usually everything gathered was already seen — normal on a repeat run. `npm run check-sources` separates "nothing new" from "a feed broke". |
| Everything rejected as `not_primary_source` | The item's own link points off the allowlist. Add the domain to `sources.json` only if it is genuinely a primary source. |
| Rejected as `unsupported_claim` | The draft's quote didn't appear verbatim in the page. Deliberately strict — a fuzzy quote match is indistinguishable from no check at all. Re-run. |
| Instagram: "media could not be fetched" | `CARD_PUBLIC_BASE_URL` isn't publicly reachable, or isn't https. Test with `curl -sI` from off the box. |
| Instagram worked, then stopped ~60 days in | You saved the long-lived *user* token instead of the *Page* token. Redo 3.3 step 2 and confirm **Expires: Never** in the debugger. |
| `render_failed: Heebo did not load` | `assets/fonts/Heebo.ttf` is missing or corrupt. It refuses rather than shipping a card of tofu boxes. |
| Cards render but Hebrew looks wrong | Look at `samples/*.jpg`, not the HTML — bidi, shaping and line breaking all happen at render time. |
