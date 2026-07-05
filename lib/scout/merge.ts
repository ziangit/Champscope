import { toID } from "../showdown/id";
import { baseFormeId, teamFingerprint } from "./formes";
import type { FieldSource, ParsedPlayer, PokemonReveal } from "./types";

/** A value observed across replays, with how often and how authoritatively. */
export interface ObservedValue {
  name: string;
  count: number;
  source: FieldSource; // best provenance seen ("sheet" beats "revealed")
}

export interface MergedMon {
  speciesId: string; // as-seen forme id, e.g. "rotomwash"
  species: string;
  nicknames: string[];
  /** keyed by toID(value) */
  moves: Record<string, ObservedValue>;
  items: Record<string, ObservedValue>;
  abilities: Record<string, ObservedValue>;
  teraTypes: Record<string, ObservedValue>;
  megaFormes: Record<string, ObservedValue>;
  /** >4 distinct moves seen ⇒ the player runs set variations of this mon. */
  setVariation: boolean;
  /** Sheet-only details; never inferred. Last sheet wins. */
  nature?: string;
  evs?: string;
  ivs?: string;
  timesBrought: number;
  timesLead: number;
}

export interface TeamProfile {
  userId: string;
  displayName: string;
  formatId: string;
  fingerprint: string;
  /** Sorted base-forme ids — the fingerprint's preimage. */
  rosterIds: string[];
  mons: Record<string, MergedMon>; // keyed by base-forme id
  leadPairs: Record<string, number>; // "a+b" (sorted ids) -> count
  brings: Record<string, number>; // "a+b+c+d" (sorted ids) -> count
  wins: number;
  losses: number;
  ties: number;
  megaSlot: Record<string, number>; // base-forme id -> games it held the Mega
  replayIds: string[];
  firstSeen: number; // uploadTime unix seconds
  lastSeen: number;
}

export interface ReplayContext {
  replayId: string;
  uploadTime: number;
  tie: boolean;
}

const better = (a: FieldSource, b: FieldSource): FieldSource => (a === "sheet" || b === "sheet" ? "sheet" : a === "revealed" || b === "revealed" ? "revealed" : "preview");

function observe(map: Record<string, ObservedValue>, name: string, source: FieldSource) {
  const key = toID(name);
  const prev = map[key];
  if (prev) {
    prev.count += 1;
    prev.source = better(prev.source, source);
    // Prefer a display name over a raw id when both spellings were seen.
    if (name.includes(" ") || /[A-Z]/.test(name)) prev.name = name;
  } else {
    map[key] = { name, count: 1, source };
  }
}

function newMergedMon(reveal: PokemonReveal): MergedMon {
  return {
    speciesId: reveal.speciesId,
    species: reveal.species,
    nicknames: [],
    moves: {},
    items: {},
    abilities: {},
    teraTypes: {},
    megaFormes: {},
    setVariation: false,
    timesBrought: 0,
    timesLead: 0,
  };
}

export function newTeamProfile(player: ParsedPlayer, formatId: string): TeamProfile {
  return {
    userId: player.userId,
    displayName: player.name,
    formatId,
    fingerprint: teamFingerprint(player.roster.map((m) => m.species)),
    rosterIds: player.roster.map((m) => baseFormeId(m.species)).sort(),
    mons: {},
    leadPairs: {},
    brings: {},
    wins: 0,
    losses: 0,
    ties: 0,
    megaSlot: {},
    replayIds: [],
    firstSeen: Number.MAX_SAFE_INTEGER,
    lastSeen: 0,
  };
}

/**
 * Merge one game's reveals into a profile. Idempotent per replayId — merging
 * the same replay twice is a no-op. Mutates and returns `profile`.
 */
export function mergeGame(profile: TeamProfile, player: ParsedPlayer, replay: ReplayContext, tie = false): TeamProfile {
  if (profile.replayIds.includes(replay.replayId)) return profile;
  profile.replayIds.push(replay.replayId);
  profile.firstSeen = Math.min(profile.firstSeen, replay.uploadTime);
  profile.lastSeen = Math.max(profile.lastSeen, replay.uploadTime);
  profile.displayName = player.name;

  if (replay.tie || tie) profile.ties += 1;
  else if (player.won) profile.wins += 1;
  else profile.losses += 1;

  for (const reveal of player.roster) {
    const key = baseFormeId(reveal.species);
    const mon = (profile.mons[key] ??= newMergedMon(reveal));
    if (reveal.nickname && !mon.nicknames.includes(reveal.nickname)) mon.nicknames.push(reveal.nickname);
    for (const move of reveal.moves) {
      observe(mon.moves, move, reveal.fieldSources[`move:${toID(move)}`] ?? "revealed");
    }
    if (reveal.item) observe(mon.items, reveal.item, reveal.fieldSources.item ?? "revealed");
    if (reveal.ability) observe(mon.abilities, reveal.ability, reveal.fieldSources.ability ?? "revealed");
    if (reveal.teraType) observe(mon.teraTypes, reveal.teraType, reveal.fieldSources.teraType ?? "revealed");
    if (reveal.megaForme) observe(mon.megaFormes, reveal.megaForme, "revealed");
    if (reveal.nature) mon.nature = reveal.nature;
    if (reveal.evs) mon.evs = reveal.evs;
    if (reveal.ivs) mon.ivs = reveal.ivs;
    // A 5th+ distinct move means set variations — keep counts, flag, never drop.
    mon.setVariation = Object.keys(mon.moves).length > 4;
  }

  const broughtBase = player.brought.map(baseFormeId);
  for (const id of broughtBase) {
    const mon = profile.mons[id];
    if (mon) mon.timesBrought += 1;
  }
  if (broughtBase.length > 0) {
    const key = [...broughtBase].sort().join("+");
    profile.brings[key] = (profile.brings[key] ?? 0) + 1;
  }
  const leadBase = player.leads.map(baseFormeId);
  for (const id of leadBase) {
    const mon = profile.mons[id];
    if (mon) mon.timesLead += 1;
  }
  if (leadBase.length === 2) {
    const key = [...leadBase].sort().join("+");
    profile.leadPairs[key] = (profile.leadPairs[key] ?? 0) + 1;
  }
  if (player.megaUser) {
    const id = baseFormeId(player.megaUser);
    profile.megaSlot[id] = (profile.megaSlot[id] ?? 0) + 1;
  }
  return profile;
}

/** Modal (most frequent) observed value, sheet provenance winning ties. */
export function modal(map: Record<string, ObservedValue>): ObservedValue | undefined {
  return Object.values(map).sort((a, b) => b.count - a.count || (a.source === "sheet" ? -1 : 1))[0];
}

export interface AltSuggestion {
  fingerprint: string;
  formatId: string;
  userIds: string[];
}

/**
 * Identical fingerprints under different userIds within one format —
 * surfaced as "possibly the same player", never asserted as fact.
 */
export function correlateAlts(profiles: Pick<TeamProfile, "userId" | "formatId" | "fingerprint">[]): AltSuggestion[] {
  const groups = new Map<string, Set<string>>();
  for (const p of profiles) {
    const key = `${p.formatId}\n${p.fingerprint}`;
    (groups.get(key) ?? groups.set(key, new Set()).get(key)!).add(p.userId);
  }
  return [...groups.entries()]
    .filter(([, users]) => users.size > 1)
    .map(([key, users]) => {
      const [formatId, fingerprint] = key.split("\n");
      return { fingerprint, formatId, userIds: [...users].sort() };
    });
}
