# Spec for the tiyul-plus session: server-side trip publishing for the growth desk

Written by the tiyul-social session on 2026-10-10. The growth desk (a local app in
tiyul-social, `src/growth/`) needs to publish a route on tiyulplus.com for a creator
or an agency, from a script, without a browser. The site cannot do that today, and
the owner's instruction was to stop and hand over a spec rather than work around it.

## What exists today (checked in this repo, read-only)

- `POST /api/trips/publish` (`src/app/api/trips/publish/route.ts:73`) takes `{ tripId }`
  only and reads the trip from `user_trips` for the signed-in caller
  (`findOwnTrip`, `src/lib/server/userTrips.ts:30`). It needs a Supabase user access
  token as `Authorization: Bearer`, plus a same-origin `Origin` header.
- Trips get into `user_trips` only from the browser, through supabase-js
  (`src/lib/trip/sync.ts:81`). No server route creates one.
- No admin route creates or publishes a trip (`src/app/api/admin/trips/route.ts` is
  read-only). No editor account, no API key, no server-to-server token exists.

The workaround (log a dedicated account in by email code, write `user_trips` through
PostgREST with its token, then call the publish route with a forged `Origin`) is
exactly what the owner ruled out. Please build the endpoint below instead.

## 1. The endpoint (required)

`POST /api/internal/trips`

**Auth.** `Authorization: Bearer <GROWTH_PUBLISH_TOKEN>`.
- `GROWTH_PUBLISH_TOKEN` is a new Vercel env var, at least 32 random bytes, compared
  with `crypto.timingSafeEqual`.
- No token configured means the route answers 404, the same posture as
  `/api/internal/warm` ("no secret means the feature is off, not open to everyone").
- No `Origin` check: this is server to server and the token is the gate.

**Acts as one account.** `GROWTH_EDITOR_USER_ID` is the uuid of a normal Supabase
account created once by hand (suggested: `editor@tiyulplus.com`, display name
"עורכי טיול+"). Every trip this route writes belongs to that user, so the existing
publish, unpublish and `/trips/<slug>` code paths need no change.

**Request body:**

```json
{
  "externalId": "growth:tiktok:7412345678901234567",
  "name": "גאורגיה 5 ימים, למרים",
  "days": [
    { "citySlug": "tbilisi", "placeIds": ["tbs-old-town", "tbs-narikala"], "notes": "" }
  ],
  "startDate": null,
  "preferences": { "kosher": false, "shabbatAware": false }
}
```

- `externalId` (required, max 120 chars, `[A-Za-z0-9:._-]`) is the idempotency key.
  The same `externalId` always maps to the same trip id in `user_trips` (for example
  `g-` plus the first 20 hex chars of its sha256), so a re-send UPDATES the trip and
  keeps the slug, through the existing re-publish branch of `publishTrip`.
- `name` (required, max 80) is the private trip name, as today. It is not published.
- `days` (required, 1 to 14 entries, each 1 to 12 `placeIds`): validated with the
  same catalog lookup `toPublicSnapshot` uses. Unlike the browser path, an unknown
  city or place id is a **422 that lists the bad ids**, not a silent drop: the desk
  matched those ids against `/api/cities` a moment earlier, so a mismatch is a bug
  worth seeing.
- `startDate`, `preferences`: optional, stored on the private trip as today. The
  public snapshot keeps its current rules (month only, no preferences).

**What it does:** upsert the `user_trips` row `{ user_id: GROWTH_EDITOR_USER_ID, id,
data: Trip }` with the service key, then call the existing `publishTrip(userId, trip)`.

**Response 200:**

```json
{
  "ok": true,
  "tripId": "g-3f9a...",
  "slug": "tbilisi-5-ab12cd34",
  "url": "https://www.tiyulplus.com/trips/tbilisi-5-ab12cd34",
  "indexable": true,
  "stopCount": 17,
  "created": true
}
```

`created: false` on a re-send that updated an existing publication.

**Errors:** 400 `bad-request` (shape), 401/404 (token), 422 `unknown-ids` with
`{ unknownCities: [], unknownPlaces: [] }`, 422 `no-city`, 429 `rate-limited`,
503 `not-configured` / `db-failed`.

**Limits:** new publications by the editor account capped at 20 per 24 hours
(the desk needs at most 5 creators plus 3 agencies a day). Re-sends do not count,
as today. Ignore the per-IP limit for this route, or set it to the same 20.

**Withdraw:** `DELETE /api/internal/trips?externalId=...` with the same token, calling
the existing `unpublishTrip`. The desk uses it when the owner marks a lead
"not interested" and chooses to take the page down.

**Audit:** one `audit` row per create and per withdraw, actor `growth-desk`.

## 2. The 'pro' plan constraint (required before any Pro gift)

`POST /api/admin/plan` already grants `plan: 'pro'` (route line 41), and the admin page
calls it (`src/app/admin/AdminClient.tsx:285`). But the only `profiles.plan` CHECK in
the repo SQL is `plan in ('free', 'premium')` (`sql/supabase-premium.sql:10`,
`sql/supabase-admin.sql:32`). Nothing in `sql/` widens it, so unless production was
altered by hand, a Pro grant fails with `db_unavailable`.

Please: check the live constraint, and if it is still two values, add
`sql/supabase-plan-pro.sql` that drops and re-adds it as
`plan in ('free', 'premium', 'pro')`, and say when it has been run.

The desk does NOT need an API for granting. The owner grants Pro by hand from the
admin page after a creator says yes; the desk only reminds them, with the email.

## 3. Optional, in order of value

1. **A count that does not depend on cookie consent.** GA4 consent defaults to
   `denied` (`src/components/Analytics.tsx:216`), so most visits from a creator's
   bio link will never carry a campaign in GA4. The middleware already matches
   `/trips/:path*`. Counting `utm_source` and `utm_campaign` there into the
   existing aggregate `app_events` table (one row per day per kind, no cookie, no
   user id), plus an admin read of it that takes the same Bearer token as section 1,
   would give the desk honest click numbers. Without it the desk reports GA4 and
   says it is consented visits only.
2. **A printable public trip book.** The PDF today is `window.print()` on the
   owner's own trip only. A `/trips/<slug>/book` page rendering the same print
   markup from the public snapshot would let the agency message link a PDF-ready
   sample. Shabbat times would need a date: allow the editor account's trips (and
   only those) to carry a sample `startDate` and `preferences.kosher` into the
   snapshot. Until this exists, the agency message links the normal trip page and
   does not promise an attachment.
3. **`/chat` drops utm parameters** when `?q=` is present
   (`src/components/AgentWorkspace.tsx:46-51`). The desk never links `/chat`, so
   this does not block it, but any other campaign that does will lose attribution.
