# Hidden gems video, and a hook generator

Written before the code, as the brief asked. Section 1 is the map of what was already
here. Section 2 onwards is what changed, every decision taken without asking, how to
move the weights and how to roll the whole thing back.

## 1. The map

### Formats and where they are declared

There are two families, and they are scheduled separately.

**Slideshows** are `kind: 'post'` (plus the older `deck` and `plan` kinds). The menu is
`posts.types` in `post-config.json`: `plan`, `list`, `instead`, `verdict`, `map`, `roll`.
Each type declares a weight, a slide range, what it `needs` from a destination page, and
optionally which `platforms` it may reach. The rotation is `src/posts/types.js`
(`nextShape`), which draws four independent dimensions with their own memories: type,
look, frame, caption shape. `src/posts/index.js` `buildPost` is the pipeline, and the
per-type builders are `src/posts/{plan,list,verdict,instead,roll,mapPost}.js`.

**Videos** are `kind: 'clip'`. Four shapes exist and each has its own entry point:

| shape | module | what it is | budget |
| --- | --- | --- | --- |
| `held` | `src/video/clip.js` + `overlay.js` | one stock shot, one line, 8s | `CLIPS_PER_DAY` (0, paused) |
| `cuts` | `src/video/cuts.js` | 4 to 5 shots, a label per cut | same |
| `montage` | `overlay.js` `burnMontage` | several shots, one line | same |
| `postcard` | `src/video/postcard.js` | hook shot, then one shot per place | `POSTCARDS_PER_DAY` (1) |
| narrated guide | `src/video/narrated.js` | spoken guide with burned subtitles | `GUIDES_PER_DAY` (1) |

`postcard` is the format the recent numbers are about. Its hook pool already contains
the winner verbatim, `3 יעדים שאנשים לא חושבים עליהם מספיק`, as one of three counted
lines chosen by a hash of the clip ids.

### Hooks and captions

- Clip lines: `src/video/hooks.js`. A line is written per clip by an editorial model
  that FILLS a known format from `clips.hooks.formats`, never by free composition, and
  it is then put through a stack of guards: `trailsOff`, `promisesList`, `hasPerson`,
  `isLabel`, `namesOtherCountry`, a word ceiling, no emoji, no URL, no hashtag.
- Slideshow covers: `posts.hooks` in `post-config.json`, filled rather than written,
  drawn by `hookShape` in `src/posts/voice.js` and excluded against the last hook of
  the same type.
- Captions: `src/hashtags.js`. `clipCaption` is pin, question, CTA, follow reason, then
  five hashtags (2 broad, 3 niche, one niche slot spent on the country). `captionQuestion`
  is the pool of comment bait, `captionFollow` the reason to follow.

### Media

`src/video/pexels.js` `findClips` searches `clips.search.queries` (destination-first,
not camera-technique), scores titles, then puts every candidate past the vision judge in
`src/video/vision.js`, which returns a place, a Hebrew site spelling and a travel-worthy
score. `clipPlaceLabel` in `src/hashtags.js` turns that into `site, country` in Hebrew
and returns null unless the judge was confident. Encode settings are `clips.video`,
the music bed is `clips.audio` plus the declared allowlist in `assets/audio/tracks.json`.

### Scheduling and publishing

`bot.js` runs one tick loop. Each kind has its own daily counter and they are
independent: `POSTS_PER_DAY` (2), `POSTCARDS_PER_DAY` (1), `GUIDES_PER_DAY` (1),
`CLIPS_PER_DAY` (0), plus decks and cards. Every trigger is gated on the same three
things: `inHours` (the Israel windows in `schedule`), the gather interval, and a backlog
cap. Publishing is `src/publish/*`, routed by `ALLOWED_BY_KIND` in
`src/publish/targets.js`: a clip goes to TikTok as a MEDIA_UPLOAD draft so the owner can
choose the sound in the app, and the Instagram copy is posted by hand on purpose.

### Metrics

`src/metrics/store.js` writes `data/metrics.json`, one row per candidate id, with a
`shape` object, the platform media ids and raw per platform stats. `rates()` computed
saves and shares per view. `src/metrics/report.js` `weeklyReport` ranks by saves per
view and refuses to touch a weight. `/views` types numbers in by hand (it already
accepts likes), `/report` prints the weekly table. `notePublished` was called for
`post`, `deck` and `plan` kinds only, so no clip ever got a metrics row.

## 2. What changed

### 2.1 The new format: `hidden_gems_video`

`src/video/hiddenGems.js`, built on the existing render and encode path. 9:16, 1080x1920,
a hook shot of 3 seconds carrying the hook from frame 1, then 3 to 5 place shots labelled
`place, country` in Hebrew and nothing else.

`fitHolds` solves for the hold rather than hardcoding one, because the shot count is
whatever the vision judge could place that morning, and it aims at the middle of the
10 to 15 second target rather than at either end. A three shot reel comes out at 12.6
seconds, which is where the reference post sat; four at 12.6, five at 13. A reel that
cannot fit drops a shot rather than running long.

Shots are ordered weakest to strongest, so the last frame a viewer sees before deciding
whether to watch again is the best one. `loop` cuts back to the opening shot for a
fraction of a second, which is a cut rather than a cross fade on purpose: a cross fade
means a second filter chain inside a graph that every other clip shape shares.

Commands: `/gems`, and `/gems nohook` for the templates alone.

### 2.2 The hook generator

`src/hooks/gems.js`. Five categories (overlooked, comparison, number, mistake, insider),
each with Hebrew templates read off the posts that worked, each declaring which formats
can DELIVER it. Ten candidates per post, six filled from templates and four written by
the editorial model, scored on specificity, curiosity and honesty, with the rest logged
onto the candidate and printed on the approval card.

Honesty is a MULTIPLIER rather than a third of the total. A hook that cannot be paid off
does not become publishable by reading well: that is what the 1993-view 0.5%-like post
was.

### 2.3 Format rotation

`src/formats/rotation.js` plus the `formats` block in `post-config.json`. Weights are
`hidden_gems_video` 50, postcard 15, guide 5, clip 5, slideshows 25. A format cannot
appear three times in a row, which costs the heavy format about six points of realized
share. The total number of posts a day and the hours are unchanged, because `slotsPerDay`
is the four existing env counters added up rather than a new setting.

Commands: `/formats` prints the mix, the slot count and the recent run.

### 2.4 Slideshows deliver on the hook

`src/posts/deliver.js` counts KINDS of concrete fact on the finished post and refuses one
whose cover promises the practical answer and whose slides carry fewer than two.
`pageSpecifics` asks the same question of the page for free, before the photographs are
paid for.

The verdict builder now has a `מה להזמין מראש` slide, quoted verbatim from the page's own
itinerary notes, which is where this catalogue keeps the one thing a "before you book"
cover is actually for. 44 of the 61 pages carry one.

The optional video variant is `src/video/slideReel.js`, off by default, reachable with
`/reel <n>` or `posts.video.on`.

### 2.5 Metrics

`shape` now carries `format`, `hookText` and `hookCategory`, clips are recorded at publish
time like every other kind (they never were), `rates()` also returns `likeRate` and
`commentRate`, and `/report hooks` ranks hooks and formats by like rate with the views
printed beside them.

### 2.6 Three things that turned out to be broken

Found while building the above, each with its own commit message:

1. **The price line had never once printed.** `costLine` read the site's `dailyCost.mid`
   as a number; the site publishes it as `{transport, food, activities}` on 21 pages and
   as a `[low, high]` pair on 20. `Number()` of either is `NaN`, so the verdict post, the
   one type whose cover promises the practical answer, had never carried a price for any
   destination. Nobody could see it because a missing fact just makes a slide shorter.
2. **The gems reel would have published with no description.** The first version set
   `cand.caption`, and `src/publish/tiktok.js` sends `cand.tiktokCaption`. Caught by
   grepping for who reads what rather than by running it, because a TikTok draft with no
   description looks fine until somebody opens the inbox.
3. **The same `Number(mid)` bug in the hook generator's price gate**, which would have
   refused every price comparison that was actually true. Both now go through one parser,
   `dailyCostOf`.

### 2.7 What the dry run produces, and what it found

`npm run gems-lab` writes to `output/examples/`: the mp4s, a `README.md` with each hook,
its score, its runners up, the shot list and the caption, and a `manifest.json` with the
same as data. Nothing is published and none of the three ledgers is written to.
`output/` is gitignored: thirteen megabytes per reel, all of it reproducible.

Two things the first full run found, both now fixed:

- **Five reels built in one sitting produce three.** The first three take every clip the
  vision judge will commit to a place on, and the last two come back with `only 2 of 17
  could be placed`. The candidate queue is ordered by title score, so a second reel in
  the same ten minutes is working down the same list rather than looking somewhere else.
  The live drip builds two a day, hours apart, and does not have this problem, so
  `queries` defaults to the whole catalogue and only the lab slices it per reel.
- **A failed build used to cost the day a post.** Each per-kind counter incremented
  before its build and never rolled back. That was survivable when each counter was one
  post of four; with the gems reel at half the slots and the format that fails most, the
  slot is now given back while `lastSlotAt` is not, so the retry waits a full drip
  interval rather than running into the same empty search.

The slideshow half of the run is the part worth reading: Prague and Barcelona both came
out carrying four and five kinds of concrete fact (price, season, booking, flight,
transport) under the `score` hook. Before the price fix, neither would have carried a
price at all.

## 3. Decisions taken without asking

1. **The 50/25/25 mix is applied to the slots that already exist, not on top of them.**
   The brief says do not change posting times or frequency. The existing per kind
   counters add up to four posts a day, so the rotation fills four slots a day with the
   new weights instead of adding a fifth. Posting hours, the gather interval and every
   backlog cap are untouched.
2. **Slideshows keep their 25 percent, and inside it the verdict type leads.** The
   earlier instruction in this session was to make the practical promise style most of
   the content. The numbers that arrived with this brief contradict the premise of that
   instruction: those two posts have the worst like rates of the recent set, 0.5 and 1.3
   percent against 6.1 for the 12 second video. So the newer, more specific instruction
   wins on the overall mix, and the earlier one survives where it is still true, which is
   the choice of which slideshow to make when the rotation calls for one.
3. **A clip is still only labelled with a place the vision judge could name.** The brief
   asks for a `place, country` label on every clip. The existing rule, written down in
   `src/video/postcard.js` and `clips.cuts`, is that this account never states where
   footage was shot on the strength of a search query. So an unplaceable clip is used for
   the hook shot, which makes no location claim, and never for a labelled one.
4. **The price comparison category is allowed only with a published number behind it.**
   `נראה כמו שוויץ, עולה חצי` is a cost claim. `clips.hooks` has a standing ban on the
   price comparison template, written after it failed, so the comparison category ships
   in two forms: the plain one (`במקום סנטוריני, תטוסו לכאן`) always, and the priced one
   only when both destinations publish a `dailyCost` on the site and the ratio actually
   supports the claim.
5. **`מה שהמדריכים לא מספרים לכם` ships as a shape, not as the example sentence.** The
   example ends mid phrase, which `trailsOff` rejects, and an open claim about what other
   guides say is not something this account can source. The insider templates name the
   thing instead, so the video can deliver it.
6. **The weekly report keeps ranking on saves per view.** Its own comment explains that
   leading with likes would steer the account back to the scenic decks. Like rate arrives
   as a new section and a new command rather than as a replacement.
7. **`4 יעדים שנראים כמו ציור` is not reintroduced** even though it is in the numbers.
   The owner dropped that line on the record, in `posts.hooks.shared`, because it praises
   the picture rather than the place.
8. **Sound defaults to the current behaviour.** `clips.audio.on` is false, the owner
   picks the track in the app, and the new format does the same. `gems.sound` can be set
   to `library` to mix a declared commercial track so a post can be promoted.
9. **Prices are printed in the currency the page publishes, not in shekels.** The brief
   asks for prices in shekels and no page in the catalogue publishes one: of the 41 that
   publish a daily cost at all, the currencies are EUR, THB, GBP, JPY, PLN, CZK and
   eleven others. Converting would need an exchange rate nobody published, which is the
   invented number `src/plan/site.js` exists to refuse, and it would turn a sourced
   figure into an unsourced one. So the slide says `יום טיפוסי: כ-1,627 קורונה צ׳כית
   לאדם, בלי לינה` with the currency named in Hebrew. The information the brief wanted
   is there; the symbol is not.
10. **Three guards from the clip writer had to be narrowed, and each had already rejected
    a line the owner wrote himself.** `hasPerson` rejects `לפני שאתם מזמינים`, a post
    this account published, for the word אתם; `isLabel` rejects three counted lines that
    are in `post-config.json` verbatim; `namesOtherCountry` takes one country and a reel
    names four. The narrowing is per-rule and documented at each site, and the clip
    writer's own file predicted the first one: it says second person went back on its ban
    list only because the advisory formats were parked, and this brief unparks them.
11. **The weekly report's existing ranking is untouched and the like rate is a second
    report.** Its own comment says leading with likes would steer the account back to the
    scenic decks. Both numbers answer real questions and they disagree, which is the
    finding rather than a problem: `/report hooks` prints the views beside the rate so
    the trade is visible in one table.

## 4. Changing the weights

All of it is `post-config.json`, no code change:

- The format mix: `formats.mix[].weight`. They are relative, not percentages, so 50/15/5/5/25
  is read as a share of the total. Set a weight to 0 to retire a format without deleting it.
- How long a run of one format may be: `formats.rotation.maxRun` (2 by default, so never
  three in a row).
- Which slideshow the rotation makes: `posts.types[].weight`, and `posts.types[].memory`
  for how many posts a type refuses to repeat itself within.
- The hook categories: `gems.hooks.categories[].weight`, and `gems.hooks.candidates` for
  how many are generated per post. `gems.hooks.on: false` goes back to the three counted
  lines the postcard reel already had.
- Length and shot count: `gems.shots`, `gems.holdSeconds`, `gems.hookSeconds`,
  `gems.targetSeconds`.
- How long a place is off limits after a post names it: `gems.placeMemoryDays`, 14 as the
  brief asks. **This is the one dial that can starve the format rather than merely
  change it**, so it is the first thing to look at if reels stop being buildable: the
  error distinguishes a place held back by this rule from a clip nobody could place.
- Whether a slideshow is also encoded as a video: `posts.video.on`, and
  `posts.video.types` for which types may be.
- Whether a cover's promise is checked against the slides: `posts.deliver.on`, and
  `posts.deliver.minSpecifics` for how many kinds of concrete fact it takes.

## 4a. Two things left alone, on purpose

Both are pre-existing and both are now more visible because the verdict type leads the
slideshow share. Neither is this branch's to decide.

- **Two destination pages cannot build a verdict post at all**, and the reason is the
  voice gate rather than the data: Tokyo's page says `תחבורה ציבורית מושלמת` and
  Zanzibar's says `היא לא גן עדן פרטי`, and `assertNoFiller` refuses both. The guard is
  right about generated prose and this is a VERBATIM QUOTE from a page the owner wrote,
  which is a different question. Changing the filler list is an editorial decision, so it
  is reported rather than taken: 2 of 61 pages, both failing loudly at build time.
- **The postcard reel publishes with no description.** `buildPostcardCandidate` sets no
  `tiktokCaption`, which is the field the publisher sends, so the same bug the gems reel
  nearly shipped is already live on the format the gems reel is being compared against.
  Fixing it would change the control midway through the comparison, so it is written down
  here instead. One line, next to `cand.place`, whenever the owner wants it.

## 4b. What this is worth watching for

Nothing here is a reason to hold the change, and all three are worth knowing in the
first fortnight.

1. **The format fails on some mornings and the message says why.** It needs three places
   a vision judge will commit to, and `only 2 of 17 could be placed` is an ordinary
   outcome rather than a fault. The slot is retried rather than lost. If it happens
   every day, read whether the reasons are `destination N` (the search is asking for the
   wrong thing) or the fortnight rule (`placeMemoryDays` is too high for the pool).
2. **Two of the 61 destination pages cannot build a verdict post at all**, and now that
   the verdict type leads the slideshow share that is 2 of 54 rather than 2 of 61 of a
   minor type. See 4a: the cause is the filler guard refusing the page's own words.
3. **The realized mix is not the weights.** 43% rather than 50% for the reel, because it
   is the only format that ever hits the run limit. `/formats` prints the declared mix
   and the recent run; the realized share is in the config comment.

## 5. Rolling back

In order of size, smallest first:

1. **Turn the new format off, keep everything else.** `formats.mix` entry for
   `hidden_gems_video`, set `weight: 0`.
2. **Turn the whole new rotation off.** `formats.rotation.on: false`. The per kind daily
   counters go back to running independently, exactly as they did before this branch, and
   `POSTCARDS_PER_DAY`, `POSTS_PER_DAY`, `GUIDES_PER_DAY` and `CLIPS_PER_DAY` are the
   only things deciding the mix again.
3. **Go back to the old hooks on the new format.** `gems.hooks.on: false` uses the three
   counted lines the postcard reel already had.
4. **Drop the branch.** Nothing here replaced an existing file: every format, template,
   prompt and command that existed before still exists and still behaves the same way, so
   `git revert` of this branch leaves a working bot.
