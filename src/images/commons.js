// The photograph the site already chose for this place.
//
// WHY THIS IS THE BEST PHOTO SOURCE THIS PROJECT HAS, and it was sitting there
// unused.
//
// Every place on a tiyulplus.com destination page carries a `photo`, and on the
// pages checked while writing this every single one of them is a Wikimedia
// Commons file - 31 of Prague's 37 places have one, and there is not a stock
// library URL among them. That matters for four separate reasons, and each one is
// a problem the existing image step spends real money on:
//
//   IT IS ACTUALLY THE PLACE. fillImages searches two stock libraries and then
//   pays for a vision call per candidate to ask "is this the Colosseum", because
//   a library's top hit for a named landmark is frequently somewhere else. The
//   site's photo was attached to that place by our own editorial process, so the
//   question is already answered - and it is answered better than a model can
//   answer it.
//
//   IT LOOKS TAKEN RATHER THAN COMMISSIONED. Commons is full of visitors'
//   photographs: uneven light, ordinary weather, people in frame, a composition
//   somebody chose while standing there. Stock travel photography is the
//   opposite, and the evidence this whole change was written against is that
//   evenly-lit postcard wides read as an aggregator's post.
//
//   IT COSTS ONE REQUEST FOR A WHOLE POST. The API takes fifty titles at a time,
//   so a twenty-slide list is one call rather than twenty searches and twenty
//   vision judgements.
//
//   AND IT CANNOT RUN OUT. A stock search can simply fail to have a photograph of
//   a specific synagogue. This is a photograph of that synagogue or the site does
//   not list one.
//
// ON THE LICENCES, BECAUSE THIS IS THE ONE THING TO KNOW BEFORE EDITING THIS FILE.
//
// Commons files are free but almost never unconditional. Of Prague's 31: every one
// is CC BY or CC BY-SA, and 24 of the 31 carry ShareAlike (22 CC BY-SA, 2 Free Art
// Licence). Setting Hebrew type over one makes an adaptation.
//
// The owner's decision, taken with those numbers in front of them, is to use the
// photographs and to keep the credit out of the published caption. So nothing here
// writes an attribution line into a caption, and nothing should be added later
// without asking again.
//
// What this module does do is CARRY the attribution rather than discard it. Author
// and licence come back on every image and are printed on the approval card, which
// is an internal message and not a publication. That costs the caption nothing,
// and it is the difference between a decision and an absence of information: the
// day somebody asks which photograph that was, the answer is in the candidate.
//
// NEVER A HOTLINK. The bytes are fetched here and embedded, like every other
// provider in this project. A slide whose <img> points at somebody else's server
// is a slide that renders differently depending on whether that server is up.

import { PROVENANCE } from '../images.js';

const API = 'https://commons.wikimedia.org/w/api.php';

/** The API takes fifty titles in one query and says so. */
export const TITLE_BATCH = 50;

// Where a Commons file may be served from. `upload.` is the canonical host and
// `thumb.` is what the API hands back for a generated thumbnail; both are
// Wikimedia's own.
//
// An ALLOWLIST rather than a pattern, because the whole point of the check is to
// answer "is this ours to use" and a pattern like /wikimedia/ would also accept
// somebody's wikimedia-mirror.example.com. If the site ever starts publishing
// photos from a stock library or from a hotel's own page, this route goes quiet
// and the ordinary search ladder takes over - which is the correct outcome, not a
// bug: a photograph on a business's own page is the one origin BRIEF.md forbids
// outright.
const HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org', 'commons.wikimedia.org']);

export class CommonsError extends Error {
  constructor(message, { step } = {}) {
    super(message);
    this.step = step;
  }
}

/**
 * The file's name on Commons, out of the URL the site publishes.
 *
 * Two shapes reach this. A full-size link is `/commons/a/ab/Name.jpg`; a thumbnail
 * is `/commons/thumb/a/ab/Name.jpg/500px-Name.jpg`, where the name appears twice
 * and it is the FIRST one that is the file. Taking the last path segment would ask
 * the API for a file called "500px-Name.jpg", which does not exist.
 *
 * Returns null for anything that is not a Commons file, which is the ordinary
 * answer for a place the site has no photograph for.
 */
export function titleFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return null;
  }
  if (!HOSTS.has(parsed.hostname)) return null;

  // `/wikipedia/commons/thumb/5/5e/<name>/<width>px-<name>` or
  // `/wikipedia/commons/5/5e/<name>`. The two hex segments are the hash prefix
  // Commons files are sharded on, and they are what makes the name's position
  // findable without counting from either end.
  const m = /\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i.exec(parsed.pathname);
  if (!m) return null;

  const name = decodeURIComponent(m[1]).replace(/_/g, ' ').trim();
  return name || null;
}

/** HTML out of a metadata field. The API returns Artist as markup, often a link. */
const plain = (html) =>
  String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Metadata and a rendered thumbnail URL for a batch of Commons files.
 *
 * `iiurlwidth` is not a nicety, it is the only way to get a usable size. The
 * site publishes 500px thumbnails and rewriting the width in the URL by hand
 * returns HTTP 400 for most values - 800, 1024 and 1600 all fail on a file whose
 * 1280 works - because only some widths are pre-generated. Asking the API for a
 * width produces a `thumburl` that is guaranteed to exist.
 *
 * Returns a Map keyed on the title as it was ASKED FOR, because the API
 * normalises titles (underscores to spaces, first letter capitalised) and the
 * caller has to be able to find its own entry again.
 */
export async function lookup(titles, { width = 1440, timeoutMs = 20_000 } = {}) {
  const want = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))];
  if (!want.length) return new Map();
  if (want.length > TITLE_BATCH) {
    throw new CommonsError(`${want.length} titles asked for, the API takes ${TITLE_BATCH}`, { step: 'titles' });
  }

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: String(width),
    titles: want.map((t) => `File:${t}`).join('|'),
  });

  let body;
  try {
    const res = await fetch(`${API}?${params}`, {
      headers: {
        accept: 'application/json',
        // Wikimedia asks for a real user agent and throttles anonymous ones that
        // do not identify themselves. PLACES_USER_AGENT is the same string the
        // rest of this project introduces itself with.
        'user-agent': process.env.PLACES_USER_AGENT || 'tiyul-plus/1.0 (own content)',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new CommonsError(`HTTP ${res.status}`, { step: 'fetch' });
    body = await res.json();
  } catch (e) {
    if (e instanceof CommonsError) throw e;
    throw new CommonsError(`lookup failed: ${e.message}`, { step: 'fetch' });
  }

  // The API answers under its own normalised titles, and reports the mapping.
  const back = new Map();
  for (const n of body?.query?.normalized || []) back.set(String(n.to), String(n.from));

  const out = new Map();
  for (const page of body?.query?.pages || []) {
    const info = page?.imageinfo?.[0];
    if (!info?.thumburl) continue;
    const asked = (back.get(page.title) || page.title).replace(/^File:/, '');
    const meta = info.extmetadata || {};
    out.set(asked, {
      thumbUrl: info.thumburl,
      thumbWidth: info.thumbwidth || null,
      thumbHeight: info.thumbheight || null,
      width: info.width || null,
      height: info.height || null,
      // Kept for the approval card, never for a caption. See the licence note at
      // the top of this file.
      author: plain(meta.Artist?.value) || null,
      license: plain(meta.LicenseShortName?.value) || null,
      // The file's own page, which is where the full licence terms live. Also
      // approval-card only: assertNoUrl would refuse it in anything published.
      pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(asked)}`,
    });
  }
  return out;
}

/** Bytes, as the data URI the renderer wants. Null on anything going wrong. */
export async function download(url, timeoutMs = 20_000) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': process.env.PLACES_USER_AGENT || 'tiyul-plus/1.0 (own content)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const type = String(res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // A Commons thumbnail at 1440px is a few hundred kilobytes. Anything under a
    // few kilobytes is an error page that arrived with a 200, which is the shape
    // of failure the site-page screenshot check was also written for.
    if (buf.length < 4_000) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * The credit line, as the approval card prints it. Never published.
 *
 * "Tilman2007 / CC BY-SA 4.0". Both halves are best-effort: some files name no
 * author and a few name no licence in the field this reads, and a half-known
 * credit is still worth carrying.
 */
export const creditFor = (meta) =>
  [meta?.author, meta?.license].filter(Boolean).join(' / ') || 'Wikimedia Commons';

/**
 * Photographs taken AT a place, found by its coordinates.
 *
 * WHY THIS EXISTS, and it is the most serious thing in this repo's history of image bugs.
 *
 * A deck slide names a specific building and shows a photograph of it. Until now that
 * photograph came from a stock library, chosen by a vision call asked "which of these is
 * the place". That question is unanswerable when the pool contains nothing of the place,
 * and the model does not answer "none" - it answers with the closest thing and writes a
 * plausible reason. Two shipped examples, both from one afternoon:
 *
 *   "מנזר מלק" - Melk Abbey, in Austria, over a night shot of ANKARA, with an Austrian
 *   flag beside the name.
 *
 *   "בית העירייה וכיכר הרטהאוס" - Vienna's town hall, over Republic Square in VALLETTA,
 *   with a Maltese flag flying in the photograph and an Austrian one printed on the slide.
 *
 * Nothing in the pipeline could catch either, because both photographs are genuinely
 * "a grand civic building at golden hour" and that is all the judge can see.
 *
 * GEOTAGS ANSWER THE QUESTION THE JUDGE CANNOT. A Commons file tagged within 300 metres
 * of Melk Abbey IS a photograph of Melk Abbey - not probably, not according to a model,
 * but as a matter of the metadata the uploader attached. Commons has a geosearch
 * generator, it needs no key, and for Melk it returns eight files of Stift Melk at up to
 * 9248px. The question stops being "does this look like the place" and becomes "was the
 * camera there", which has an answer.
 *
 * WHAT IT CANNOT DO. A place with no coordinates gets nothing here, and a place nobody
 * has photographed within the radius gets nothing either. Both fall through to the stock
 * ladder, which is the right order: a sourced photograph when one exists, a curated
 * guess when one does not, and no slide at all when neither works.
 */
export async function nearby(lat, lng, { radius = 300, limit = 12, width = 1440, minWidth = 1000, timeoutMs = 20_000 } = {}) {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return [];

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'geosearch',
    ggscoord: `${la}|${lo}`,
    // Metres. 300 is a building and its square; much more and a photograph of the
    // thing across the street qualifies, which is how this would become the bug it
    // replaces.
    ggsradius: String(Math.max(10, Math.min(1000, radius))),
    ggslimit: String(Math.max(1, Math.min(50, limit))),
    // Namespace 6 is File:. Without it the generator returns articles.
    ggsnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: String(width),
  });

  let body;
  try {
    const res = await fetch(`${API}?${params}`, {
      headers: {
        accept: 'application/json',
        'user-agent': process.env.PLACES_USER_AGENT || 'tiyul-plus/1.0 (own content)',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new CommonsError(`geosearch answered HTTP ${res.status}`, { step: 'geosearch' });
    body = await res.json();
  } catch (err) {
    if (err instanceof CommonsError) throw err;
    throw new CommonsError(`geosearch failed - ${err.message}`, { step: 'geosearch' });
  }

  const pages = body?.query?.pages || [];
  return pages
    .map((p) => {
      const info = p?.imageinfo?.[0];
      if (!info?.thumburl) return null;
      // The same quality bar fillFromSite uses: the frame is 1080 wide and upscaling a
      // small original is visibly soft.
      if (Number(info.width) < minWidth) return null;
      const meta = info.extmetadata || {};
      return {
        title: String(p.title || '').replace(/^File:/, ''),
        src: info.thumburl,
        width: Number(info.thumbwidth) || null,
        height: Number(info.thumbheight) || null,
        credit: creditFor({
          author: stripHtml(meta.Artist?.value),
          license: meta.LicenseShortName?.value || meta.License?.value,
        }),
        page: info.descriptionurl || null,
        // How this photograph was established to be of this place, carried so an
        // approval card can say so and a reviewer can check it.
        via: 'commons-geosearch',
      };
    })
    .filter(Boolean);
}

const stripHtml = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim() || null;

/**
 * A photograph per place, for the places the site gave one.
 *
 * MUTATES the place objects, exactly as fillImages does, so the caller's day
 * structure keeps pointing at the same stops. Returns what happened per place so
 * the ladder above it knows which ones still need a search.
 *
 * `minWidth` is the one quality bar. The site publishes 500px thumbnails and this
 * asks for 1440, but the render is 1080 wide and upscaling a small original is
 * visibly soft - on the pages checked every original was at least 1600 wide, so
 * this rejects the exception rather than the rule.
 */
export async function fillFromSite(places, { width = 1440, minWidth = 1000, timeoutMs = 20_000 } = {}) {
  const rows = (places || []).filter(Boolean);
  const titles = new Map();
  for (const p of rows) {
    const title = titleFromUrl(p?.photo || p?.sitePhoto || null);
    if (title) titles.set(p, title);
  }
  if (!titles.size) return { filled: 0, missing: rows.length, why: new Map() };

  const why = new Map();
  const meta = new Map();
  const list = [...new Set(titles.values())];
  for (let i = 0; i < list.length; i += TITLE_BATCH) {
    const batch = list.slice(i, i + TITLE_BATCH);
    // One failed batch must not lose the others. A Commons outage means the
    // ordinary search ladder runs for every place, which is slower and works.
    const got = await lookup(batch, { width, timeoutMs }).catch((e) => {
      console.error(`commons: lookup failed for ${batch.length} files - ${e.message}`);
      return new Map();
    });
    for (const [k, v] of got) meta.set(k, v);
  }

  let filled = 0;
  for (const [place, title] of titles) {
    const m = meta.get(title);
    if (!m) {
      why.set(place, `no Commons metadata for "${title}"`);
      continue;
    }
    if ((m.width || 0) < minWidth) {
      why.set(place, `original is only ${m.width}px wide`);
      continue;
    }
    const src = await download(m.thumbUrl, timeoutMs);
    if (!src) {
      why.set(place, 'thumbnail would not download');
      continue;
    }
    place.image = {
      src,
      // A fourth origin, declared in src/images.js so findImage's policy check
      // knows it. See the licence note at the top of this file for what it means.
      provenance: 'commons',
      credit: creditFor(m),
      // The metadata, kept whole beside the credit line, because the card prints
      // one string and a question about a photograph a month later needs the
      // parts. Nothing published reads any of this.
      commons: { title, author: m.author, license: m.license, pageUrl: m.pageUrl },
      sourceUrl: m.pageUrl,
      width: m.thumbWidth,
      height: m.thumbHeight,
    };
    filled++;
  }

  // The policy check, run here rather than trusted. findImage runs the same one
  // on everything that comes through it, and this route does not go through
  // findImage - so without this line a typo in the provenance tag would publish
  // an image the approval card describes as "לא ידוע".
  if (filled && !PROVENANCE.commons) {
    throw new CommonsError('the commons provenance is not declared in src/images.js', { step: 'policy' });
  }

  return { filled, missing: rows.length - filled, why };
}
