// Scoring, per type. Pure.
//
// Each function returns { score, why, reject }. `why` is the list of Hebrew
// reasons the lead page shows under "why it was picked", so a reason that does
// not appear there did not count. `reject` is a reason the lead is not worth
// showing at all, and `rejectPerson` says whether that reason is about the
// person (never look at them again) or only about this post.

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

function recency(ageDays) {
  if (ageDays <= 3) return [25, 'posted in the last few days'];
  if (ageDays <= 7) return [20, 'posted this week'];
  if (ageDays <= 14) return [12, 'posted in the last two weeks'];
  if (ageDays <= 30) return [5, 'posted this month'];
  return [0, null];
}

export function scoreCreator({ verdict, followers, ageDays, onSite, comments }, settings) {
  const why = [];
  let score = 0;
  if (!verdict?.hebrew) return { score: 0, why, reject: 'not in Hebrew', rejectPerson: true };
  if (verdict.kind !== 'creator') return { score: 0, why, reject: 'not travel content by a creator' };
  if (ageDays > settings.maxPostAgeDays) return { score: 0, why, reject: `too old (${Math.round(ageDays)} days)` };
  if (!onSite) return { score: 0, why, reject: 'the destination is not on our site, so there is no route to build' };
  why.push('in Hebrew', `a destination we have: ${onSite}`);
  score += 20;

  if (Number.isFinite(followers)) {
    if (followers < settings.followers.min || followers > settings.followers.max) {
      return { score: 0, why, reject: `${fmt(followers)} followers, outside the range`, rejectPerson: true };
    }
    score += 30;
    why.push(`${fmt(followers)} followers`);
  } else {
    why.push('follower count unknown');
  }

  const [r, rWhy] = recency(ageDays);
  score += r;
  if (rWhy) why.push(rWhy);
  if (verdict.routeDemand) {
    score += 20;
    why.push('the post says people ask for the route');
  }
  if (verdict.places?.length) {
    score += 5;
    why.push(`names ${verdict.places.length} places`);
  }
  if (Number(comments) >= 20) {
    score += 10;
    why.push(`${fmt(comments)} comments`);
  }
  return { score, why, reject: null };
}

export function scoreCustomer({ verdict, ageDays, onSite }, settings) {
  const why = [];
  let score = 0;
  if (!verdict?.hebrew) return { score: 0, why, reject: 'not in Hebrew', rejectPerson: true };
  if (verdict.kind !== 'customer') return { score: 0, why, reject: 'not a question about planning a trip' };
  if (ageDays > settings.maxCustomerAgeDays) return { score: 0, why, reject: `an old question (${Math.round(ageDays)} days)` };
  // A reply is only allowed to state what our site says, so a destination the
  // site does not cover leaves nothing true to write.
  if (!onSite) return { score: 0, why, reject: 'we have nothing on this destination' };
  why.push('asks how to plan a trip', `a destination we have: ${onSite}`);
  score += 30;
  if (ageDays <= 2) {
    score += 25;
    why.push('asked in the last two days');
  } else if (ageDays <= 7) {
    score += 15;
    why.push('asked this week');
  }
  if (verdict.asksForRoute) {
    score += 15;
    why.push('asked for a route outright');
  }
  return { score, why, reject: null };
}

export function scoreAgency({ status, phone, website, whatsapp, email, kosher, abroad, siteRead, types = [] }) {
  const why = [];
  let score = 10;
  if (status && status !== 'OPERATIONAL') return { score: 0, why, reject: 'closed, according to Google' };
  if (!phone && !website && !whatsapp && !email) return { score: 0, why, reject: 'no public way to contact them' };
  // It has to sell trips abroad. Read off the name and the homepage; when the
  // homepage could not be read, Google's own "travel_agency" is taken instead.
  if (!abroad && (siteRead || !types.includes('travel_agency'))) {
    return { score: 0, why, reject: 'does not seem to sell trips abroad' };
  }
  if (abroad) {
    score += 10;
    why.push(`sells trips abroad ("${abroad}")`);
  }
  if (types.includes('travel_agency')) {
    score += 10;
    why.push('a travel agency, according to Google');
  }
  if (whatsapp) {
    score += 15;
    why.push('WhatsApp on their site');
  } else if (phone) {
    score += 5;
    why.push('a public phone number');
  }
  if (email) {
    score += 5;
    why.push('email on their site');
  }
  if (website) score += 5;
  if (kosher) {
    score += 25;
    why.push(`a kosher-keeping audience ("${kosher}")`);
  }
  return { score, why, reject: null };
}
