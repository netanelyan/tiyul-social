# The growth desk

A website that finds travel creators, travel agencies and people planning
trips, prepares everything, and leaves you two jobs: choosing the text and
pressing send. It never sends a DM, a comment, a follow or a like itself, on any
platform. There is no code path that could.

It runs on the VPS behind a login, at `https://desk.tiyulplus.com` (see "On the
VPS" below), or on your own computer at `http://127.0.0.1:4600`. Either way it
listens on 127.0.0.1 only. It does not touch the posting bot or its store.

## Run it

1. Put the keys below in the repo's `.env`.
2. Turn it on: `"growth": { "on": true }` in `post-config.json`, or just for one
   run, `GROWTH_ON=1 npm run growth` (PowerShell: `$env:GROWTH_ON=1; npm run growth`).
3. `npm run growth` and open http://127.0.0.1:4600.

With the switch off, `npm run growth` prints why and exits. `GROWTH_ON=0` turns it
off even when the file says on. The port is `growth.port` in `post-config.json`
(or `GROWTH_PORT`); the address is always 127.0.0.1.

ONE DESK. Once the data has moved to the VPS, `data/growth.MOVED` sits next to
the old file and a local `npm run growth` refuses to start, so two desks cannot
both spend the monthly budget.

Discovery runs once a day (at the hour in Settings, 08:00 by default, or on
start if today's run has not happened), and whenever you press [Look for new
leads].

## Keys

| Variable | Needed for | Where |
|---|---|---|
| `ANTHROPIC_API_KEY` | sorting posts, reading agency sites, drafting, the bot-score review | already in `.env` |
| `BRAVE_API_KEY` | finding TikTok and Instagram posts | brave.com/search/api, the Search plan ($5 per 1,000, with a monthly $5 credit) |
| `GOOGLE_MAPS_KEY` | finding agencies (Places API (New) Text Search) | Google Cloud console; usage stays in the free 1,000 a month |
| `GROWTH_PUBLISH_TOKEN` | publishing route pages on tiyulplus.com | the same value as on Vercel, at least 32 characters |
| `YOUTUBE_API_KEY` | finding creators on YouTube Shorts, and reading a video's description and top comments | a key restricted to "YouTube Data API v3" |
| `GROWTH_PASSWORD` | the login, required whenever `GROWTH_PUBLIC_HOST` is set | you choose it, at least 12 characters; never printed anywhere |
| `GROWTH_SESSION_SECRET` | signing the login cookie (optional: derived from the password when unset) | any long random string; changing it logs everyone out |
| `GROWTH_PUBLIC_HOST` | the name the desk answers under through Caddy | `desk.tiyulplus.com` on the VPS; unset locally |
| `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_FILE` | Reports: visits per campaign | GA4 Admin, Property details; a service account with Viewer access |

Missing keys never fail silently: Today says which source was skipped and why.

## What it costs

Drafting and the review pass run on Opus 5.5 ($4 in, $20 out per million
tokens); reading an agency's site on Sonnet 5.5; sorting on Haiku 4.5. One item
is one drafting call for three variants, a redo of any the checks refused, one
review call, and a second look when the reviewer rewrote one. Measured on
2026-10-11 over 17 real items: $0.12 a comment, $0.18 an agency message with
its site read, $0.15 a creator DM. That is about $41 a month at that day's
volume (7 comments and 3 agencies a day) and about $91 at the full caps, plus
sorting and Brave. Fable 5.1 measured about three times as much ($0.36 a
comment, $0.66 an agency message) and did not score better. The monthly cap (default $50) is in
Settings; spend is in every page's header and on Reports, and searching and
drafting stop when it is reached. Fable 5.1 ($10 / $50) is in the price table
for the day it is chosen in Settings; an unknown model is billed at the dearest
rate, so a typo overstates the spend rather than hiding it.

## The drafts

Every first message, comment and reply is written whole by the model, as
Netanel: first person singular, the way he talks on WhatsApp, short sentences,
one emoji at most, no exclamation marks (`prepare/voice.js`). Each is written
three times from a context that holds everything it may say:

- a YouTube video: its title, full description and top ten comments
  (`find/videoContext.js`); a TikTok or Instagram post: its caption only, and
  the card says so;
- an agency: its homepage and up to two of its own trip pages, read by Sonnet
  into the destinations it sells and who its clients are, each with the words it
  came from (`prepare/agencyProfile.js`);
- our site's data for the destination.

Every variant quotes one specific thing about them, and code checks the quote
is really in the source it names. Code refuses the bot tells
(`prepare/tells.js`): the stock openers and connectives, formal words, generic
praise, colons and semicolons, lists of three, a closing moral, the long dash,
any claim of travel experience, "we", and a gendered "you" when the gender is
not known. The lengths: comments about 150 characters and two sentences,
replies to people asking how to plan a trip about 250 and three, first
messages about 350 with exactly one link. A refused variant is asked for again
once, with the reasons.

Then a separate call reads the variants as a skeptical Israeli and scores each
from 0 (a person wrote it) to 10 (a bot); any at 4 or more is rewritten, and the
rewrite replaces it only if it passes the same checks (`prepare/review.js`).
The card shows each variant with its score.

The gender is "unknown" unless the post's own grammar says otherwise, and the
drafts then use the plural. The toggle on the lead page is She / He / Unknown.

LEARNING FROM YOU. [Copy & open] tells the desk which variant you copied and
the exact text; [Sent] or [Commented] logs the draft beside what went out. If
you changed it after pasting, the card's "Changed it after pasting?" box takes
the final text. Your last ten sent texts of the same kind are the next drafts'
examples, and Reports shows "Your edits this week": which option you pick, how
much shorter you make them, and the words you cut and add most.

## The flows

- **Creators**: found -> a comment on their video (three options) -> you
  comment from @tiyulplus and press [Commented] -> the next day they appear
  under Creators with their route, published on the site, and the message ->
  [Copy & open] -> [Sent] -> if nothing is logged in 4 days, the one follow-up
  appears -> then never again. [Skip] on a comment skips only that video; [Not
  for us] drops the creator for good.
- **Agencies**: found -> picked for today -> their site is read, a sample route
  on a city they sell is published, and the card shows it (days, places, link)
  beside the message -> [Copy & open] -> [Sent] -> one follow-up after 4 days.
  When nothing they sell is in our catalog, the closest page, with the reason.
- **Questions**: a post asking how to plan a trip -> one reply, from our site's
  data, with a link only if they asked for a route. Never a DM.
- **Instagram handles for the trend watcher**: every Hebrew travel creator the
  sorter meets, lead or not, from an Instagram link or "Instagram: @handle" in a
  YouTube channel's or Short's description, the Linktree page it links, or
  Brave's instagram.com results (a post too old for a lead, or a profile, is
  sorted for its author alone, 20 a run). Kept in `igHandles` in growth.json,
  where the bot's trend watcher reads them; never a lead, never contacted. The
  run details on Today say how many were added.

[Not for us] and [Not interested] are stored against every key the person has
(handle, phone, website, place) and checked before anything new is created.

## Publishing routes

Through `POST /api/internal/trips` on tiyulplus.com (`SITE-SPEC.md`), with
`GROWTH_PUBLISH_TOKEN`. Every trip belongs to the site's editor account and is
keyed by the lead, so a re-send updates the same page.

- A creator's route goes public the day they reach the Creators column; an
  agency's sample route the day the agency is picked for a message. Nothing else
  in the desk publishes.
- The site takes 20 new pages a day from the editor account. The desk counts
  creators and agencies together against `publishPerDay` (Settings, 20) and waits
  rather than spending the site's refusal; a waiting route says so on its card.
- A page comes down (it answers 410) on [Skip], [Not for us] and [Not
  interested]. If the site does not answer, the desk's timer tries again.

## Short links

Messages carry the plain page link, `https://tiyulplus.com/trips/...`, with no
`utm_` tail: WhatsApp shows a link in full and a tagged one looks like spam.
The cost is that GA4 cannot tie those visits to a lead. The site's `/t/<code>`
links are its shared-trip viewer and cannot carry attribution, so a short link
needs a change on tiyulplus.com, which the desk does not make. The change:

1. A Supabase table, `sql/supabase-short-links.sql`:
   ```sql
   create table short_links (
     code text primary key check (code ~ '^[a-z0-9]{5,8}$'),
     target text not null check (target like '/%'),
     utm_source text, utm_medium text, utm_campaign text,
     created_at timestamptz not null default now(),
     clicks integer not null default 0
   );
   alter table short_links enable row level security;  -- service role only
   create unique index short_links_target_campaign on short_links (target, utm_campaign);
   ```
2. `src/app/go/[code]/route.ts`: `GET` looks the code up with the service role,
   adds one to `clicks`, and answers 302 to `target` with the three `utm_`
   parameters added; an unknown code answers 302 to `/`. `/go/`, not `/t/`, so
   the two kinds of code never share a namespace.
3. `src/app/api/internal/links/route.ts`: `POST { target, utm_source,
   utm_medium, utm_campaign }` with `Authorization: Bearer <GROWTH_PUBLISH_TOKEN>`
   (the same check as `/api/internal/trips`), returns `{ code, url }`, the same
   code again for the same target and campaign.
4. `robots.ts`: disallow `/go/`.

The desk already asks for `/api/internal/links` (`prepare/short.js`). Today it
answers 404, which is remembered for a day; the day the site ships it, messages
switch to `tiyulplus.com/go/<code>` by themselves.

## Templates

Only the two follow-ups and the reply's link line are templates
(`templates/*.txt`, editable in Settings). Fields: `[יעד]`, `[קישור]`. No
gendered forms (most people's gender is not known), no web addresses, no long
dash; the first messages are written by the model, see "The drafts".

## On the VPS

The desk runs as its own systemd service, `tiyul-growth`, from
`/opt/tiyul-growth`, with its data in `/var/lib/tiyul-growth`, as a system user
of its own, on 127.0.0.1:4600. Caddy (the one in BrickDeal's Caddyfile, which
also serves cards.tiyulplus.com) is the only thing in front of it, at
`https://desk.tiyulplus.com`. There is no plain-HTTP address.

Setting it up (each step checked before the next; every file touched is backed
up first as `<file>.bak.<epoch>`):

1. DNS at Porkbun: an A record, host `desk`, `129.121.89.58`, TTL 600.
2. `useradd --system --no-create-home --shell /usr/sbin/nologin tiyul-growth`;
   a git checkout at `/opt/tiyul-growth` with
   `receive.denyCurrentBranch updateInstead`, so it is updated by a push of the
   branch it has checked out (`main` since the desk merged, 2026-10-11);
   `npm ci --omit=dev`; `/opt/tiyul-growth/.env` mode 600, owned by the desk's
   user, with the keys above and `GROWTH_PUBLIC_HOST=desk.tiyulplus.com`.
3. The data: `data/growth.json` and `data/growth-thumbs/` copied into
   `/var/lib/tiyul-growth/` (`growth.json`, `thumbs/`), owned by the desk's user;
   `data/growth.MOVED` written locally.
4. `deploy/tiyul-growth.service` to `/etc/systemd/system/`, then
   `systemctl daemon-reload && systemctl enable --now tiyul-growth`.
5. `deploy/Caddyfile.desk` appended to `/etc/caddy/Caddyfile`, then
   `caddy validate --config /etc/caddy/Caddyfile` and `systemctl reload caddy`
   (a reload, not a restart), once the DNS name resolves.
6. Checks: BrickDeal's pages and a cards.tiyulplus.com slide answer as before,
   pm2's processes keep their pids, `/` without a session goes to the login, a
   wrong password is refused and the sixth answers 429.

Commands:

- restart: `ssh tiyul-vps 'systemctl restart tiyul-growth'`
- logs, live: `ssh tiyul-vps 'journalctl -u tiyul-growth -f'`
- logs, today: `ssh tiyul-vps 'journalctl -u tiyul-growth --since today'`
- status: `ssh tiyul-vps 'systemctl status tiyul-growth'`
- update: `git push ssh://tiyul-vps/opt/tiyul-growth main:main`, then
  `ssh tiyul-vps 'cd /opt/tiyul-growth && npm ci --omit=dev && systemctl restart tiyul-growth'`

The host firewall is a separate step, after the desk is live.

## Layout

```
main.js       npm run growth: the switch, the moved-desk check, the password check, then desk.js
desk.js       the store, the server, the daily timer, what each button does
config.js     the switch, the port, the limits, default settings
store.js      data/growth.json (never the posting store), and its migrations
rules.js      caps, warm-up, one message + one follow-up, do-not-contact, dedupe
claude.js     every Claude call, budget-checked, with the refusal fallback
links.js      every link: plain for people, tagged for GA4
find/         discovery: queries, Places, sorting, scoring, thumbnails, a
              video's description and comments (videoContext.js), and the
              trend watcher's Instagram handles (igHandles.js)
../clients/   shared with the trend watcher: the network door and its allowlist,
              Brave, YouTube, TikTok oEmbed, the monthly ledger, the model prices,
              the stop
prepare/      site data, routes, the agency's profile and example, the voice, the
              tells, drafting, the review, learning from edits, short links,
              composing, publishing
report/       stage counts, week over week, GA4
web/          server-rendered pages, the server, the login, one stylesheet, one script
deploy/       the systemd unit and the Caddy block for the VPS
selftest.js   the growth group in `npm test`
```

Thumbnails are saved to `data/growth-thumbs/` (or `GROWTH_THUMB_DIR`), because
TikTok's thumbnail links expire in about two days.
