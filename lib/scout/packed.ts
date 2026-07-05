/**
 * Parser for Showdown's packed team format (sim/TEAMS.md), used by
 * `|showteam|`. Champions ladder replays currently don't emit showteam
 * (see docs/ARCHITECTURE.md) but other VGC formats do.
 *
 * Per mon: NICKNAME|SPECIES|ITEM|ABILITY|MOVES|NATURE|EVS|GENDER|IVS|SHINY|LEVEL|MISC
 * MISC = HAPPINESS,POKEBALL,HIDDENPOWERTYPE,GIGANTAMAX,DYNAMAXLEVEL,TERATYPE
 * Mons are joined by "]". Empty SPECIES means it equals NICKNAME.
 */

export interface PackedSet {
  nickname: string;
  species: string;
  item?: string;
  ability?: string;
  moves: string[];
  nature?: string;
  evs?: string;
  gender?: "M" | "F";
  ivs?: string;
  shiny?: boolean;
  level?: number;
  teraType?: string;
}

export function parsePackedTeam(packed: string): PackedSet[] {
  return packed
    .split("]")
    .filter((s) => s.length > 0)
    .map((mon) => {
      const f = mon.split("|");
      const nickname = f[0] ?? "";
      const species = f[1] || nickname;
      const misc = (f[11] ?? "").split(",");
      const set: PackedSet = {
        nickname,
        species,
        moves: (f[4] ?? "").split(",").filter(Boolean),
      };
      if (f[2]) set.item = f[2];
      if (f[3]) set.ability = f[3];
      if (f[5]) set.nature = f[5];
      if (f[6]) set.evs = f[6];
      if (f[7] === "M" || f[7] === "F") set.gender = f[7];
      if (f[8]) set.ivs = f[8];
      if (f[9] === "S") set.shiny = true;
      if (f[10]) set.level = Number(f[10]);
      if (misc[5]) set.teraType = misc[5];
      return set;
    });
}
