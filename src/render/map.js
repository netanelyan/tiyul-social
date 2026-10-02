import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { getBrowser } from './index.js';
import { heeboDataUri, assistantDataUri, escapeHtml } from './theme.js';

// The slide that answers "where", drawn as a country ringed on a night map.
//
// Modelled on a reference the owner supplied: a TikTok slideshow whose second
// slide is a satellite view at night with one country outlined in a red dotted
// line, and whose whole job is to turn a daydream into a place. It is the only
// informative frame in a post that otherwise carries no text at all.
//
// TWO PUBLIC SOURCES, NO KEY, AND THAT IS WHY THIS EXISTS AT ALL.
//
//   The picture   NASA GIBS serves VIIRS City Lights as ordinary web-mercator
//                 tiles. It is the actual Earth-at-night imagery the reference
//                 is using, it is US-government work and therefore public
//                 domain, and it needs no account. Every commercial basemap
//                 that would do this job wants a key and a billing relationship
//                 for what amounts to one image a day.
//
//   The outline   Nominatim returns a country's real boundary as GeoJSON with
//                 `polygon_geojson=1`. This project already depends on
//                 Nominatim in two other places, so it is not a new dependency,
//                 only a new field of an existing one.
//
// THE COMPOSITING IS DONE IN CHROMIUM, which is already running for every card
// and slide this project makes. Tiles are positioned as plain <img> elements
// and the boundary is one SVG path over a canvas, so there is no image
// library and no native dependency — the same bargain src/video/overlay.js
// makes when it refuses to let ffmpeg draw Hebrew.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA =
  process.env.PLACES_USER_AGENT || 'tiyul-plus/1.0 (travel content pipeline; contact via www.tiyulplus.com)';

// GIBS, in the projection everything else on the web uses. `Level8` caps at
// zoom 8, which is ample: a country has to FIT the frame, so the zoom that
// shows Finland whole is 4 or 5 and no country on earth needs more than 8.
const TILE = 256;
const MAX_ZOOM = 8;
const tileUrl = (z, x, y) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpg`;

/* -------------------------------------------------------------------------- */
/* Web Mercator                                                               */
/* -------------------------------------------------------------------------- */

/** Longitude to world x, in tiles, at this zoom. */
const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;

/**
 * Latitude to world y, in tiles.
 *
 * Clamped to Mercator's limit. The projection is undefined at the poles and
 * returns Infinity a little before them, which on a country reaching past 85°
 * would produce a tile range of NaN and an empty slide rather than an error.
 */
const latToY = (lat, z) => {
  const φ = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * 2 ** z;
};

/**
 * Where to look, and how close.
 *
 * The zoom is the largest one at which the whole boundary still fits inside the
 * frame with `padding` to spare — found by trying each zoom rather than solved,
 * because the answer is an integer in a range of nine and the loop is clearer
 * than the logarithm.
 *
 * PADDING IS NOT DECORATION. A country whose edges touch the frame reads as a
 * screenshot of a map; one with sea around it reads as a place being pointed
 * at. The reference has roughly a fifth of the frame spare on the narrow axis.
 */
export function fitZoom(bbox, { width, height, padding = 0.18, maxZoom = MAX_ZOOM } = {}) {
  const [south, north, west, east] = bbox.map(Number);
  const usableW = width * (1 - padding * 2);
  const usableH = height * (1 - padding * 2);

  for (let z = maxZoom; z >= 0; z--) {
    const w = Math.abs(lonToX(east, z) - lonToX(west, z)) * TILE;
    const h = Math.abs(latToY(south, z) - latToY(north, z)) * TILE;
    if (w <= usableW && h <= usableH) return z;
  }
  return 0;
}

/**
 * Every point of a boundary, as pixels in the finished frame.
 *
 * Returns one array per ring, because a country is not one loop: Finland is a
 * mainland plus a scatter of islands, and drawing them as a single path joins
 * Åland to the coast with a line through the sea.
 *
 * DECIMATED, and the number matters. Nominatim returns Finland as 448KB of
 * coordinates — around twenty thousand points, at a fidelity meant for
 * cartography rather than for a shape eight hundred pixels tall. Every one of
 * them would be laid out, rasterised and screenshotted by Chromium for a
 * difference no viewer can see. `maxPoints` keeps the silhouette and drops the
 * fjords; rings too small to register at this zoom are dropped whole.
 */
export function projectRings(geojson, { zoom, centre, width, height, maxPoints = 1200 } = {}) {
  const polys =
    geojson?.type === 'MultiPolygon' ? geojson.coordinates : geojson?.type === 'Polygon' ? [geojson.coordinates] : [];

  // The world-pixel coordinate of the frame's top-left corner.
  const originX = lonToX(centre.lon, zoom) * TILE - width / 2;
  const originY = latToY(centre.lat, zoom) * TILE - height / 2;

  const rings = [];
  for (const poly of polys) {
    // The outer ring only. Holes are enclaves and lakes, and outlining them
    // turns a silhouette into a diagram.
    const ring = poly[0];
    if (!ring?.length) continue;

    const step = Math.max(1, Math.ceil(ring.length / maxPoints));
    const pts = [];
    for (let i = 0; i < ring.length; i += step) {
      const [lon, lat] = ring[i];
      pts.push([lonToX(lon, zoom) * TILE - originX, latToY(lat, zoom) * TILE - originY]);
    }
    // Closed explicitly: decimation almost always drops the repeated last
    // point, which leaves a visible gap in a dashed outline.
    if (pts.length > 2) {
      pts.push(pts[0]);
      rings.push(pts);
    }
  }

  // Biggest first, and small fragments dropped. A country's outline is its
  // mainland; forty islands of four pixels each read as noise around it.
  const area = (pts) => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  };
  return rings.sort((a, b) => area(b) - area(a)).filter((r, i) => i === 0 || area(r) > 400);
}

/* -------------------------------------------------------------------------- */
/* The lookup                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the tiles HERE rather than letting the page do it.
 *
 * The first version put the tile URLs straight into `<img src>` and waited for
 * them to load. A country needs around seventy tiles, Chromium asked for all
 * seventy at once, and GIBS quietly dropped a handful — which arrives as a
 * BLACK COLUMN down one side of the slide, not as an error. Every tile fetched
 * on its own afterwards returned 200.
 *
 * So they are fetched in Node, six at a time, with one retry, and embedded as
 * data URIs. Three things follow from that and all of them are improvements:
 * the render stops depending on the page's network, the screenshot cannot
 * outrun a decode, and a tile that genuinely will not come back is COUNTABLE —
 * which is what lets renderMapSlide refuse to publish a map with holes in it
 * rather than shipping one.
 */
async function fetchTiles(tiles, { concurrency = 6, timeoutMs = 15_000 } = {}) {
  const out = [];
  let next = 0;
  let failed = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= tiles.length) return;
      const t = tiles[i];
      let data = null;
      for (let attempt = 0; attempt < 2 && !data; attempt++) {
        try {
          const res = await fetch(t.url, { signal: AbortSignal.timeout(timeoutMs) });
          if (res.ok) data = Buffer.from(await res.arrayBuffer()).toString('base64');
        } catch {
          /* retried once, then counted */
        }
      }
      if (data) out.push({ ...t, src: `data:image/jpeg;base64,${data}` });
      else failed++;
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker));
  return { tiles: out, failed };
}

/**
 * The middle of a ring, for placing the country's name inside it.
 *
 * The bounding box's centre rather than a true centroid, which is wrong for a
 * crescent and right for everything this draws. The reference puts the name
 * inside the outlined country, and a label centred on the FRAME sits on the
 * border as often as not — which is what the first render did.
 */
export function ringCentre(ring) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

const cache = new Map();

/**
 * A place's boundary and bounding box, or null.
 *
 * Null rather than a throw, like every other optional lookup here: a map slide
 * that cannot be drawn should cost the slide, and the caller decides whether
 * the post survives without it.
 */
export async function boundaryOf(place, { timeoutMs = 15_000 } = {}) {
  const key = String(place || '').trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  try {
    const url = `${NOMINATIM}?${new URLSearchParams({
      q: key,
      format: 'json',
      polygon_geojson: '1',
      limit: '1',
    })}`;
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const [hit] = await res.json();
    if (!hit?.geojson || !hit?.boundingbox) return null;

    const out = {
      name: hit.display_name,
      bbox: hit.boundingbox.map(Number),
      geojson: hit.geojson,
      centre: { lat: Number(hit.lat), lon: Number(hit.lon) },
    };
    cache.set(key, out);
    return out;
  } catch (err) {
    // Named rather than swallowed. A basemap that silently does not appear looks
    // identical to a destination with no mapped roads, and the two want different
    // things done about them.
    console.error(`map: no basemap vectors - ${err.message}`);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* The slide                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The map slide's HTML.
 *
 * Exported so the selftest can assert what is on it without launching a
 * browser, which is how every other renderer here is tested.
 */
export function mapHtml({ tiles, rings, width, height, label = null, style = {} }) {
  const {
    stroke = '#FF3B30',
    strokeWidth = 5,
    dash = '2 14',
    glow = true,
    // A wash over the tiles. NASA's night imagery is already dark, but its
    // brightest cities are bright enough to compete with a dashed outline
    // crossing them.
    dim = 0.25,
  } = style;

  const path = rings
    .map((r) => `M ${r.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`)
    .join(' ');

  // THE TILES GO ONTO ONE CANVAS, NOT INTO SEVENTY <img> ELEMENTS.
  //
  // The <img> version laid out perfectly and rendered wrong. Measured, all of
  // it: seventy images in the DOM, none broken, every bounding rect at the
  // pixel it was asked for, every tile's JPEG verified to have content — and
  // the screenshot came back with two whole columns painted as page background.
  // Drawing those same decoded images to a canvas at those same coordinates, in
  // the same page, produced the correct pixels. So the bug is in how Chromium
  // composites that many large data-URI layers for a screenshot, and it is not
  // worth chasing further when the composition itself is one drawImage loop.
  //
  // It is also simply better: one element instead of seventy, one decode pass,
  // and a basemap that is finished before anything is drawn over it.
  const tileData = JSON.stringify(tiles.map((t) => [t.src, Math.round(t.x), Math.round(t.y)]));

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:${width}px; height:${height}px; overflow:hidden; background:#00030a; }
#map { position:absolute; inset:0; display:block; }
#dim { position:absolute; inset:0; background:rgba(0,3,10,${dim}); }
svg { position:absolute; inset:0; }
/* The outline, and the glow behind it. A 5px dashed line over a night
   satellite image is legible on the sea and invisible over a lit city; the
   blurred copy underneath is what carries it across Helsinki. */
.ring { fill:none; stroke:${stroke}; stroke-width:${strokeWidth}; stroke-dasharray:${dash};
        stroke-linecap:round; stroke-linejoin:round; }
.glow { fill:none; stroke:${stroke}; stroke-width:${strokeWidth * 3}; opacity:0.35;
        filter:blur(${strokeWidth * 2}px); stroke-linejoin:round; }
</style></head><body>
<canvas id="map" width="${width}" height="${height}"></canvas>
<div id="dim"></div>
<svg viewBox="0 0 ${width} ${height}">
  ${glow ? `<path class="glow" d="${path}"></path>` : ''}
  <path class="ring" d="${path}"></path>
</svg>
${
    label
      ? (() => {
          // Inside the outlined country, like the reference, rather than at the
          // centre of the frame - which lands on the border as often as not.
          const [cx, cy] = rings.length ? ringCentre(rings[0]) : [width / 2, height / 2];
          const size = Math.round(width * 0.048);
          return `<div style="position:absolute;left:0;top:${Math.round(cy - size)}px;width:${width}px;text-align:center;transform:translateX(${Math.round(cx - width / 2)}px);font:700 ${size}px system-ui,sans-serif;color:#fff;letter-spacing:1px;text-shadow:0 2px 20px rgba(0,0,0,0.95),0 0 6px rgba(0,0,0,0.8)">${label}</div>`;
        })()
      : ''
  }
<script>
// Draw every tile, then say so. window.__mapReady is what the renderer waits
// for: a screenshot taken before this finishes is a red outline on a black
// rectangle, and that is exactly the failure that would ship unnoticed.
window.__mapReady = (async () => {
  const g = document.getElementById('map').getContext('2d');
  const tiles = ${tileData};
  await Promise.all(
    tiles.map(
      ([src, x, y]) =>
        new Promise((resolve) => {
          const img = new Image();
          // Resolved either way. One tile that will not decode should cost a
          // corner of the basemap, not the whole slide - renderMapSlide has
          // already refused anything with more than a couple missing.
          img.onload = () => { g.drawImage(img, x, y, ${TILE}, ${TILE}); resolve(); };
          img.onerror = resolve;
          img.src = src;
        })
    )
  );
  return true;
})();
</script>
</body></html>`;
}

/* -------------------------------------------------------------------------- */
/* the city-scale pin map                                                     */
/* -------------------------------------------------------------------------- */

// WHY THIS ONE HAS NO BASEMAP, which is the first thing anybody will ask.
//
// GIBS caps at zoom 8. That is stated above as "ample" and it is - for a COUNTRY,
// which has to fit the frame. A city itinerary needs about zoom 13, and at zoom 8 one
// tile pixel is roughly 600 metres, so every place on a Prague day lands inside the
// same pixel. The imagery this project has a licence to use simply cannot draw this.
//
// The alternatives were considered and rejected:
//
//   OpenStreetMap's own tiles - the usage policy discourages automated bulk fetching
//   and requires visible attribution, and "© OpenStreetMap contributors" burned into
//   the corner of a slide is exactly the tiny corner text that marks a post as
//   made-by-a-company.
//
//   A commercial basemap - every one of them wants a key and a billing relationship,
//   which is the dependency the note at the top of this file exists to avoid.
//
// SO WHAT IS DRAWN IS THE GEOMETRY ITSELF, and it turns out to be the better post
// anyway. The coordinates are real, the relative positions are true, the walking order
// is the itinerary's own order, and a scale bar makes the distances readable. What a
// viewer saves a map for is "what is near what and can I walk it" - and a street map
// answers that less directly than a route diagram does, because a street map also
// draws four hundred streets they did not ask about.
//
// It is NOT called a map of the city anywhere in the output. The hook says "כל
// המקומות מהמסלול", which is what it is.

/**
 * A projection that fits a set of points into a frame.
 *
 * Web Mercator, exactly as the country map uses, but at a FRACTIONAL scale chosen to
 * fit rather than at an integer tile zoom - there are no tiles here, so there is no
 * reason to round to one. Mercator rather than plain latitude/longitude because at 50
 * degrees north a degree of longitude is two thirds of a degree of latitude, and
 * plotting them as a square grid stretches Prague sideways by half.
 */
export function fitPoints(points, { width, height, padding = 0.14 } = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  if (pts.length < 2) return null;

  // Unit mercator, independent of zoom: x in [0,1] across the world.
  const mx = (lon) => (Number(lon) + 180) / 360;
  const my = (lat) => {
    const r = (Math.max(-85, Math.min(85, Number(lat))) * Math.PI) / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };

  const xs = pts.map((p) => mx(p.lng));
  const ys = pts.map((p) => my(p.lat));
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };

  // A single-point-wide box would divide by zero, and a very thin one would scale to
  // absurdity - two stops fifty metres apart would fill the frame and read as a map of
  // two buildings. The floor is about 1.2km of span at this latitude.
  const MIN = 1 / 2 ** 15;
  const spanX = Math.max(box.x1 - box.x0, MIN);
  const spanY = Math.max(box.y1 - box.y0, MIN);

  const usable = 1 - padding * 2;
  const scale = Math.min((width * usable) / spanX, (height * usable) / spanY);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;

  const project = (p) => ({
    x: width / 2 + (mx(p.lng) - cx) * scale,
    y: height / 2 + (my(p.lat) - cy) * scale,
  });

  // Metres per pixel, for the scale bar.
  //
  // One unit of mercator x is the whole world round, 40,075,017m at the equator,
  // narrowing by cos(latitude). So the only unknown is the latitude of the frame's
  // centre, and `cy` is a mercator y rather than a latitude - inverted here, which is
  // the one bit of arithmetic in this file worth writing out:
  //
  //   cy = (1 - asinh(tan φ) / π) / 2   =>   φ = atan(sinh(π (1 - 2 cy)))
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * cy)));
  const metresPerPixel = (40_075_017 * Math.cos(latRad)) / scale;

  return { project, scale, metresPerPixel, latDeg: (latRad * 180) / Math.PI, centre: { x: cx, y: cy } };
}

/**
 * A round number of metres that fits in about a quarter of the frame.
 *
 * ROUND, because a scale bar reading "437 מ׳" is a scale bar nobody reads. The ladder
 * is the one every map uses: 1, 2, 5 and their decades.
 */
export function scaleBar(metresPerPixel, width) {
  const want = width * 0.24 * metresPerPixel;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000];
  const metres = steps.find((s) => s >= want) || steps[steps.length - 1];
  return {
    metres,
    px: Math.round(metres / metresPerPixel),
    labelHe: metres >= 1000 ? `${metres / 1000} ק״מ` : `${metres} מ׳`,
  };
}

/**
 * The pin map's HTML.
 *
 * `points` each carry `{ lat, lng, n, dayN, nameHe }`. The day number is what colours
 * them, because "which of these can I do together" is the question a viewer is
 * actually asking and it is the one thing a street map would not tell them.
 *
 * NO LABELS ON THE PINS beyond their number. Twenty place names on one frame is a
 * frame of overlapping text at any size that fits - the reference maps do not attempt
 * it either. The numbers key to the list post's own numbering, which is what makes a
 * map post worth posting alongside one.
 */
export function pinMapHtml({ points, width, height, titleHe = null, subHe = null, bar = null, dayColours = [], base = null }) {
  const pin = Math.round(width * 0.052);
  const font = Math.round(pin * 0.52);

  // Lines first, so pins sit on top of them.
  const byDay = new Map();
  for (const p of points) {
    if (!byDay.has(p.dayN)) byDay.set(p.dayN, []);
    byDay.get(p.dayN).push(p);
  }
  const paths = [...byDay.entries()]
    .filter(([, pts]) => pts.length > 1)
    .map(([day, pts]) => {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      const colour = dayColours[(Number(day) - 1) % dayColours.length] || '#FFD84D';
      return `<path class="leg" d="${d}" style="stroke:${colour}"/>`;
    })
    .join('\n  ');

  const pins = points
    .map((p) => {
      const colour = dayColours[(Number(p.dayN) - 1) % dayColours.length] || '#FFD84D';
      return `<div class="pin" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px;background:${colour}">${p.n}</div>`;
    })
    .join('\n  ');

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family: 'Heebo'; src: url(${heeboDataUri()}) format('truetype'); font-weight: 100 900; font-display: block; }
@font-face { font-family: 'Assistant'; src: url(${assistantDataUri()}) format('truetype'); font-weight: 200 800; font-display: block; }
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:${width}px; height:${height}px; overflow:hidden;
             background:#0b0f16; font-family:'Assistant','Heebo',sans-serif; }
/* THE BASEMAP, UNDER THE PINS. Water first, because a river is the strongest landmark
   on any city map and the thing a reader orients by before anything else. */
.basemap { z-index:0; }
.water { fill:rgba(58,96,150,.5); stroke:rgba(78,126,190,.55); stroke-width:${Math.max(1, Math.round(width * 0.0016))}; }
.road  { fill:none; stroke:rgba(255,255,255,.15); stroke-width:${Math.max(1, Math.round(width * 0.0022))};
         stroke-linecap:round; stroke-linejoin:round; }
/* The grid stands in when there is no basemap - an Overpass outage, or a destination
   with no mapped roads. Over a real map it is noise. */
#grid { position:absolute; inset:0; opacity:.5;
        background-image:
          linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px);
        background-size:${bar?.px || 120}px ${bar?.px || 120}px; }
#glow { position:absolute; inset:0;
        background:radial-gradient(ellipse at 50% 46%, rgba(80,120,190,.16), transparent 62%); }
svg { position:absolute; inset:0; }
.leg { fill:none; stroke-width:${Math.max(3, Math.round(width * 0.005))}px; stroke-dasharray:2 ${Math.round(width * 0.012)};
       stroke-linecap:round; opacity:.72; }
.pin { position:absolute; width:${pin}px; height:${pin}px; margin-left:${-pin / 2}px; margin-top:${-pin / 2}px;
       border-radius:50%; color:#14161c; font-weight:800; font-size:${font}px;
       display:flex; align-items:center; justify-content:center;
       box-shadow:0 0 0 ${Math.max(2, Math.round(pin * 0.06))}px rgba(11,15,22,.9), 0 ${Math.round(pin * 0.12)}px ${Math.round(pin * 0.3)}px rgba(0,0,0,.5); }
.head { position:absolute; inset-inline:0; top:${Math.round(height * 0.07)}px; text-align:center; padding:0 ${Math.round(width * 0.07)}px; }
.head .t { color:#fff; font-weight:800; font-size:${Math.round(width * 0.062)}px; line-height:1.16;
           text-shadow:0 2px 14px rgba(0,0,0,.6); }
.head .s { color:rgba(255,255,255,.74); font-weight:600; font-size:${Math.round(width * 0.036)}px; margin-top:6px; }
/* The scale bar. The one piece of small type on the slide that earns its place: it is
   what makes the geometry mean something rather than being decoration. */
.bar { position:absolute; inset-inline-start:${Math.round(width * 0.075)}px; bottom:${Math.round(height * 0.075)}px;
       color:rgba(255,255,255,.86); font-weight:700; font-size:${Math.round(width * 0.029)}px; }
/* REQUIRED BY ODbL, not decoration, and in the corner where every map anyone has ever
   seen puts it. */
.osm { position:absolute; inset-inline-end:${Math.round(width * 0.03)}px; bottom:${Math.round(height * 0.022)}px;
       color:rgba(255,255,255,.45); font-size:${Math.round(width * 0.018)}px; font-weight:600; direction:ltr; }
.bar i { display:block; height:${Math.max(3, Math.round(width * 0.004))}px; background:rgba(255,255,255,.86);
         border-radius:2px; margin-bottom:6px; }
/* One invisible character set in Heebo, for the reason given above the base stylesheet
   in render/postSlides.js: renderToJpeg refuses a page whose Heebo did not load, and a
   declared face that no rule draws with is never fetched at all. */
.font-probe { position:absolute; top:-200px; inset-inline-start:-200px; font-family:'Heebo';
              font-weight:700; font-size:40px; color:transparent; }
</style></head><body>
<div class="font-probe">א</div>
${
  base
    ? `<svg class="basemap" viewBox="0 0 ${width} ${height}">${base.roads
        .map((d) => `<path class="road" d="${d}"/>`)
        .join('')}${base.water.map((d) => `<path class="water" d="${d}"/>`).join('')}</svg>`
    : '<div id="grid"></div>'
}
<div id="glow"></div>
<svg viewBox="0 0 ${width} ${height}">
  ${paths}
</svg>
  ${pins}
<div class="head">
  ${titleHe ? `<div class="t">${escapeHtml(titleHe)}</div>` : ''}
  ${subHe ? `<div class="s">${escapeHtml(subHe)}</div>` : ''}
</div>
${bar ? `<div class="bar"><i style="width:${bar.px}px"></i>${escapeHtml(bar.labelHe)}</div>` : ''}
${base ? `<div class="osm">© OpenStreetMap contributors</div>` : ''}
</body></html>`;
}

/**
 * Draw one country, ringed, on a night satellite map.
 *
 * Returns null when the place could not be resolved, which the caller treats as
 * "this post has no map slide" rather than as a failure — the same contract
 * every other optional enrichment in this pipeline has.
 */
export async function renderMapSlide(place, { width, height, file, label = null, style = {} } = {}) {
  const found = await boundaryOf(place);
  if (!found) return null;

  const zoom = fitZoom(found.bbox, { width, height });
  // The centre of the BOUNDING BOX, not Nominatim's `lat`/`lon`. Those are a
  // representative point inside the shape — for a country with a long tail it
  // sits where the mass is, and centring on it pushes the far end off frame.
  const centre = {
    lat: (found.bbox[0] + found.bbox[1]) / 2,
    lon: (found.bbox[2] + found.bbox[3]) / 2,
  };

  // Which tiles cover the frame. One row and column of margin, because a frame
  // whose edge falls mid-tile would otherwise show the page background.
  const originX = lonToX(centre.lon, zoom) * TILE - width / 2;
  const originY = latToY(centre.lat, zoom) * TILE - height / 2;
  const n = 2 ** zoom;
  const tiles = [];
  for (let tx = Math.floor(originX / TILE) - 1; tx <= Math.floor((originX + width) / TILE) + 1; tx++) {
    for (let ty = Math.floor(originY / TILE) - 1; ty <= Math.floor((originY + height) / TILE) + 1; ty++) {
      // Wrapped east-west, clamped north-south: the world repeats sideways and
      // stops at the poles, and asking GIBS for row -1 is a 400.
      if (ty < 0 || ty >= n) continue;
      const wrapped = ((tx % n) + n) % n;
      tiles.push({ url: tileUrl(zoom, wrapped, ty), x: tx * TILE - originX, y: ty * TILE - originY });
    }
  }

  const rings = projectRings(found.geojson, { zoom, centre, width, height });
  if (!rings.length) return null;

  // A MAP WITH HOLES IN IT DOES NOT PUBLISH. A couple of missing tiles at the
  // corner of a frame is invisible; a dropped column is a black stripe down a
  // slide whose entire job is to look like a satellite photograph, and it
  // arrives silently. Two is the tolerance, and the count is returned either
  // way so a caller can say so.
  const fetched = await fetchTiles(tiles);
  if (fetched.failed > 2) return null;

  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.setContent(mapHtml({ tiles: fetched.tiles, rings, width, height, label, style }), {
      waitUntil: 'load',
    });
    // The basemap is drawn by a script in the page, so `load` is not the
    // finish line - this is.
    await page.waitForFunction(() => window.__mapReady !== undefined, null, { timeout: 30_000 });
    await page.evaluate(() => window.__mapReady);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    return {
      file,
      zoom,
      centre,
      rings: rings.length,
      tiles: fetched.tiles.length,
      missing: fetched.failed,
      name: found.name,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* the city basemap, drawn from data                                          */
/* -------------------------------------------------------------------------- */

// WHY THIS IS VECTOR AND NOT A PICTURE, because the obvious answer was tried first.
//
// GIBS caps at zoom 8, where one tile pixel is about 600 metres - every stop on a
// Prague day lands in the same pixel - so the country basemap above cannot draw a city,
// and the pin map shipped as dots on a dark field with nothing under them.
//
// OpenStreetMap's own raster tiles serve city zoom and need no key. One tile fetches
// fine; seventy in a row come back 403, "App is not following the tile usage policy of
// OpenStreetMap's volunteer-run servers" - which is their policy working exactly as
// written, and it rendered a slide covered in error tiles. Carto's Positron answers
// with 2KB placeholders without an account, and every other grey basemap wants a key.
//
// What IS available is the data underneath. Overpass is already a dependency here - the
// deck's map route runs on it - and the water plus the major roads for one bounding box
// is a single query. Drawn as paths that is a real map: the Seine and the main avenues
// under the pins, which is all a reader needs to orient themselves.
//
// It is also the better map for this slide. A raster carries four hundred streets, a
// shopping district and a transit network, none of which the viewer is using and all of
// which compete with the pins. This carries the two things they ARE using.
//
// ODbL attribution is owed for the data and is printed on the slide.
// THE SAME MIRROR LIST THE DECK'S MAP ROUTE USES, and for the same reason: Overpass is
// volunteer-run, every instance rations query slots, and a busy one answers 429 or 504
// rather than queueing. One instance is one busy afternoon away from a map post with
// nothing under its pins.
const OVERPASS_MAP = (process.env.OVERPASS_URL || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean)
  .concat([
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    // overpass.osm.ch IS DELIBERATELY NOT HERE. It is the Swiss instance and it carries
    // a REGIONAL extract, so a query for central Paris returns HTTP 200 with zero
    // elements - which is indistinguishable, to this code, from "there is nothing here".
    // A mirror that confidently answers "no data" for most of the world is worse than
    // no mirror: it ends the fallback chain with a success and the slide draws pins
    // over nothing. That is what it did, and it is why the Paris map had no basemap.
  ]);

// Where the cached basemaps live. Under the repo rather than in the OS temp directory,
// because the point is that they survive a restart - a VPS that reboots and then has to
// re-fetch every city it ever rendered is the problem this solves, arrived at slowly.
const VECTOR_CACHE = new URL('../../data/basemaps/', import.meta.url);

// Thirty days. OSM changes constantly and a motorway does not: at this zoom, drawn as
// 2px lines under numbered pins, a month-old extract is indistinguishable from a fresh
// one, and the cost of being wrong is a road slightly out of date on a map that is
// decoration for the pins.
const VECTOR_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const vectorCachePath = (box) => new URL(`${box.replace(/[^0-9.,-]/g, '')}.json`, VECTOR_CACHE);

function readVectorCache(box) {
  try {
    const file = vectorCachePath(box);
    const stat = statSync(file);
    if (Date.now() - stat.mtimeMs > VECTOR_TTL_MS) return null;
    const json = JSON.parse(readFileSync(file, 'utf8'));
    if (!json?.roads && !json?.water) return null;
    return json;
  } catch {
    // A cache miss is the normal case and says nothing worth printing. Every OTHER
    // failure in this module is logged loudly; this one genuinely is not news.
    return null;
  }
}

/**
 * The same shape at the precision a 1080px frame can actually show.
 *
 * Overpass returns coordinates at seven decimal places - about a centimetre - and a
 * motorway as several hundred of them. Central Paris came back as 564KB of JSON for a
 * map drawn as 2px lines under numbered pins, where a whole city block is nine pixels.
 *
 * Two reductions, both lossless at this scale: round to five decimals (about a metre),
 * and drop any point less than roughly ten metres from the one before it. The endpoints
 * of every way are always kept, so nothing changes shape - only its description gets
 * shorter.
 */
function simplify(ways) {
  const R = (n) => Math.round(n * 1e5) / 1e5;
  const MIN = 0.0001; // ~10m in latitude, and less in longitude at these latitudes.
  return (ways || [])
    .map((geometry) => {
      const out = [];
      for (const [i, pt] of geometry.entries()) {
        const lat = R(Number(pt.lat));
        const lon = R(Number(pt.lon ?? pt.lng));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const last = out[out.length - 1];
        const far = !last || Math.abs(lat - last.lat) > MIN || Math.abs(lon - last.lon) > MIN;
        // The last point always survives, so a way does not lose its far end to rounding.
        if (far || i === geometry.length - 1) out.push({ lat, lon });
      }
      return out;
    })
    .filter((g) => g.length > 1);
}

function writeVectorCache(box, vectors) {
  try {
    mkdirSync(VECTOR_CACHE, { recursive: true });
    writeFileSync(vectorCachePath(box), JSON.stringify(vectors));
  } catch (err) {
    console.error(`map: could not cache the basemap for ${box} - ${err.message}`);
  }
}

/**
 * Water and the roads worth drawing, for one bounding box.
 *
 * ONLY THREE ROAD CLASSES, AND A GENEROUS TIMEOUT.
 *
 * A city's full road graph is tens of thousands of ways and drawing it produces grey
 * mud; motorway, trunk and primary is the skeleton somebody navigates by. Including
 * secondary as well pulled eight thousand ways for central Paris, which Overpass takes
 * over a minute to compute and send - and the first version's 45-second timeout meant
 * the basemap silently never appeared.
 *
 * Ninety seconds is deliberately generous. This runs on the rarest post type in the
 * rotation, once, and a map post that takes an extra half-minute to build is a far
 * better outcome than one with nothing under the pins.
 *
 * Null on anything going wrong, and the caller then draws the geometry-only map it drew
 * before - a worse slide, and a true one.
 */
// 180 SECONDS, NOT 90, AND THE NUMBER IS MEASURED.
//
// A successful fetch of central Paris from overpass.kumi.systems took 94.6 seconds. The
// timeout was 90, so every real request for a dense European city centre was aborted
// roughly five seconds before its answer arrived, and the failure printed as a timeout -
// which reads as "the mirror is down" rather than as "we hung up first". Overpass
// queries of this size legitimately take one to two minutes on a free instance; the
// cache above is what makes that acceptable, because a city pays it once.
export async function cityVectors(bbox, { timeoutMs = 180_000 } = {}) {
  // [SOUTH, WEST, NORTH, EAST] - Overpass's own order, and what renderPinMapHtml passes.
  // NOT Nominatim's [south, north, west, east], which is what `fitZoom` above reads; the
  // two orders look alike and swapping them produces a box whose north edge is below its
  // south edge. That box is empty by definition, and Overpass answers "no ways" for it
  // exactly as it would for an ocean - which is why the guard below is loud.
  const [south, west, north, east] = bbox.map(Number);
  if (![south, west, north, east].every(Number.isFinite) || !(north > south && east > west)) {
    console.error(
      `map: refusing an inverted bounding box [S${south} W${west} N${north} E${east}] - expected [south, west, north, east]`
    );
    return null;
  }
  const box = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`;

  // CACHED ON DISK, BECAUSE THE PUBLIC INSTANCES RATION SLOTS AND WE ARE A GUEST.
  //
  // Overpass is volunteer-run and every instance throttles by IP. Rendering the same
  // city's map twice in an afternoon - which happens constantly in testing, and happens
  // in production whenever a post is rebuilt - spends a slot on an answer we already
  // had, and the second one comes back 504. That is not the instance being unreliable,
  // it is us being a bad citizen and then calling the result an outage.
  //
  // Keyed on the box rounded to three decimals, which is about 100m: two renders of the
  // same city produce the same key, and a genuinely different city does not collide.
  const cached = readVectorCache(box);
  if (cached) return cached;
  const q = `[out:json][timeout:30];
(
  way["natural"="water"](${box});
  way["waterway"="river"](${box});
  way["highway"~"^(motorway|trunk|primary|secondary)$"](${box});
);
out geom;`;

  // EVERY FAILURE IS NAMED, which is what the first version got wrong and what cost an
  // hour of looking at an empty map: a rate-limited instance answers 429, the code
  // returned null without a word, and a slide with no basemap looks exactly like a
  // destination with no mapped roads. Those want completely different things done.
  for (const host of OVERPASS_MAP) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        console.error(`map: ${new URL(host).hostname} answered HTTP ${res.status}, trying the next mirror`);
        continue;
      }
      const json = await res.json();
      const ways = (json?.elements || []).filter((el) => Array.isArray(el.geometry) && el.geometry.length > 1);
      if (!ways.length) {
        console.error(`map: ${new URL(host).hostname} returned no ways for this box`);
        continue;
      }
      const out = {
        water: simplify(ways.filter((el) => el.tags?.natural === 'water' || el.tags?.waterway).map((el) => el.geometry)),
        roads: simplify(ways.filter((el) => el.tags?.highway).map((el) => el.geometry)),
      };
      writeVectorCache(box, out);
      return out;
    } catch (err) {
      console.error(`map: ${new URL(host).hostname} - ${err.message}`);
    }
  }
  return null;
}
