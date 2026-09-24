# The TikTok brief · @tiyulplus

What this account posts, why, and which half of it a program can make.

[`README.md`](README.md) describes the machine. This describes the editorial
standard the machine is now held to, and the parts of that standard no machine
can meet.

---

## The numbers this was written against

Seven videos. Views, in order posted:

```
672 · 504 · 452 · 336 · 105 · 77 · 33
```

One follower.

That curve is not seven unlucky posts. A feed whose first video reaches 672
people and whose seventh reaches 33 is a feed the ranker has stopped offering,
and it stops for a measurable reason: nobody watched the early ones through.
Each post inherits the last post's retention, so a run of weak openings
compounds downward and no amount of posting fixes it — posting *more* of the
same thing is what produced 33.

Three causes, in the order they cost the most:

1. **Every video is stock landscape footage with a line on top, and they all
   look like each other.** Seven posts, one template. By the third the viewer
   has seen this account's whole idea.
2. **The first second promises nothing.** A scenic shot with a wry caption is a
   thing to look at, not a thing to stay for. Watch time collapses in the window
   that decides reach.
3. **Nothing shows the product and nothing asks for anything.** There is no
   reason to follow, so 672 impressions produced one follower.

The control group is in the same hands. **@brickdealil** holds steady at 500–970
views a video on hand-held product footage — worse-looking material, no stock
library, no measured type placement, and it does not decay. The difference is
not production value. It is that something real is happening in the frame.

---

## The rule that governs everything below

**A video earns its next video.** Every rule here exists to buy watch time in
the first two seconds and a reason to come back in the last two.

---

## The eight rules

### 1. A hook in the first one to two seconds

On screen and, wherever there is a voice, spoken. A specific promise or a
specific problem, in Hebrew, before anything pretty happens.

```
✅  3 טעויות שישראלים עושים בגאורגיה
✅  טיול 5 ימים ברומא ב-2,000 ₪ — ככה
✅  אל תטוסו לתאילנד לפני שאתם יודעים את זה

❌  Beautiful Dolomites 🏔️
❌  a general quote about wanderlust over a mountain
```

**Never open on a scenic shot with no text.** That is the single most expensive
habit in the first seven posts and the one this brief exists to end.

### 2. Be specific

Name the destination. Name the price in ₪. Name the number of days, the season,
the month. Use the angles that only matter to this audience:

- kosher food
- direct flights from Ben Gurion
- Shabbat
- visas for Israeli passports
- safety, and what the travel advisories actually say

A post that would read identically to an American audience is a post with
nothing in it for this one.

### 3. Show the product in at least half the videos

A screen recording of Tiyul+ building an itinerary in Hebrew: type the request,
show the plan come back. Frame it as **"ביקשתי מ-AI לתכנן לי טיול ל..."** and
then show the result.

This is the rule that separates reach from a business. The account exists to
send people to tiyulplus.com; a feed of travel tips with no product in it
converts nothing however well it performs.

### 4. Real footage, not stock

Real phone footage, a face or a voice to camera, or a screen recording. If stock
is used at all it is **B-roll under a strong hook and real information** — never
the substance of the post.

### 5. Vary the format

Never the same template twice in a row. Five shapes, rotated:

| | | |
|---|---|---|
| **A** | Mistakes / warnings | "אל תעשו את זה ב..." |
| **B** | Budget breakdown | the trip itemised in ₪ |
| **C** | App demo | screen recording of Tiyul+ planning a trip |
| **D** | Lists | "5 יעדים לאוקטובר בלי ויזה" |
| **E** | Myth vs reality, or hidden spots | |

### 6. Fifteen to thirty-five seconds

Long enough to deliver something, short enough to finish. The ending loops back
to the opening or leaves an open question — a video that resolves cleanly is a
video nobody rewatches.

### 7. A reason to follow

Build series and say so: **"חלק 1 מתוך 3"**, **"עקבו לחלק 2 מחר"**, **"כל יום
יעד חדש"**. End on a question that invites an answer: **"לאן אתם טסים הבא?"**

Reach without follows is the seven-video problem in a better costume.

### 8. A soft call to action, at the end only

**"תכננו טיול כזה בחינם — הלינק בביו"**

At the end, once, after the value has already been delivered. Never make the
whole video an advertisement.

Note what this line does *not* contain: a domain. `assertNoUrl` in
`src/format.js` still refuses anything carrying `http`, `www.`, `.com` or
`.co.il`, and that rule has not moved — an external domain in a TikTok
description is a demotion and the string was never tappable anyway. "הלינק
בביו" is a pointer to the bio, which is the only tappable route either platform
offers. The CTA is back; the URL is still banned.

---

## Captions and hashtags

- **Caption:** one short line in Hebrew, plus a question.
- **Hashtags:** three to five, mixing broad and niche, with the destination in
  Hebrew among them — `#טיול #טיסות #חופשה #<יעד> #טיפיםלטיול`. Not dozens, and
  not a pile of unrelated ones.
- **Sound:** a trending sound, quiet, under the voiceover.

---

## Posting

**Once a day, for at least three weeks, without long gaps.** Consistency is
itself a ranking input, and three weeks is the shortest run that produces enough
data to read.

**When:** 12:00–14:00 and 19:00–22:00 Israel time.

**Not** from Friday evening to Saturday evening. The audience is Israeli and
most of it is not on the app; a post that lands in that window spends its whole
first-hour test on nobody. `src/schedule.js` enforces both of these, so the
filming queue never asks for something it is about to be the wrong time to post.

**Plan around the season.** Sukkot, Hanukkah, summer vacation, and whichever
destinations are actually good that month.

---

## Measuring, weekly

Four numbers per video:

- average watch time
- percentage who watched to the end
- followers gained
- where the views came from — For You versus profile

And three rules for acting on them:

- **Average watch time under about 40%** → the hook or the pacing is wrong.
  Change the first two seconds, not the topic.
- **Views fine, nobody follows** → the series angle and the follow reason are
  too weak. Rule 7, harder.
- **A format that underperforms three times** is dropped. The two best get
  everything.

TikTok's analytics are not available to this project through any API it holds,
so this loop is read by hand, in the app, once a week. Nothing in `bot.js`
can do it and nothing in `bot.js` claims to.

---

## Never

- another stock landscape slideshow with a generic line on it
- an advertisement with no information in it
- English-only on-screen text
- several near-identical videos
- **a stranger standing in front of the view.** Somebody filmed from outside,
  facing or walking for the camera, makes the post about that person instead of
  about the place. A participant camera — hands, feet, handlebars — is the
  opposite thing and is wanted. Enforced by `rejectPersonSubject`.
- **a line that trails off.** No `...` on screen. There is nothing to click for
  the rest, so half a sentence is all the viewer ever gets. Enforced by
  `trailsOff` in `src/video/hooks.js`.

---

## What the machine does, and what you do

This is the honest split, and it is the reason this file exists rather than a
config change.

Rules 3 and 4 — show the product, use real footage — require a camera, a voice
and a screen. No pipeline produces those. Rule 3 has since found a second route
that does not need a camera at all — a **plan** draws the output rather than
filming the screen it came from, see the table above — but rule 4 has none, and
a drawn itinerary is not somebody using the app. What a pipeline *can* do is everything
that surrounds them: choose the destination and the angle, rotate the format so
two of the same shape never land back to back, write the hook and the caption
and the tags, remember which part of which series is next, and refuse to ask for
any of it during Shabbat.

So the bot builds a **shoot** — a shot list, delivered to Telegram, that you
film and post by hand:

```
shoot   rotation → angle + destination → hook + beats + caption + tags (Claude)
           → Telegram shot list → you film it → you post it
```

A shoot is never published by the bot. There is nothing to publish; the video
does not exist until you make it. `/shoot` asks for one now, `/shoot 3` asks for
three, and `SHOOTS_PER_DAY` sets how many arrive on their own.

The existing three kinds are untouched:

| | what it is | who makes it |
|---|---|---|
| card | one verified claim, 1080×1350 → Instagram | the bot |
| deck | a slideshow of places → TikTok + Instagram | the bot |
| clip | stock video, one burned-in line → TikTok drafts | the bot |
| **shoot** | **a shot list you film** | **the bot plans, you shoot** |
| **plan** | **an AI itinerary as slides → TikTok + Instagram** | **the bot, on request** |

A **plan** is rule 3 — show the product — reached by the one route a program
can take. It cannot film a screen, so it draws the output instead: "ביקשתי מ-AI
לתכנן 4 ימים ברומא", then a photograph for every stop with its time and its
price, the total, and then the ask. It is built as a deck and rendered by the
deck's own renderer, so it sits in the feed looking like the account that posted
it rather than like a leaflet. It is also
the only post here that asks for a follow outright, which is why it is the only
one with no timer: the last slide promises five commenters a month of premium,
and a promise made on a schedule accumulates on a schedule. `/trip` when you are
ready to keep it.

---

## Three rules this brief overturned

Each of these was a documented decision with an argument behind it. Each was
reversed on the owner's instruction, and the reversal is recorded here rather
than quietly applied, because the original arguments are still worth reading
when a post goes wrong.

### The fare ban is lifted

`src/verify.js` used to reject any amount of money sitting within 120 characters
of a flight word, anywhere in a card. `src/video/hooks.js` went further —
"תבנית השוואת המחיר בוטלה כליל" — and banned the price shape outright.

Rule 2 requires the opposite. The reference account this brief was built against
(`@clicktrip.il`, 2.5K followers, posts at 100–263K views) leads with prices in
four of its eight best hooks: ₪8,500 for Lisbon, ₪20,000 for New Year, ₪4,500
for three days. It is the most reproducible thing about that account.

`flightPriceGuard` is now **off by default** and switched by
`FLIGHT_PRICE_GUARD=on`. Two things follow, and both are real:

- **A number on a post is now unsourced.** Everything else in this pipeline is
  traceable to a page that was fetched; a price is not, because no allowlisted
  authority publishes "five days in Rome for ₪2,000". The guard was the only
  thing stopping an invented figure from publishing, and it is off.
- **So a price is the owner's claim, not the pipeline's.** On a shoot, you are
  the source and you know the number. On an automated clip, the price formats
  are weighted low and every one of them is printed on the approval card before
  you tap.

### The caption's call to action is back

`post-config.json` recorded removing it: the caption was
`למתכנן טיולים חכם בביו שלנו` over `www.tiyulplus.com`, and an external domain
in a TikTok description is a demotion. That argument was about the **domain**,
and it survives — `assertNoUrl` is unchanged and still throws at build time.
What is restored is the pointer with no domain in it, at the end of the caption,
on a configurable share of posts rather than all of them.

### A clip grew a middle, and then gave it back

Eight seconds was chosen because a loop is worth more than a watch, and that is
true of a clip whose whole content is one sentence. Rule 6 asks for 15–35, and a
longer video carrying the *same* single line would be strictly worse — more
seconds for the same information is exactly how average watch time falls below
40%.

So the clip format grew a middle: a **hook plus two to five beats**, each burned
in over its own window, twenty-six seconds of it, with the source looped to fill
the length.

**It was reverted on sight, and the reason is the footage rather than the
writing.** Under those four changing lines is one stock shot that never cuts. A
video that holds a single frozen composition for half a minute while the caption
rewrites itself is a slideshow with a video background — the picture stops being
what the line answers and becomes wallpaper. Rule 6's length is for a video that
keeps moving.

A clip is eight seconds with one line again. The beats are not thrown away: they
are the right shape for a post type where **every line change is a cut**, with
new footage under each one, and they come back when that type is built.
`git show 97ec1c1` has all of it.

This is still stock footage, and Rule 4 still says stock is B-roll. An automated
clip is the weakest thing this account posts and it is not the thing that will
fix the curve at the top of this file. It is what runs on the days you do not
film.
