# Daily posting, hands-off: plan

Status: approved on 2026-10-10 with every default in section 4, and built on branch
`daily-posting` (cut from `growth-desk`, because Part 2 reuses the growth desk's search
clients). The three choices made while building the mix (section 3.5) were approved on
2026-10-11. The tiyul-plus repo is not touched.

**Merge gate:** the branch merges only after the private test post and one public post
the owner approves by hand (section 6). The private test runs from a separate checkout on
the VPS, never from the bot's own.

The goal: one approval tap a day. TikTok 2 posts a day in week 1, then 3, all public.
Instagram 1 to 2 a day. Formats from what works now plus our own numbers.

## 0. What the code does today (read before the rest)

Found while mapping the repo, each checked by hand. Five of these stand between today
and the goal, so the plan fixes them first.

1. **No TikTok post goes public.** Every TikTok post is a draft in the account's inbox
   (posts `src/posts/index.js:461`, plans, clips, and decks forced at `bot.js:568`). The
   direct-post code exists (`src/publish/tiktok.js:702` sends `auto_add_music` on photo
   direct posts) and nothing reaches it, because the app is unaudited.
2. **The posting windows and the Shabbat rule are not enforced.** `src/schedule.js` is
   imported at `bot.js:13` and never called. The drip publishes every 6 hours counted from
   boot (`POST_INTERVAL_MINUTES=360`), at any hour, on Shabbat too. BRIEF.md says
   `schedule.js` enforces both; it does not.
3. **The opening-line repeat guard does nothing in production.** `buildPost` takes the
   history it avoids repeats from as an argument (`src/posts/index.js:140,171`); the
   production call (`bot.js:2604`) never passes it. There are 18 hook templates.
4. **The "look" rotation is mostly cosmetic, and one template dominates.** The drawn look
   changes the design only for the plan type; the verdict type has weight 20 of 33 (60%)
   and `memory: 0`, so two verdict posts in a row, same design, is the normal case.
5. **TikTok metrics cannot work.** `src/metrics/tiktok.js:70,83` reads `.token`, the store
   saves `accessToken` (`src/store.js:1768`); the id recorded is the `publishId`, not a
   post id; and the `video.list` scope was never granted. TikTok's API has no save count
   at all.

Also: Instagram's 25-per-24h quota is never checked before publishing; a post's Telegram
approval shows only its cover; posts are never checked against `idInUse`; and slideshows
are about 20% of today's rotation (0.8 a day), the rest is video.

## 1. The service: Zernio, with Upload-Post as the fallback

Checked in each service's API docs, not marketing. Three pass every requirement:

| | Zernio (formerly Late) | Upload-Post | Blotato |
|---|---|---|---|
| Public TikTok photo carousel via API | yes, up to 35 images | yes ("runs its own approved TikTok app") | yes |
| Auto music | `tiktokSettings.auto_add_music` | `auto_add_music` | `autoAddMusic` |
| Instagram carousel | yes, up to 10 | yes, up to 10 | yes |
| TikTok cap per account | 15 photo posts / 24h | 15 / 24h | 25 / 24h |
| Private test (SELF_ONLY) | yes | yes (defaults to PUBLIC if omitted) | yes |
| Status | `GET /v1/posts/{id}`, webhooks, resolves the public URL | sync URL, polling, webhook | polling only |
| Price for 1 TikTok + 1 Instagram | **$0** (1 to 2 accounts free, full API, unlimited posts) | $24/mo, or $16/mo yearly | $29/mo; generating a key starts billing |

**Recommendation: Zernio.** Free for exactly our two accounts, every requirement
documented, caps about five times our 3 a day, media taken by URL (our slides are already
public at `cards.tiyulplus.com`), webhooks. Verified on its pricing and TikTok pages:
"Every account, free or paid, includes full API access, unlimited posts", and both
`PUBLIC_TO_EVERYONE` and `SELF_ONLY` on photo posts.

Caveats, all from its docs:
- It never uses the word "audited". It documents public direct posts, and the first
  private test proves the connection, not the public path. Upload-Post says outright that
  it runs an approved app; it is the fallback if Zernio's public posts fail.
- What it can access. TikTok: `user.info.basic`, `user.info.profile`, `video.publish`,
  `video.upload`, `video.list` (read our own videos). No TikTok scope allows deleting,
  reading DMs or reading comments. Instagram: connect with `scopes=posting` to keep its
  comments and messages permissions off (we keep our own Instagram publisher anyway).
  Revoked from Zernio's dashboard, or in TikTok under Settings, Security, app permissions.
- Neither TikTok nor Instagram posts can be deleted through any of these APIs. A wrong
  public post is removed by hand. This is why nothing posts without approval.
- A SELF_ONLY post has no public URL until it is made public (TikTok's own rule).
- Required on every TikTok post: `content_preview_confirmed: true`,
  `express_consent_given: true`, `publishNow: true` (without it, Zernio schedules instead).
- Per-post analytics document likes, comments and shares; views are not documented. To
  be checked on the first real post, not assumed.

**Instagram stays on our own publisher.** It works, it already reads saves and shares
through `src/metrics`, and moving it gains nothing. Zernio's Instagram path stays unused.

## 2. Part 1: posting publicly, one tap a day

**2.1 A new publish target, `zernio`** (`src/publish/zernio.js`), behind the same shape the
others have in `publishNext` (`bot.js:1059`): it returns `{ publishId, privacy, notes,
status }` or throws with `step` and `code`, and classifies its errors into the same four
buckets (card-level, platform limit, config problem, other). Chosen in `post-config.json`:

```json
"publish": {
  "tiktok": { "via": "zernio", "privacy": "PUBLIC_TO_EVERYONE", "autoAddMusic": true,
              "dailyCap": 3, "fallback": "draft" }
}
```

- Status is polled until published or failed (or read from the webhook if we expose one
  later); the resolved TikTok URL gives the real post id, which fixes the metrics join.
- **Fallback:** any failure that is not a platform limit or a cap sends the same post down
  today's draft path, and the Telegram notice says it went as a draft and why.
- **Caps as hard limits:** our daily cap (3, 2 in week 1), TikTok's ~15/day and Zernio's
  15 photo posts per 24h as ceilings, Zernio's 60 requests/min, and Instagram's 25/24h
  checked before publishing (today it is only read at boot).

**2.2 The morning digest.** At a configured hour (default 08:00) the day's slate is built
and sent as one Telegram message: an album of the covers, then one line per post (time,
platform, type, destination, slides, caption opening) and buttons: `✅ אשר הכל`, and
`⏭ דלג 1`, `⏭ דלג 2`... per post. Nothing posts without approval; `autoApprove` in
`post-config.json`, off by default, skips the tap. The web admin gets the same approve-all
through `adminOps`, one implementation for both (the rule the admin site was built on).
The existing per-item approval stays for everything outside the slate.

**2.3 The schedule.** Clock times in `post-config.json`, not a boot-relative timer:

```json
"schedule": {
  "slots": { "tiktok": ["12:15", "19:15", "21:15"], "instagram": ["13:15", "20:30"] },
  "rampUntil": "2026-10-19", "rampTiktokPerDay": 2,
  "sameDeckGapMinutes": 60
}
```

- Inside the existing windows (12 to 14, 19 to 22) and outside Shabbat (Fri 15:00 to
  Sat 20:00), finally enforced through `src/schedule.js`. Saturday keeps its 20:15 and
  21:15 slots, so Saturday counts as a posting day and 90% of days is reachable.
- The same deck never goes to both platforms within the same hour.
- No two consecutive posts use the same template. "Template" becomes the post type plus
  the look it actually rendered, and the slate orders posts so neighbours differ.

**2.4 Volume check (3 TikTok + 2 Instagram a day).** The slate is 3 distinct decks a day;
Instagram takes 2 of them, at other hours, in their 4:5 renders.

- **Destinations, no repeat within 7 days:** 21 a week from the 61 site pages already
  mapped in destinations.json, plus 114 site pages not mapped yet. Enough.
- **Opening lines, no repeat within 14 days:** enforced on the rendered line, by fixing
  the guard and passing the store's history (item 0.3). 18 templates times the
  destination names keep the lines unique; the same template shape will recur every few
  days until the watcher adds new shapes.
- **Cost:** a slideshow post makes no text-model calls (hooks are templates). Photos come
  free from our own pages and Wikimedia; only a place with none goes to stock, at up to
  six Haiku calls (about $0.005 each). Estimate $0 to $0.05 a post, so **$1 to $7 a month**
  at 90 posts, plus about $2 a month for the trend watcher's image reading. **Under $15.**
  Zernio is $0.

## 3. Part 2: the trend watcher

**3.1 Shared clients.** The watcher runs inside the bot (it feeds the generator and the
weekly report), and the growth desk's selftest forbids the bot from importing
`src/growth/`. So the clients move to `src/clients/` (the network door and its allowlist,
Brave, YouTube, TikTok oEmbed, the budget ledger), and both the desk and the bot import
them from there. The desk stays isolated; the "never sends" checks cover `src/clients/`.

**3.2 Sources, honestly.** Twice a week (Sunday and Wednesday, 09:00):

- **YouTube Shorts carry the signal.** Real views, likes and comments from `videos.list`.
  Probed today: English travel formats from the last 30 days at 30K to 270K views ("3
  Travel Mistakes You Should Never Make Abroad", 174K). Hebrew is thin: one or two
  results a query.
- **TikTok and Instagram through Brave are a weak signal only**, with no numbers (oEmbed
  gives none, and none are invented). Brave's index is also old: of 84 TikTok videos,
  none was from the last 45 days. In practice YouTube carries the watcher.
- Spend goes through the same budget ledger with its own monthly cap (default $3).

**3.3 Format cards: the shape, never the content.** The existing vision pattern
(`judgeThumb`, `src/video/vision.js`) reads the thumbnail and the title in memory and
returns: the hook shape as a template with placeholders ("X טעויות ש...", "שווה / לא
שווה"), the topic type (mistakes, budget, itinerary, hidden gems, versus, don't do this,
know before), the look (native text, notes app, photo-led, illustrated, map), the slide
structure if visible, the caption style. Kept: the card, the source link and its
numbers, for the report. Never kept: the image (not written to disk), and no run of three
words from the source title or caption, no names, no numbers from the source. A test
holds all three.

**3.4 Filling a format with our data only.**

| Topic | From the site | |
|---|---|---|
| versus, שווה / לא שווה | `editorialRating.verdict`, quoted (today's verdict builder) | ready |
| itinerary, "מה עושים X ימים ב" | the itinerary days and their notes | ready |
| "X דברים שכדאי לדעת לפני" | `practical` (flights, getting around, kosher), `bestSeason`, booking lines, day notes | new builder |
| hidden gems | places that are not `mustSee`, with their own descriptions | new builder |
| mistakes, don't do this | only where day notes carry an explicit warning; otherwise dropped, with the reason | partial |
| budget, "כמה עולה" | `dailyCost` exists, in local currency, with a source and a checked date | decision 6 |
| anything else | dropped, and the report says why | |

Looks map to our renderers; a look we cannot draw cheaply uses the nearest one we have,
and the card says so. Broad listicles that are not about Tiyul+ ("5 דברים שכדאי לדעת לפני
פראג") are exactly the "know before" builder.

**3.5 Learning from our numbers.** 72 hours after each post:

- Instagram: views, saves, shares, through the existing `src/metrics` (works today).
- TikTok: fix the two bugs, take the post id from Zernio's resolved URL, then read
  views, likes and shares with `video.list` (decision 7), or Zernio's analytics if they
  carry views, or `/views` by hand. TikTok has no saves, so TikTok scores on shares plus
  likes per view (as approved; no TikTok save number is faked) and Instagram on saves
  plus shares per view, each against its own platform.
- **The mix:** 70% of slate slots to proven formats (at least 3 measured posts, score at
  or above the median), 30% to new formats from the watcher. Mix and thresholds in
  `post-config.json` (`trends`). Approved on 2026-10-11:
  - A format drops after 3 results in a row under 70% of its platform's median, with
    the reason recorded. "Under the median" would retire an average format within a
    month.
  - One of our own types that drops rests 14 days and returns as a trial; a found
    format stays dropped.
  - `know` and `budget` start as trials, since the ordinary rotation never draws them.

**3.6 The weekly Telegram report:** the top 3 formats by saves (Instagram saves, TikTok
shares beside them), the new formats in trial, the ones dropped and why, and the week's
best post with its numbers.

## 4. Decisions for you

1. **Service:** Zernio (free) [recommended], Upload-Post ($16 to $24), or Blotato ($29).
2. **Instagram:** keep our own publisher [recommended], or move it to the service.
3. **BRIEF.md says "once a day":** update its Posting section to the new volume [yes].
4. **Shabbat:** keep it, with Saturday 20:15 and 21:15 slots counting as a posting day [yes].
5. **What fills the slate:** slideshow posts only, with the videos (hidden gems, "before",
   postcard) staying on today's per-item approval and drafts; or let the slate take the
   "before" reel too, which is the format that has passed 2,000 views. [slideshows only
   in week 1, then let the 70/30 mix decide]
6. **Budget format:** print the site's daily cost in local currency with its checked date
   [allowed], or drop budget formats.
7. **TikTok metrics:** add `video.list` to our TikTok app and re-run `npm run tiktok-token`
   [yes], or rely on Zernio's analytics or `/views`.

## 5. What needs you (I sign up for nothing)

- A Zernio account, the TikTok account connected (and Instagram only if decision 2 says
  so), an API key as `ZERNIO_API_KEY` in `.env` here and on the VPS.
- `BRAVE_API_KEY` and `YOUTUBE_API_KEY` in the VPS `.env`, since the watcher runs in the bot.
- For decision 7: the `video.list` scope on the TikTok app, then a fresh token.

## 6. Proof before merge

- `npm test`, with new tests for: digest approval (nothing posts unapproved), the draft
  fallback, daily caps, schedule spacing (windows, Shabbat, same-deck gap, no repeated
  template), format extraction never carrying source text or images, the 70/30 mix, and
  dropping a format after 3 losses.
- One real end-to-end post through Zernio as SELF_ONLY, with music
  (`npm run zernio-test -- private`, from the separate checkout on the VPS).
- One public post the owner approves by hand (`prepare-public`, then
  `publish-public <id>`). Only then the merge, and only then the schedule.
- One watcher run: the format cards with their sources, and 3 posts built from them,
  rendered at 9:16 and 4:5.
- README and `post-config.json` comments updated. Then the diff.

## 7. Risks

- Zernio's public path is documented but not described as audited; the first public post
  is the real proof, and Upload-Post is the fallback.
- Auto music may not attach every time (Blotato's docs put TikTok's failure rate at about
  10%); each post reports whether it got music.
- The trend signal is mostly English YouTube; Hebrew winners will be rare.
- "GA shows visits from TikTok or Instagram" needs the bio link (no URLs in captions or
  slides, by rule), and GA's consent default undercounts.
