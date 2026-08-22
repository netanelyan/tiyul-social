// Build a square Instagram avatar from the tiyul-plus brand assets.
//
// The repo's icon-512.png is the plane alone floating in a large frame, which
// becomes a speck once Instagram crops to a circle at ~110px. og.png has the
// right lockup but is 1200x630, so a square crop would cut the wordmark in half.
// This composes the same two elements — plane + טיול+ — at a size that survives
// the circular crop, using the same Chromium/Heebo path the cards already use.

import { chromium } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const font = readFileSync(new URL('../assets/fonts/Heebo.ttf', import.meta.url)).toString('base64');

// Exact paths from logo/public/logo.svg, white-filled for a dark background.
const PLANE = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="300" height="300">
  <path d="M3.0 20.9C4.6 18.2 5.9 16.8 7.9 15.2" stroke="#FF5941" stroke-width="1.9" stroke-linecap="round"/>
  <path d="M2.3 17.6C3.3 16.1 4.1 15.2 5.5 14.2" stroke="#FF5941" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M21.7 2.3 1.9 10.6c-.58.24-.53 1.08.06 1.26l6.7 2 2 6.7c.18.6 1.02.64 1.26.06L21.7 2.3Z" fill="#F5F1E8"/>
</svg>`;

const html = `
<style>
@font-face { font-family:'Heebo'; src:url('data:font/ttf;base64,${font}') format('truetype');
             font-weight:100 900; font-display:block; }
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:1080px; height:1080px; overflow:hidden; }
body {
  direction:rtl; font-family:'Heebo',sans-serif; -webkit-font-smoothing:antialiased;
  background:#241B4D;
  display:flex; align-items:center; justify-content:center;
}
/* The same radial warmth as og.png, kept subtle so it reads at 110px. */
.bg { position:absolute; inset:0;
      background:
        radial-gradient(circle at 50% 22%, rgba(255,89,65,.30), transparent 58%),
        radial-gradient(circle at 78% 82%, rgba(120,90,220,.28), transparent 62%);
}
.dots { position:absolute; inset:0; opacity:.16;
        background-image:radial-gradient(rgba(245,241,232,.6) 2px, transparent 2px);
        background-size:46px 46px; }
/* Everything sits inside the safe circle: Instagram crops a square to a circle,
   so the corners are guaranteed to be lost. */
.lockup { position:relative; display:flex; flex-direction:column;
          align-items:center; gap:28px; }
.plane { transform:rotate(-8deg); filter:drop-shadow(0 10px 26px rgba(0,0,0,.4)); }
.word { font-size:230px; font-weight:900; color:#F5F1E8; letter-spacing:-6px; line-height:1; }
.word span { color:#FF5941; }
.rule { width:210px; height:12px; border-radius:6px; background:#FF5941; }
</style>
<div class="bg"></div><div class="dots"></div>
<div class="lockup">
  <div class="plane">${PLANE}</div>
  <div class="word">טיול<span>+</span></div>
  <div class="rule"></div>
</div>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1, locale: 'he-IL' });
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

// Same guard as the cards: a fallback font here means a tofu avatar.
const okFont = await page.evaluate(() => {
  const f = [...document.fonts].find((x) => x.family.replace(/['"]/g, '') === 'Heebo');
  return f?.status === 'loaded';
});
if (!okFont) throw new Error('Heebo did not load — refusing to render the avatar');

const out = fileURLToPath(new URL('../assets/brand/instagram-avatar.jpg', import.meta.url));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, await page.screenshot({ type: 'jpeg', quality: 95 }));
console.log('wrote', out);
await browser.close();
