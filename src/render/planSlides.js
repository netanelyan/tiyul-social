import { SIZES } from './deckTemplates.js';
import {
  palette,
  heeboDataUri,
  assistantDataUri,
  escapeHtml as e,
  siteMark,
} from './theme.js';

// The AI-itinerary slideshow, drawn as the product.
//
// Every other slide in this project is a photograph with type on it, and the
// whole craft of those files is getting the type to survive whatever is
// underneath. There is no photograph here. The plan IS the picture: a day, its
// stops, their times and their prices, laid out the way a product would lay them
// out — which is the point of the format, because the post is showing what the
// thing does.
//
// SO THE DESIGN RULES ARE DIFFERENT, and two of them are the opposite of the
// deck's:
//
//   · The layout does NOT move. A deck measures each photograph and puts the
//     text where that frame is quietest, which is right when the background is
//     out of our hands and wrong here — five slides of the same product whose
//     furniture wanders are five slides that look like five products. Every day
//     slide is identical except for its content, and that repetition is what
//     makes the set read as one screen being scrolled.
//
//   · Nothing is measured, because nothing is unknown. Contrast, ink and scrim
//     are all decided in this file, once, on a ground we chose.
//
// WHAT IT IS NOT ALLOWED TO BE: a screenshot of the app. It carries the
// account's own wordmark and the account's own palette, it never draws a
// control the product does not have, and it never claims the product produced
// this particular plan — see the note at the top of src/plan/write.js. Drawing
// a fake status bar or a fake tab bar here would turn an honest "an AI planned
// this" into a fabricated screen, which is the one thing this pipeline refuses.
//
// TIKTOK'S FURNITURE IS REAL AND IS NOT OURS. The app draws a button rail down
// the right of the frame (x 0.76→1.0, y 0.42→0.86 — see render/photo.js) and
// bars top and bottom. A designed slide cannot measure its way around them the
// way a photograph's caption can, so the content box is simply inset out of
// them: `INSET` below is why a TikTok slide is narrower on its right than its
// left, which in RTL is the side the text starts on.

/** The content box per size, in px. The TikTok numbers are the app's furniture. */
const INSET = {
  // topSafe/bottomSafe are the same constants the deck's placement search uses.
  // The right inset clears the button rail; the left is the design margin.
  tiktok: { top: SIZES.tiktok.topSafe, bottom: SIZES.tiktok.bottomSafe, right: 184, left: 88 },
  instagram: { top: SIZES.instagram.topSafe, bottom: SIZES.instagram.bottomSafe, right: 88, left: 88 },
};

/** Type scale per size. Instagram is 570px shorter and everything steps down. */
const SCALE = {
  tiktok: { hook: 82, sub: 44, day: 58, name: 46, note: 31, time: 30, cost: 32, total: 128, step: 42 },
  instagram: { hook: 72, sub: 38, day: 50, name: 41, note: 28, time: 27, cost: 29, total: 108, step: 37 },
};

const ACCENT = palette.amber;

/** 2,340 — grouped, because an itinerary's total is read at a glance or not at all. */
export const shekels = (n) => Number(n || 0).toLocaleString('en-US');

/** A count of stops across the whole plan, which is one of the cover's promises. */
export const stopCount = (days) => days.reduce((n, d) => n + d.stops.length, 0);

/** What one day costs, summed from its own stops for the same reason the total is. */
export const dayTotal = (day) => day.stops.reduce((s, stop) => s + (stop.costIls || 0), 0);

/**
 * The ordered slides of one plan.
 *
 * Cover, one per day, the total, then the ask. The order is the argument: the
 * hook promises a plan, the days are the plan, the total is the line that makes
 * it feel real, and only then is anything asked of the viewer. Putting the ask
 * earlier would spend a viewer who has not yet been given anything.
 *
 * The ask slide is absent when the giveaway is off, which is what switching it
 * off has to mean — a promise nobody can keep must not be drawn.
 */
export function planSlides(plan, { giveaway = null } = {}) {
  const slides = [{ type: 'cover' }, ...plan.days.map((day) => ({ type: 'day', day })), { type: 'total' }];
  if (giveaway?.on) slides.push({ type: 'cta' });
  return slides;
}

const fonts = () => `
@font-face { font-family:'Heebo'; src:url('${heeboDataUri()}') format('truetype'); font-weight:100 900; font-display:block; }
@font-face { font-family:'Assistant'; src:url('${assistantDataUri()}') format('truetype'); font-weight:100 900; font-display:block; }`;

/**
 * The ground every slide of a plan is drawn on.
 *
 * One dark field with a single warm light source top-right. It is the same ink
 * as a news card, so a plan in the grid belongs to the account that posted it,
 * and the glow is doing a real job rather than decorating: without it a 1080
 * frame of flat ink reads as a slide that failed to load an image.
 */
function css(size) {
  const g = SIZES[size];
  const pad = INSET[size];
  const s = SCALE[size];

  return `
${fonts()}
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:${g.w}px; height:${g.h}px; overflow:hidden; }
body {
  direction:rtl;
  text-align:right;
  font-family:'Assistant','Heebo',sans-serif;
  -webkit-font-smoothing:antialiased;
  color:${palette.paper};
  background:${palette.ink};
}
.frame {
  position:relative;
  width:${g.w}px;
  height:${g.h}px;
  padding:${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px;
  display:flex;
  flex-direction:column;
  background:
    radial-gradient(1200px 900px at 88% -8%, rgba(232,163,61,0.20) 0%, rgba(232,163,61,0.06) 42%, rgba(232,163,61,0) 72%),
    radial-gradient(900px 700px at 6% 104%, rgba(127,168,138,0.14) 0%, rgba(127,168,138,0) 68%),
    ${palette.ink};
}
/* A latin run inside RTL — the address under the wordmark — needs isolating or
   its dot jumps to the wrong end of the line. */
.ltr { direction:ltr; unicode-bidi:isolate; display:inline-block; }

/* --- the header, identical on every slide ------------------------------- */
.top { display:flex; align-items:center; justify-content:space-between; gap:24px; }
.brand { display:flex; flex-direction:column; align-items:flex-start; line-height:1; }
.brand .word { font-family:'Heebo',sans-serif; font-size:${size === 'tiktok' ? 46 : 40}px; font-weight:900; letter-spacing:-0.5px; }
.brand .word span { color:${ACCENT}; }
.brand .site { margin-top:8px; font-size:${size === 'tiktok' ? 20 : 18}px; font-weight:600; letter-spacing:0.6px; color:rgba(242,236,224,0.42); }
.chip {
  padding:${size === 'tiktok' ? '14px 26px' : '12px 22px'};
  border:2px solid rgba(232,163,61,0.55);
  border-radius:999px;
  font-size:${s.time}px;
  font-weight:700;
  color:${ACCENT};
  white-space:nowrap;
}

/* --- cover -------------------------------------------------------------- */
.mid { flex:1; display:flex; flex-direction:column; justify-content:center; gap:${size === 'tiktok' ? 44 : 32}px; min-height:0; }
/* The ask, drawn as something typed. It is a quotation of what was asked, not a
   mock of a chat application: one bubble, our own radius, no avatar and no
   input field — the moment it grows an interface it starts pretending to be a
   product screen it is not. */
.ask {
  align-self:flex-start;
  max-width:88%;
  padding:${size === 'tiktok' ? '30px 38px' : '26px 32px'};
  border-radius:34px 34px 34px 10px;
  background:rgba(242,236,224,0.09);
  border:1px solid rgba(242,236,224,0.16);
  font-size:${s.sub}px;
  font-weight:600;
  line-height:1.3;
}
.ask .who { display:block; margin-bottom:10px; font-size:${Math.round(s.time * 0.86)}px; font-weight:700; letter-spacing:0.4px; color:rgba(242,236,224,0.5); }
.hook { font-family:'Heebo',sans-serif; font-size:${s.hook}px; font-weight:900; line-height:1.08; letter-spacing:-1.5px; text-wrap:balance; }
.hook em { font-style:normal; color:${ACCENT}; }
.sub { font-size:${s.sub}px; font-weight:600; color:rgba(242,236,224,0.66); }
.facts { display:flex; flex-wrap:wrap; gap:${size === 'tiktok' ? 16 : 12}px; }
.fact {
  padding:${size === 'tiktok' ? '16px 26px' : '14px 22px'};
  border-radius:20px;
  background:rgba(242,236,224,0.07);
  border:1px solid rgba(242,236,224,0.12);
  font-size:${s.cost}px;
  font-weight:700;
}
.fact b { color:${ACCENT}; font-weight:800; }

/* --- a day -------------------------------------------------------------- */
.dayhead { margin-top:${size === 'tiktok' ? 56 : 38}px; }
.dayhead .n { font-family:'Heebo',sans-serif; font-size:${s.day}px; font-weight:900; letter-spacing:-0.8px; }
.dayhead .n span { color:${ACCENT}; }
.dayhead .t { margin-top:10px; font-size:${s.sub}px; font-weight:600; color:rgba(242,236,224,0.6); }

/* The rail is one continuous line behind the dots rather than a border on each
   row: a per-row border leaves a hairline gap at every join, which at this size
   reads as a dashed line nobody asked for. */
.stops { position:relative; flex:1; display:flex; flex-direction:column; justify-content:center; gap:${size === 'tiktok' ? 30 : 20}px; padding:${size === 'tiktok' ? 40 : 28}px 0; min-height:0; }
/* align-items:stretch, which is what makes the rail a RAIL. With flex-start the
   rail column is only as tall as its own dot, the connecting line is positioned
   inside a 38px box, and what draws is a stub under each dot — four detached
   ticks that read as a dashed border nobody asked for. */
.stop { display:flex; align-items:stretch; gap:${size === 'tiktok' ? 24 : 18}px; }
.stop .rail { position:relative; width:${size === 'tiktok' ? 30 : 26}px; flex:none; display:flex; align-items:flex-start; justify-content:center; padding-top:${size === 'tiktok' ? 16 : 13}px; }
.stop .dot { width:${size === 'tiktok' ? 22 : 18}px; height:${size === 'tiktok' ? 22 : 18}px; border-radius:50%; background:${ACCENT}; box-shadow:0 0 0 ${size === 'tiktok' ? 8 : 6}px rgba(232,163,61,0.16); }
.stop .line { position:absolute; top:${size === 'tiktok' ? 44 : 36}px; bottom:${size === 'tiktok' ? -30 : -20}px; width:3px; background:rgba(242,236,224,0.18); }
.stop:last-child .line { display:none; }
.stop .body { flex:1; min-width:0; }
.stop .when { font-size:${s.time}px; font-weight:700; color:${ACCENT}; letter-spacing:0.4px; }
.stop .name { font-family:'Heebo',sans-serif; font-size:${s.name}px; font-weight:800; line-height:1.18; letter-spacing:-0.6px; }
.stop .note { margin-top:6px; font-size:${s.note}px; font-weight:500; line-height:1.34; color:rgba(242,236,224,0.62); }
/* The price sits on the line's END — its left, in RTL — which is also the half
   of the frame TikTok's button rail never covers. */
.stop .cost { flex:none; align-self:center; font-size:${s.cost}px; font-weight:800; white-space:nowrap; color:${palette.paper}; }
.stop .cost.free { color:${palette.sage}; }

.foot { display:flex; align-items:center; justify-content:space-between; gap:20px; padding-top:${size === 'tiktok' ? 26 : 18}px; border-top:2px solid rgba(242,236,224,0.14); }
.foot .label { font-size:${s.note}px; font-weight:600; color:rgba(242,236,224,0.55); }
.foot .sum { font-family:'Heebo',sans-serif; font-size:${s.cost + 6}px; font-weight:900; }
.pips { display:flex; gap:10px; }
.pip { width:${size === 'tiktok' ? 14 : 12}px; height:${size === 'tiktok' ? 14 : 12}px; border-radius:50%; background:rgba(242,236,224,0.22); }
.pip.on { background:${ACCENT}; }

/* --- the total ---------------------------------------------------------- */
.rows { display:flex; flex-direction:column; gap:${size === 'tiktok' ? 22 : 15}px; }
.row { display:flex; align-items:baseline; justify-content:space-between; gap:20px; padding-bottom:${size === 'tiktok' ? 20 : 14}px; border-bottom:1px solid rgba(242,236,224,0.12); }
.row .what { font-size:${s.name - 6}px; font-weight:700; }
.row .what b { color:${ACCENT}; font-weight:800; }
.row .much { font-size:${s.cost}px; font-weight:800; white-space:nowrap; }
.big { font-family:'Heebo',sans-serif; font-size:${s.total}px; font-weight:900; line-height:1; letter-spacing:-3px; }
.big span { font-size:${Math.round(s.total * 0.46)}px; margin-inline-start:12px; }
.per { margin-top:14px; font-size:${s.note}px; font-weight:600; color:rgba(242,236,224,0.55); }

/* --- the ask ------------------------------------------------------------ */
.steps { display:flex; flex-direction:column; gap:${size === 'tiktok' ? 30 : 22}px; }
.step { display:flex; align-items:center; gap:${size === 'tiktok' ? 24 : 18}px; font-size:${s.step}px; font-weight:700; line-height:1.24; }
.step i {
  flex:none; display:flex; align-items:center; justify-content:center;
  width:${size === 'tiktok' ? 66 : 56}px; height:${size === 'tiktok' ? 66 : 56}px;
  border-radius:50%; background:${ACCENT}; color:${palette.ink};
  font-family:'Heebo',sans-serif; font-style:normal; font-size:${Math.round(s.step * 0.86)}px; font-weight:900;
}
.step q { quotes:'"' '"'; color:${ACCENT}; }
`;
}

const head = (kicker) => `<div class="top">
  <div class="brand"><div class="word">טיול<span>+</span></div><div class="site ltr">${e(siteMark())}</div></div>
  ${kicker ? `<div class="chip">${e(kicker)}</div>` : ''}
</div>`;

const pips = (n, of) =>
  `<div class="pips">${Array.from({ length: of }, (_, i) => `<div class="pip${i < n ? ' on' : ''}"></div>`).join('')}</div>`;

/** A cost, or the word for free — a blank price reads as an omission. */
const cost = (n) =>
  n > 0
    ? `<div class="cost">${shekels(n)} ₪</div>`
    : `<div class="cost free">חינם</div>`;

/**
 * One slide of a plan, as HTML.
 *
 * `plan` is the whole itinerary on every call, because each slide states
 * something about the whole — the cover counts the stops, a day slide shows
 * which day of how many, the total lists every day. Passing only the slide's
 * own content is how a set of slides stops agreeing with itself.
 */
export function renderPlanSlideHtml(slide, plan, { size = 'tiktok', text, giveaway = null } = {}) {
  if (!SIZES[size]) throw new Error(`unknown plan slide size: ${size}`);
  const body = slideBody(slide, plan, { size, text, giveaway });
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${css(size)}</style></head><body><div class="frame">${body}</div></body></html>`;
}

function slideBody(slide, plan, { size, text, giveaway }) {
  const of = plan.days.length;

  if (slide.type === 'cover') {
    return [
      // The chip says what this IS, not how long it is — the day count is
      // already in the hook and again in the facts row below it, and a label
      // repeated three times on one slide is a slide with one fewer thing to
      // say. "מסלול AI" is also the honest heading for the whole post.
      head('מסלול AI'),
      '<div class="mid">',
      `<div class="ask"><span class="who">${e(text.askWhoHe)}</span>${e(text.askHe)}</div>`,
      `<div class="hook">${e(text.hookHe)}</div>`,
      `<div class="sub">${e(text.hookSubHe)}</div>`,
      '</div>',
      `<div class="facts">
         <div class="fact"><b>${of}</b> ימים</div>
         <div class="fact"><b>${stopCount(plan.days)}</b> עצירות</div>
         <div class="fact"><b>${shekels(plan.total)} ₪</b> ${e(text.perPersonHe)}</div>
       </div>`,
    ].join('');
  }

  if (slide.type === 'day') {
    const day = slide.day;
    return [
      head(e(plan.dest.he)),
      `<div class="dayhead">
         <div class="n">${e(text.dayLabelFor(day.n))}<span> · ${e(plan.dest.he)}</span></div>
         <div class="t">${e(day.titleHe)}</div>
       </div>`,
      '<div class="stops">',
      ...day.stops.map(
        (stop) => `<div class="stop">
          <div class="rail"><div class="dot"></div><div class="line"></div></div>
          <div class="body">
            ${stop.timeHe ? `<div class="when">${e(stop.timeHe)}</div>` : ''}
            <div class="name">${e(stop.nameHe)}</div>
            <div class="note">${e(stop.noteHe)}</div>
          </div>
          ${cost(stop.costIls)}
        </div>`
      ),
      '</div>',
      `<div class="foot">
         <div class="label">${e(text.dayLabelFor(day.n))}</div>
         ${pips(day.n, of)}
         <div class="sum">${shekels(dayTotal(day))} ₪</div>
       </div>`,
    ].join('');
  }

  if (slide.type === 'total') {
    return [
      head(e(plan.dest.he)),
      '<div class="mid">',
      '<div class="rows">',
      ...plan.days.map(
        (day) => `<div class="row">
          <div class="what"><b>${e(text.dayLabelFor(day.n))}</b> · ${e(day.titleHe)}</div>
          <div class="much">${shekels(dayTotal(day))} ₪</div>
        </div>`
      ),
      '</div>',
      `<div><div class="big">${shekels(plan.total)} <span>₪</span></div>
        <div class="per">${e(text.totalLabelHe)} · ${e(text.perPersonHe)} · ${e(`${of} ימים ב${plan.dest.he}`)}</div></div>`,
      '</div>',
      `<div class="foot"><div class="label">${e(text.totalNoteHe)}</div>${pips(of, of)}</div>`,
    ].join('');
  }

  if (slide.type === 'cta') {
    return [
      head(e(plan.dest.he)),
      '<div class="mid">',
      `<div class="hook">${e(giveaway.titleHe)}</div>`,
      '<div class="steps">',
      ...giveaway.stepsHe.map(
        (step, i) => `<div class="step"><i>${i + 1}</i><div>${withQuotes(step)}</div></div>`
      ),
      '</div>',
      '</div>',
      `<div class="foot"><div class="label">${e(giveaway.footHe)}</div></div>`,
    ].join('');
  }

  throw new Error(`unknown plan slide type: ${slide.type}`);
}

/**
 * The quoted keyword, coloured.
 *
 * The step that matters is 'תגיבו "רומא"', and the word in quotes is the thing
 * a viewer has to actually type. Escaped first and marked up second, so the
 * accent colour cannot be a way for a destination name to inject markup.
 */
function withQuotes(step) {
  const safe = e(step);
  return safe.replace(/&quot;([^&]+)&quot;/g, (_, inner) => `<q>${inner}</q>`);
}

export { SIZES };
