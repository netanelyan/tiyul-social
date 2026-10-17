// Shekels, from a rate somebody published.
//
// THE RULE THIS FILE KEEPS. src/plan/site.js and src/hooks/gems.js both refuse to
// convert a price, because "nobody published a rate" and a rate this program made up
// would be an invented number on a slide. The owner's cover test (17 Oct 2026) wants
// "{dest} ב-X ₪ ליום", so the rate now comes from someone who does publish one: the
// European Central Bank's daily reference rates, which carry ILS and every currency
// the site's daily costs are in except a handful (GEL, AED, SCR, VND, MAD, ARS).
// Not the Bank of Israel: its list has no CZK, HUF, THB or PLN, and one source for
// every page is simpler to state on a slide than two.
//
// The ECB quotes everything against the euro, so a crown in shekels is the cross
// rate ILS/EUR divided by CZK/EUR. The date of the rates goes on the slide.

const URL_ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const KEEP_MS = 6 * 3_600_000;

let cached = null;

/** Parse the ECB's daily XML into { date, perEur: { USD: 1.12, ... } }. Exported for the tests. */
export function parseEcb(xml) {
  const s = String(xml || '');
  const date = s.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] || null;
  const perEur = { EUR: 1 };
  for (const m of s.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) perEur[m[1]] = Number(m[2]);
  return date && perEur.ILS ? { date, perEur } : null;
}

/** Today's rates, fetched at most every six hours. Null when the ECB cannot be reached. */
export async function ecbRates({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (cached && now - cached.at < KEEP_MS) return cached.rates;
  try {
    const res = await fetchImpl(URL_ECB, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rates = parseEcb(await res.text());
    if (!rates) throw new Error('no ILS rate in the file');
    cached = { at: now, rates };
    return rates;
  } catch (e) {
    console.error(`fx: the ECB rates could not be read - ${e.message}`);
    return cached?.rates || null;
  }
}

/** `amount` of `currency` in shekels, or null when the ECB does not quote it. */
export function toShekels(amount, currency, rates) {
  const per = rates?.perEur?.[String(currency || '').toUpperCase()];
  if (!Number.isFinite(Number(amount)) || !per || !rates.perEur.ILS) return null;
  return (Number(amount) / per) * rates.perEur.ILS;
}

/** "2026-10-16" as "16.10.2026". */
export const dateHe = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : null;
};

export const __resetFx = () => {
  cached = null;
};
