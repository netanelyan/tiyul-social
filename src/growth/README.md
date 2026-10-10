# The growth desk

A local website that finds travel creators, travel agencies and people planning
trips, prepares everything, and leaves you two jobs: writing the comment and
pressing send. It never sends a DM, a comment, a follow or a like itself, on any
platform. There is no code path that could.

It runs on your computer only, on `http://127.0.0.1:4600`. It does not touch the
VPS, the posting bot, or the posting store.

## Run it

1. Put the keys below in the repo's `.env`.
2. Turn it on: `"growth": { "on": true }` in `post-config.json`, or just for one
   run, `GROWTH_ON=1 npm run growth` (PowerShell: `$env:GROWTH_ON=1; npm run growth`).
3. `npm run growth` and open http://127.0.0.1:4600.

With the switch off, `npm run growth` prints why and exits. `GROWTH_ON=0` turns it
off even when the file says on. The port is `growth.port` in `post-config.json`
(or `GROWTH_PORT`); the host is always 127.0.0.1.

Discovery runs once a day while the app is open (at the hour in Settings, 08:00 by
default, or on start if today's run has not happened), and whenever you press
[מצא לידים חדשים].

## Keys

| Variable | Needed for | Where |
|---|---|---|
| `ANTHROPIC_API_KEY` | sorting posts, drafting comments and the personal line | already in `.env` |
| `BRAVE_API_KEY` | finding TikTok and Instagram posts | brave.com/search/api, the Search plan ($5 per 1,000, with a monthly $5 credit; a card is required) |
| `GOOGLE_MAPS_KEY` | finding agencies (Places API (New) Text Search) | Google Cloud console, enable "Places API (New)"; billing must be on, usage stays in the free 1,000 a month |
| `GROWTH_PUBLISH_TOKEN` | publishing creator routes on tiyulplus.com | the same value as on Vercel, at least 32 characters |
| `YOUTUBE_API_KEY` | finding creators on YouTube Shorts, the only fresh creator source | a separate key restricted to "YouTube Data API v3" in the same Google project (falls back to `GOOGLE_MAPS_KEY` if that key allows it) |
| `GA4_PROPERTY_ID` | Reports: clicks per utm_campaign | GA4 Admin, Property details: the numeric id, not `G-...` |
| `GA4_SERVICE_ACCOUNT_FILE` | the same | a service account JSON key from Google Cloud with the Google Analytics Data API enabled; add its email in GA4 Property access management as Viewer |

Missing keys never fail silently: the run summary on Today says which source was
skipped and why, and Reports says exactly what GA4 needs.

Instagram hashtag search and Business Discovery need "Instagram API with Facebook
Login" plus Meta's App Review for Public Content Access. That is deliberately not
set up; Instagram leads come from Brave search results only.

## What it costs

At the default caps, about $14 to $19 a month: Claude drafting (~$12), Claude
sorting (~$2), Brave (inside its $5 credit at ~900 queries a month). Places, TikTok
oEmbed, YouTube and GA4 stay free. The monthly cap (default $25) is in Settings;
spend is on every page's header and on Reports, and finding stops when it is reached.

## The flows

- **Creators**: found -> comment queue (two suggested comments) -> you comment from
  @tiyulplus and press [הגבתי] -> the next day they appear under Creators with their
  route and the DM -> [העתק ופתח] copies it and opens the profile -> [נשלח] -> if
  nothing is logged in 4 days, the follow-up appears once -> then never again.
  [דלג] on a comment item skips only that video; [לא רלוונטי] drops the creator for good.
- **Agencies**: found -> Agencies column with a sample itinerary page and the
  WhatsApp or email text -> [העתק ופתח] -> [נשלח] -> one follow-up after 4 days.
- **Customers**: a post asking how to plan a trip -> one reply comment from our
  site's data, with a link only if they explicitly asked for a route. Never a DM.

[לא מעוניינים] and [לא רלוונטי] are stored against every key the person has (handle,
phone, website, place) and checked before anything new is created.

## Publishing creator routes

Through `POST /api/internal/trips` on tiyulplus.com (built from `SITE-SPEC.md`),
with `GROWTH_PUBLISH_TOKEN`. Every trip belongs to the site's editor account and
is keyed by the lead, so a re-send updates the same page.

- A route goes public only when the creator appears in the Creators column, the
  day after you mark [הגבתי]. Nothing else in the desk publishes.
- It comes down (the page answers 410) on [דלג], [לא מעוניינים] or [לא רלוונטי].
  If the site does not answer, the desk's timer tries again until it does.
- A refused publish (an id the catalog dropped, a daily cap) is shown on the card
  with the reason and retried at most once an hour.
- The public page shows the places and the map, never the creator's name.

Verified on production on 2026-10-10: two routes published, opened (200), then
withdrawn through [דלג] (410).

## Templates

`templates/*.txt`, editable on the Settings page (saved back to these files):

- `{זכר|נקבה}`: the female/male toggle picks a side.
- `[שם]`, `[יעד]`, `[שורה אישית אחת על הפוסט]`, `[קישור]`, `[מתנה]`: filled per lead.
  `[שם]` and the personal line disappear cleanly when there is nothing true to say.
- `{{אם שואלים: ...}}`: kept only when the post itself says people ask for the
  route. The desk cannot read comments, so it will not claim they do otherwise.

No long dashes and no URLs in a template; the link only ever enters through `[קישור]`.

## Layout

```
main.js       npm run growth: checks the switch, then loads desk.js
desk.js       the store, the server, the daily timer, what each button does
config.js     the switch, the port, default settings
store.js      data/growth.json (never the posting store)
rules.js      caps, warm-up, one message + one follow-up, do-not-contact, dedupe
claude.js     every Claude call, budget-checked
links.js      every link, with utm_source / utm_medium / utm_campaign
find/         discovery: queries, Places, sorting, scoring, thumbnails
../clients/   shared with the trend watcher: the network door and its allowlist,
              Brave, YouTube, TikTok oEmbed, the monthly budget ledger
prepare/      site data, routes, drafts, guards, templates, composing, publishing
report/       stage counts, week over week, GA4
web/          server-rendered pages, the server, one stylesheet, one small script
selftest.js   the growth group in `npm test`
```

Thumbnails are saved to `data/growth-thumbs/` (TikTok's thumbnail links expire in
about two days). Both `data/` paths are gitignored.
