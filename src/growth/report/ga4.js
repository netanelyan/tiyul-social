import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { postForm, postJson } from '../../clients/http.js';

// Clicks per utm_campaign, from the GA4 Data API.
//
// A service account, not a person's login: the JSON key file's email is added
// as a Viewer on the GA4 property, and this signs a short JWT with its private
// key (node:crypto, no dependency) to get a read-only token.
//
// WHAT GA4 CAN SEE. The site's consent defaults to "denied", so a visitor who
// never answers the banner is not counted with a campaign. These numbers are
// consented visits only, and the page says so. SITE-SPEC.md item 3.1 is the fix
// at the source.

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** What is missing, as instructions. Empty when GA4 is configured. */
export function ga4Missing(env = process.env) {
  const out = [];
  if (!String(env.GA4_PROPERTY_ID || '').trim()) {
    out.push('GA4_PROPERTY_ID: מספר ה-property (ספרות בלבד, לא G-MR48GYKQ3R). ב-GA4: Admin, Property details.');
  }
  if (!String(env.GA4_SERVICE_ACCOUNT_FILE || env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) {
    out.push('GA4_SERVICE_ACCOUNT_FILE: נתיב לקובץ JSON של service account מ-Google Cloud (עם Google Analytics Data API מופעל).');
    out.push('ואת כתובת המייל של ה-service account מוסיפים ב-GA4 תחת Admin, Property access management, בהרשאת Viewer.');
  }
  return out;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** The signed assertion Google's token endpoint takes. */
export function jwtFor(account, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(account.private_key))}`;
}

let token = null;

async function accessToken(env) {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const file = String(env.GA4_SERVICE_ACCOUNT_FILE || env.GOOGLE_APPLICATION_CREDENTIALS).trim();
  const account = JSON.parse(readFileSync(file, 'utf8'));
  const res = await postForm(TOKEN_URL, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwtFor(account) });
  token = { value: res.access_token, until: Date.now() + (Number(res.expires_in) || 3600) * 1000 };
  return token.value;
}

let cache = null;

/**
 * Sessions per source and campaign: this week and the week before.
 *
 * Returns { configured: false, missing } without a key, never a throw, so the
 * Reports page can render the instructions in place of the table.
 */
export async function campaignClicks({ env = process.env, now = Date.now() } = {}) {
  const missing = ga4Missing(env);
  if (missing.length) return { configured: false, missing };
  if (cache && now - cache.at < 3_600_000) return cache.value;
  try {
    const t = await accessToken(env);
    const body = await postJson(
      `https://analyticsdata.googleapis.com/v1beta/properties/${String(env.GA4_PROPERTY_ID).trim()}:runReport`,
      {
        dateRanges: [
          { startDate: '6daysAgo', endDate: 'today', name: 'thisWeek' },
          { startDate: '13daysAgo', endDate: '7daysAgo', name: 'lastWeek' },
        ],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionCampaignName' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        dimensionFilter: { filter: { fieldName: 'sessionSource', inListFilter: { values: ['creator', 'agency', 'customer'] } } },
        limit: 500,
      },
      { headers: { authorization: `Bearer ${t}` } }
    );
    const rows = (body?.rows || []).map((r) => ({
      source: r.dimensionValues?.[0]?.value,
      campaign: r.dimensionValues?.[1]?.value,
      range: r.dimensionValues?.[2]?.value || 'thisWeek',
      sessions: Number(r.metricValues?.[0]?.value) || 0,
      users: Number(r.metricValues?.[1]?.value) || 0,
    }));
    const value = { configured: true, rows };
    cache = { at: now, value };
    return value;
  } catch (e) {
    return { configured: true, error: e.message, rows: [] };
  }
}
