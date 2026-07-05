import { toID } from "../showdown/id";
import { parsePackedTeam } from "./packed";
import {
  PARSER_VERSION,
  type FieldSource,
  type ParsedPlayer,
  type ParsedReplay,
  type PokemonReveal,
  type ReplayMeta,
} from "./types";

type SideID = "p1" | "p2";

/** `-item`/`-ability` `[from]` effects that transfer items between Pokémon —
 * the revealed item is NOT the holder's original set item. */
const ITEM_TRANSFER_EFFECTS = /^move: (Trick|Switcheroo|Thief|Covet|Magician|Pickpocket|Bestow)/;

interface SideState {
  name: string;
  roster: Map<string, PokemonReveal>; // speciesId -> reveal, insertion = preview order
  brought: string[];
  leads: string[];
  nickToSpecies: Map<string, string>;
  megaUser?: string;
  teraUser?: string;
  won: boolean;
}

function newSide(): SideState {
  return { name: "", roster: new Map(), brought: [], leads: [], nickToSpecies: new Map(), won: false };
}

/** "Staraptor-Mega, L50, F, shiny" -> parts. Species is always first. */
function parseDetails(details: string) {
  const parts = details.split(",").map((s) => s.trim());
  const out: { species: string; level?: number; gender?: "M" | "F"; shiny?: boolean } = {
    species: parts[0] ?? "",
  };
  for (const p of parts.slice(1)) {
    if (p === "M" || p === "F") out.gender = p;
    else if (p === "shiny") out.shiny = true;
    else if (/^L\d+$/.test(p)) out.level = Number(p.slice(1));
  }
  return out;
}

/** "p1a: Boltund" -> { side, pos, nick } — nicknames may contain ":" so split once. */
function parseIdent(ident: string) {
  const m = ident.match(/^(p[12])([ab]?): (.*)$/);
  if (!m) return null;
  return { side: m[1] as SideID, pos: m[2], nick: m[3] };
}

function findFromOf(args: string[]) {
  let from: string | undefined;
  let of: string | undefined;
  for (const a of args) {
    // The sim is inconsistent about the space after the tag: "[from] move: X"
    // on item/ability lines but "[from]move: X" on called-move lines.
    if (a.startsWith("[from]")) from = a.slice(6).trimStart();
    else if (a.startsWith("[of]")) of = a.slice(4).trimStart();
  }
  return { from, of };
}

export function parseReplay(log: string, meta: ReplayMeta): ParsedReplay {
  const sides: Record<SideID, SideState> = { p1: newSide(), p2: newSide() };
  let gameType: string | undefined;
  let tie = false;
  let winnerName: string | null = null;

  const getMon = (side: SideID, species: string, details?: ReturnType<typeof parseDetails>): PokemonReveal => {
    const s = sides[side];
    // Megas and other in-battle forme changes must not create a second roster
    // entry: fall back to a roster mon whose id prefixes the changed forme id.
    const id = toID(species);
    let mon = s.roster.get(id);
    if (!mon) {
      for (const candidate of s.roster.values()) {
        if (id.startsWith(candidate.speciesId)) return candidate;
      }
    }
    if (!mon) {
      mon = { speciesId: id, species, moves: [], source: "revealed", fieldSources: {} };
      if (details?.gender) mon.gender = details.gender;
      if (details?.level !== undefined) mon.level = details.level;
      if (details?.shiny) mon.shiny = true;
      s.roster.set(id, mon);
    }
    return mon;
  };

  /** Resolve an ident to its roster mon via the side's nickname map. */
  const monByIdent = (ident: string): PokemonReveal | null => {
    const id = parseIdent(ident);
    if (!id) return null;
    const species = sides[id.side].nickToSpecies.get(id.nick);
    return species ? (sides[id.side].roster.get(species) ?? null) : null;
  };

  const markRevealed = (mon: PokemonReveal, field: string, source: FieldSource = "revealed") => {
    // A sheet field stays "sheet" even when battle play re-confirms it.
    if (mon.fieldSources[field] !== "sheet") mon.fieldSources[field] = source;
    if (mon.source === "preview" && source === "revealed") mon.source = "revealed";
  };

  // Sheets carry move IDs ("thunderbolt"), battle lines display names
  // ("Thunderbolt") — dedupe by toID so a sheet move re-revealed in battle
  // isn't double-counted, and provenance keys stay stable across both.
  const addMove = (mon: PokemonReveal, move: string, source: FieldSource) => {
    const key = `move:${toID(move)}`;
    if (!mon.moves.some((m) => toID(m) === toID(move))) mon.moves.push(move);
    markRevealed(mon, key, source);
  };

  for (const line of log.split("\n")) {
    if (!line.startsWith("|")) continue;
    const args = line.slice(1).split("|");
    const cmd = args[0];

    switch (cmd) {
      case "gametype":
        gameType = args[1];
        break;

      case "player": {
        // Trailing "|player|p2|" (player left) must not clobber the name.
        const side = args[1] as SideID;
        if ((side === "p1" || side === "p2") && args[2] && !sides[side].name) {
          sides[side].name = args[2];
        }
        break;
      }

      case "poke": {
        const side = args[1] as SideID;
        const d = parseDetails(args[2] ?? "");
        const mon = getMon(side, d.species, d);
        mon.source = mon.source === "revealed" ? mon.source : "preview";
        break;
      }

      case "showteam": {
        const side = args[1] as SideID;
        // Packed teams may themselves contain "|" — rejoin everything after the side.
        const sets = parsePackedTeam(args.slice(2).join("|"));
        for (const set of sets) {
          const mon = getMon(side, set.species);
          mon.source = "sheet";
          if (set.nickname && set.nickname !== set.species) mon.nickname = set.nickname;
          if (set.gender) mon.gender = set.gender;
          if (set.level !== undefined) mon.level = set.level;
          if (set.shiny) mon.shiny = true;
          if (set.ability) {
            mon.ability = set.ability;
            mon.fieldSources.ability = "sheet";
          }
          if (set.item) {
            mon.item = set.item;
            mon.fieldSources.item = "sheet";
          }
          if (set.teraType) {
            mon.teraType = set.teraType;
            mon.fieldSources.teraType = "sheet";
          }
          if (set.nature) mon.nature = set.nature;
          if (set.evs) mon.evs = set.evs;
          if (set.ivs) mon.ivs = set.ivs;
          for (const move of set.moves) {
            addMove(mon, move, "sheet");
          }
        }
        break;
      }

      case "switch":
      case "drag": {
        const id = parseIdent(args[1] ?? "");
        if (!id) break;
        const d = parseDetails(args[2] ?? "");
        const mon = getMon(id.side, d.species, d);
        const s = sides[id.side];
        s.nickToSpecies.set(id.nick, mon.speciesId);
        if (id.nick !== d.species && !mon.nickname) mon.nickname = id.nick;
        if (mon.source === "preview") mon.source = "revealed";
        if (!s.brought.includes(mon.speciesId)) s.brought.push(mon.speciesId);
        // Leads: the first mon to occupy each position before anything else does.
        const leadSlots = gameType === "doubles" ? 2 : 1;
        if (s.leads.length < leadSlots && !s.leads.includes(mon.speciesId)) s.leads.push(mon.speciesId);
        break;
      }

      case "detailschange": {
        const mon = monByIdent(args[1] ?? "");
        if (!mon) break;
        const d = parseDetails(args[2] ?? "");
        if (toID(d.species).includes("mega")) {
          mon.megaForme = d.species;
          sides[parseIdent(args[1]!)!.side].megaUser = mon.speciesId;
        }
        break;
      }

      case "-mega": {
        const identInfo = parseIdent(args[1] ?? "");
        const mon = monByIdent(args[1] ?? "");
        if (!mon || !identInfo) break;
        sides[identInfo.side].megaUser = mon.speciesId;
        // The mega stone is a revealed item.
        if (args[3]) {
          mon.item = args[3];
          markRevealed(mon, "item");
        }
        break;
      }

      case "-terastallize": {
        const identInfo = parseIdent(args[1] ?? "");
        const mon = monByIdent(args[1] ?? "");
        if (!mon || !identInfo) break;
        mon.teraType = args[2];
        markRevealed(mon, "teraType");
        sides[identInfo.side].teraUser = mon.speciesId;
        break;
      }

      case "move": {
        // Called moves ([from] Metronome, Dancer, ...) are not set moves.
        const { from } = findFromOf(args.slice(3));
        if (from) break;
        const mon = monByIdent(args[1] ?? "");
        if (!mon || !args[2]) break;
        addMove(mon, args[2], "revealed");
        break;
      }

      case "-ability": {
        const { from, of } = findFromOf(args.slice(3));
        if (from?.startsWith("ability: ")) {
          // e.g. Trace: shown ability was copied — the copier's real ability is
          // the [from] one; the [of] mon genuinely has the shown ability.
          const mon = monByIdent(args[1] ?? "");
          if (mon && !mon.ability) {
            mon.ability = from.slice(9);
            markRevealed(mon, "ability");
          }
          const src = of ? monByIdent(of) : null;
          if (src && args[2] && !src.ability) {
            src.ability = args[2];
            markRevealed(src, "ability");
          }
          break;
        }
        const mon = monByIdent(args[1] ?? "");
        if (mon && args[2]) {
          mon.ability = args[2];
          markRevealed(mon, "ability");
        }
        break;
      }

      case "-item":
      case "-enditem": {
        const rest = args.slice(3);
        const { from } = findFromOf(rest);
        const mon = monByIdent(args[1] ?? "");
        if (!mon || !args[2]) break;
        // Transferred items don't reflect the holder's original set.
        if (from && ITEM_TRANSFER_EFFECTS.test(from)) break;
        if (!mon.item) {
          mon.item = args[2];
          markRevealed(mon, "item");
        }
        if (cmd === "-enditem") mon.itemConsumed = true;
        break;
      }

      case "win":
        winnerName = args[1] ?? null;
        break;

      case "tie":
        tie = true;
        break;
    }
  }

  const toPlayer = (side: SideID): ParsedPlayer => {
    const s = sides[side];
    return {
      name: s.name,
      userId: toID(s.name),
      roster: [...s.roster.values()],
      brought: s.brought,
      leads: s.leads,
      ...(s.megaUser ? { megaUser: s.megaUser } : {}),
      ...(s.teraUser ? { teraUser: s.teraUser } : {}),
      won: winnerName !== null && s.name === winnerName,
    };
  };

  return {
    replayId: meta.id,
    formatId: meta.formatid,
    uploadTime: meta.uploadtime,
    rating: meta.rating,
    ...(meta.views !== undefined ? { views: meta.views } : {}),
    ...(gameType ? { gameType } : {}),
    tie,
    players: [toPlayer("p1"), toPlayer("p2")],
    parserVersion: PARSER_VERSION,
  };
}
