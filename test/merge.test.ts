import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseFormeId, teamFingerprint } from "../lib/scout/formes";
import { correlateAlts, mergeGame, modal, newTeamProfile } from "../lib/scout/merge";
import { parseReplay } from "../lib/scout/parse";
import type { ParsedPlayer } from "../lib/scout/types";
import type { ReplayJSON } from "../lib/showdown/types";

describe("baseFormeId (forme normalization)", () => {
  it("strips battle-only formes", () => {
    expect(baseFormeId("Charizard-Mega-Y")).toBe("charizard");
    expect(baseFormeId("Charizard-Mega-X")).toBe("charizard");
    expect(baseFormeId("Scrafty-Mega")).toBe("scrafty");
    expect(baseFormeId("Groudon-Primal")).toBe("groudon");
  });

  it("keeps teambuilder formes distinct", () => {
    expect(baseFormeId("Rotom-Wash")).toBe("rotomwash");
    expect(baseFormeId("Lycanroc-Dusk")).toBe("lycanrocdusk");
    expect(baseFormeId("Ogerpon-Wellspring")).toBe("ogerponwellspring");
    expect(baseFormeId("Basculegion-F")).toBe("basculegionf");
    expect(baseFormeId("Landorus-Therian")).toBe("landorustherian");
  });
});

describe("teamFingerprint", () => {
  const team = ["Staraptor", "Houndstone", "Tyranitar", "Rotom-Wash", "Excadrill", "Venusaur"];

  it("is order-independent and Mega-invariant", () => {
    const a = teamFingerprint(team);
    const b = teamFingerprint([...team].reverse());
    const c = teamFingerprint(["Staraptor-Mega", ...team.slice(1)]);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  it("distinguishes different formes chosen in the builder", () => {
    expect(teamFingerprint(team)).not.toBe(teamFingerprint(["Rotom-Heat", ...team.filter((s) => s !== "Rotom-Wash")]));
  });
});

function fixturePlayer(id: string, playerIndex: 0 | 1) {
  const raw = JSON.parse(readFileSync(join(__dirname, "fixtures", `${id}.json`), "utf8")) as ReplayJSON;
  const parsed = parseReplay(raw.log, raw);
  return { parsed, player: parsed.players[playerIndex] };
}

describe("mergeGame", () => {
  it("accumulates a profile from a real replay and is idempotent per replay", () => {
    const { parsed, player } = fixturePlayer("gen9championsvgc2026regmb-2644523805", 0);
    const ctx = { replayId: parsed.replayId, uploadTime: parsed.uploadTime, rating: parsed.rating, tie: parsed.tie };
    const profile = mergeGame(newTeamProfile(player, parsed.formatId), player, ctx);

    expect(profile.userId).toBe("quinncs");
    expect(profile.rosterIds).toHaveLength(6);
    expect(profile.wins).toBe(1);
    expect(profile.losses).toBe(0);
    expect(profile.leadPairs).toEqual({ "rotomwash+staraptor": 1 });
    expect(profile.brings).toEqual({ "excadrill+rotomwash+staraptor+tyranitar": 1 });
    expect(profile.megaSlot).toEqual({ staraptor: 1 });
    expect(profile.mons.staraptor.items.staraptite.name).toBe("Staraptite");
    // The source replay is kept with its ladder rating.
    expect(profile.replays).toEqual([
      { id: parsed.replayId, uploadTime: parsed.uploadTime, rating: 1327 },
    ]);

    // Merging the same replay again changes nothing.
    const again = mergeGame(profile, player, ctx);
    expect(again.wins).toBe(1);
    expect(again.replays).toHaveLength(1);
  });

  it("counts frequencies across games and flags 5th-move set variations", () => {
    const base: ParsedPlayer = {
      name: "Alice",
      userId: "alice",
      roster: [
        {
          speciesId: "pikachu",
          species: "Pikachu",
          moves: ["Thunderbolt", "Protect"],
          source: "revealed",
          fieldSources: {},
        },
      ],
      brought: ["pikachu"],
      leads: ["pikachu"],
      won: true,
    };
    const profile = newTeamProfile(base, "testformat");
    mergeGame(profile, base, { replayId: "r1", uploadTime: 100, rating: null, tie: false });
    mergeGame(
      profile,
      {
        ...base,
        won: false,
        roster: [
          {
            ...base.roster[0],
            item: "Light Ball",
            moves: ["Thunderbolt", "Fake Out", "Volt Tackle"],
          },
        ],
      },
      { replayId: "r2", uploadTime: 200, rating: null, tie: false },
    );
    mergeGame(
      profile,
      { ...base, roster: [{ ...base.roster[0], moves: ["Grass Knot"] }] },
      { replayId: "r3", uploadTime: 300, rating: null, tie: true },
    );

    const pika = profile.mons.pikachu;
    expect(pika.moves.thunderbolt.count).toBe(2);
    expect(Object.keys(pika.moves)).toHaveLength(5);
    expect(pika.setVariation).toBe(true); // 5 distinct moves — never silently dropped
    expect(pika.items.lightball.count).toBe(1);
    expect(profile.wins).toBe(1);
    expect(profile.losses).toBe(1);
    expect(profile.ties).toBe(1);
    expect(profile.firstSeen).toBe(100);
    expect(profile.lastSeen).toBe(300);
    expect(modal(pika.moves)!.name).toBe("Thunderbolt");
  });
});

describe("correlateAlts", () => {
  it("groups identical fingerprints under different users within a format", () => {
    const alts = correlateAlts([
      { userId: "mainacct", formatId: "f1", fingerprint: "abc" },
      { userId: "secretalt", formatId: "f1", fingerprint: "abc" },
      { userId: "someoneelse", formatId: "f1", fingerprint: "xyz" },
      { userId: "otherformat", formatId: "f2", fingerprint: "abc" },
    ]);
    expect(alts).toEqual([{ fingerprint: "abc", formatId: "f1", userIds: ["mainacct", "secretalt"] }]);
  });
});
