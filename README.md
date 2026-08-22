# tiyul+ content pipeline

A Hebrew travel-content pipeline for Israeli travellers. It reads primary
sources, picks the best two or three items a day, writes the Hebrew, renders a
card, and sends it to me on Telegram with the source URL and approve/reject
buttons. Nothing publishes without a tap.

**Telegram is the approval surface; Instagram is where posts go.** There is no
Telegram channel by default — setting `CHANNEL_ID` adds one as a second
destination if you want it, and the two publish independently.

It's the same shape as my [BrickDeal bot](./brickdeal-automation-main) — same
approval gate, same single-JSON-file store, same owner lock, same
report-what-you-filtered discipline — pointed at a different problem. The
difference is what sits between ingestion and staging: BrickDeal resolves a
product ID and asks AliExpress for a price. This one has to establish that a
claim is true before it will write it down.

```
sources (RSS / dataset / a URL I paste)
        │
        ▼
   rank cheaply ──────────────────── titles only, before anything costs money
        │
        ▼
   verify source ────────────────── allowlisted primary domain? page reachable?
        │
        ▼
   draft (Claude) ───────────────── Hebrew headline + caption + layout + quotes
        │
        ▼
   verify claims ────────────────── every quote must appear verbatim in the page
   fare guard ───────────────────── no flight prices, at all, in v1
   topic quota ──────────────────── no thread takes over the feed
        │
        ▼
   render card ──────────────────── HTML → Chromium → 1080×1350 JPEG
        │
        ▼
   Telegram staging card: ✅ אשר ופרסם  ❌ דחה  ✏️ ערוך  📎 ציטוטים
        │
   approved ──▶ publish queue ──▶ drip ──▶ Instagram (+ Telegram channel,
                                                       if CHANNEL_ID is set)
```

## The rules, and where each one lives in the code

The brief had hard rules. None of them are prompt instructions — a prompt is a
request, and these needed to be guarantees.

| Rule | Enforced by |
|---|---|
| The source URL is always in the approval message | `src/format.js` — pushed unconditionally, never truncated, never hidden behind a link label |
| Nothing publishes without approval | `bot.js` — the only path to `enqueue()` is the `ok:` button handler |
| No claim without a primary source | `src/verify.js` + the `allowlist` in `sources.json` — suffix-matched on a domain-label boundary, re-checked after redirects |
| Claims must come from the source, not from memory | `src/verify.js` — the draft returns verbatim quotes and every one is checked against the fetched page. A paraphrased quote fails the whole draft |
| Images: stock / our catalogue / AI only, never scraped | `src/images.js` — three named providers, provenance tag required, shown in the approval message *and* printed on the card |
| AI images generic only, never the specific place | `src/images.js` — `assertGenericAiPrompt()` rejects a prompt containing the post's own place or country |
| Instagram via the official Graph API only | `src/publish/instagram.js` — the documented two-step `/media` → `/media_publish` handshake |
| Hebrew and RTL correct in the rendered card | `src/render/` — real browser bidi, bundled font, and a hard check that the font loaded before screenshotting |
| No flight prices in v1 | `src/verify.js` — `flightPriceGuard()`, which rejects a fare but allows an entry fee |
| Kosher/Shabbat is a thread, not the theme | `src/pillars.js` — a rolling-window cap on the tag's share of what published |

## Sources

`sources.json` is a registry, not a hardcoded list — adding a source is an edit
to one JSON file. Each entry records whether its adapter actually works, because
a source that 404s silently is worse than one that's honestly switched off.

Enabled, and verified live against the real endpoints:

| Source | Kind | Good for |
|---|---|---|
| UK FCDO foreign travel advice | Atom | entry, visa and border changes, per country |
| UNESCO World Heritage Centre | RSS | places, new inscriptions, hidden spots |
| JNTO (Japan) | RSS | DMO announcements, openings, timing |
| Open-Meteo Climate (ERA5) | JSON dataset | when to go, and when not to |

Declared but disabled, each with the probe result recorded in its `note`: the US
State Department advisories feed (well-formed but contains zero items), gov.il
and the Israel Airports Authority (both behind Imperva, 403 to any non-browser
client), the EU EES/ETIAS pages (client-rendered, no feed), and the Ryanair,
Wizz Air and Aegean newsrooms (no working feed at the documented paths). Turning
one on means writing its adapter first.

The climate source is the one that behaves differently, and deliberately: it
isn't a feed waiting for someone to publish, it's a question asked of a dataset.
It rotates through `destinations.json`, computes monthly normals from ten years
of ERA5 daily values, and classifies each month against stated thresholds. So it
always has something to say on a quiet day, and its "source URL" is the exact
API request — anyone can re-run it and get the same numbers.

You can also just paste a URL to the bot. It goes through the identical gates,
allowlist included.

## Templates

Ten layouts, all 1080×1350 (4:5 — the tallest ratio Instagram accepts). Two
families.

**Photo-led** — the picture is the point and the words sit under it. All three
need an image, and all three degrade to `fact` when there isn't one, which in
v1 is every time.

- **photoFull** — full-bleed picture, headline and one line over its bottom
  third. The headline is capped one size smaller than on the text cards on
  purpose: an 86px headline wrapping to three lines pushes the scrim halfway up
  the frame and buries the photograph.
- **photoBand** — picture on top, a solid band of type beneath it. Best when the
  supporting line needs more room than a scrim can carry legibly.
- **photoFrame** — inset picture with a gallery caption under it. Quieter; suits
  a single object or detail rather than a landscape.

**Text-led** — no photograph at all, which is what actually sidesteps image
licensing rather than managing it.

- **fact** — one surprising, specific claim, set large. The headline *is* the fact.
- **numbers** — a single figure carrying the card. The numeral is bidi-isolated,
  because a Hebrew unit sitting beside a Latin figure is exactly where the
  reordering goes wrong.
- **compare** — a widely held belief against what the source actually says.
- **tips** — three numbered practical tips.
- **whenToGo** — a twelve-month strip, good / shoulder / avoid, drawn straight from
  the climate data rather than from anything the model wrote, so the card and the
  source cannot drift apart.
- **alert** — an entry or visa change: what changed, from when, who it affects.
- **route** — a new or returning line out of TLV, with the connector pointing
  origin→destination. The arrowhead is drawn rather than typed, because the ✈
  glyph's own direction varies by font and would silently point the wrong way.

The drafting step picks the layout from the content and fills that layout's
payload. A layout whose payload comes back incomplete — a tips card with two
bullets, a numbers card with no figure — falls back to `fact` rather than
rendering a hole, on the same principle as the photo layouts degrading without
an image. The photo family is forbidden to the model unless an image was
actually supplied.

`npm run render-samples` writes one of each to `samples/`, with the photo family
rendered against a procedurally generated placeholder (`scripts/sample-image.js`)
— without one they'd all degrade to text cards and the whole photo family would
be invisible. That generator is a preview aid and lives in `scripts/` rather than
`src/` precisely so it can't become a content source: the provenance rules in
`src/images.js` still allow only licensed stock, our own catalogue, or generic
AI, and a procedural placeholder is none of them.

**Look at the JPEGs.**
Whether the Hebrew is right is not a question you can answer by reading the
HTML — bidi resolution, glyph shaping and line breaking all happen at render
time. That's also why Chromium is in the dependency list: it's doing real
bidirectional text layout, which is the one job a canvas library would get
subtly and unfixably wrong.

## Stack

Node 18+, plain ESM, no bundler, no build step. Deliberately boring, same as
BrickDeal.

- **telegraf** — the bot, staging UI, publishing
- **playwright** — headless Chromium, for card rendering only
- **fast-xml-parser** — RSS and Atom
- **@anthropic-ai/sdk** — the drafting step
- Storage is one JSON file (`data/store.json`), written atomically. No database.
- Heebo (OFL) is bundled in `assets/fonts/` and inlined into the page as a data
  URI. A linked webfont that fails doesn't error, it falls back — and the
  fallback for Hebrew on a bare Linux box is tofu boxes.

## File map

| File | What it does |
|---|---|
| `bot.js` | Telegraf bot: owner lock, staging cards and their buttons, the edit flow, the daily-run and drip timers, `/run` `/status` `/why` `/mix` `/sources` `/pending` `/queue` `/next` `/igquota` |
| `sources.json` | The source registry and the primary-authority allowlist |
| `destinations.json` | Places the climate adapter rotates through, with their Hebrew names |
| `src/sources/` | `index.js` (registry + allowlist matching + gather), `rss.js` (RSS *and* Atom), `climate.js` (ERA5 normals → a when-to-go item) |
| `src/fetchPage.js` | Fetch + HTML→text, including the boilerplate stripping that keeps cookie notices out of the evidence pool |
| `src/verify.js` | The gate: primary source, verbatim-quote checking, the fare guard |
| `src/draft.js` | The Anthropic call — Hebrew copy, layout choice, and the quotes backing every claim |
| `src/pillars.js` | Content pillars and the rolling-window topic quotas |
| `src/score.js` | Cheap ranking of raw items, before anything expensive happens to them |
| `src/candidate.js` | One item → one staged candidate, gates in cost order |
| `src/pipeline.js` | The daily pass: gather → rank → build until the target is met |
| `src/render/` | `theme.js` (tokens + CSS), `templates.js` (the five layouts), `index.js` (Chromium → JPEG) |
| `src/images.js` | Image provenance policy. Three permitted origins, tag required |
| `src/publish/` | `telegram.js`, `instagram.js` (Graph API two-step) |
| `src/format.js` | The approval message and the published captions — kept deliberately separate |
| `src/store.js` | Dedupe, staging, pending edits, publish queue, and the published log the quotas are computed from |
| `src/notify.js` | The Hebrew status DMs |
| `src/env.js` | The ~10-line `.env` loader, so there's no `dotenv` dependency |
| `scripts/check-sources.js` | Probe every enabled source live. No drafting, no Telegram |
| `scripts/run-once.js` | A full pass printed to the terminal instead of sent to Telegram |
| `scripts/render-samples.js` | One sample card per layout, into `samples/` |
| `test.js` | Run one URL through verification (and, with a key, the whole pipeline) |

## Getting it running

```
npm install
npx playwright install chromium
cp .env.example .env      # then fill it in
npm run check-sources     # do the feeds work? no key needed
npm run render-samples    # then LOOK at samples/*.jpg
npm run run-once          # a full pass, printed, nothing published
npm start
```

Minimum to boot: `TG_BOT_TOKEN`, `CHANNEL_ID`, `STAGING_CHAT_ID`, `OWNER_ID`,
`ANTHROPIC_API_KEY`. The bot refuses to start without the owner id or the
staging chat — the first because it can publish, the second because an approval
gate with nowhere to send approvals isn't a gate.

**[SETUP.md](./SETUP.md) is the step-by-step** for getting the Telegram bot and
the Instagram Graph API credentials in place, including the token exchange that
otherwise leaves you with a pipeline that dies after 60 days.

Instagram additionally needs `IG_USER_ID`, `IG_ACCESS_TOKEN` and
`CARD_PUBLIC_BASE_URL` — that last one because the Graph API hands Instagram a
URL its own servers fetch, so a card on local disk cannot publish. Every
approval card states where it will go before you tap.

The bot refuses to start with no publish destination at all (no `CHANNEL_ID`
and no Instagram): approving would send the post nowhere, so it fails closed
rather than quietly eating approvals. `npm run run-once` exercises the whole
pipeline without needing either.

### Deployment (pm2)

```
pm2 start bot.js --name tiyul
pm2 save && pm2 startup
```

Run exactly one instance — `data/store.json` isn't safe for concurrent writers.
`.env` is read once at process start, so `pm2 restart tiyul` after changing it.
Point `CARD_OUTPUT_DIR` at a directory the web server already serves and set
`CARD_PUBLIC_BASE_URL` to match; that pairing is what makes Instagram publishing
possible at all.

## Monitoring

`/status` gives a fixed last-24h window — gathered, staged, rejected, and the
rejections broken down by reason — plus queue depth and when the last run was.
`/why [n]` shows the actual rejected items with their reason and URL, not just
counts. `/mix` prints the pillar balance the quotas are computed from, with the
kosher share against its cap.

The rejection reporting is the part I care most about. BrickDeal's README is
blunt about what its silent quality filter cost: it dropped things without
telling me, so I had no way to know whether it was saving me from junk or
quietly throwing away good deals. The filters here are considerably more
opinionated — a primary-source allowlist, a verbatim-quote check, topic quotas —
so every rejection carries a reason code and a URL, and `REJECT_NOTIFY`
(`off` / `each` / `digest`) controls how loudly. A filter you can't see is a
filter you can't disagree with.

## Honest notes and caveats

**The evidence check proves sourcing, not truth.** It proves a claim appears in
the page we fetched from an allowlisted authority. If FCDO is wrong, we'll
faithfully repeat FCDO being wrong. That's the intended bar — attribution, not
omniscience — but it's worth being clear that "verified" here means "traceable".

**The quote check is strict on purpose, and it will produce false rejections.**
Normalisation handles whitespace and punctuation drift, but a model that
summarises two sentences into one loses the whole draft. I'd rather re-run than
loosen it — a fuzzy quote match is indistinguishable from no check at all.

**Four of the eleven declared sources work.** The rest are honestly switched off
with the probe result recorded. The two I most want are `gov.il` and the Israel
Airports Authority, both behind Imperva; we already ship Playwright, so a real
browser fetch is the obvious way in, but I haven't written it.

**Image licensing is sidestepped, not solved.** v1 publishes text-led cards
because that's genuinely the right call for facts, tips, timing and entry rules —
but it does mean the photo template, the provenance machinery and
`assertGenericAiPrompt()` ship untested against a live provider.

**Topic quotas only bind once there's a sample.** Below `QUOTA_MIN_SAMPLE`
published posts the shares are noise, so nothing is capped — on a fresh install
the first several posts could in principle all be kosher-tagged. It converges
quickly, but it isn't instant.

**One gather a day, guarded by the date.** A restart mid-day won't re-run, but
a process that's down at `RUN_HOUR` and comes back later that day will run then.
If it's down all day, that day is simply skipped.

**The publish retry rule is about double-posting, not importance.** If nothing
published, the item goes back on the queue (up to 3 attempts, then it is dropped
loudly rather than silently). If *something* published, it is not retried,
because retrying would duplicate whichever destination succeeded — you get told
which one failed and decide. An earlier version treated Telegram as primary and
swallowed Instagram failures, which silently discarded approved posts for anyone
running Instagram-only.

## Things I learned building this

**`document.fonts.check()` does not check what it sounds like it checks.** The
tofu guard was originally `document.fonts.check('900 100px Heebo')`, which reads
exactly like "is Heebo available". It isn't — it returns true whenever the text
can be rendered by *something*, fallback included. On a page with no `@font-face`
rule at all it still returns `true`. So the guard I wrote specifically to catch
the silent-fallback failure was itself silently passing. It now checks that a
`FontFace` with family `Heebo` exists in `document.fonts` with `status ===
'loaded'`, *and* that Hebrew set in Heebo measures differently from Hebrew set in
a deliberately nonexistent family — if the font failed, both fall back to the
same face and measure identically. Both halves are tested, in both directions.

I only found this because the brief said to check the output image rather than
the HTML. The rendered cards were fine, so nothing looked wrong; the bug was in
the thing that was supposed to notice when they weren't.

**Cookie banners are an evidence-integrity problem, not a tidiness one.** The
extracted text for a gov.uk page opened with ~500 characters of consent boilerplate.
The obvious cost is wasted prompt. The real cost is that `verify.js` proves a claim
by checking the quote appears verbatim in that text — so anything left in the pool
is something a claim can legally be grounded in. A quote lifted from a cookie
notice would have passed verification and published.

**The scorer's first draft ranked the single best source last.** FCDO publishes
one entry per country, titled just "Norway", with the actual change in the summary
— so a thin-title penalty sent the best entry-change feed to the bottom while
JNTO's B2B trade notices (operator recruitment, press briefings) sat at the top on
authority alone. Both were only visible by running the ranker against the live
feeds and reading the output. Neither would have shown up in a unit test, because
both were about what the real data looks like.

## Security

- Every credential lives in `.env`, which is gitignored. Nothing else reads one.
- `data/` is gitignored too, so cloning this doesn't leak what's been posted.
- The bot checks `ctx.from.id` against `OWNER_ID` in a middleware registered
  before every other handler, and refuses to start without it — a missing config
  value fails closed rather than opening the bot to whoever finds the username.
- Scraped page content is only ever fetched, regex-matched, and shown to the
  drafting model. It is never rendered as HTML, never evaluated, never shelled
  out to. The one place we *do* render HTML is our own templates, and every
  interpolated value goes through `escapeHtml()`.
- The allowlist matches on a domain-label boundary, so `evil-gov.uk` and
  `gov.uk.attacker.com` don't pass as `gov.uk`, and non-http schemes are
  rejected outright. Verified.
- Telegram messages are sent without `parse_mode`. A scraped title containing a
  stray `*` or `_` would otherwise break Markdown parsing and drop the message —
  which, for an approval card, means silently not asking.
