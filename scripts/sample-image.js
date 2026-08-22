// Procedurally generated sample imagery, for previewing the photo layouts.
//
// This is a PREVIEW AID, not a content source. It is in scripts/ rather than
// src/ on purpose: nothing in the pipeline imports it, and it must never
// become a way to put a generated picture on a real post. The image-provenance
// rules in src/images.js still allow exactly three origins — licensed stock,
// our own catalogue, or AI-generated and generic — and this is none of them.
//
// It exists because the photo layouts were unreviewable without it: with no
// provider configured they always fell back to a text card, so the background
// image path had never actually been seen.

const scenes = {
  coast: {
    sky: ['#F2B25C', '#E8734A', '#7A3B52'],
    sea: ['#2B4A63', '#16293B'],
    land: '#141F2B',
    sun: { x: 700, y: 470, r: 78, fill: '#FFD9A0' },
    horizon: 560,
  },
  mountains: {
    sky: ['#8FB6C9', '#D7C4A8', '#E8B27C'],
    sea: ['#5B6E70', '#2C3A3E'],
    land: '#1B2529',
    sun: { x: 340, y: 380, r: 58, fill: '#FFF0D2' },
    horizon: 690,
  },
  city: {
    sky: ['#22304C', '#4A3A63', '#B4617A'],
    sea: ['#1A2136', '#0E121F'],
    land: '#0B0E18',
    sun: { x: 800, y: 300, r: 40, fill: '#FFE2B8' },
    horizon: 620,
  },
};

const W = 1080;
const H = 1350;

// A deterministic pseudo-random source, so a given scene always renders the
// same ridgeline. Chromium screenshots would otherwise differ run to run and
// make visual diffs useless.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function ridge(y, amp, seed, colour, opacity = 1) {
  const rand = rng(seed);
  const step = 60;
  const pts = [];
  for (let x = 0; x <= W + step; x += step) {
    pts.push(`${x},${Math.round(y + (rand() - 0.5) * amp)}`);
  }
  return `<polygon points="0,${H} ${pts.join(' ')} ${W},${H}" fill="${colour}" opacity="${opacity}"/>`;
}

/**
 * Build one scene as an SVG data URI, ready for an <img src>.
 * `name` is one of the keys in `scenes`; anything else falls back to coast.
 */
export function sampleImage(name = 'coast') {
  const s = scenes[name] || scenes.coast;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.sky[0]}"/>
      <stop offset="55%" stop-color="${s.sky[1]}"/>
      <stop offset="100%" stop-color="${s.sky[2]}"/>
    </linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.sea[0]}"/>
      <stop offset="100%" stop-color="${s.sea[1]}"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0%" stop-color="${s.sun.fill}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${s.sun.fill}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="${s.sun.x}" cy="${s.sun.y}" r="${s.sun.r * 3.2}" fill="url(#glow)"/>
  <circle cx="${s.sun.x}" cy="${s.sun.y}" r="${s.sun.r}" fill="${s.sun.fill}" opacity="0.92"/>
  <rect y="${s.horizon}" width="${W}" height="${H - s.horizon}" fill="url(#sea)"/>
  ${ridge(s.horizon - 40, 150, 7, s.land, 0.35)}
  ${ridge(s.horizon + 30, 110, 23, s.land, 0.55)}
  ${ridge(s.horizon + 150, 80, 91, s.land, 1)}
</svg>`;

  return {
    src: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    // Deliberately labelled as what it is. A real image would carry 'stock',
    // 'catalogue' or 'ai' here, and src/images.js rejects anything else.
    provenance: 'stock',
    credit: 'sample placeholder — not a real photo',
  };
}

export const sceneNames = Object.keys(scenes);
