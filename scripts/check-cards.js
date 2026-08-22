import { loadEnv } from '../src/env.js';
loadEnv();

import { existsSync } from 'node:fs';
import path from 'node:path';
import { renderCard, closeBrowser, cardOutputDir, cardPublicUrl } from '../src/render/index.js';

// Verifies the card-hosting chain end to end: render a card, confirm it landed
// on disk, then fetch it back over the PUBLIC url the way Instagram will.
//
// This exists because the failure it catches is invisible from inside the
// process. Instagram never receives the image bytes from us — it takes the URL
// and fetches it with its own servers. So a card can render perfectly, sit
// happily on disk, and still be unpublishable because nothing on the public
// internet can reach it. That gap only shows up as a Graph API error at
// publish time, long after you'd think this was working.
//
//   npm run check-cards

const sample = {
  layout: 'fact',
  pillar: 'fact',
  place: 'בדיקה',
  country: '',
  headline: 'בדיקת אירוח כרטיסים',
  subhead: 'אם אתם רואים את זה בדפדפן — אינסטגרם יוכל להביא את התמונה.',
  url: 'https://www.gov.uk/foreign-travel-advice',
  bullets: [],
};

async function main() {
  const dir = cardOutputDir();
  console.log(`CARD_OUTPUT_DIR       ${dir}`);
  console.log(`CARD_PUBLIC_BASE_URL  ${process.env.CARD_PUBLIC_BASE_URL || '(not set)'}`);
  console.log('');

  console.log('1/3  rendering a test card...');
  const card = await renderCard(sample, { id: 'hosting-check' });
  console.log(`     wrote ${card.file} (${(card.bytes / 1024).toFixed(0)} KB)`);

  console.log('2/3  confirming it is on disk...');
  if (!existsSync(card.file)) throw new Error(`render reported success but ${card.file} is missing`);
  console.log('     ok');

  const url = cardPublicUrl(path.basename(card.file));
  if (!url) {
    console.log('\n3/3  SKIPPED — CARD_PUBLIC_BASE_URL is not set.');
    console.log('     Telegram publishing works without it. Instagram does not:');
    console.log('     it fetches the image from a public URL rather than receiving bytes.');
    return;
  }

  console.log(`3/3  fetching it back the way Instagram will:\n     ${url}`);
  if (!url.startsWith('https://')) {
    throw new Error('CARD_PUBLIC_BASE_URL must be https — Instagram will not fetch over plain http');
  }

  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    throw new Error(
      `could not reach it (${e.message}).\n` +
        '     Either DNS has not propagated, the web server is not serving that path,\n' +
        '     or the bot is not running on the machine that serves it — a card written\n' +
        '     to a laptop is not reachable by Instagram no matter what the URL says.'
    );
  }

  const type = res.headers.get('content-type') || '(none)';
  console.log(`     HTTP ${res.status} · content-type: ${type}`);

  if (!res.ok) throw new Error(`the URL returned ${res.status} — Instagram would get the same`);
  if (!/image\/jpe?g/i.test(type)) {
    throw new Error(`served as "${type}" rather than image/jpeg — Instagram rejects non-JPEG`);
  }

  const bytes = (await res.arrayBuffer()).byteLength;
  if (bytes !== card.bytes) {
    console.log(`     ⚠ served ${bytes} bytes but wrote ${card.bytes} — stale cache or a different file`);
  }

  console.log('\n✅ hosting works. Instagram can fetch these cards.');
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e.message}`);
    process.exitCode = 1;
  })
  .finally(closeBrowser);
