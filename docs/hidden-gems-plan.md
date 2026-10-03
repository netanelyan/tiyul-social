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
hook shot of 2 to 3 seconds carrying the hook from frame 1, then 3 to 5 place shots of 2
to 4 seconds each, labelled `place, country` in Hebrew and nothing else. Target length 10
to 15 seconds, enforced by a solver that fits the per shot hold to the configured range.
Shots are ordered weakest to strongest so the reel ends on its best frame, and the last
shot can be cross faded back toward the first when `loop` is on.

### 2.2 The hook generator

`src/hooks/gems.js`. Five categories (overlooked, comparison, number, mistake, insider),
each with Hebrew templates read off the posts that worked. It generates 10 candidates
(model plus templates), scores each on specificity, curiosity and honesty, takes the
best and logs the rest onto the candidate and into the approval card.

### 2.3 Format rotation

`src/formats/rotation.js` plus the `formats` block in `post-config.json`. Weights are
`hidden_gems_video` 50, other video variants 25, slideshows 25. A format cannot appear
three times in a row. The total number of posts a day and the hours are unchanged.

### 2.4 Slideshows deliver on the hook

`src/posts/deliver.js` asserts that a slideshow whose hook promises specifics carries
them, and the verdict builder now puts the page's own practical numbers on the slides.

### 2.5 Metrics

`shape` now carries `format`, `hookText` and `hookCategory`, clips are recorded at
publish time like every other kind, `rates()` also returns `likeRate`, and `/report hooks`
ranks hooks and formats by like rate and by views.

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

## 4. Changing the weights

All of it is `post-config.json`, no code change:

- The format mix: `formats.mix[].weight`. They are relative, not percentages, so 50/15/5/5/25
  is read as a share of the total. Set a weight to 0 to retire a format without deleting it.
- How long a run of one format may be: `formats.rotation.maxRun` (2 by default, so never
  three in a row).
- Which slideshow the rotation makes: `posts.types[].weight`, and `posts.types[].memory`
  for how many posts a type refuses to repeat itself within.
- The hook categories: `gems.hooks.categories[].weight`, and `gems.hooks.candidates` for
  how many are generated per post.
- Length and shot count: `gems.shots`, `gems.holdSeconds`, `gems.hookSeconds`,
  `gems.targetSeconds`.

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
