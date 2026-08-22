import { readFileSync } from 'node:fs';

// Same ~10-line loader BrickDeal uses, for the same reason — not worth a
// `dotenv` dependency. Reads the repo-root .env, which is gitignored.
export function loadEnv() {
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let value = m[2];
      if (!/^["']/.test(value)) value = value.replace(/\s+#.*$/, ''); // inline comment, but not inside quotes
      value = value.trim().replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  } catch {
    /* no .env file — env may be provided another way (systemd, pm2, CI) */
  }
}
