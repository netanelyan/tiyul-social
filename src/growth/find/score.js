// Scoring, per type. Pure.
//
// Each function returns { score, why, reject }. `why` is the list of Hebrew
// reasons the lead page shows under "why it was picked", so a reason that does
// not appear there did not count. `reject` is a reason the lead is not worth
// showing at all, and `rejectPerson` says whether that reason is about the
// person (never look at them again) or only about this post.

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

function recency(ageDays) {
  if (ageDays <= 3) return [25, 'פורסם בימים האחרונים'];
  if (ageDays <= 7) return [20, 'פורסם השבוע'];
  if (ageDays <= 14) return [12, 'פורסם בשבועיים האחרונים'];
  if (ageDays <= 30) return [5, 'פורסם החודש'];
  return [0, null];
}

export function scoreCreator({ verdict, followers, ageDays, onSite, comments }, settings) {
  const why = [];
  let score = 0;
  if (!verdict?.hebrew) return { score: 0, why, reject: 'לא בעברית', rejectPerson: true };
  if (verdict.kind !== 'creator') return { score: 0, why, reject: 'לא תוכן של יוצר/ת טיולים' };
  if (ageDays > settings.maxPostAgeDays) return { score: 0, why, reject: `ישן מדי (${Math.round(ageDays)} ימים)` };
  if (!onSite) return { score: 0, why, reject: 'היעד לא קיים באתר, אין מסלול לבנות' };
  why.push('עברית', `יעד שיש לנו באתר: ${onSite}`);
  score += 20;

  if (Number.isFinite(followers)) {
    if (followers < settings.followers.min || followers > settings.followers.max) {
      return { score: 0, why, reject: `${fmt(followers)} עוקבים, מחוץ לטווח`, rejectPerson: true };
    }
    score += 30;
    why.push(`${fmt(followers)} עוקבים`);
  } else {
    why.push('מספר עוקבים לא ידוע');
  }

  const [r, rWhy] = recency(ageDays);
  score += r;
  if (rWhy) why.push(rWhy);
  if (verdict.routeDemand) {
    score += 20;
    why.push('בפוסט כתוב ששואלים על המסלול');
  }
  if (verdict.places?.length) {
    score += 5;
    why.push(`מזכיר ${verdict.places.length} מקומות`);
  }
  if (Number(comments) >= 20) {
    score += 10;
    why.push(`${fmt(comments)} תגובות`);
  }
  return { score, why, reject: null };
}

export function scoreCustomer({ verdict, ageDays, onSite }, settings) {
  const why = [];
  let score = 0;
  if (!verdict?.hebrew) return { score: 0, why, reject: 'לא בעברית', rejectPerson: true };
  if (verdict.kind !== 'customer') return { score: 0, why, reject: 'לא שאלה על תכנון טיול' };
  if (ageDays > settings.maxCustomerAgeDays) return { score: 0, why, reject: `שאלה ישנה (${Math.round(ageDays)} ימים)` };
  // A reply is only allowed to state what our site says, so a destination the
  // site does not cover leaves nothing true to write.
  if (!onSite) return { score: 0, why, reject: 'אין לנו מידע על היעד הזה' };
  why.push('שואלים איך לתכנן טיול', `יעד שיש לנו באתר: ${onSite}`);
  score += 30;
  if (ageDays <= 2) {
    score += 25;
    why.push('השאלה מהיומיים האחרונים');
  } else if (ageDays <= 7) {
    score += 15;
    why.push('השאלה מהשבוע');
  }
  if (verdict.asksForRoute) {
    score += 15;
    why.push('ביקשו מסלול במפורש');
  }
  return { score, why, reject: null };
}

export function scoreAgency({ status, phone, website, whatsapp, email, kosher, abroad, siteRead, types = [] }) {
  const why = [];
  let score = 10;
  if (status && status !== 'OPERATIONAL') return { score: 0, why, reject: 'העסק לא פעיל לפי גוגל' };
  if (!phone && !website && !whatsapp && !email) return { score: 0, why, reject: 'אין דרך ציבורית ליצור קשר' };
  // It has to sell trips abroad. Read off the name and the homepage; when the
  // homepage could not be read, Google's own "travel_agency" is taken instead.
  if (!abroad && (siteRead || !types.includes('travel_agency'))) {
    return { score: 0, why, reject: 'לא נראה שמוכרים טיולים לחו"ל' };
  }
  if (abroad) {
    score += 10;
    why.push(`טיולים לחו"ל ("${abroad}")`);
  }
  if (types.includes('travel_agency')) {
    score += 10;
    why.push('סוכנות נסיעות לפי גוגל');
  }
  if (whatsapp) {
    score += 15;
    why.push('וואטסאפ באתר שלהם');
  } else if (phone) {
    score += 5;
    why.push('טלפון ציבורי');
  }
  if (email) {
    score += 5;
    why.push('מייל באתר שלהם');
  }
  if (website) score += 5;
  if (kosher) {
    score += 25;
    why.push(`קהל שומר כשרות ("${kosher}")`);
  }
  return { score, why, reject: null };
}
