import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// data/trends.json: the format cards the watcher found, the formats in play, and
// their results. Written whole and atomically, by the bot's process only (the
// watcher runs inside the bot), so it has one writer like every store here.
//
// It holds no source text and no images: a card keeps the source's link and its
// numbers, for the report, and the format's abstract shape. See extract.js.

export const DEFAULT_PATH = fileURLToPath(new URL('../../data/trends.json', import.meta.url));

export const emptyTrends = () => ({ v: 1, cards: {}, formats: {}, runs: [], spend: {}, credited: {}, seen: {} });

export function openTrends(path = process.env.TRENDS_STORE_PATH || DEFAULT_PATH) {
  let data = emptyTrends();
  if (existsSync(path)) {
    try {
      data = { ...emptyTrends(), ...JSON.parse(readFileSync(path, 'utf8')) };
    } catch (e) {
      throw new Error(`${path} could not be read (${e.message})`);
    }
  }
  const save = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 1));
    renameSync(`${path}.tmp`, path);
  };
  return { data, save, path };
}
