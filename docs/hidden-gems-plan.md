# Hidden gems video, a hook generator, and the retention fix

> **Second pass, 3 Oct 2026.** The format shipped and the analytics came back. Section
> 0 is what they said and what changed because of it; everything from section 1 is the
> original build and still accurate except where section 0 overrides it.

## 0. The retention fix

### 0.1 What the numbers said

One reel, read off the app:

| | |
|---|---|
| hook | 3 יעדים שאנשים לא חושבים עליהם מספיק |
| length | about 12 seconds |
| views | 559 |
| likes | 21 (3.8%) |
| comments | **0** |
| shares | 1 |
| saves | 1 |
| new followers | 0 |
| average watch time | **3.1s** |
| watched in full | **5.03%** |
| distribution | climbed for two hours, stopped by hour three |

**3.1 seconds is not a coincidence and it is not the footage.** `hookSeconds` was 3, in
this format and in the postcard reel both, so at exactly three seconds the hook text
vanished and the first shot cut away. The line had been read, the promise was closed,
and nothing on screen said more was coming. TikTok showed it to 559 people, measured a
26% watch ratio and 5% completion, and stopped.

The like rate was this account's second best. It did not help, and it was never going
to: watch time is the input to distribution and likes are an output of having been
distributed, which is why a table led by likes shows a healthy number on a post the
feed has already given up on.

### 0.2 What changed

All of it is `gems.retention` in `post-config.json`, on by default, and `on: false`
restores the previous timeline exactly.

| | before | after |
|---|---|---|
| first cut | 3.0s, where the average view ended | **1.6s**, before the drop |
| hook at full size | 0 to 3.0s, then gone | 0 to **3.2s**, then a header that stays |
| counter | none | **1/3, 2/3, 3/3**, the whole video |
| open loop | none | a second hook line the end pays off |
| shot order | weakest to strongest | **strongest first**, payoff last |
| length | 10 to 15s | **7 to 9s** |
| loop | off | opening and closing windows **matched** |
| end question | caption only | **on the last shot and in the caption** |
| quality gate | none | six refusal reasons, logged, one retry |

### 0.3 The two that needed thinking about

**Strongest first and the promise last are not in conflict**, because they are different
measures. "Strongest" is this project's own `rank`, where a drone shot is penalised four
points because `BRIEF.md` lists aerials under Never, so the most dramatic shot cannot
mean the drone shot and does mean the highest-ranked one, usually a POV shot that moves.
The open loop orders on something else: `surprise` is whether the site is absent from
the owner's pinned `clips.sites` list, `beauty` is the judge's raw destination score. On
a live example Lauterbrunnen opened on rank 9 and Ushguli closed as the one place not in
the pinned list.

**The hook staying on screen does not break the owner's own rule.** "The hook and the
first label shared a frame, which is two messages in the half second a viewer decides
on" (git e64f71c) still holds: the hook shot is still its own shot carrying no label,
just shorter, and the first place's label is withheld until the hook has shrunk to a
header. At no moment are there two full-size messages. What changed is that the hook
stops being full size before it stops being present. The first shot is held longest, by
exactly the seconds its label needs after the shrink.

### 0.4 Decisions taken without asking

1. **The retention policy lives in `gems.retention` and the postcard reel reads it
   too.** Those two formats now differ in exactly one way, which is where the hook line
   comes from, so the postcard hands its pooled line to `planGemsReel` and gets the open
   loop, the ordering, the counter, the question and the gate from the same code. A
   second copy would be a second place for the timing to drift. The block keeps the
   `gems` name because that is the format the analytics were measured on.
2. **The three stock clip shapes, the narrated guide and the slide reel are not
   changed.** `held` is one shot, so a counter over it would be a lie; `montage` holds
   one line over several shots of one place, so there is no list to count; the guide's
   on-screen text is its narration, timed to a voice, and a counter would fight it; the
   slide reel is off by default and its frames already carry their own text. Between
   them they are 10% of the rotation's weight and the three stock shapes are paused at
   0 a day. The two reel formats this does change are 65%.
3. **`strongestLast` is now false and the setting is kept.** It was true that the last
   frame is what a viewer is looking at when they decide to watch again. It was also
   true of a frame 95% of viewers never reached, while the opening frame that every
   viewer sees was whatever came back third best.
4. **The loop is a matched window rather than a cross fade or a cut back.** The closing
   frame now has a question on it that has to be read, and spending 0.4s of an 8.6s reel
   replaying the opening is 5% of the post plus the frame the question needed. Matching
   costs no screen time: the last shot's window is nudged to whichever candidate second
   looks most like the opening frame, measured on colour and a coarse 8x8 brightness
   grid. A match that is not close enough is simply not applied, because a jarring cut
   dressed up as a loop is worse than an honest one.
5. **A price open loop is wired up and will almost never appear.** `האחרון עולה הכי
   פחות` needs a published daily cost for every place on the reel, which the site has
   for its own destinations and nobody has for a stock clip. It is in the pool because
   the brief names it and because `/gems` may one day be handed a region.
6. **`needsSite` is false for the beauty loops and true for the surprise ones.** Whether
   the last shot is the prettiest is checkable by looking; "the least known" is a claim
   about a reputation and therefore about a place that has a name. It is also what keeps
   the format buildable on a morning that produced only bare country labels, which is
   the brief's own `גאורגיה` example.
7. **One loop makes no comparative claim at all.** `תחכו עד הסוף` is offered when
   nothing can be measured, which happens when every shot scored the same. Without it
   such a morning produces no reel, and a weaker promise beats no post: the same
   argument `placeMemoryDays` settles one level down.
8. **The emoji in the end question is allowed and the hook still may not have one.** A
   hook is a sentence and the banned list stands; `👇` is a signpost to the comment
   field, which is what the emoji is for.
9. **The weekly `/report` still leads on saves and shares.** Watch time leads in
   `/report hooks`, beside completion, with the like table kept underneath. Three
   measures printed together, because the lesson of the last two changes here is that
   one number at a time picks the wrong winner.

### 0.5 The new config, and how to roll back

Everything is in `post-config.json` under `gems`:

| setting | default | what it does |
|---|---|---|
| `retention.on` | `true` | **the rollback switch.** False restores the old timeline exactly |
| `retention.counter` | `true` | `1/3` on every place shot |
| `retention.headerOn` | `true` | the hook stays as a small header after it shrinks |
| `retention.question` | `true` | the end question, on screen and in the caption |
| `retention.openLoop` | `true` | the second hook line |
| `retention.strongestFirst` | `true` | highest-ranked shot opens |
| `retention.firstCutSeconds` | `1.6` | the hook shot's length, which is the first cut |
| `retention.maxFirstCutSeconds` | `2.5` | the gate refuses a later one |
| `retention.hookFullSeconds` | `3.2` | how long the hook is the only message |
| `retention.labelMinSeconds` | `1.2` | how long the first place's name needs after that |
| `retention.loop` | `match` | `match`, `cut` or `off` |
| `retention.loopMaxDistance` | `0.22` | above this the two frames are too unalike to call it a loop |
| `retention.retries` | `1` | rebuilds of a plan that fails the gate |
| `targetSeconds` | `7` to `9` | the length, which decides the shot count |
| `holdSeconds` | `2` to `3` | per shot |
| `hooks.openLoops` | 7 entries | the second lines and the measure each one orders by |
| `hooks.stayWeight` | `0.25` | what "a reason to stay" is worth in the hook score |

To roll back in order of size: `retention.on: false` returns the timeline and the
overlay to what they were, leaving the shorter length; `targetSeconds` back to 10 and 15
returns that too; `git revert` of this branch leaves a working bot, because nothing was
removed and every old path is still reachable.

### 0.6 The dry run

`npm run gems-lab -- --reels 5 --posts 0 --out output/examples/retention` built five,
all of them:

| | |
|---|---|
| length | 8.6s, inside the 7 to 9 target |
| first cut | 1.6s, against a 2.5s ceiling |
| holds | 2.8 + 2.1 + 2.1, the first longest so its label is readable after the shrink |
| loop | matched on all five, distances 0.102 to 0.211 against a 0.22 ceiling |
| question | on the last shot and at the end of the caption, same words |

The five hooks, each with the open loop the shots could support:

```
3 יעדים שאנשים לא חושבים עליהם מספיק · האחרון כמעט לא מוכר   (lastnoone, surprise)
3 מקומות לטיול הקרוב שלכם · השלישי הכי מפתיע                  (nthsurprise, surprise)
3 יעדים ששווים את הטיסה · תחכו לאחרון                         (lastsurprise, surprise)
3 יעדים שאנשים לא חושבים עליהם מספיק · תחכו עד הסוף           (waitend, no claim)
3 מקומות לרשימה הבאה שלכם · תחכו עד הסוף                      (waitend, no claim)
```

Two of the five fell back to `תחכו עד הסוף`, and that is the gate working rather than
failing: on those mornings every placed shot scored the same on every measure, so no
comparative claim could be ordered and the only honest loop left is the one that
promises an end and nothing about which item wins.

### 0.7 What is still unknown

**Whether it works.** Everything above is an argument from one post's analytics, and
the goal the brief set, 60% watch ratio and 30% completion, is a target rather than a
result. The measurement is the point of `/views ... watch= full=` and of `/report
hooks`: five or six reels under the new timeline, read off the app, will say whether
the hook staying on screen is what mattered or whether it was the length, and
`openLoopId` is on the metrics row so the loops can be compared against each other.

Two specific things to watch:

- **The counter is a promise of its own.** `1/3` tells a viewer exactly how much is
  left, which is the intent, and it also tells them when it is nearly over. If
  completion rises and rewatches do not, that is the place to look.
- **The `surprise` measure is a proxy and a weak one.** Not being in the owner's pinned
  `clips.sites` list is the closest thing to "unfamiliar" the data holds, and it rated
  the Dolomites as more surprising than Cinque Torri, which is the wrong way round for
  a reader who knows the region. The strongest claims are the rarest by weight, and the
  default loop makes no comparative claim at all, which is why this is a limitation
  rather than a published falsehood.

---

# The original build

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

### 2.6 Four things that turned out to be broken

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
4. **The dedupe key was the country, so eight Dolomites shots counted as one place.**
   `postcard.js` keys its one-shot-per-place rule on `vision.place`, which its comment
   calls a city and which is the country the judge named. Measured on one live search:
   17 clips passed the destination gate, 14 could be labelled, and keyed by country that
   is three places, exactly the minimum. Five consecutive dry runs failed at `only 1 of
   20 could be placed` while sitting on a pool of fourteen labelled clips. Keyed on the
   label it is six. Fixed in the gems reel and **deliberately left alone in the postcard
   reel**, which is the control the comparison depends on, so it is worth a one-line
   change there whenever the owner is happy to break the comparison.

### 2.7 What the dry run produces, and what it found

`npm run gems-lab` writes to `output/examples/`: the mp4s, a `README.md` with each hook,
its score, its runners up, the shot list and the caption, and a `manifest.json` with the
same as data. Nothing is published and none of the three ledgers is written to.
`output/` is gitignored: thirteen megabytes per reel, all of it reproducible.

Four things the runs found, all now fixed. Two of them were the format being broken
rather than the lab being unlucky, which is the whole argument for running it:

- **The dedupe key was the country.** Five consecutive runs failed every reel at `only
  1 of 20 could be placed` while sitting on a pool of fourteen labelled clips, because
  eight Dolomites shots and three Greek sites counted as two places. See 2.6.4. After
  the fix, reels come out at four and five places rather than scraping the minimum.
- **Every reel opened on the same sentence.** The scorer is argmax over a fixed pool,
  so the best line ships every time it is offered: four reels, four copies of `N יעדים
  שאנשים לא חושבים עליהם מספיק`. The hook now keeps the same memory the look, the type
  and the caption shape all keep, two deep, which is a cycle of three shapes with the
  model varying the wording inside each.
- **Narrowing the search per reel does not help**, measured three ways: all 30 searches
  shared gave 3 of 5, six searches each gave 3 of 5 with a different two failing, and
  fifteen stepped per reel made the FIRST reel fail. Narrowing stops the reels
  competing and also decides which part of the catalogue each is stuck with, and the
  window that opens on the Greek island searches is almost all people walking through
  streets, which the judge vetoes. Breadth is what makes a placeable clip likely at all.
  The `queries` parameter stays on the builder, where it is the right handle for a
  `/gems` that names a region.
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
3a. **The fortnight rule is a preference rather than a refusal**, which is the one place
   this work does not take the brief literally. "Do not repeat a destination posted in
   the last 14 days" as a hard filter can stop the lead format being built at all: a
   live morning's search yields one to five placeable clips, so reserving a fortnight of
   names is the difference between a post and nothing on more days than is comfortable,
   and the dry run hit exactly that. Both precedents in this codebase overrule it and
   hard rule 1 says they win: `drawWeighted` falls back to its full pool because
   "refusing to build is a worse answer than repeating the oldest of them", and
   `pickTrack` falls back to every track because "publishing silence to avoid a repeat
   is the wrong way round". So fresh places come first always, a place inside the window
   returns only to reach the minimum shot count, oldest first, never for a fourth or
   fifth shot, and every one of those decisions is printed on the approval card.
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
