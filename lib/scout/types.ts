/** Bump whenever parse output changes shape or semantics; drives `reparse`. */
export const PARSER_VERSION = 1;

export type FieldSource = "sheet" | "revealed" | "preview";

export interface PokemonReveal {
  speciesId: string; // toID of species as shown in details (forme included, e.g. "rotomwash")
  species: string; // display species, e.g. "Rotom-Wash"
  nickname?: string; // only when it differs from species
  gender?: "M" | "F";
  level?: number;
  shiny?: boolean;
  ability?: string;
  item?: string;
  itemConsumed?: boolean;
  moves: string[]; // distinct, order of first reveal (sheet moves first)
  megaForme?: string; // e.g. "Charizard-Mega-Y"
  teraType?: string;
  /** Highest-fidelity origin for this mon overall. */
  source: FieldSource;
  /** Per-field provenance: ability/item/tera plus one entry per move name. */
  fieldSources: Record<string, FieldSource>;
  /** Set details only available from a team sheet; never inferred. */
  nature?: string;
  evs?: string; // raw packed EV string, e.g. "252,0,0,4,0,252"
  ivs?: string;
}

export interface ParsedPlayer {
  name: string;
  userId: string;
  roster: PokemonReveal[]; // up to 6, team-preview order
  brought: string[]; // speciesIds, order of first appearance
  leads: string[]; // speciesIds first on the field (2 in doubles, 1 in singles)
  megaUser?: string; // speciesId that Mega Evolved this game
  teraUser?: string; // speciesId that Terastallized this game
  won: boolean;
}

export interface ParsedReplay {
  replayId: string;
  formatId: string;
  uploadTime: number; // unix seconds
  rating: number | null;
  views?: number;
  gameType?: string; // e.g. "doubles"
  tie: boolean;
  players: [ParsedPlayer, ParsedPlayer];
  parserVersion: number;
}

/** Metadata the parser needs alongside the raw log (from ReplayJSON). */
export interface ReplayMeta {
  id: string;
  formatid: string;
  uploadtime: number;
  rating: number | null;
  views?: number;
}
