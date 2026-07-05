import { createHash } from "node:crypto";
import { toID } from "../showdown/id";

/**
 * Normalize a species to its base forme for team identity, so in-battle
 * transformations don't split one team into several fingerprints.
 *
 * Only battle-only formes are stripped (Mega/Primal/Gmax/Terastal…);
 * teambuilder formes like Rotom-Wash or Lycanroc-Dusk are distinct team
 * choices and must NOT be normalized away.
 */
const BATTLE_FORME_SUFFIX = /-(Mega(-[XY])?|Primal|Gmax|Terastal|Stellar|Eternamax|Complete|Ultra)$/;

export function baseFormeId(species: string): string {
  return toID(species.replace(BATTLE_FORME_SUFFIX, ""));
}

/**
 * Team identity: SHA-1 of the sorted base-forme species IDs.
 * Same 6 species under any name → same fingerprint (powers alt correlation).
 */
export function teamFingerprint(species: string[]): string {
  const ids = species.map(baseFormeId).sort();
  return createHash("sha1").update(ids.join(",")).digest("hex");
}
