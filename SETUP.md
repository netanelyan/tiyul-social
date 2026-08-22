# Setup

Getting tiyul+ from a clone to publishing.

**The intended shape: Telegram is the approval surface, Instagram is where posts
go.** No Telegram channel — the bot DMs you a card, you tap approve, it publishes
to Instagram. A Telegram channel is supported as an *additional* destination if
you ever want one, but it is optional and off by default.

That makes the order below: Telegram first (it's the fastest way to see a real
card and it works before Instagram exists), then hosting, then Instagram.

> **You can't skip Instagram and call it done.** The bot refuses to start unless
> at least one publish destination is configured. With no `CHANNEL_ID` and no
> Instagram credentials, approving a card would send it nowhere — so it fails
> closed rather than quietly eating your approvals. While you're still setting
> Instagram up, `npm run run-once` exercises the whole pipeline without needing
> either.

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

### 1.4 Channel — skip this

Leave `CHANNEL_ID` blank. That's the approval-only setup: the bot DMs you cards,
and approved posts go to Instagram alone.

```
CHANNEL_ID=
```

Only if you later want a Telegram channel *as well*: create it, Channel →
Administrators → Add Administrator → your bot, permission **Post Messages**,
then set `CHANNEL_ID=@yourchannel` (or the numeric `-100…` id — post a message
in the channel, forward it to [@userinfobot](https://t.me/userinfobot), and it
reports the id). Both destinations then publish, independently.

### 1.5 Drafting key

```
ANTHROPIC_API_KEY=sk-ant-...
```

Not optional. Unlike BrickDeal, where the AI step was a cosmetic title polish
that no-oped without a key, drafting *is* the pipeline here — without it there
are no candidates.

### 1.6 Test what you can, now

These need no publish destination at all, so run them before Instagram exists:

```
npm test                 # 89 offline checks, no credentials needed
npm run check-sources    # are the feeds alive?
npm run render-samples   # then look at samples/*.jpg
npm run run-once         # full pass — gather, draft, verify, render — publishes nothing
```

`run-once` is the important one: it exercises everything except the final
publish, prints each approval message, and shows you what got rejected and why.
If that looks right, the pipeline is working and only the last step is missing.

`npm start` will refuse until Instagram is configured (or `CHANNEL_ID` is set) —
that's the fail-closed check, not a bug.

Once it does start, in the DM: `/run`. Within a minute or two you get approval
cards with the rendered image, the source URL, and the buttons. Each card also
says **where it will publish** before you tap. Approve one and it goes out on the
next drip tick (`POST_INTERVAL_MINUTES`), or `/next` to publish immediately.

Useful once running: `/status`, `/why`, `/mix`, `/sources`, `/pending`,
`/queue`, `/igquota`, `/help`.

---

## 2. Hosting the cards

Do this before Instagram, because Instagram depends on it — and since Instagram
is your only publish target, nothing goes out until this is right.

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

**The App ID and App Secret do not go in `.env`.** Nothing in the code reads
them — `src/publish/instagram.js` only ever uses `IG_USER_ID`,
`IG_ACCESS_TOKEN`, `CARD_PUBLIC_BASE_URL` and `GRAPH_API_VERSION`. The App ID
and Secret are used once, to mint the token, and then you're done with them:

```
App ID + App Secret  ──(once)──▶  IG_ACCESS_TOKEN + IG_USER_ID  ──▶  .env
```

First, a short-lived token from the
[Graph API Explorer](https://developers.facebook.com/tools/explorer/):

1. **Meta App** dropdown → your app
2. **User or Page** dropdown → **User Token**
3. Add these four permissions:
   `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
   `pages_read_engagement`
4. **Generate Access Token** → approve → tick your Page and Instagram account
   in the popup
5. Copy the string from the **Access Token** box

That one expires in about an hour. It's only the starting point. Then:

```
npm run ig-token
```

It asks for the App ID, App Secret and that short-lived token, runs the whole
exchange, and prints the two lines to paste into `.env`. Nothing is written to
disk and nothing is passed as a shell argument, so the secret stays out of your
shell history.

**Why a script rather than three curls:** the chain returns three different
values all called `access_token`, and only the last one is correct. The one you
want is the **Page** token — derived from a long-lived user token, it carries no
expiry at all. Pick the wrong one and it works perfectly today, then stops dead
about 60 days later, silently. So the script finishes by calling `debug_token`
and refuses to hand you a token unless it comes back `expires: never` with all
the required scopes present.

If you'd rather do it by hand, it's `oauth/access_token`
(`grant_type=fb_exchange_token`) → `me/accounts` → `{page-id}?fields=
instagram_business_account`, then verify in the
[Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/).

You end up with:

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

On approve, the item joins the queue and drips out one every
`POST_INTERVAL_MINUTES`. Instagram publishing is the documented two-step:
`POST /media` → poll the container until `FINISHED` → `POST /media_publish`.

The retry rule is about **double-posting, not about which destination matters
more**:

- **Nothing published** → safe to retry, so the item goes back on the queue.
  With Instagram as your only target, that covers every failure: a token blip, a
  hosting outage, a Graph 5xx. You get a DM each attempt, up to 3, then it is
  dropped from the queue — loudly, never silently. The card file is kept.
- **Something published** → not retried, because retrying would duplicate
  whichever destination succeeded. Only reachable if you later add
  `CHANNEL_ID`; you get told which one failed and decide.

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
| Refuses to start: "No publish destination configured" | Working as intended. Set up Instagram (§3), or set `CHANNEL_ID`. Until then use `npm run run-once`, which needs neither. |
| Bot starts, no approval cards ever arrive | You never sent it `/start`. Telegram forbids a bot messaging a user who hasn't messaged it first. |
| Approved, but nothing appeared on Instagram | Check the DM — a failure always reports there. `🔁` means it went back on the queue and will retry; `🔴` means it exhausted 3 attempts and was dropped. |
| `⛔ not authorized` to your own messages | `OWNER_ID` doesn't match your real user id. Check with @userinfobot. |
| Refuses to start, complains about `OWNER_ID` / `STAGING_CHAT_ID` | Working as intended. It can publish, so it fails closed. |
| `/run` stages nothing | Try `/why`. Usually everything gathered was already seen — normal on a repeat run. `npm run check-sources` separates "nothing new" from "a feed broke". |
| Everything rejected as `not_primary_source` | The item's own link points off the allowlist. Add the domain to `sources.json` only if it is genuinely a primary source. |
| Rejected as `unsupported_claim` | The draft's quote didn't appear verbatim in the page. Deliberately strict — a fuzzy quote match is indistinguishable from no check at all. Re-run. |
| Instagram: "media could not be fetched" | `CARD_PUBLIC_BASE_URL` isn't publicly reachable, or isn't https. Test with `curl -sI` from off the box. |
| Instagram worked, then stopped ~60 days in | You saved the long-lived *user* token instead of the *Page* token. Re-run `npm run ig-token` — it refuses to hand back a token that has an expiry. |
| `npm run ig-token` says "No Pages came back" | The Instagram account isn't linked to a Facebook Page, or you didn't tick the Page in the Explorer's login popup. |
| `npm run ig-token` says the Page has no Instagram account | The account is still personal. Instagram app → Settings → Account type and tools → Switch to professional, then link the Page. |
| `render_failed: Heebo did not load` | `assets/fonts/Heebo.ttf` is missing or corrupt. It refuses rather than shipping a card of tofu boxes. |
| Cards render but Hebrew looks wrong | Look at `samples/*.jpg`, not the HTML — bidi, shaping and line breaking all happen at render time. |
