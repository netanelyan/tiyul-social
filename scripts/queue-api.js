import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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
//   GET  /kit.tgz  the video kit: the desktop's demos/anim (kit-base.tgz,
//                  uploaded by demos/publish-kit.sh) with every patch since
//   POST /video    multipart: video (mp4), meta (the json make.mjs writes),
//                  script (the video's .mjs), and optionally kit: a .tgz of
//                  the anim/ files the run added or changed (a new 3D set, a
//                  fix), so the next nights have them. Queued after what is
//                  waiting.
//
// KIT PATCHES. A run's kit patch is kept in data/video-kit/patches/ and the
// served kit is rebuilt as the base plus every patch in order. The desktop's
// publish-kit.sh pulls the patches into demos/anim first, uploads the result
// as the new base, and moves the patches it folded in to patches/applied/.
//
// Every request needs `Authorization: Bearer $QUEUE_UPLOAD_TOKEN`. Listens on
// 127.0.0.1 only; Caddy forwards cards.tiyulplus.com/queue-api/* here.

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const QUEUE_DIR = path.join(ROOT, 'data', 'video-queue');
const KIT_DIR = path.join(ROOT, 'data', 'video-kit');
const KIT = path.join(KIT_DIR, 'kit.tgz');
const KIT_BASE = path.join(KIT_DIR, 'kit-base.tgz');
const PATCHES = path.join(KIT_DIR, 'patches');
const MAX_VIDEO = 120 * 1024 * 1024;
const MAX_PATCH = 30 * 1024 * 1024;

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

/** Keep a run's kit patch and rebuild the served kit from the base and every patch. */
function applyKitPatch(buf, id) {
  if (buf.length > MAX_PATCH) throw new Error(`kit patch is ${buf.length} bytes, over ${MAX_PATCH}`);
  mkdirSync(PATCHES, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${id}.tgz`;
  const tmpPatch = path.join(PATCHES, `.${name}`);
  writeFileSync(tmpPatch, buf);
  const entries = execFileSync('tar', ['-tzf', tmpPatch], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const bad = entries.filter((e) => !e.startsWith('anim/') || e.split('/').includes('..') || /node_modules|\.venv|\/frames\//.test(e));
  if (!entries.length || bad.length) {
    rmSync(tmpPatch, { force: true });
    throw new Error(bad.length ? `kit patch has paths outside anim/: ${bad.slice(0, 3).join(', ')}` : 'kit patch is empty');
  }
  renameSync(tmpPatch, path.join(PATCHES, name));
  // The first patch makes the kit uploaded so far the base.
  if (!existsSync(KIT_BASE)) copyFileSync(KIT, KIT_BASE);
  const work = mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  try {
    execFileSync('tar', ['-xzf', KIT_BASE, '-C', work]);
    for (const p of readdirSync(PATCHES).filter((n) => n.endsWith('.tgz')).sort()) execFileSync('tar', ['-xzf', path.join(PATCHES, p), '-C', work]);
    execFileSync('tar', ['-czf', `${KIT}.new`, '-C', work, 'anim']);
    renameSync(`${KIT}.new`, KIT);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return entries.filter((e) => !e.endsWith('/'));
}

function status() {
  const queued = readInbox().entries.filter((e) => e.entry.cand?.clip?.format === 'queue').map((e) => e.entry.cand.id.replace(/^queue-/, ''));
  const patches = existsSync(PATCHES) ? readdirSync(PATCHES).filter((n) => n.endsWith('.tgz')) : [];
  return { queued, made: madeIds(), kitPatches: patches };
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
  const out = { queued: meta.id, waiting: status().queued.length };
  // The video is queued either way; a kit patch that cannot be used is reported back.
  const kit = form.get('kit');
  if (kit && kit.size) {
    try {
      out.kitFiles = applyKitPatch(Buffer.from(await kit.arrayBuffer()), meta.id);
    } catch (e) {
      out.kitError = e.message;
    }
  }
  return out;
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
