# The growth desk: plan

Status: approved on 2026-10-10 with the decisions below, and built on this branch except publishing.
Branch: `growth-desk`. Nothing merges until the owner says so.

A local web app that finds travel creators, travel agencies and people planning trips,
prepares everything, and leaves two jobs to the owner: writing the comment and pressing
send. It never sends, comments, follows or likes anything itself.

## 1. Where it lives

```
src/growth/
  main.js            entry for `npm run growth`; checks the switch, starts server + daily timer
  config.js          the switch (post-config.json growth.on, GROWTH_ON), defaults, settings
  store.js           data/growth.json only; atomic write (tmp + rename); GROWTH_STORE_PATH for tests
  rules.js           pure: caps, warm-up gate, one message + one follow-up, do-not-contact, dedupe keys
  budget.js          monthly ledger per API, free allowances, the hard stop
  http.js            the ONLY way growth code reaches the network; allowlist of host + method
  links.js           trip and page links, always with utm_source / utm_medium / utm_campaign
  find/
    index.js         one discovery run: budget check, sources, dedupe, classify, score, store
    queries.js       daily rotation over destinations.json, query templates, hashtag week (30/7d)
    brave.js         Brave Search API: site:tiktok.com and site:instagram.com, search_lang=he
    tiktok.js        TikTok oEmbed (no key); thumbnail downloaded, the CDN URL expires in ~2 days
    instagram.js     hashtag recent_media + Business Discovery, only when Facebook Login is set up
    places.js        Google Places Text Search (agencies: name, phone, website)
    youtube.js       optional Shorts search + channel subscriber counts
    classify.js      one cheap Claude call per batch: Hebrew? creator / customer / neither, destination, places named
    score.js         pure scoring per type
  prepare/
    site.js          the site's itinerary and catalog via fetchCities (src/plan/site.js), place matching
    route.js         creator route: places they named first, then the site's itinerary
    publish.js       calls the site endpoint from SITE-SPEC.md; until it exists, says so and stops
    draft.js         Claude: comment suggestions, the one personal line, customer replies
    guards.js        no URL but the trip link, no long dash, numbers must appear in the source
  report/
    stats.js         counts per stage, week over week, which queries and hashtags converted
    ga4.js           GA4 Data API runReport; service account JWT signed with node:crypto
  web/
    server.js        node:http on 127.0.0.1:4600, Host and token checks, routes
    pages.js         server-rendered Hebrew RTL pages (template strings, every value escaped)
    style.css        one stylesheet, laptop-first
    client.js        ~100 lines: copy + open, gender toggle, buttons that POST
  templates/         creator.txt, creator-followup.txt, agency.txt, agency-followup.txt (editable in Settings)
  selftest.js        the growth group, called from scripts/selftest.run.js
  README.md          setup, keys, running
  PLAN.md            this file
  SITE-SPEC.md       the endpoint the site does not have yet
```

Changes outside `src/growth/`, all of them small:
- `package.json`: `"growth": "node src/growth/main.js"`.
- `post-config.json`: `"growth": { "on": false }`.
- `scripts/selftest.run.js`: one import and one call that runs the growth group.
- `.env.example`: a commented growth block (keys listed in section 6).

**Isolation, and how the tests hold it:**
- The bot never imports `src/growth/`. A test walks the import graph from `bot.js`
  through every relative import and fails if any path lands in `src/growth/`.
- Growth never opens the posting store. The same walk from every growth file must never
  reach `src/store.js`, and no growth file may name `store.json`. The shared helpers it
  imports were checked: `src/env.js`, `src/fetchPage.js`, `src/dashes.js`,
  `src/urlLike.js`, `src/models.js`, `src/plan/site.js` (which imports only
  `src/postConfig.js`). None of them reaches the store.
- The switch: with `growth.on` false and no `GROWTH_ON=1`, `npm run growth` prints why
  and exits 0 before it binds a port or reads `data/growth.json`. `GROWTH_ON=0` forces off.
- Reused, not copied: `loadEnv`, `fetchCities`, `stripDashes` / `hasLongDash`,
  `URL_LIKE`, `outputConfig` / `supportsEffort`. There is no single shared Claude client
  module in this repo: every module does `new Anthropic()` from the SDK and takes its
  call shape from `src/models.js`. Growth does the same.
- The store is written whole, like the posting store, so only one process may own it. A
  second `npm run growth` finds the port taken and exits instead of becoming a second writer.

## 2. Hard rules, and where each one is enforced

| Rule | Mechanism | Test |
|---|---|---|
| Never sends, comments, follows or likes | `http.js` allows GET only to Instagram, Facebook, TikTok and YouTube hosts; POST only to Places, GA4, Google OAuth, Anthropic and (later) the site endpoint. No growth file calls `fetch` directly or imports `src/publish/` or `src/igReplies/` | static scan of every growth file, and the allowlist has no platform POST |
| Official APIs and public endpoints only | the same allowlist; no Playwright and no browser fetch in growth | static scan |
| One message + one follow-up per lead | `rules.js` refuses a second `messaged` or second `followup` | unit tests |
| "Not interested" is forever | `dnc` keys (handle, IG user, phone, domain, place id) checked before a lead is created or shown | unit tests |
| Daily caps (10 / 5 / 3, customers 5) | Today picks at most the cap per column per Israel date, follow-ups included | unit tests |
| Dedupe forever | `seen` keys: TikTok video id, TikTok handle, IG media id, IG username, YouTube video and channel, Places place id, phone, website domain | unit tests |
| Monthly budget cap | `budget.js` checked before every paid call; a run stops mid-way when the cap is hit; re-draft is refused at the cap | unit tests |
| Facts only from the post or site data | the drafting call sees only the post text and the site's data for that destination; the DM is the template verbatim plus ONE generated line; numbers in a draft must appear in its sources | unit tests on the guards |
| No em dashes, natural Hebrew | `stripDashes` on every model output, `hasLongDash` refusal in the guards, template check on save | unit tests |
| UTM on every link, no URL but ours | `links.js` builds every link; guards reject any URL that is not the trip link, and comments carry no URL at all | unit tests |
| Binds to 127.0.0.1 only | `server.listen(port, '127.0.0.1')`, no override for the host | test starts it and checks `server.address()` |

Two protections the brief did not ask for but a local server needs: every POST must carry a
per-run token embedded in the page, and the `Host` header must be `127.0.0.1:4600` or
`localhost:4600`. Without them, any web page open in the same browser could POST to the desk
(spend the budget, mark leads as sent) or reach it through DNS rebinding.

## 3. The flows

**Creator** (TikTok, Instagram, YouTube):
found -> comment queue (a warm-up item: thumbnail, link, why picked, two suggested comments)
-> owner comments from @tiyulplus and presses [הגבתי] or [עקבתי] -> the next day or later the
creator moves to the Creators column with the trip link and the DM -> [העתק ופתח] copies the DM
and opens the profile -> [נשלח] -> four days with no [ענו] -> the follow-up appears once ->
[נשלח] -> nothing more, ever. [ענו], [מעוניינים], [לא מעוניינים] at any point.
[מעוניינים] shows the offer and a reminder to grant Pro from the site's admin page.

**Agency** (Places): found -> Agencies column with a sample plan link and a WhatsApp or email
draft -> [העתק ופתח] copies and opens `wa.me/<number>` (or mail, or the website contact page) ->
[נשלח] -> follow-up after four days, once.

**Customer** (a post asking how to plan a trip): found -> Customers column with one reply
comment drawn from site data. A link only when they explicitly asked for a route, and then
the site's own itinerary or destination page with utm_source=customer. Never a DM.

Stages, as asked: found -> commented -> messaged -> replied -> yes / no -> using it.
"Using it" is a button on the lead page; the Reports page also flags a creator whose
utm_campaign starts showing clicks, so you know when to press it.

## 4. Finding, source by source

**TikTok.** Brave Search with `site:tiktok.com`, `search_lang=he`, `freshness` past month.
Brave's web search does not accept `country=IL`, so the Hebrew comes from the language and
the query. About 20 queries a day: 4 destinations from the 102 in destinations.json
(rotated so each comes back every ~25 days, preferring those with a site page) times the 5
templates (מסלול, טיול ל{dest}, המלצות {dest}, כמה ימים ב{dest}, מישהו היה ב{dest}).
Every `tiktok.com/@user/video/<id>` result then goes through oEmbed for caption, author and
thumbnail. The post date comes from the video id itself (its top 32 bits are the upload time).

What TikTok will not give us: follower counts (no official API without the creator's own
login) and comments. So "1,000 to 30,000 followers" applies only where it is known, and
"people asking for the route" is judged from the caption. Brave's snippet of a profile page
sometimes carries "X Followers"; when it does, it is used, and labelled as from search.

**Instagram.** Hashtag search and Business Discovery both require "Instagram API with Facebook
Login" (graph.facebook.com). This repo runs in Instagram Login mode (`IG_AUTH` unset, so
`instagram`), where Meta marks hashtag search "Not supported". What is needed, exactly:
1. A Facebook Page linked to @tiyulplus.
2. In the Meta app, the "Instagram API with Facebook Login" product with `instagram_basic`,
   `pages_show_list`, `pages_read_engagement` and `instagram_manage_insights`
   (Business Discovery), plus the **Instagram Public Content Access** feature (hashtags).
3. Business verification, and App Review for Public Content Access. Meta's docs disagree on
   whether an app in development mode can use it on your own account without review: try
   it in Graph API Explorer first, it takes five minutes.
4. A long-lived token in `GROWTH_FB_TOKEN` and the Facebook-side IG user id in
   `GROWTH_FB_IG_USER_ID`. Separate variables, so the posting bot's Instagram setup is
   not touched.

Also: hashtag media never includes the username, and `recent_media` covers only the last 24
hours. So hashtag results feed the comment queue and the Customers column (you open the
post and see who it is), and the rotation spends 4 of the 30 weekly hashtags a day.
Instagram creators with a known handle come from Brave `site:instagram.com` results, and
Business Discovery adds their follower count once Facebook Login exists. Until then,
Instagram contributes through Brave only.

**Agencies.** Places Text Search, `languageCode=he`, `regionCode=IL`, one query a day from a
rotation of ("סוכנות נסיעות", "מארגני טיולים", "טיולים לשומרי כשרות", ...) times Israeli
cities. One call returns 20 places. The field mask asks for name, address, website, phone and
maps link: website and phone make it an Enterprise request (1,000 free a month). Then two Brave
queries for each of the day's 3 picks to find their Instagram and Facebook pages. Public
business contacts only.

**YouTube** (off by default, a setting). `search.list` with `relevanceLanguage=he`,
`regionCode=IL`, `videoDuration=short`, then `channels.list` for subscriber counts, which
YouTube does publish. Since June 2026 search has its own 100-a-day quota at 1 unit a call.

**Classification.** Batches of 10 posts to the cheap model: is it Hebrew, is it a creator's
content or a customer's question or neither, which destination, which places it names, and
whether the caption asks for or offers the route. Also the first-person grammar ("הייתי
מתרגשת"), which sets the default of the female/male toggle. A name never does.

**Scoring.** Creators: Hebrew required; followers 1,000 to 30,000 when known (outside that
range when known, dropped); recent; route requests in the caption; comment count where
Instagram gives it. Customers: the post is a planning question. Agencies: a bonus for kosher
and religious groups (name, Places types, website text).

**Schedule.** Once a day while the app runs (default 08:00 Israel time, or on start if today's
run has not happened), plus the [מצא לידים חדשים] button. Both go through the same budget gate.

## 5. Preparing

**Creator route.** Built from `/api/cities` (the same `fetchCities` the posting code uses):
the places the creator named are matched to the catalog (the model may only pick ids from the
list it is shown, and every id is checked), put first, then the site's itinerary fills the
days in its own order. Number of days: from the post when it says ("5 ימים"), otherwise the
site's itinerary up to 5.

**Publishing is blocked.** The site has no endpoint that creates and publishes a trip from a
script. `/api/trips/publish` takes only a trip id and reads it from the signed-in user's own
rows, and no editor account or server token exists. Per your instruction this is not worked
around: `SITE-SPEC.md` is the exact spec for the tiyul-plus session. Until that ships, a
creator's card shows the route it would publish, and [העתק ופתח] stays disabled with the
reason. When it ships, `prepare/publish.js` is the only file that changes. The route is
published when the creator reaches the Creators column (after the warm-up), and withdrawn
automatically on [דלג] or [לא מעוניינים].

**Pro.** Granting exists (`/api/admin/plan`, used by the admin page), so the desk does not
need an API for it: [מעוניינים] reminds you to grant it by hand. But the database constraint
in the site's SQL still allows only `free` and `premium`, so a Pro grant may fail in
production today. That check is item 2 of the spec.

**PDF trip book.** The site can only print one from the owner's own trip in the browser,
so the agency message links the trip page and does not promise an attachment (optional
item in the spec).

**Drafts.** The DM is the template text verbatim. Claude writes only the
"[שורה אישית אחת על הפוסט]" line, from the caption, and the guards check it: one sentence,
no URL, no long dash, no number that is not in the caption, no compliment about anything the
caption does not show. Comments: two suggestions, written like a real answer to the post's
question from the site's data for that destination; no link and no mention of the site.
[נסח מחדש] asks again; [ערוך] saves your text, and your text is what gets copied.
Templates use `{male|female}` pairs, so the toggle is instant and free.

## 6. Cost per month at the default caps

Prices checked on the official pages on 2026-10-10.

| API | What for | Monthly volume | Free allowance | Est. cost |
|---|---|---|---|---|
| Brave Search | TikTok and Instagram discovery, agency socials | ~30 a day, ~900 | $5 credit a month (~1,000) | $0 to $5 |
| TikTok oEmbed | caption, author, thumbnail | ~600 | free, no key | $0 |
| Google Places Text Search (Enterprise fields) | agencies | ~30 to 60 | 1,000 free | $0 |
| YouTube Data API (optional) | Shorts and subscriber counts | ~600 | 100 searches a day | $0 |
| Instagram Graph (once Facebook Login exists) | hashtags, Business Discovery | ~120 hashtag calls | free | $0 |
| GA4 Data API | Reports | a few a day | free | $0 |
| Claude Sonnet 5.5 ($2 / $10 per M) | comments, personal lines, replies | ~30 calls a day, ~4k in / 0.5k out | none | ~$12 |
| Claude Haiku 4.5 ($1 / $5 per M) | classify, match, check | ~10 calls a day | none | ~$2 |
| **Total** | | | | **~$14 to $19** |

Default budget cap: **$25 a month**. The ledger counts billable spend after each API's free
allowance, shows it on Today and Reports, and stops finding at the cap.

Not available, and why:
- Google Custom Search JSON API: closed to new customers, and shuts down for everyone on
  2027-01-01.
- Bing Web Search: retired in August 2025.
- SerpApi and Serper: they scrape Google, not official.
- Exa ($10 free credit a month, then $4 to $7 per 1,000) could be a second provider if
  Brave's TikTok coverage turns out thin. That is a measurement for the demo, not a guess
  for now.

## 7. Pages

All Hebrew, RTL, server-rendered, one stylesheet, laptop width first.

1. **היום** (home): four columns, comment queue / creators / agencies / customers, each capped;
   the budget bar; [מצא לידים חדשים]; when the last run happened and what it found.
2. **ליד** (one per person or post): what was found and why, thumbnail and link, the route
   and trip link, the drafts, and the buttons: [העתק ופתח], [ערוך], [נסח מחדש], the female/male
   toggle, [נשלח], [דלג], [ענו], [מעוניינים], [לא מעוניינים].
3. **כל הלידים**: filter by type, stage, source and date.
4. **דוחות**: per type, counts per stage; clicks per utm_campaign from GA4 (or exactly which
   credentials are missing); which queries and hashtags led to a yes; this week against last.
   GA4 consent defaults to denied on the site, so GA4 sees consented visits only, and the
   page says so (optional spec item 1 fixes that at the source).
5. **הגדרות**: caps, budget, offers, queries, hashtags, cities, YouTube on/off, run hour,
   warm-up and follow-up delays, and the four templates (saved to `src/growth/templates/`).

## 8. What the demo needs from you

To show real results, the demo needs these in `.env`:
- `BRAVE_API_KEY`: brave.com/search/api, the Search plan. A card is required.
- `GOOGLE_MAPS_KEY`: a Google Cloud key with Places API (New) enabled. Billing must be on,
  but it stays inside the free 1,000.
- Optional: `YOUTUBE_API_KEY`. The same Google project works.
- Optional: `GA4_PROPERTY_ID` (the numeric property id, not `G-MR48GYKQ3R`) and
  `GA4_SERVICE_ACCOUNT_FILE`, the path to a service account JSON key whose email is added
  as Viewer in GA4 Property Access Management.
- Optional, and slow because of Meta review: `GROWTH_FB_TOKEN` and `GROWTH_FB_IG_USER_ID`.

Without the optional ones, the demo shows exactly what each missing piece would add and what
it needs, instead of empty columns that look like a quiet day.

## 9. Decisions at approval, and what changed while building

The owner's answers (2026-10-10):
- Brave Search: yes. Instagram through Brave only, no Facebook Login for now. YouTube off.
- Customers: 5 a day. Follow-ups count inside each column's cap.
- A creator's DM appears only after [הגבתי]. [דלג] on a comment item skips only that
  video; [לא רלוונטי] drops the creator for good (stored like "not interested").
- A route goes public only when the creator is shown in the Creators column, and comes
  down on [דלג], [לא מעוניינים] or [לא רלוונטי]. Publishing itself waits for SITE-SPEC.md.
- Agency sample: the site's existing public itinerary pages (30 live in the sitemap).

Found while building:
- **Brave's TikTok and Instagram index is old.** Measured on 2026-10-10 with the real key:
  of 84 TikTok videos across six Hebrew queries, none was from the last 45 days and 3
  were from the last year; of 54 Instagram posts, none was from the last 90 days. A
  Hebrew query with `site:tiktok.com` returns topic pages unless the word "video" is
  added, and `freshness` removes the videos altogether. The queries now carry "video"
  and no freshness filter, and post dates are read from the TikTok id and the Instagram
  shortcode. The 45-day and 14-day limits are kept, which means Brave alone will rarely
  produce a lead that passes them. See the owner's options in the hand-off.
- The creator template's "שמתי לב שהרבה שואלים אותך על המסלול בתגובות" is wrapped in
  `{{אם שואלים: ...}}`: the desk cannot read comments, so the sentence is kept only when
  the caption itself shows people asking.
- The local server checks the Host header and a per-run token on every POST, which the
  plan described, and sends a strict Content-Security-Policy.

Publishing (2026-10-10, after the site shipped `/api/internal/trips`):
- Built in `prepare/publish.js`: publish when the creator is shown in the Creators
  column, withdraw on [דלג], [לא מעוניינים] and [לא רלוונטי], a timer that retries any
  withdrawal the site did not answer, and a failed publish retried at most hourly.
  http.js allows exactly POST and DELETE on our own `/api/internal/trips`.
- Verified on production: two routes published (200), then withdrawn by pressing
  [דלג] in the desk (410).
- The first real run with the approved settings: 26 searches, 250 TikTok and
  Instagram posts, every one older than 45 days, so 0 creators and 0 customers;
  15 agencies. Old posts are now dropped before they are sorted, so they cost
  nothing beyond the search, and the empty comment queue says why it is empty.

YouTube on (2026-10-10, the owner's decision after the stale-index finding):
- A separate key, `YOUTUBE_API_KEY`, restricted to YouTube Data API v3.
- Five Hebrew templates times three destinations: 15 of the 100 free searches a day,
  plus one channels.list call for subscriber counts.
- YouTube has no direct messages, so channel descriptions are read for the public
  Instagram, TikTok or email they list, and [העתק ופתח] opens that. A channel that
  lists none opens its own page.
