import { getBrowser } from './index.js';

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
  } catch {
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
