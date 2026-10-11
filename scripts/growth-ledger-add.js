import { loadEnv } from '../src/env.js';

loadEnv();

// One run by hand, booked into the desk's ledger after the fact.
//
//   GROWTH_STORE_PATH=/var/lib/tiyul-growth/growth.json node scripts/growth-ledger-add.js \
//     --source "route report" --at 2026-10-11T16:47:12Z --note "..." places=110 claude=0.396
//
// For an API priced per call (places, brave) the number is calls, priced as the
// ledger prices them; for claude it is dollars. Drops one file in the ledger
// inbox next to the store, which the desk folds in on its next tick
// (src/growth/ledgerInbox.js). Writes nothing else.

const { API_PRICES, monthKey } = await import('../src/clients/budget.js');
const { dropSpend, inboxDir } = await import('../src/growth/ledgerInbox.js');

const path = process.env.GROWTH_STORE_PATH;
if (!path) throw new Error('GROWTH_STORE_PATH is the desk store whose ledger this goes into');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const source = flag('source');
const at = flag('at') || new Date().toISOString();
if (!source || !Date.parse(at)) throw new Error('--source and a valid --at are needed');

const month = monthKey(Date.parse(at));
const spend = { [month]: {} };
for (const a of args.filter((x) => /^[a-z0-9]+=[0-9.]+$/.test(x))) {
  const [api, n] = a.split('=');
  if (!API_PRICES[api]) throw new Error(`Unknown API "${api}" (${Object.keys(API_PRICES).join(', ')})`);
  const value = Number(n);
  spend[month][api] = API_PRICES[api].usdPerUnit ? { units: value, usd: value * API_PRICES[api].usdPerUnit } : { units: 0, usd: value };
}
if (!Object.keys(spend[month]).length) throw new Error('Nothing to book: give api=amount, e.g. places=110 claude=0.396');
console.log(dropSpend(inboxDir(path), { source, at, spend, note: flag('note') || '' }));
