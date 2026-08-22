import { loadEnv } from '../src/env.js';
loadEnv();

import path from 'node:path';
import { renderCard, closeBrowser } from '../src/render/index.js';
import { LAYOUTS, isPhotoLayout } from '../src/render/templates.js';
import { sampleImage } from './sample-image.js';

// Renders one sample of every layout into ./samples so the output can actually
// be looked at. This exists because "the Hebrew is correct" is not something
// you can establish by reading the HTML - the bidi algorithm, the font's
// shaping, and the line breaking all happen at render time. Look at the JPEGs.
//
// The photo layouts are rendered against a procedurally generated placeholder
// (scripts/sample-image.js) rather than a real photograph. Without one they
// degrade to the fact card, which is correct behaviour but means the whole
// photo family would be invisible here.

const OUT = path.join(process.cwd(), 'samples');

const common = { pillar: 'place', place: 'ליסבון', country: 'פורטוגל', bullets: [] };

const samples = {
  photoFull: {
    ...common,
    layout: 'photoFull',
    headline: 'הרובע שכל ליסבון מגיעה אליו רק בסופי שבוע',
    subhead: 'עשר דקות הליכה מהמרכז.',
    url: 'https://whc.unesco.org/en/news/example',
    scene: 'coast',
  },
  photoBand: {
    ...common,
    layout: 'photoBand',
    pillar: 'hidden',
    place: 'פיורדלנד',
    country: 'ניו זילנד',
    headline: 'העמק שנפתח למבקרים רק 60 יום בשנה',
    subhead: 'שאר השנה הדרך סגורה בגלל מפולות.',
    url: 'https://www.govt.nz/example',
    scene: 'mountains',
  },
  photoFrame: {
    ...common,
    layout: 'photoFrame',
    pillar: 'fact',
    place: 'קיוטו',
    country: 'יפן',
    headline: 'הגשר שנבנה מחדש כל 20 שנה - בכוונה',
    subhead: 'המסורת שומרת על הידע של הבנייה, לא על העץ עצמו.',
    url: 'https://www.jnto.go.jp/news/example',
    scene: 'city',
  },
  fact: {
    ...common,
    layout: 'fact',
    pillar: 'fact',
    place: 'סלינה',
    country: 'קרואטיה',
    headline: 'האגם היחיד באירופה שמשנה צבע פעמיים בשנה',
    subhead: 'הסיד מההרים מגיב לטמפרטורה.',
    url: 'https://whc.unesco.org/en/news/example',
  },
  numbers: {
    ...common,
    layout: 'numbers',
    pillar: 'fact',
    place: 'האיים הקנריים',
    country: 'ספרד',
    headline: 'זה הר הגעש הגבוה ביותר על אדמת ספרד',
    subhead: '',
    stat: { value: '3,715', unit: 'מטר', label: 'גובה הפסגה של הטיידה מעל פני הים' },
    url: 'https://whc.unesco.org/en/news/example',
  },
  compare: {
    ...common,
    layout: 'compare',
    pillar: 'tip',
    place: 'איסלנד',
    country: '',
    headline: 'הזוהר הצפוני לא עובד ככה',
    subhead: '',
    compare: {
      aTitle: 'מה שחושבים',
      aText: 'צריך להגיע בדצמבר, בשיא החורף, כדי לראות זוהר צפוני.',
      bTitle: 'מה שקורה בפועל',
      bText: 'ספטמבר ומרץ נותנים את אותן שעות חשיכה עם מזג אוויר נוח יותר וסיכוי גבוה יותר לשמיים בהירים.',
    },
    url: 'https://www.govt.nz/example',
  },
  tips: {
    ...common,
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
    ...common,
    layout: 'whenToGo',
    pillar: 'timing',
    place: 'אתונה',
    country: 'יוון',
    headline: 'מתי באמת כדאי לטוס לאתונה',
    subhead: 'אפריל ואוקטובר הם החלון הנוח באמת.',
    url: 'https://archive-api.open-meteo.com/v1/archive?latitude=37.98',
  },
  alert: {
    ...common,
    layout: 'alert',
    pillar: 'entry',
    place: 'האיחוד האירופי',
    country: '',
    headline: 'הרישום הביומטרי בגבולות שנגן נכנס לתוקף בהדרגה',
    subhead: 'בכניסה הראשונה: טביעות אצבע ותצלום פנים.',
    url: 'https://www.gov.uk/foreign-travel-advice/example',
  },
  route: {
    ...common,
    layout: 'route',
    pillar: 'route',
    place: 'גאורגיה',
    country: '',
    headline: 'קו ישיר חדש לבירת גאורגיה, ארבע פעמים בשבוע',
    subhead: 'הטיסה נוחתת לפנות בוקר, כך שיום ההגעה נשאר שלם.',
    route: { from: 'תל אביב', to: 'טביליסי', operator: 'ג׳ורג׳יאן איירווייז', startsOn: '3 בנובמבר' },
    url: 'https://www.gov.uk/foreign-travel-advice/example',
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
    if (!draft) {
      console.log(`${layout.padEnd(11)} -> no sample defined`);
      continue;
    }
    const r = await renderCard(draft, {
      id: `sample-${layout}`,
      data: layout === 'whenToGo' ? climateData : null,
      image: isPhotoLayout(layout) ? sampleImage(draft.scene) : null,
      outDir: OUT,
    });
    console.log(`${layout.padEnd(11)} -> ${path.basename(r.file)} (${(r.bytes / 1024).toFixed(0)} KB)`);
  }
  console.log(`\n${LAYOUTS.length} layouts written to ${OUT} - look at the JPEGs, not the HTML.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeBrowser);
