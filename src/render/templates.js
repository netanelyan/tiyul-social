import { baseCss, escapeHtml as e, palette, pillarAccent, CARD_W, CARD_H } from './theme.js';
import { pillarHe } from '../pillars.js';

// The layout set. Four of the five need no photograph at all, which is the
// answer to the image-licensing problem rather than a workaround for it: a fact,
// a set of tips, a seasonal strip and an entry-rule change are all better served
// by type than by a stock photo of somewhere the post isn't even about.
export const LAYOUTS = ['photo', 'fact', 'tips', 'whenToGo', 'alert'];

export const LAYOUT_HE = {
  photo: 'כרטיס תמונה',
  fact: 'כרטיס עובדה',
  tips: 'כרטיס טיפים',
  whenToGo: 'מתי ללכת',
  alert: 'עדכון כניסה',
};

const HE_MONTH_ABBR = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

// Hebrew sets tighter than Latin at the same point size, so the thresholds are
// tuned against rendered Hebrew rather than character counts borrowed from an
// English layout.
function headlineSize(text, { max = 'xl' } = {}) {
  const n = String(text || '').length;
  if (max === 'lg' || n > 46) return n > 70 ? 'md' : 'lg';
  return n > 30 ? 'lg' : 'xl';
}

// A source URL is latin text inside an RTL line — always isolated, never bare.
function sourceLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function shell({ accent, kicker, body, place, url, extraCss = '', bodyClass = '' }) {
  return `<style>${baseCss()}${extraCss}</style>
<div class="card ${bodyClass}" style="--accent:${accent}">
  <div class="head">
    <div class="brand">טיול<span>+</span></div>
    <div class="kicker">${e(kicker)}</div>
  </div>
  <div class="body">${body}</div>
  <div class="foot">
    <div class="place">${e(place || '')}</div>
    <div class="src">מקור: <span class="ltr">${e(sourceLabel(url))}</span></div>
  </div>
</div>`;
}

const placeLine = (d) => [d.place, d.country].filter(Boolean).join(' · ');

/* -------------------------------------------------------------------------- */
/* Layouts                                                                    */
/* -------------------------------------------------------------------------- */

function factCard(d, accent) {
  return shell({
    accent,
    kicker: pillarHe(d.pillar),
    place: placeLine(d),
    url: d.url,
    body: `
      <div class="rule"></div>
      <div class="headline ${headlineSize(d.headline)}">${e(d.headline)}</div>
      ${d.subhead ? `<div class="subhead">${e(d.subhead)}</div>` : ''}`,
  });
}

function tipsCard(d, accent) {
  const items = d.bullets
    .map(
      (b, i) => `
      <li class="tip">
        <div class="num">${i + 1}</div>
        <div class="tip-body">
          <div class="tip-title">${e(b.title)}</div>
          <div class="tip-text">${e(b.text)}</div>
        </div>
      </li>`
    )
    .join('');

  return shell({
    accent,
    kicker: pillarHe(d.pillar),
    place: placeLine(d),
    url: d.url,
    extraCss: `
      .tips { list-style: none; display: flex; flex-direction: column; gap: 34px; }
      .tip { display: flex; gap: 26px; align-items: flex-start; }
      .num {
        flex: 0 0 62px; height: 62px; border-radius: 50%;
        background: var(--accent); color: ${palette.ink};
        font-size: 34px; font-weight: 900;
        display: flex; align-items: center; justify-content: center;
      }
      .tip-body { flex: 1; min-width: 0; }
      .tip-title { font-size: 40px; font-weight: 800; line-height: 1.2; margin-bottom: 8px; }
      .tip-text { font-size: 32px; font-weight: 400; line-height: 1.4; color: ${palette.paperDim}; }
      /* Centred rather than top-aligned: three short tips leave ~280px of dead
         space at the bottom otherwise, which reads as a truncated card. */
      .body { justify-content: center; gap: 44px; }`,
    body: `
      <div class="headline ${headlineSize(d.headline, { max: 'lg' })}">${e(d.headline)}</div>
      <ul class="tips">${items}</ul>`,
  });
}

function whenToGoCard(d, accent, data) {
  const months = data?.months || [];
  const colour = { good: palette.sage, shoulder: palette.amber, avoid: palette.clay };

  // The strip is drawn from the climate data itself, never from anything the
  // model wrote — so what the card claims and what the source says cannot drift.
  // In an RTL grid the first cell lands on the right, which is where a Hebrew
  // reader expects January.
  const cells = months
    .map((m) => {
      const c = colour[m.verdict] || 'rgba(242,236,224,0.2)';
      return `
      <div class="m">
        <div class="m-bar" style="background:${c}"></div>
        <div class="m-name">${HE_MONTH_ABBR[m.month]}</div>
      </div>`;
    })
    .join('');

  const legend = [
    ['מומלץ', palette.sage],
    ['בסדר', palette.amber],
    ['פחות', palette.clay],
  ]
    .map(([label, c]) => `<div class="lg"><i style="background:${c}"></i>${label}</div>`)
    .join('');

  return shell({
    accent,
    kicker: pillarHe('timing'),
    place: placeLine(d),
    url: d.url,
    extraCss: `
      .strip { display: grid; grid-template-columns: repeat(12, 1fr); gap: 10px; }
      .m { display: flex; flex-direction: column; align-items: center; gap: 12px; }
      .m-bar { width: 100%; height: 96px; border-radius: 8px; }
      .m-name { font-size: 22px; font-weight: 600; color: ${palette.paperDim}; }
      .legend { display: flex; gap: 30px; justify-content: flex-start; }
      .lg { display: flex; align-items: center; gap: 10px; font-size: 26px; color: ${palette.paperDim}; }
      .lg i { width: 22px; height: 22px; border-radius: 6px; display: inline-block; }`,
    body: `
      <div class="headline ${headlineSize(d.headline, { max: 'lg' })}">${e(d.headline)}</div>
      ${d.subhead ? `<div class="subhead">${e(d.subhead)}</div>` : ''}
      <div class="strip">${cells}</div>
      <div class="legend">${legend}</div>`,
  });
}

function alertCard(d, accent) {
  return shell({
    accent,
    kicker: pillarHe('entry'),
    place: placeLine(d),
    url: d.url,
    extraCss: `
      .badge {
        align-self: flex-start;
        background: ${palette.clay}; color: ${palette.paper};
        font-size: 28px; font-weight: 800;
        padding: 12px 26px; border-radius: 999px;
      }`,
    body: `
      <div class="badge">שינוי בכללי הכניסה</div>
      <div class="headline ${headlineSize(d.headline, { max: 'lg' })}">${e(d.headline)}</div>
      ${d.subhead ? `<div class="subhead">${e(d.subhead)}</div>` : ''}`,
  });
}

function photoCard(d, accent, image) {
  // Provenance is printed on the card itself, not only in the approval message,
  // so a published card carries its own licence trail.
  const credit = image?.credit ? `<div class="credit"><span class="ltr">${e(image.credit)}</span></div>` : '';
  return `<style>${baseCss()}
    .photo-card { padding: 0; }
    .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .scrim {
      position: absolute; inset: 0;
      background: linear-gradient(to top,
        rgba(16,32,31,0.96) 0%, rgba(16,32,31,0.86) 30%,
        rgba(16,32,31,0.30) 62%, rgba(16,32,31,0.20) 100%);
    }
    .layer { position: relative; z-index: 2; display: flex; flex-direction: column;
             height: 100%; padding: 74px 78px 66px; }
    .credit { font-size: 20px; color: rgba(242,236,224,0.55); margin-top: 10px; }
  </style>
  <div class="card photo-card" style="--accent:${accent}">
    ${image?.src ? `<img class="bg" src="${e(image.src)}" alt="">` : ''}
    <div class="scrim"></div>
    <div class="layer">
      <div class="head">
        <div class="brand">טיול<span>+</span></div>
        <div class="kicker">${e(pillarHe(d.pillar))}</div>
      </div>
      <div class="body" style="justify-content:flex-end">
        <div class="rule"></div>
        <div class="headline ${headlineSize(d.headline, { max: 'lg' })}">${e(d.headline)}</div>
        ${d.subhead ? `<div class="subhead">${e(d.subhead)}</div>` : ''}
      </div>
      <div class="foot">
        <div class="place">${e(placeLine(d))}</div>
        <div class="src">מקור: <span class="ltr">${e(sourceLabel(d.url))}</span></div>
      </div>
      ${credit}
    </div>
  </div>`;
}

/**
 * Build the full HTML document for a card.
 *
 * `draft` is a normalised draft (src/draft.js) plus the candidate's `url`.
 * `data` carries any structured payload the layout draws directly (climate months).
 */
export function renderHtml(draft, { data = null, image = null } = {}) {
  const accent = pillarAccent[draft.pillar] || palette.amber;
  const d = draft;

  let inner;
  switch (d.layout) {
    case 'tips':
      inner = tipsCard(d, accent);
      break;
    case 'whenToGo':
      inner = whenToGoCard(d, accent, data);
      break;
    case 'alert':
      inner = alertCard(d, accent);
      break;
    case 'photo':
      // Falls back rather than rendering an empty frame: v1 has no image
      // source wired up, so this is the path that actually runs today.
      inner = image?.src ? photoCard(d, accent, image) : factCard(d, accent);
      break;
    case 'fact':
    default:
      inner = factCard(d, accent);
  }

  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>tiyul+ card</title></head>
<body>${inner}</body>
</html>`;
}

export { CARD_W, CARD_H };
