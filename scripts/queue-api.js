import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/env.js';
import { addToInbox, entryProblem, readInbox } from '../src/slate/inbox.js';
import { queueEntry } from './queue-videos.js';

// The door the nightly video run comes in through.
//
// The explainers are made by a scheduled Claude run in the cloud (demos/anim/
// PIPELINE.md on the desktop): it downloads the video kit from here, makes one
// fact-checked ~40s video, and uploads it here to be queued. The owner decided
// on 27 Nov 2026 that these post without their approval; the digest's skip
// button is still the stop.
//
//   GET  /status   what is queued and every video ever made (by id)
//   GET  /kit.tgz  the video kit (demos/ from the desktop, uploaded by scp)
//   POST /video    multipart: video (mp4), meta (the json make.mjs writes),
//                  script (the video's .mjs). Queued after what is waiting.
//
// Every request needs `Authorization: Bearer $QUEUE_UPLOAD_TOKEN`. Listens on
// 127.0.0.1 only; Caddy forwards cards.tiyulplus.com/queue-api/* here.

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const QUEUE_DIR = path.join(ROOT, 'data', 'video-queue');
const KIT = path.join(ROOT, 'data', 'video-kit', 'kit.tgz');
const MAX_VIDEO = 120 * 1024 * 1024;

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

function authorized(req) {
  const want = Buffer.from(process.env.QUEUE_UPLOAD_TOKEN || '');
  const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  return want.length >= 32 && got.length === want.length && timingSafeEqual(got, want);
}

/** Every video id that was ever queued from a folder in data/video-queue. */
function madeIds() {
  if (!existsSync(QUEUE_DIR)) return [];
  const ids = new Set();
  for (const dir of readdirSync(QUEUE_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const n of readdirSync(path.join(QUEUE_DIR, dir.name))) if (n.endsWith('.json')) ids.add(n.slice(0, -5));
  }
  return [...ids].sort();
}

function status() {
  const queued = readInbox().entries.filter((e) => e.entry.cand?.clip?.format === 'queue').map((e) => e.entry.cand.id.replace(/^queue-/, ''));
  return { queued, made: madeIds() };
}

async function upload(req) {
  const form = await new Request('http://local/', { method: 'POST', headers: req.headers, body: req, duplex: 'half' }).formData();
  const video = form.get('video');
  const meta = JSON.parse(await form.get('meta').text());
  const script = form.get('script');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(meta.id || '')) throw new Error('meta.id must be a-z, 0-9 and dashes');
  for (const field of ['headline', 'caption', 'seconds']) if (!meta[field]) throw new Error(`meta has no ${field}`);
  if (meta.seconds < 20 || meta.seconds > 75) throw new Error(`a ${meta.seconds}s video is outside 20-75s`);
  if (!video || video.size < 100_000 || video.size > MAX_VIDEO) throw new Error('video missing or the wrong size');
  if (status().made.includes(meta.id)) throw new Error(`${meta.id} was already made`);

  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(QUEUE_DIR, `auto-${date}-${meta.id}`);
  mkdirSync(dir, { recursive: true });
  const src = path.join(dir, `${meta.id}.mp4`);
  writeFileSync(src, Buffer.from(await video.arrayBuffer()));
  writeFileSync(path.join(dir, `${meta.id}.json`), JSON.stringify(meta, null, 2));
  if (script) writeFileSync(path.join(dir, `${meta.id}.mjs`), Buffer.from(await script.arrayBuffer()));

  const outDir = process.env.CARD_OUTPUT_DIR;
  const base = String(process.env.CARD_PUBLIC_BASE_URLS || process.env.CARD_PUBLIC_BASE_URL || '').split(',')[0].trim().replace(/\/+$/, '');
  const name = `queue-${meta.id}.mp4`;
  const entry = queueEntry(meta, { file: path.join(outDir, name), url: `${base}/${encodeURIComponent(name)}`, addedAt: new Date().toISOString() });
  const problem = entryProblem(entry);
  if (problem) throw new Error(problem);
  copyFileSync(src, entry.cand.clip.file);
  addToInbox(entry);
  return { queued: meta.id, waiting: status().queued.length };
}

function main() {
  loadEnv();
  if ((process.env.QUEUE_UPLOAD_TOKEN || '').length < 32) throw new Error('QUEUE_UPLOAD_TOKEN (32+ chars) is not set');
  if (!process.env.CARD_OUTPUT_DIR) throw new Error('CARD_OUTPUT_DIR is not set');
  const port = Number(process.env.QUEUE_API_PORT || 4610);
  createServer(async (req, res) => {
    const route = `${req.method} ${new URL(req.url, 'http://local').pathname.replace(/^\/queue-api/, '')}`;
    try {
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
      if (route === 'GET /status') return send(res, 200, status());
      if (route === 'GET /kit.tgz') {
        if (!existsSync(KIT)) return send(res, 404, { error: 'no kit uploaded yet' });
        res.writeHead(200, { 'content-type': 'application/gzip' });
        return res.end(readFileSync(KIT));
      }
      if (route === 'POST /video') {
        const out = await upload(req);
        console.log(`queue-api: queued ${out.queued} (${out.waiting} waiting)`);
        return send(res, 200, out);
      }
      return send(res, 404, { error: `no route ${route}` });
    } catch (e) {
      console.error(`queue-api: ${route}: ${e.message}`);
      return send(res, 400, { error: e.message });
    }
  }).listen(port, '127.0.0.1', () => console.log(`queue-api: listening on 127.0.0.1:${port}`));
}

main();
