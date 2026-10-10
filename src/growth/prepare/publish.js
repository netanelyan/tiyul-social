// Publishing a creator's route on tiyulplus.com: NOT BUILT, on purpose.
//
// The site has no endpoint that creates and publishes a trip from a script.
// /api/trips/publish takes only a trip id and reads the trip from the signed-in
// user's own rows; there is no editor account and no server token. The owner's
// instruction was to stop and write a spec rather than work around that, and
// SITE-SPEC.md beside this file is that spec.
//
// So every creator route is built (route.js) and held, and the card says why
// the link is missing. When the site ships POST /api/internal/trips, this is
// the only file that changes:
//
//   publishRoute: POST { externalId: `growth:${lead.id}`, name, days, ... } with
//                 GROWTH_PUBLISH_TOKEN; store { status: 'published', url, slug }.
//                 Called when the creator first appears in the Creators column,
//                 never earlier: a route goes public only when it is shown.
//   withdrawRoute: DELETE ?externalId=..., on [דלג], [לא מעוניינים] and
//                 [לא רלוונטי].
//
// Both need a line in http.js RULES for www.tiyulplus.com /api/internal/trips,
// which is a write to OUR site, not to a platform.

export const PUBLISHING_BUILT = false;

export const WAITING = {
  status: 'waiting-for-site',
  reason: 'האתר עוד לא מאפשר לפרסם מסלול מכאן. המפרט נשלח (SITE-SPEC.md). עד אז המסלול בנוי ומחכה, וההודעה לא יוצאת בלי קישור.',
};

/** The trip state for a creator whose route is built. */
export async function publishRoute(lead) {
  if (!lead.route?.days?.length) return { status: 'no-route', reason: 'אין מסלול לבנות: היעד לא באתר או בלי ימים' };
  return { ...WAITING };
}

/** Take a published route down. Nothing is ever published yet, so nothing to do. */
export async function withdrawRoute(lead) {
  if (lead.trip?.status === 'published') {
    // Unreachable until publishRoute exists; kept loud so it cannot pass silently.
    throw new Error('withdrawRoute: publishing is not built, yet a route is marked published');
  }
  return lead.trip ? { ...lead.trip, status: lead.trip.status === 'waiting-for-site' ? 'not-published' : lead.trip.status } : null;
}
