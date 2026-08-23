# Deploying to the VPS

The bot has to run **on the VPS**, not on your laptop. `CARD_OUTPUT_DIR` is a
path on that machine (`/var/www/tiyul/cards`), and Instagram fetches cards from
`https://cards.tiyulplus.com/cards/...`. Run it locally and the JPEGs land in
`C:\var\www\tiyul\cards`, where nothing on the internet can reach them — the
pipeline would look healthy right up until every Instagram publish failed.

Host: `129.121.89.58`, same box as BrickDeal. Caddy is already serving
`cards.tiyulplus.com` from `/var/www/tiyul` — that part is done and verified.

---

## 1. Clone and install

Every command in sections 1, 2, 4 and 5 runs **on the VPS**. Section 3 is the
one exception and it runs **on your laptop** — it is called out again there.

```bash
cd /opt
sudo git clone https://github.com/netanelyan/tiyul-social
sudo chown -R $USER:$USER /opt/tiyul-social
cd /opt/tiyul-social && npm install
```

Chained with `&&` deliberately. If the `cd` fails, `npm install` must not run:
it would install into `/opt` instead, leaving the project with no
`node_modules` while looking like it succeeded. The next step then warns about
missing dependencies and it is easy to read that as noise.

Confirm before continuing — the prompt should show the project directory, and
the module tree should exist:

```bash
pwd && ls node_modules/playwright/package.json
```

## 2. Chromium

Cards are rendered by headless Chromium, which is doing the one job nothing
else here can: real bidirectional text layout for Hebrew.

```bash
npx playwright install --with-deps chromium
```

**`--with-deps` is not optional on a fresh server.** Chromium needs a set of
system libraries that a minimal Ubuntu image doesn't ship, and without them the
failure is a cryptic missing-shared-object error at render time rather than
anything that mentions fonts or browsers.

## 3. Environment

Copy your local `.env` across (it is gitignored, so it is not in the clone).

**This one runs on your laptop, not on the VPS.** Run it on the server and it
looks for a local `.env` that isn't there, reports
`scp: stat local ".env": No such file or directory`, and would be copying the
box to itself anyway.

```powershell
cd C:\Users\Cyber_Magshimim\Desktop\tiyul\tiyul-social
scp .env root@129.121.89.58:/opt/tiyul-social/.env
```

Then check the two paths are the VPS ones, not the Windows placeholders:

```bash
grep -E "CARD_OUTPUT_DIR|CARD_PUBLIC_BASE_URL" /opt/tiyul-social/.env
```

Expected:

```
CARD_OUTPUT_DIR=/var/www/tiyul/cards
CARD_PUBLIC_BASE_URL=https://cards.tiyulplus.com/cards
```

The bot writes cards as the user it runs as, into a directory owned by
`$USER:www-data`. If you run pm2 as a different user than the one that owns
`/var/www/tiyul`, fix the ownership or rendering fails with EACCES.

## 4. Verify before starting anything

```bash
npm test            # 164 offline checks, no credentials needed
npm run check-sources
npm run check-cards
date                # see below
```

`date` is there because `RUN_HOUR` is **server** local time, not Israel time.
The box is in Amsterdam; if it is on UTC then `RUN_HOUR=8` fires the daily
gather at 11:00 in Israel. Nothing breaks either way — but pick the hour
knowing which clock it is on, or set `TZ=Asia/Jerusalem` in `.env`.

`check-cards` is the one that matters here. It renders a real card, confirms it
hit disk, then **fetches it back over the public URL exactly as Instagram
will**, checking the status and that it is served as `image/jpeg`. It is the
only check that can catch the laptop-versus-VPS mistake, because everything
else passes happily in both cases.

Then a full dry run — gathers, drafts, verifies, renders, publishes nothing:

```bash
npm run run-once
```

## 5. Start it

```bash
sudo npm install -g pm2
pm2 start bot.js --name tiyul
pm2 save
pm2 startup      # run the command it prints, so it survives a reboot
pm2 logs tiyul
```

**One instance only.** `data/store.json` is not safe for concurrent writers —
no cluster mode, no `pm2 start -i max`. BrickDeal runs under the same
constraint on the same box.

`.env` is read once at process start, so `pm2 restart tiyul` after any change
to it.

## 6. Back up what matters

`data/store.json` holds the dedupe history, the publish queue, the published
log the topic quotas are computed from, and the refreshed Instagram token.
Losing it means re-posting old items and re-running `npm run ig-token`.

```bash
0 4 * * * cp /opt/tiyul-social/data/store.json /root/backups/tiyul-store-$(date +\%F).json
```

---

## Updating later

```bash
cd /opt/tiyul-social
git pull
npm install
pm2 restart tiyul
```

If the pull touches `src/render/`, re-run `npm run render-samples` and look at
the JPEGs. Whether the Hebrew is right is not answerable by reading a diff.

---

## Troubleshooting on the server

| Symptom | Cause |
|---|---|
| `render_failed: Heebo did not load` | `assets/fonts/Heebo.ttf` missing from the clone, or the file is corrupt. It refuses rather than shipping a card of tofu boxes. |
| Cryptic `error while loading shared libraries` on render | Chromium installed without `--with-deps`. Re-run step 2. |
| `EACCES` writing a card | The pm2 user does not own `/var/www/tiyul/cards`. `sudo chown -R $USER:www-data /var/www/tiyul`. |
| `check-cards` renders fine but the fetch 404s | Caddy is serving a different root than `CARD_OUTPUT_DIR` writes into, or `CARD_PUBLIC_BASE_URL` has the wrong path segment. |
| Instagram publishes fail with "media could not be fetched" | The card URL is not publicly reachable. Run `check-cards` — it reproduces exactly what Instagram does. |
| Bot exits immediately at boot | No publish destination configured (`CHANNEL_ID` blank and Instagram not set up), or `OWNER_ID` missing. Both are deliberate fail-closed checks; the reason prints to the terminal, not to Telegram. |
| Telegram works, Instagram silently never posts | Check `/status` — it reports the configured targets. Instagram needs `IG_USER_ID`, `IG_ACCESS_TOKEN` **and** `CARD_PUBLIC_BASE_URL`; missing any one leaves it switched off. |
