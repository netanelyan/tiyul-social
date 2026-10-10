import { stripDashes } from '../../dashes.js';
import { askJson } from '../claude.js';
import { checkDraft } from './guards.js';

// The three things a model writes for the desk, and nothing else:
//
//   two comment suggestions for a creator's video (the warm-up)
//   the one personal line inside a creator DM, plus the first name to greet
//   a reply comment for a customer's planning question
//
// Each call sees only the post's own text and our site's data for that
// destination. Each answer is checked by guards.js; a failed check is sent back
// once with the reasons, and a second failure is reported on the card rather
// than shown as if it were fine.
//
// The prompts are in Hebrew because the output is, and they say "spoken": the
// difference between a comment a person would leave and one a brand would is
// mostly register.

export class DraftError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.problems = problems;
  }
}

const genderNote = (g) =>
  g === 'm' ? 'כותב הפוסט הוא גבר: פנייה בלשון זכר.' : g === 'f' ? 'כותבת הפוסט היא אישה: פנייה בלשון נקבה.' : 'לא ידוע אם זה גבר או אישה: נסח בלי פנייה מגדרית (למשל ברבים, או בלי פנייה ישירה).';

const postBlock = (lead, post) =>
  [`פלטפורמה: ${post.platform}`, `שם: ${lead.name || lead.handle || ''}`, `טקסט הפוסט:`, post.title || post.text || '(אין טקסט)'].join('\n');

const COMMENT_SYSTEM = `את/ה כותב/ת תגובות קצרות בטיקטוק ובאינסטגרם, מהחשבון @tiyulplus: חשבון של אתר ישראלי לתכנון טיולים. התגובה צריכה להיות כזו שאדם אמיתי היה משאיר, ושעוזרת באמת.
אם בפוסט יש שאלה, עונים עליה. אם אין, מוסיפים דבר אחד ספציפי וחדש שקשור למה שמופיע בפוסט, מתוך המידע על היעד שמצורף: מקום בסביבה, סדר טוב לביקור, עונה, התניידות.

כללים:
- עברית מדוברת וטבעית, תקינה, כמו בתגובות. משפט או שניים. בלי שפה של פרסומת.
- כל עובדה חייבת להופיע בטקסט הפוסט או במידע על היעד שמצורף. אם אין במידע תשובה, כותבים משהו שלא דורש עובדה חדשה.
- החשבון הוא של אתר, לא של אדם: אסור לטעון לחוויה אישית ("הייתי שם", "אני מכיר", "ביקרנו", "טסתי").
- לא חוזרים על הטיפ שכבר כתוב בפוסט ולא מסכמים אותו. מוסיפים משהו שאין בו.
- לא ממליצים על יעד אחר מזה שבפוסט.
- בלי מספרים שלא מופיעים במקור. בלי מחירים.
- בלי מחמאות כלליות ("איזה סרטון מדהים"). אם מחמיאים, רק על משהו שמופיע בטקסט.
- בלי קישורים, בלי לכתוב "האתר", "לינק", "בביו", בלי להזכיר את טיול+, בלי האשטגים ובלי תיוגים.
- לכל היותר אימוג'י אחד.
- בלי קו מפריד ארוך. רק פסיקים, נקודות ומקף רגיל.
- שתי הצעות שונות זו מזו בתוכן, לא רק בניסוח.`;

const LINE_SYSTEM = `את/ה עוזר/ת לכתוב הודעה אישית קצרה ליוצר/ת תוכן טיולים. ההודעה עצמה כתובה מראש. חסר בה רק חלק אחד:
"ראיתי את הפוסט שלך על [יעד], ___ 🙌"
כותבים את מה שבא במקום ___: חצי משפט אחד, אישי וספציפי, על משהו שמופיע בטקסט הפוסט עצמו.

כללים:
- רק ממה שכתוב בפוסט. לא ממציאים מה רואים בסרטון, לא מחמיאים על דברים שלא מופיעים בטקסט.
- ההודעה חתומה על ידי נתנאל (גבר). החצי משפט הוא על הפוסט, לא על הכותב: בלי "אני עוקב", "אני מחכה", "אני תמיד". אם יש פועל בגוף ראשון, בלשון זכר.
- עברית מדוברת, חם אבל לא מתלהב מדי. בלי סימן קריאה בסוף, בלי אימוג'י, בלי האשטגים ובלי תיוגים.
- בלי מספרים שלא מופיעים בפוסט. בלי קו מפריד ארוך.
- אם אין בפוסט שום דבר ספציפי להגיד עליו, מחזירים מחרוזת ריקה.
גם: שם פרטי לפתיחה ("היי ___!"). רק אם שם התצוגה מכיל שם פרטי ברור, ובעברית אם הוא כתוב בעברית. אחרת מחרוזת ריקה. לא מנחשים שם מתוך שם משתמש.`;

const REPLY_SYSTEM = `את/ה עונה בתגובה לפוסט של מישהו שמתכנן טיול ושואל שאלה. התשובה מהחשבון @tiyulplus, של אתר ישראלי לתכנון טיולים.
המטרה: לעזור באמת. תשובה ישירה לשאלה, 2 עד 4 משפטים קצרים.

כללים:
- החשבון הוא של אתר, לא של אדם: אסור לטעון לחוויה אישית ("הייתי שם", "אני מכיר", "ביקרנו").
- כל עובדה חייבת להופיע בטקסט הפוסט או במידע על היעד שמצורף. אם המידע לא עונה על השאלה, עונים על מה שכן אפשר ולא ממציאים.
- בלי מספרים שלא מופיעים במקור. בלי מחירים.
- עברית מדוברת וטבעית. בלי שפה של פרסומת, בלי להזכיר את טיול+, בלי קישורים ובלי "תבדקו באתר".
- בלי האשטגים, בלי תיוגים, לכל היותר אימוג'י אחד, בלי קו מפריד ארוך.`;

const COMMENTS_SCHEMA = {
  type: 'object',
  properties: { comments: { type: 'array', items: { type: 'string' } } },
  required: ['comments'],
  additionalProperties: false,
};
const LINE_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, line: { type: 'string' } },
  required: ['name', 'line'],
  additionalProperties: false,
};
const REPLY_SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' } },
  required: ['reply'],
  additionalProperties: false,
};

const clean = (s) => stripDashes(String(s || '').trim()).replace(/^["“”']+|["“”']+$/g, '');

/** Ask, check, and ask once more with the reasons if the check failed. */
async function withRetry(ctx, build, check) {
  let feedback = '';
  let last = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await askJson({ ...ctx, user: build(feedback) });
    const problems = check(out);
    if (!problems.length) return out;
    last = problems;
    feedback = `\n\nהניסיון הקודם נפסל: ${problems.join('; ')}. כתוב מחדש בלי הבעיות האלה.`;
  }
  throw new DraftError(`the draft failed its checks twice: ${last.join('; ')}`, last);
}

export async function draftComments({ state, settings, lead, post, context }) {
  const sources = [post.title || '', context];
  const out = await withRetry(
    { state, settings, model: settings.models.draft, system: COMMENT_SYSTEM, schema: COMMENTS_SCHEMA, maxTokens: 900, effort: 'medium' },
    (fb) => `${postBlock(lead, post)}\n\n${genderNote(lead.gender)}\n\nמידע על היעד (מהאתר שלנו):\n${context || '(אין)'}\n\nהחזר בדיוק שתי הצעות.${fb}`,
    (o) => {
      const cs = (o.comments || []).map(clean).filter(Boolean);
      if (cs.length < 2) return ['צריך שתי הצעות'];
      return cs.slice(0, 2).flatMap((c, i) => checkDraft(c, { kind: 'comment', sources }).map((p) => `הצעה ${i + 1}: ${p}`));
    }
  );
  return out.comments.map(clean).filter(Boolean).slice(0, 2);
}

export async function draftCreatorLine({ state, settings, lead, post }) {
  const sources = [post.title || '', lead.name || ''];
  try {
    const out = await withRetry(
      { state, settings, model: settings.models.draft, system: LINE_SYSTEM, schema: LINE_SCHEMA, maxTokens: 300, effort: 'medium' },
      (fb) => `${postBlock(lead, post)}\nשם תצוגה: ${lead.name || '(אין)'}\nשם משתמש: ${lead.handle || '(אין)'}\n\n${genderNote(lead.gender)}${fb}`,
      (o) => (clean(o.line) ? checkDraft(clean(o.line), { kind: 'line', sources }) : [])
    );
    const name = clean(out.name);
    // A name is only used if it is really in the display name: never a guess.
    return { name: name && String(lead.name || '').includes(name) ? name : '', line: clean(out.line), problems: [] };
  } catch (e) {
    if (e instanceof DraftError) return { name: '', line: '', problems: e.problems };
    throw e;
  }
}

export async function draftCustomerReply({ state, settings, lead, post, context }) {
  const sources = [post.title || '', context];
  const out = await withRetry(
    { state, settings, model: settings.models.draft, system: REPLY_SYSTEM, schema: REPLY_SCHEMA, maxTokens: 700, effort: 'medium' },
    (fb) => `${postBlock(lead, post)}\n\n${genderNote(lead.gender)}\n\nמידע על היעד (מהאתר שלנו):\n${context || '(אין)'}${fb}`,
    (o) => checkDraft(clean(o.reply), { kind: 'reply', sources })
  );
  return clean(out.reply);
}
