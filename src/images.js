// Image provenance.
//
// The brief allows exactly three origins for a photograph, and forbids one
// specific thing absolutely:
//
//   allowed:  commercial-license stock | our own catalogue | AI-generated
//   never:    an image lifted from a news article or a business's own page
//
// So this module is not a fetcher with a policy bolted on — it is the policy,
// and fetching is what the individual providers do underneath it. Every image
// that reaches the renderer carries a provenance tag, that tag is printed in
// the approval message *and* on the card itself, and anything without one is
// refused rather than published with a shrug.
//
// v1 ships with no provider enabled: the four text-led layouts need no
// photograph, which sidesteps licensing entirely rather than managing it. The
// machinery is here so turning a provider on is a config change, not a rewrite.

export const PROVENANCE = {
  stock: 'סטוק ברישיון מסחרי',
  catalogue: 'קטלוג התמונות שלנו',
  ai: 'נוצר ב-AI (גנרי)',
};

export const provenanceHe = (p) => PROVENANCE[p] || p || 'לא ידוע';

export class ImagePolicyError extends Error {}

/**
 * The one hard rule for AI images: generic only.
 *
 * "AI images may only be generic. Never a depiction of the specific place the
 * post is about." A model handed "a hidden square in Lisbon" will cheerfully
 * invent a Lisbon that does not exist, and a plausible fake of a real place is
 * exactly the failure being guarded against — so the place name never reaches
 * the image prompt at all. The prompt is built from an abstract descriptor
 * only, and a prompt that mentions the post's place or country is rejected.
 */
export function assertGenericAiPrompt(prompt, { place, country } = {}) {
  const p = String(prompt || '').toLowerCase();
  for (const term of [place, country].filter(Boolean)) {
    if (p.includes(String(term).toLowerCase())) {
      throw new ImagePolicyError(
        `AI image prompt names the specific place ("${term}") — generic imagery only`
      );
    }
  }
  return true;
}

const providers = {
  /**
   * Commercial-license stock. Pluggable on purpose — the pipeline cares that an
   * image is licensed for commercial use, not which library it came from.
   * Wire a provider here and set its key to enable the photo layout.
   */
  async stock() {
    if (!process.env.PEXELS_API_KEY && !process.env.UNSPLASH_ACCESS_KEY) return null;
    throw new ImagePolicyError(
      'a stock key is set but no stock provider is implemented yet — ' +
        'implement it in src/images.js before enabling, rather than silently posting without one'
    );
  },

  /** Our own catalogue: a directory plus a manifest of what each photo shows. */
  async catalogue() {
    if (!process.env.CATALOGUE_DIR) return null;
    throw new ImagePolicyError('CATALOGUE_DIR is set but the catalogue reader is not implemented yet');
  },

  /** Generic AI imagery. Anthropic has no image generation, so this is a separate provider. */
  async ai() {
    if (!process.env.IMAGE_GEN_API_KEY) return null;
    throw new ImagePolicyError('IMAGE_GEN_API_KEY is set but no image-gen provider is implemented yet');
  },
};

export const imagesEnabled = () =>
  Boolean(
    process.env.PEXELS_API_KEY ||
      process.env.UNSPLASH_ACCESS_KEY ||
      process.env.CATALOGUE_DIR ||
      process.env.IMAGE_GEN_API_KEY
  );

/**
 * Find an image for a draft, or null.
 *
 * Returns { src, provenance, credit } — `src` is whatever the renderer can put
 * in an <img> (a data URI or an absolute file URL), never a hotlink to someone
 * else's server. Returning null is a completely normal outcome: the caller
 * falls back to a text-led layout, which is the v1 default anyway.
 */
export async function findImage(draft, { order = ['catalogue', 'stock', 'ai'] } = {}) {
  for (const name of order) {
    const got = await providers[name](draft);
    if (got?.src) {
      if (!PROVENANCE[got.provenance]) {
        throw new ImagePolicyError(`provider "${name}" returned an unknown provenance`);
      }
      return got;
    }
  }
  return null;
}
