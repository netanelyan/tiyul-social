import { loadEnv } from '../src/env.js';
loadEnv();

import path from 'node:path';
import { renderCard, closeBrowser } from '../src/render/index.js';
import { LAYOUTS } from '../src/render/templates.js';

// Renders one sample of every layout into ./samples so the output can actually
// be looked at. This exists because "the Hebrew is correct" is not something
// you can establish by reading the HTML — the bidi algorithm, the font's
// shaping, and the line breaking all happen at render time. Look at the JPEGs.

const OUT = path.join(process.cwd(), 'samples');

const samples = {
  fact: {
    layout: 'fact',
    pillar: 'fact',
    place: 'סלינה',
    country: 'קרואטיה',
    headline: 'האגם היחיד באירופה שמשנה צבע פעמיים בשנה',
    subhead: 'הסיד שנשטף מההרים מגיב לטמפרטורה — ובאפריל ובאוקטובר המים עוברים מטורקיז לירוק כהה.',
    url: 'https://whc.unesco.org/en/news/example',
    bullets: [],
  },
  tips: {
    layout: 'tips',
    pillar: 'tip',
    place: 'טוקיו',
    country: 'יפן',
    headline: 'שלושה דברים שכדאי לסדר לפני שנוחתים ביפן',
    subhead: '',
    url: 'https://www.jnto.go.jp/news/example',
    bullets: [
      { title: 'כרטיס Suica', text: 'אפשר להנפיק דיגיטלית בארנק של הטלפון עוד לפני הטיסה.' },
      { title: 'אינטרנט', text: 'eSIM יוצא זול יותר מהשכרת ראוטר, ומגיע מופעל.' },
      { title: 'מזומן', text: 'הרבה מסעדות קטנות עדיין לא מקבלות כרטיסים בכלל.' },
    ],
  },
  whenToGo: {
    layout: 'whenToGo',
    pillar: 'timing',
    place: 'אתונה',
    country: 'יוון',
    headline: 'מתי באמת כדאי לטוס לאתונה',
    subhead: 'ממוצע רב-שנתי של טמפרטורות ומשקעים — אפריל ואוקטובר הם החלון הנוח באמת.',
    url: 'https://archive-api.open-meteo.com/v1/archive?latitude=37.98',
    bullets: [],
  },
  alert: {
    layout: 'alert',
    pillar: 'entry',
    place: 'האיחוד האירופי',
    country: '',
    headline: 'הרישום הביומטרי בגבולות שנגן נכנס לתוקף בהדרגה',
    subhead: 'בכניסה הראשונה תידרשו לטביעות אצבע ולתצלום פנים. כדאי להגיע לשדה מוקדם יותר מהרגיל.',
    url: 'https://www.gov.uk/foreign-travel-advice/example',
    bullets: [],
  },
  photo: {
    layout: 'photo',
    pillar: 'place',
    place: 'ליסבון',
    country: 'פורטוגל',
    headline: 'הרובע שכל ליסבון מגיעה אליו רק בסופי שבוע',
    subhead: 'בין השוק לנמל, ובעשר דקות הליכה מהמרכז.',
    url: 'https://example.gov/lisbon',
    bullets: [],
  },
};

// Same shape src/sources/climate.js emits, so the strip is exercised for real.
const climateData = {
  kind: 'climate',
  months: [
    { month: 0, meanMax: 13.5, wetDays: 12, verdict: 'avoid' },
    { month: 1, meanMax: 14.2, wetDays: 10, verdict: 'shoulder' },
    { month: 2, meanMax: 17.1, wetDays: 8, verdict: 'good' },
    { month: 3, meanMax: 21.0, wetDays: 7, verdict: 'good' },
    { month: 4, meanMax: 26.4, wetDays: 5, verdict: 'good' },
    { month: 5, meanMax: 31.5, wetDays: 3, verdict: 'shoulder' },
    { month: 6, meanMax: 34.6, wetDays: 1, verdict: 'avoid' },
    { month: 7, meanMax: 34.2, wetDays: 1, verdict: 'avoid' },
    { month: 8, meanMax: 29.6, wetDays: 3, verdict: 'good' },
    { month: 9, meanMax: 24.3, wetDays: 6, verdict: 'good' },
    { month: 10, meanMax: 19.0, wetDays: 9, verdict: 'good' },
    { month: 11, meanMax: 15.0, wetDays: 12, verdict: 'avoid' },
  ],
};

async function main() {
  for (const layout of LAYOUTS) {
    const draft = samples[layout];
    const r = await renderCard(draft, {
      id: `sample-${layout}`,
      data: layout === 'whenToGo' ? climateData : null,
      outDir: OUT,
    });
    console.log(`${layout.padEnd(10)} -> ${r.file} (${(r.bytes / 1024).toFixed(0)} KB)`);
  }
  console.log(`\nLook at the JPEGs in ${OUT} — not the HTML.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeBrowser);
