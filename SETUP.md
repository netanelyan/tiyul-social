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
npm test                 # 109 offline checks, no credentials needed
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

## 3. Instagram — when you're ready, not before

**You do not need this to use the pipeline.** Meta's app console is genuinely
painful, and getting stuck in it is normal rather than a sign you did something
wrong. Everything else works without it — see "Running without Instagram" below,
which takes about a minute and gives you the complete approve-and-publish loop.

Come back to this section when you actually want posts on Instagram.

### 3.1 Account shape

The Instagram account must be **Business or Creator**. In the Instagram app:
Settings → Account type and tools → Switch to professional account. A personal
account cannot publish through the API on any path.

### 3.2 Which auth path

There are two, and they are not interchangeable. The code supports both via
`IG_AUTH`:

| | `IG_AUTH=instagram` (default) | `IG_AUTH=facebook` |
|---|---|---|
| Facebook Page | **not needed** | required, linked to the IG account |
| Permissions | `instagram_business_basic`, `instagram_business_content_publish` | `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement` |
| Host | `graph.instagram.com` | `graph.facebook.com` |
| Token | 60 days, **auto-refreshed by the bot** | Page token, never expires |

Start with the default. It needs no Facebook Page and half the permissions,
which is where most of the friction lives.

### 3.3 Get a token

**Ignore the Graph API Explorer.** On this path you never touch it, and you
never pick permissions from a dropdown. It is one button in the App Dashboard.

1. App Dashboard → left menu → **Instagram** → **API setup with Instagram
   business login**
2. **Step 1** — add your Instagram account if it isn't listed
3. **Step 3, "Generate access token"** → click **Generate token** next to your
   account → log in to Instagram → **copy the token**
4. Still on that page, copy the **Instagram app secret** from step 1.
   ⚠️ This is *not* the Facebook app secret on the Basic Settings page. They are
   different values and the exchange fails with the wrong one.

Then:

```
npm run ig-token
```

It asks for those two, exchanges the 1-hour token for a 60-day one, resolves
your Instagram user id, and records the expiry so the bot can keep it alive.
Paste the two printed lines into `.env`.

**On expiry — this is the part that bites.** Instagram Login tokens last 60
days. The bot refreshes automatically on boot and once a day, whenever fewer
than 20 days remain, and stores the refreshed value in `data/store.json` rather
than `.env` so it survives restarts. `/igquota` reports days remaining. Without
that, publishing would work perfectly for two months and then stop dead with no
warning.

### 3.4 Check before publishing

```
npm start
```

Then `/igquota` in the DM. It exercises the token, the permissions and the user
id in one call without posting anything. Instagram's cap is 25 posts per 24
hours; at two or three a day it should never bind.

### 3.5 What publishing actually does

`POST /media` → poll the container until `FINISHED` → `POST /media_publish`.

The retry rule is about **double-posting, not which destination matters more**:

- **Nothing published** → safe to retry, so it goes back on the queue. Three
  attempts, then dropped — loudly, never silently. The card file is kept.
- **Something published** → not retried, since that would duplicate whichever
  destination succeeded. You get told which failed and decide.

Cards are 1080×1350 (4:5), JPEG — inside Instagram's accepted range and its
8 MB limit with room to spare.

---

## Running without Instagram

The fastest way to a working pipeline. Point publishing at your own Telegram DM:

```
CHANNEL_ID=<your user id — the same number as OWNER_ID>
```

```
npm start
```

Send `/run`, tap approve on a card, and the published version arrives in the
same chat. That is the entire loop — gather, rank, verify, draft, render,
approve, publish — with nothing stubbed.

The only cost is that approval cards and published posts share one thread, so
"waiting on you" and "already out" stop being visually distinct. Fine for days;
annoying eventually, at which point either make a private channel or come back
to §3.

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
