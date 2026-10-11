import { readFileSync } from 'node:fs';
import { loadEnv } from '../src/env.js';

loadEnv();

// The route check over every agency on the desk, as a report. READ-ONLY.
//
//   GROWTH_STORE_PATH=/var/lib/tiyul-growth/growth.json node scripts/growth-route-check.js [--read-sites]
//
// For each agency: its sample route (the one it has, or the one the desk would
// build for it today) and the route check's verdict, the same one the card shows
// (src/growth/prepare/routeCheck.js). It reads the desk's store and never writes
// it: the desk holds the store in memory and saves over it, so a report that
// saved would be lost or would lose the desk's own writes.
//
// --read-sites reads the website of an agency the desk has not read yet, so its
// example can be chosen the way the desk will choose it. That is one Claude call
// each (the desk's extract model), counted in the totals below and NOT in the
// desk's ledger, and the desk reads the site again when it picks the agency.
// Without it, an unread agency is reported as such.

const { mergeSettings } = await import('../src/growth/config.js');
const { chooseExample, extractProfile, readAgencySite } = await import('../src/growth/prepare/agencyProfile.js');
const { agencySample } = await import('../src/growth/prepare/index.js');
const { buildRoute } = await import('../src/growth/prepare/route.js');
const { checkRoute } = await import('../src/growth/prepare/routeCheck.js');
const { cityFor } = await import('../src/growth/prepare/site.js');
const { monthSpend } = await import('../src/clients/budget.js');

const path = process.env.GROWTH_STORE_PATH;
if (!path) throw new Error('GROWTH_STORE_PATH is the desk store to read');
const state = JSON.parse(readFileSync(path, 'utf8'));
const settings = mergeSettings(state.settings || {});
const readSites = process.argv.includes('--read-sites');
const before = monthSpend(state, settings).gross;

const cities = new Map();
const city = async (slug) => {
  if (!cities.has(slug)) cities.set(slug, await cityFor(slug).catch(() => null));
  return cities.get(slug);
};

const rows = [];
for (const lead of Object.values(state.leads).filter((l) => l.type === 'agency').sort((a, b) => (b.score || 0) - (a.score || 0))) {
  const row = { name: lead.name, state: lead.closed ? `closed (${lead.closed})` : lead.messagedAt ? 'messaged' : 'waiting' };
  try {
    if (!lead.profile && readSites) {
      const site = await readAgencySite(lead).catch(() => ({ text: '' }));
      lead.profile = await extractProfile({ state, settings, lead, siteText: site.text });
      row.readNow = true;
    }
    if (!lead.profile && !lead.example) {
      row.verdict = 'not read yet';
      rows.push(row);
      continue;
    }
    const ex = lead.example || chooseExample(state, lead, { fallback: agencySample });
    if (!ex) {
      row.verdict = 'no example';
      rows.push(row);
      continue;
    }
    const c = await city(ex.slug);
    const route = ex.kind === 'route' ? lead.route || (c && buildRoute(c, {})) : c && buildRoute(c, { days: Number(/\/(\d+)$/.exec(ex.path || '')?.[1]) || null });
    row.example = `${ex.kind} ${ex.slug}${route ? ` (${route.days.map((d) => d.placeIds.length).join('/')})` : ''}`;
    if (!route || !c) {
      row.verdict = 'no route: the site has no itinerary for it';
      rows.push(row);
      continue;
    }
    const check = await checkRoute(route, c, { state, settings });
    row.verdict = check.status;
    row.issues = check.issues || [check.error];
  } catch (e) {
    row.verdict = 'error';
    row.issues = [e.message];
  }
  rows.push(row);
}

for (const r of rows) {
  console.log(`\n${r.verdict.toUpperCase()} · ${r.name} · ${r.state}${r.readNow ? ' · site read now' : ''}${r.example ? ` · ${r.example}` : ''}`);
  for (const i of r.issues || []) console.log(`   - ${i}`);
}
const checked = rows.filter((r) => ['pass', 'fail'].includes(r.verdict));
console.log(`\n${checked.filter((r) => r.verdict === 'pass').length} of ${checked.length} checked routes pass; ${rows.length} agencies in all.`);
console.log(`Spent by this report (not in the desk's ledger): $${(monthSpend(state, settings).gross - before).toFixed(3)} list price.`);
