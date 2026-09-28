# Deploying to the VPS

It has to run on a server, and not for the usual reasons. Instagram's
`POST /{ig-user-id}/media` takes an `image_url` **that Instagram's own servers
fetch**, the bytes never travel through our request. TikTok's Content Posting
API works the same way. So a card that only exists on a laptop cannot be
published at all, and `cardPublicUrl()` returning null is exactly why
`publishInstagram()` refuses rather than failing halfway.

Everything else about this deployment follows from that one fact: there is a
web server, it serves a directory, and the renderer writes straight into it.

The target here is Debian/Ubuntu with Caddy, because that is what
`cards.tiyulplus.com` already runs on alongside BrickDeal.

---

## ffmpeg (required for clips)

Clips are encoded with ffmpeg, and the text on them is composited as an image, ffmpeg's own `drawtext` has no bidi support, so Hebrew comes out reversed and
unshaped with no flag to fix it. The line is rendered in Chromium, which this
project already runs, and ffmpeg overlays the result.

```bash
sudo apt update && sudo apt install -y ffmpeg
ffmpeg -version          # expect 6.x or newer
```

Without it the bot still starts and cards and decks still work; the clip half
says so at boot and sends one Telegram warning rather than failing quietly at
the first clip of the day. `spawn ffmpeg ENOENT` in a log means exactly this.

`FFMPEG_PATH` overrides the lookup if the binary lives somewhere unusual. The
resolver checks `/usr/bin`, `/usr/local/bin`, `/snap/bin` and the Homebrew path
before falling back to PATH.

**Clips are served from the card directory.** `CLIP_OUT_DIR` defaults to
`CARD_OUTPUT_DIR`, which is what Caddy already serves at `CARD_PUBLIC_BASE_URL`.
TikTok fetches video by URL exactly as Instagram fetches a card image, so a clip
written anywhere else has a public address that resolves to nothing, it would
look fine here and 404 at TikTok. No extra Caddy rule is needed.

## What is actually being deployed

One long-running Node process. It is **not** a cron job, `bot.js` schedules
itself with `setInterval`, gathers through the day from `RUN_HOUR`, and drips
posts every `POST_INTERVAL_MINUTES`. Killing and restarting it on a timer would
lose the day's state. It wants systemd with `Restart=always`.

It needs **no inbound ports**. Telegram is long-polled, so the bot reaches out.
Only Caddy listens, on 80 and 443, and only to serve the rendered images.

Three things live outside the repository and none of them are in git:

| What | Where | Why it is not in git |
|---|---|---|
| Secrets | `.env` | `.gitignore` covers `.env` and `.env.*`, a `.env.bak` is the same secrets with a different extension |
| State | `data/store.json` | dedupe history, the publish queue, the published log the pillar quotas are computed from, and the TikTok token pair |
| Rendered cards | `CARD_OUTPUT_DIR` | regenerable from the candidate at any time |

`data/` is the one that matters. Lose it and the bot forgets what it has
already posted, which means it will happily post it again.

---

## 1. Node

Node 18 is the floor; this was developed on 24. Debian's packaged Node is
usually too old.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

## 2. A user for it

Don't run it as root. It executes a browser.

```bash
sudo adduser --system --group --home /srv/tiyul tiyul
sudo -u tiyul git clone https://github.com/netanelyan/tiyul-social /srv/tiyul/app
cd /srv/tiyul/app
sudo -u tiyul npm ci
```

## 3. Chromium, with its system libraries

**This is where a VPS deploy usually fails.** Playwright's Chromium needs a
couple of dozen shared libraries that a minimal server image does not have, and
without them it fails at launch with a missing-`.so` error rather than anything
that mentions Playwright.

```bash
sudo npx playwright install-deps chromium
sudo -u tiyul npx playwright install chromium
```

Two commands rather than `--with-deps` because the libraries need root and the
browser needs to land in the service user's cache, not root's. If you run the
whole thing under `sudo`, Chromium downloads into `/root/.cache` and the service
cannot see it.

Fonts are **not** a system dependency here. Every face is bundled in `assets/`
and inlined into the HTML as a data URI, precisely so that a server with no
fonts installed renders identically to a laptop. If Hebrew comes out as boxes,
something else is wrong, and the renderer will refuse before it gets there, see
the font guard in `src/render/index.js`.

## 4. The web root Caddy already serves

```bash
sudo mkdir -p /var/www/tiyul/cards
sudo chown tiyul:tiyul /var/www/tiyul/cards
```

In the Caddyfile:

```
cards.tiyulplus.com {
    root * /var/www/tiyul
    file_server
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy gets the certificate itself on first request, provided the DNS A record
for `cards.tiyulplus.com` already points at this box.

**Verify it from off the machine before going further.** This is the single
assumption everything downstream rests on, and it is cheap to check:

```bash
sudo -u tiyul touch /var/www/tiyul/cards/probe.jpg
curl -sI https://cards.tiyulplus.com/cards/probe.jpg | head -1   # expect 200
```

If that is not a 200 from another network, Instagram will not be able to fetch a
card either, and the failure it gives you is far less legible than this one.

**The `cards.tiyulplus.com` block is load-bearing and lives in a file another
project also edits.** It was once removed by a rewrite of that file from the
other side, and the symptom was not a 404 — it was Caddy having no certificate
for the hostname, so every media fetch failed the TLS handshake and surfaced
hours later as an opaque `photo_pull_failed` from TikTok. When publishing breaks
with no code change to explain it, check this before looking in the repo:

```bash
grep cards.tiyulplus.com /etc/caddy/Caddyfile
curl -sSI https://cards.tiyulplus.com/cards/probe.jpg | head -1
```

Use `-sSI`, not `-sI`. Plain `-s` hides connection errors, so a TLS failure
prints nothing at all and reads as a hang.

## 4a. The admin site (optional)

The same approve/reject/publish decisions as the Telegram bot, in a browser, for
admins who are not on the Telegram chat. It runs **inside the bot's process** —
the store is held in memory and written whole, so a second process would revert
whatever the bot did between its read and its write. There is nothing extra to
start or supervise.

It is off until `ADMIN_USERS` is set. One `name:password` per person, comma
separated, because every action is announced in the Telegram chat under the name
that performed it:

```bash
# in /opt/tiyul-social/.env
ADMIN_USERS=neta:a-long-password,dana:a-different-one
```

Then a Caddy block beside the cards one, in the same file:

```
admin.tiyulplus.com {
    reverse_proxy 127.0.0.1:8787
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
pm2 restart tiyul
```

The DNS A record for `admin.tiyulplus.com` has to point at this box first, or
Caddy cannot get a certificate.

**Never bind the site to a public address.** `ADMIN_BIND` defaults to
`127.0.0.1` and should stay there: there is no TLS inside the process, Caddy
provides it, and the session cookie would otherwise travel in clear. The login
throttle also trusts `X-Forwarded-For` only while bound to localhost, where the
proxy is the only thing that can reach it.

Check it is up before opening a browser:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/        # 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/state  # 401
```

A 200 then a 401 is exactly right: the login page is public and everything
behind it is not.

## Instagram auto-replies

When somebody comments the destination under a post, the account DMs them the
link to that destination's page. Meta calls this a **private reply**: one
message per comment, within seven days of the comment, and it is the only
route Instagram offers from a feed post to a tappable link.

This is four separate things and three of them are in Meta's dashboard rather
than here. Doing them out of order is the usual reason it does not work.

### 1. Permissions, and a new token

Add to the app, on top of what publishing already needs:

- `instagram_business_manage_messages` — to send the DM
- `instagram_business_manage_comments` — to receive the webhook and to post
  the short public reply under the comment

Then **regenerate `IG_ACCESS_TOKEN`**. This is the step that gets skipped: the
old token keeps publishing perfectly well and simply cannot subscribe, and the
error it produces names a scope rather than the thing the scope was for.

> **Meta's docs disagree with themselves here.** The Private Replies page
> lists `instagram_business_basic` + `instagram_business_manage_comments`; the
> Messaging API page lists `instagram_business_basic` +
> `instagram_business_manage_messages`. They are describing the same call. Ask
> for all three and let review trim it.

> **Advanced Access is an open question, and it decides whether this works.**
> Meta requires Advanced Access when an app "serves Instagram professional
> accounts you don't own or manage". This app serves one account, its owner's,
> which argues Standard Access is enough — but the people being messaged are
> strangers, and nothing found says plainly which side of the line that falls.
> Check **App Review → Permissions** in the dashboard before relying on it. If
> Advanced is required, everything here still installs and still verifies; it
> will answer people with a role on the app and nobody else until review
> passes.

### 2. The env, and the Caddy route

```bash
# in /opt/tiyul-social/.env
IG_APP_SECRET=...              # from the app dashboard; every delivery is HMAC-checked
IG_WEBHOOK_VERIFY_TOKEN=...    # any string; the dashboard must carry the same one
IG_WEBHOOK_PORT=8788
```

Both of the first two, or the listener does not start. That is deliberate: an
endpoint that sends direct messages must never come up unauthenticated.

A block beside the other two, in the same Caddyfile:

```
hooks.tiyulplus.com {
    reverse_proxy /ig/webhook 127.0.0.1:8788
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
pm2 restart tiyul
```

Only `/ig/webhook` is proxied. The DNS A record has to point here first or
Caddy cannot get a certificate, and Meta will not accept an endpoint without a
valid one.

### 3. The webhook, in the dashboard

**App dashboard → Webhooks → Instagram**:

- Callback URL: `https://hooks.tiyulplus.com/ig/webhook`
- Verify token: the same string as `IG_WEBHOOK_VERIFY_TOKEN`
- Subscribe to the **`comments`** field

Meta calls the URL once with a `hub.challenge` and expects it echoed back. The
log says `ig webhook: handshake ok` when that has happened. A failure here is
almost always the verify token differing, or the route not being proxied.

### 4. Subscribe the account

The dashboard says where to send events; this says that this account has them.

```bash
npm run ig-subscribe -- --on     # subscribe to `comments`
npm run ig-subscribe             # show what it is subscribed to
```

### Turning it on

The credentials above only make it possible. The editorial switch is
`igReplies.on` in `post-config.json`, and with it off nothing replies, the
closing slide falls back to the bio wording and so does the caption.

It replaces `plans.giveaway`, which is now off: that asked for a comment and
promised a month of premium that no code here could hand out, and this asks
for the same comment and sends the thing it promises.

### Checking it

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:8788/ig/webhook?hub.mode=subscribe&hub.verify_token=WRONG'   # 403
curl -sS -X POST -d '{}' -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:8788/ig/webhook                                               # 403, unsigned
```

Two 403s is right: an unsigned POST and a wrong verify token are the two
things this must refuse. Then comment the destination under a published post
from another account and watch `pm2 logs tiyul` for
`ig webhook: <user> on <media> - replied (destination)`.

Reasons it will decline, all of them logged and all of them normal:

| Log line | What it means |
|---|---|
| `no record of that post` | Published before this shipped, or by hand. It cannot know which page the post was about, so it says nothing rather than guessing. |
| `did not ask` | The comment did not name the destination or a keyword. |
| `already answered` | Meta redelivered, or that person already asked under this post. |
| `our own comment` | The public receipt arriving back through the webhook. |
| `hourly cap (30) reached` | `igReplies.hourlyCap`. A blast radius, not a rate limit. |

## 5. `.env`

Copy `.env.example` and fill it in, it documents every variable. Two entries
differ from a laptop:

```ini
CARD_OUTPUT_DIR=/var/www/tiyul/cards
CARD_PUBLIC_BASE_URL=https://cards.tiyulplus.com/cards
```

`CARD_PUBLIC_BASE_URL` must resolve to the same file `CARD_OUTPUT_DIR` writes.
Getting this pair subtly wrong is the most common cause of a card that renders
perfectly and then fails to publish.

```bash
sudo -u tiyul cp .env.example .env
sudo -u tiyul nano .env
sudo chmod 600 .env
```

Set `TZ=Asia/Jerusalem` here as well as in the unit file, `RUN_HOUR=8` means
8am where the audience is, not 8am UTC.

## 6. Prove it works before it runs unattended

```bash
sudo -u tiyul npm test                 # offline, no credentials needed
sudo -u tiyul npm run check-sources    # probes every feed
sudo -u tiyul npm run run-once         # a full pass, publishes nothing
sudo -u tiyul npm run deck-once -- "Dolomites mountain"
```

`deck-once` is the one that exercises Chromium, the bundled fonts, the photo
measurement and the renderer together. If it writes slides into `out/decks/`,
the hard part of this deployment is done.

## 7. Keeping it running

> **What the live box actually does, as of 2026-09-20.** The production host
> runs this under **pm2 as root from `/opt/tiyul-social`**, not under systemd
> from `/srv/tiyul/app`. The unit file below describes the intended shape and is
> still the better one, it drops privileges, caps memory and isolates the
> filesystem, none of which pm2 is doing here, but it is not what is running,
> and a deploy that follows this file to the letter will end up with two copies
> of the bot long-polling the same Telegram token. Reconcile before you follow
> the section below.
>
> The commands for what is actually there:
>
> ```bash
> pm2 list                 # tiyul should be `online`
> pm2 restart tiyul
> pm2 logs tiyul --lines 50
> pm2 save                 # persist the process list across reboots
> ```
>
> Note also that pm2 does not read `.env` for you the way `EnvironmentFile`
> does, `src/env.js` loads it from the working directory, which is why
> `exec cwd` must stay `/opt/tiyul-social`.

`/etc/systemd/system/tiyul.service`:

```ini
[Unit]
Description=tiyul+ content pipeline
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tiyul
Group=tiyul
WorkingDirectory=/srv/tiyul/app
EnvironmentFile=/srv/tiyul/app/.env
Environment=NODE_ENV=production
Environment=TZ=Asia/Jerusalem
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=10

# It shares this box. Chromium is the spike, it is held for about five
# minutes after the last render (RENDER_IDLE_MS) and then shut down, so the
# steady state is far below this ceiling.
MemoryMax=1200M

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/srv/tiyul/app/data /var/www/tiyul/cards

[Install]
WantedBy=multi-user.target
```

`EnvironmentFile` does not understand quotes the way a shell does, a value
wrapped in `"` arrives *with* the quote characters. Leave them off.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tiyul
sudo systemctl status tiyul
journalctl -u tiyul -f
```

Then **DM the bot `/start` once** from your own Telegram account. Until you do,
it cannot message you at all, and it ignores everyone whose id is not
`OWNER_ID`. Send `/status` to confirm it is alive.

## 8. TikTok, if you want it

Only after the domain is live, because two of its requirements are about the
domain:

- `cards.tiyulplus.com` must be verified under **URL properties** in the
  developer portal, or every post fails with `url_ownership_unverified`.
- `TIKTOK_REDIRECT_URI` must match what is registered there character for
  character, trailing slash included.

Set `TIKTOK_VERIFIED_DOMAINS` to whatever you verified there. It is checked
before init, and an image on any other domain is refused by name rather than
handed over, because TikTok's answer to an unverified host is not reliably an
error, it can simply decline to fetch, and that surfaces as a post stuck in
`PROCESSING` and looks like nothing at all. Left unset it falls back to the host
of the first card base URL, which is right while there is only one; the moment
you add a second via `CARD_PUBLIC_BASE_URLS`, set it explicitly or the new host
will be refused.

`npm run dry-run` exercises all of this, config, token, `creator_info`, the
privacy level, the domain preflight and the 24h cap, and stops at the one call
that would create a post. It points `STORE_PATH` at a copy of `data/store.json`
first, so it is safe to run while the bot is live. Run it after any change to
the card host or the TikTok app.

Then `npm run tiktok-token` as the service user, so the token pair lands in
`data/store.json`, where it is refreshed, because the access token lasts about
a day and a value in `.env` would be stale by morning.

---

## Keeping it alive

**Back up `data/`.** It is the only thing here that cannot be rebuilt.

```bash
sudo -u tiyul cp /srv/tiyul/app/data/store.json \
  /srv/tiyul/backup/store-$(date +%F).json
```

**Updating:**

```bash
cd /srv/tiyul/app
sudo -u tiyul git pull
sudo -u tiyul npm ci
sudo -u tiyul npm test
sudo systemctl restart tiyul
```

**Cards accumulate.** They are regenerable, so old ones can go, but not
recent ones, which Instagram and TikTok may still be fetching:

```bash
find /var/www/tiyul/cards -name '*.jpg' -mtime +30 -delete
```

## When something breaks

| Symptom | Where to look |
|---|---|
| Bot silent, service running | Did you DM it `/start`? Is your id `OWNER_ID`? |
| `Host system is missing dependencies` | Step 3, and check which user owns `~/.cache/ms-playwright` |
| Renders fail mentioning Heebo | The font guard fired, a bundled face did not parse. It is refusing on purpose; a silent fallback would publish tofu boxes |
| `url_ownership_unverified` | TikTok domain verification, step 8 |
| Instagram fetch fails | `curl -I` the exact URL from off the box; check the `CARD_OUTPUT_DIR` / `CARD_PUBLIC_BASE_URL` pair |
| `no places found` on every deck | Overpass, not you. All three mirrors go down together sometimes; it is transient |
| Memory pressure on a shared box | Lower `RENDER_IDLE_MS` so Chromium is released sooner between renders |
| Admin site 502s | The bot is down — the site is inside its process. `pm2 logs tiyul` |
| Admin site says `off (ADMIN_USERS is not set)` at boot | `.env` is gitignored, so it never arrives by `git pull`. Set it on the box |
| Correct admin password is rejected | A `Secure` cookie over plain http is never sent back. Reach it through Caddy on https, or set `ADMIN_INSECURE_COOKIES=1` for a local run only |
| Admin port already in use after a restart | Both listeners are closed on SIGTERM; if it persists, something else took 8787. `ss -lptn 'sport = :8787'` |
