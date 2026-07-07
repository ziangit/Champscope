import { classifyImage, type ClassifyOptions } from "./match";
import type { RGBAImage, TemplateSet } from "./signature";

/**
 * Screenshot -> team species, tiered the way /match consumes it.
 *
 * Candidate regions are detected bottom-up (detail clusters on smooth UI
 * backgrounds) and classified against both template sets at once: box icons
 * (Showdown side panels, Champions team screens) and gen5 battle sprites
 * (Showdown team preview headers and battle scenes). Anything that matches
 * neither — artwork, photos, unrelated images — lands in tier "none": that
 * IS the not-recognized fallback, by construction.
 */

export interface RecognizedTeam {
  recognized: boolean;
  /** ">=4 species" auto-matches; "1-3" pre-fills and asks; "none" is rejected. */
  tier: "match" | "partial" | "none";
  species: { id: string; name: string; score: number; source: string }[];
}

export interface TemplateSets {
  icons: TemplateSet;
  gen5: TemplateSet;
  /** XY-style animated battle sprites (frames) — what the client renders in battle. */
  ani: TemplateSet;
  /** HOME-style renders (Showdown dex sprites; Champions select screens reuse them). */
  dex: TemplateSet;
}

/** PRECISION-FIRST calibration (fixture eval 2026-07-06): extraction
 * pre-fills a human-editable input, so a wrong species is worse than a
 * missing one. Recall on crowded previews is known-partial; the manifest
 * records the scorecard and the deferred trained-model path is the fix. */
export const CLASSIFY: ClassifyOptions = {
  maxScore: 12,
  minCorr: 0.85,
  maxMargin: 0.8,
};

const SPRITE_MAX_SCORE = 10;
const SPRITE_MIN_CORR = 0.88;

function tierOf(count: number): RecognizedTeam["tier"] {
  return count >= 4 ? "match" : count >= 1 ? "partial" : "none";
}

export function recognizeTeam(img: RGBAImage, sets: TemplateSets, opts: ClassifyOptions = CLASSIFY): RecognizedTeam {
  // Showdown-only scope for now: dex renders (Champions select screens) stay
  // out of the scan until Champions support lands — they can't appear in
  // Showdown screenshots and would only add false-positive surface.
  const hits = classifyImage(
    img,
    [
      { set: sets.icons, source: "icon" },
      { set: sets.gen5, source: "sprite", maxScore: SPRITE_MAX_SCORE, minCorr: SPRITE_MIN_CORR },
      { set: sets.ani, source: "sprite", maxScore: SPRITE_MAX_SCORE, minCorr: SPRITE_MIN_CORR },
    ],
    opts,
  );
  const species = hits.slice(0, 6).map((h) => ({ id: h.id, name: h.name, score: h.score, source: h.source }));
  const tier = tierOf(species.length);
  return { recognized: tier !== "none", tier, species };
}
