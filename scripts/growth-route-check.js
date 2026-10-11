import { readFileSync } from 'node:fs';
import { loadEnv } from '../src/env.js';

loadEnv();

// The route check over every agency on the desk, as a report.
//
//   GROWTH_STORE_PATH=/var/lib/tiyul-growth/growth.json node scripts/growth-route-check.js [--read-sites]
//
// For each agency: the sample route the desk would send it today, built and
// checked exactly as the desk does it (src/growth/prepare/sampleRoute.js: the
// site's itinerary, repaired, checked on Google, rebuilt around any stop Google
// says is closed), with its days and the check's verdict.
//
// It never writes the desk's store: the desk holds it in memory and saves over
// it. What it spends (Google Places, and with --read-sites one Claude call per
// agency site the desk has not read) goes into the desk's ledger anyway, the
// owner's rule of 2026-10-11: it drops a file in the ledger inbox next to the
// store, and the desk folds it in on its next tick (src/growth/ledgerInbox.js),
// with the Google answers it paid for, so the desk does not ask for them again.
// Spend still waiting in that inbox counts toward the monthly cap here too.

const { mergeSettings } = await import('../src/growth/config.js');
const { chooseExample, extractProfile, readAgencySite } = await import('../src/growth/prepare/agencyProfile.js');
const { agencySample } = await import('../src/growth/prepare/index.js');
const { BUILDER } = await import('../src/growth/prepare/route.js');
const { readyRoute } = await import('../src/growth/prepare/sampleRoute.js');
const { cityFor } = await import('../src/growth/prepare/site.js');
const { monthSpend } = await import('../src/clients/budget.js');
const { dropSpend, foldInbox, inboxDir, spendDelta } = await import('../src/growth/ledgerInbox.js');

const path = process.env.GROWTH_STORE_PATH;
if (!path) throw new Error('GROWTH_STORE_PATH is the desk store to read');
const state = JSON.parse(readFileSync(path, 'utf8'));
const settings = mergeSettings(state.settings || {});
const readSites = process.argv.includes('--read-sites');
const inbox = inboxDir(path);
foldInbox(state, inbox, { move: false });
const before = structuredClone(state.spend || {});
const cacheBefore = new Map(Object.entries(state.placeChecks || {}).map(([id, hit]) => [id, hit.at]));
const startGross = monthSpend(state, settings).gross;

const cities = new Map();
const city = async (slug) => {
  if (!cities.has(slug)) cities.set(slug, await cityFor(slug).catch(() => null));
  return cities.get(slug);
};

const rows = [];
try {
  for (const lead of Object.values(state.leads).filter((l) => l.type === 'agency').sort((a, b) => (b.score || 0) - (a.score || 0))) {
    const row = { name: lead.name, state: lead.closed ? `closed (${lead.closed})` : lead.messagedAt ? 'messaged' : 'waiting' };
    rows.push(row);
    try {
      if (!lead.profile && readSites) {
        const site = await readAgencySite(lead).catch(() => ({ text: '' }));
        lead.profile = await extractProfile({ state, settings, lead, siteText: site.text });
        row.readNow = true;
      }
      if (!lead.profile && !lead.example) {
        row.verdict = 'not read yet';
        continue;
      }
      // What the desk does: a page example of an agency not yet messaged is chosen again, as a route.
      const ex = lead.example?.kind === 'page' && !lead.messagedAt ? chooseExample(state, lead, { fallback: agencySample }) : lead.example || chooseExample(state, lead, { fallback: agencySample });
      if (!ex) {
        row.verdict = 'no example';
        continue;
      }
      const c = await city(ex.slug);
      if (!c || ex.kind !== 'route') {
        row.verdict = c ? `a site page (${ex.path}), sent already: it stays as it is` : 'the site has no such destination';
        continue;
      }
      // A sent route the desk would re-send: rebuilt from scratch, as refreshSent does.
      const old = lead.route?.builder === BUILDER ? lead.route : null;
      const { route, check } = await readyRoute(c, { state, settings, now: Date.now(), route: old, check: old ? lead.routeCheck : null });
      row.example = `${ex.slug}${ex.fallback ? ' (fallback)' : ''}`;
      row.route = route;
      row.verdict = check?.status || 'no route';
      row.issues = check?.issues?.length ? check.issues : check?.error ? [check.error] : [];
    } catch (e) {
      row.verdict = 'error';
      row.issues = [e.message];
      if (e.code === 'budget') break;
    }
  }
} finally {
  // Whatever was spent, even by a run that failed halfway, goes into the desk's ledger.
  const spend = spendDelta(before, state.spend || {});
  if (Object.keys(spend).length) {
    const paid = Object.fromEntries(Object.entries(state.placeChecks || {}).filter(([id, hit]) => cacheBefore.get(id) !== hit.at));
    const file = dropSpend(inbox, { source: 'scripts/growth-route-check.js', spend, placeChecks: paid, note: readSites ? 'with --read-sites' : '' });
    console.log(`Spend dropped for the desk's ledger: ${file} (the desk folds it in within 15 minutes).`);
  }
}

for (const r of rows) {
  console.log(`\n${String(r.verdict).toUpperCase()} · ${r.name} · ${r.state}${r.readNow ? ' · site read now' : ''}${r.example ? ` · ${r.example}` : ''}`);
  (r.route?.days || []).forEach((d, i) => console.log(`   day ${i + 1}${d.dayTrip ? ' (day trip)' : ''}: ${d.names.join(', ')}`));
  for (const i of r.issues || []) console.log(`   - ${i}`);
}
const checked = rows.filter((r) => ['pass', 'fail'].includes(r.verdict));
console.log(`\n${checked.filter((r) => r.verdict === 'pass').length} of ${checked.length} checked routes pass; ${rows.length} agencies in all.`);
console.log(`Spent by this report: $${(monthSpend(state, settings).gross - startGross).toFixed(3)} list price, into the desk's ledger.`);
