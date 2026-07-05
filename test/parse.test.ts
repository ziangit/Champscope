import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReplay } from "../lib/scout/parse";
import type { ReplayJSON } from "../lib/showdown/types";

const FIXTURES = join(__dirname, "fixtures");

function loadFixture(id: string): ReplayJSON {
  return JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), "utf8"));
}

function parseFixture(id: string) {
  const r = loadFixture(id);
  return parseReplay(r.log, r);
}

describe("parseReplay on real Champions replays", () => {
  it("snapshots every fixture (guards against silent parser drift)", () => {
    for (const f of readdirSync(FIXTURES).filter((f) => f.startsWith("gen9"))) {
      const r = JSON.parse(readFileSync(join(FIXTURES, f), "utf8")) as ReplayJSON;
      expect(parseReplay(r.log, r)).toMatchSnapshot(r.id);
    }
  });

  it("parses the high-rated Mega mirror (QuinnCS vs Purinja92179) — hand-checked", () => {
    const p = parseFixture("gen9championsvgc2026regmb-2644523805");
    expect(p.formatId).toBe("gen9championsvgc2026regmb");
    expect(p.gameType).toBe("doubles");
    expect(p.tie).toBe(false);
    expect(p.rating).toBe(1327);

    const [p1, p2] = p.players;
    expect(p1.name).toBe("QuinnCS");
    expect(p1.userId).toBe("quinncs");
    expect(p1.won).toBe(true);
    expect(p2.won).toBe(false);

    expect(p1.roster.map((m) => m.speciesId).sort()).toEqual(
      ["staraptor", "houndstone", "tyranitar", "rotomwash", "excadrill", "venusaur"].sort(),
    );
    expect(p1.leads).toEqual(["rotomwash", "staraptor"]);
    expect(p2.leads).toEqual(["charizard", "whimsicott"]);
    expect(p1.brought).toEqual(["rotomwash", "staraptor", "tyranitar", "excadrill"]);

    // Both sides Mega Evolved; the stone is a revealed item.
    expect(p1.megaUser).toBe("staraptor");
    const staraptor = p1.roster.find((m) => m.speciesId === "staraptor")!;
    expect(staraptor.megaForme).toBe("Staraptor-Mega");
    expect(staraptor.item).toBe("Staraptite");
    expect(staraptor.ability).toBe("Intimidate");
    expect(staraptor.moves).toContain("Brave Bird");

    expect(p2.megaUser).toBe("charizard");
    expect(p2.roster.find((m) => m.speciesId === "charizard")!.megaForme).toBe("Charizard-Mega-Y");

    // Focus Sash reveals via -enditem, flagged consumed.
    const whimsicott = p2.roster.find((m) => m.speciesId === "whimsicott")!;
    expect(whimsicott.item).toBe("Focus Sash");
    expect(whimsicott.itemConsumed).toBe(true);

    // No Tera in Champions games.
    expect(p1.teraUser).toBeUndefined();
    expect(p2.teraUser).toBeUndefined();
  });

  it("resolves nicknames to species and Megas to their base roster entry — hand-checked", () => {
    const p = parseFixture("gen9championsvgc2026regmb-2644523560");
    const p1 = p.players[0];
    expect(p1.name).toBe("lazmawasa");
    expect(p1.won).toBe(true);

    // Nicknamed team: felicidad=Farigiraf, jackyjill=Scrafty, sebastian=Lycanroc-Dusk, lazmad=Torkoal.
    const scrafty = p1.roster.find((m) => m.speciesId === "scrafty")!;
    expect(scrafty.nickname).toBe("jackyjill");
    expect(scrafty.megaForme).toBe("Scrafty-Mega");
    expect(p1.megaUser).toBe("scrafty");
    // The Mega did NOT create a 7th roster entry.
    expect(p1.roster).toHaveLength(6);
    expect(p1.brought).toEqual(["farigiraf", "scrafty", "lycanrocdusk", "torkoal"]);
    expect(p1.roster.find((m) => m.speciesId === "lycanrocdusk")!.nickname).toBe("sebastian");
  });

  it("handles forfeits and Knock Off item attribution — hand-checked", () => {
    const p = parseFixture("gen9championsvgc2026regmb-2644522165");
    expect(p.players[0].name).toBe("Goomyracle");
    expect(p.players[0].won).toBe(true);
    expect(p.tie).toBe(false);
    // |-enditem|p2a: Clawitzer|Dragon Fang|[from] move: Knock Off|[of] p1b: Weavile
    // → the item belongs to Clawitzer (the victim), not Weavile.
    const clawitzer = p.players[1].roster.find((m) => m.speciesId === "clawitzer")!;
    expect(clawitzer.item).toBe("Dragon Fang");
    const weavile = p.players[0].roster.find((m) => m.speciesId === "weavile")!;
    expect(weavile.item).toBeUndefined();
    expect(weavile.ability).toBe("Pressure");
  });
});

describe("parseReplay on synthetic edge-case logs", () => {
  const META = { id: "test-1", formatid: "gen9championsvgc2026regmb", uploadtime: 1783000000, rating: null };

  it("records a tie", () => {
    const log = [
      "|gametype|doubles",
      "|player|p1|Alice|1|1100",
      "|player|p2|Bob|2|1100",
      "|clearpoke",
      "|poke|p1|Pikachu, L50, M|",
      "|poke|p2|Eevee, L50, F|",
      "|start",
      "|switch|p1a: Pikachu|Pikachu, L50, M|100/100",
      "|switch|p2a: Eevee|Eevee, L50, F|100/100",
      "|tie",
    ].join("\n");
    const p = parseReplay(log, META);
    expect(p.tie).toBe(true);
    expect(p.players[0].won).toBe(false);
    expect(p.players[1].won).toBe(false);
  });

  it("treats a showteam sheet as authoritative and merges reveals on top", () => {
    const packed =
      "Sparky|Pikachu|lightball|static|thunderbolt,protect,fakeout,volttackle|Timid|,,,252,4,252|M||S|50|,,,,,Electric]" +
      "|Eevee|leftovers|adaptability|quickattack,protect||||||50|";
    const log = [
      "|gametype|doubles",
      "|player|p1|Alice|1|1100",
      "|player|p2|Bob|2|1100",
      "|clearpoke",
      "|poke|p1|Pikachu, L50, M|",
      "|poke|p1|Eevee, L50, F|",
      `|showteam|p1|${packed}`,
      "|start",
      "|switch|p1a: Sparky|Pikachu, L50, M|100/100",
      "|move|p1a: Sparky|Thunderbolt|p2a: X",
      "|win|Alice",
    ].join("\n");
    const p = parseReplay(log, META);
    const pika = p.players[0].roster.find((m) => m.speciesId === "pikachu")!;
    expect(pika.source).toBe("sheet");
    expect(pika.nickname).toBe("Sparky");
    expect(pika.item).toBe("lightball");
    expect(pika.ability).toBe("static");
    expect(pika.moves).toEqual(["thunderbolt", "protect", "fakeout", "volttackle"]);
    expect(pika.nature).toBe("Timid");
    expect(pika.evs).toBe(",,,252,4,252");
    expect(pika.teraType).toBe("Electric");
    // Battle reveal of a sheet move keeps sheet provenance; the raw move name
    // is recorded separately only if it wasn't already known.
    expect(pika.fieldSources["move:thunderbolt"]).toBe("sheet");
    const eevee = p.players[0].roster.find((m) => m.speciesId === "eevee")!;
    expect(eevee.nickname).toBeUndefined();
    expect(eevee.moves).toEqual(["quickattack", "protect"]);
  });

  it("does not attribute Tricked items or called moves to a set", () => {
    const log = [
      "|gametype|doubles",
      "|player|p1|Alice|1|1100",
      "|player|p2|Bob|2|1100",
      "|start",
      "|switch|p1a: Gothitelle|Gothitelle, L50, F|100/100",
      "|switch|p2a: Snorlax|Snorlax, L50, M|100/100",
      "|move|p1a: Gothitelle|Trick|p2a: Snorlax",
      "|-item|p2a: Snorlax|Choice Scarf|[from] move: Trick",
      "|-item|p1a: Gothitelle|Leftovers|[from] move: Trick",
      "|move|p2a: Snorlax|Metronome|p2a: Snorlax",
      "|move|p2a: Snorlax|Fly|p1a: Gothitelle|[from]move: Metronome",
      "|win|Alice",
    ].join("\n");
    const p = parseReplay(log, META);
    const snorlax = p.players[1].roster.find((m) => m.speciesId === "snorlax")!;
    expect(snorlax.item).toBeUndefined();
    expect(snorlax.moves).toEqual(["Metronome"]);
    const goth = p.players[0].roster.find((m) => m.speciesId === "gothitelle")!;
    expect(goth.item).toBeUndefined();
    expect(goth.moves).toEqual(["Trick"]);
  });

  it("attributes Trace-style ability copies to both mons correctly", () => {
    const log = [
      "|gametype|doubles",
      "|player|p1|Alice|1|1100",
      "|player|p2|Bob|2|1100",
      "|start",
      "|switch|p1a: Porygon2|Porygon2, L50|100/100",
      "|switch|p2a: Gyarados|Gyarados, L50, M|100/100",
      "|-ability|p1a: Porygon2|Intimidate|[from] ability: Trace|[of] p2a: Gyarados",
      "|win|Bob",
    ].join("\n");
    const p = parseReplay(log, META);
    expect(p.players[0].roster.find((m) => m.speciesId === "porygon2")!.ability).toBe("Trace");
    expect(p.players[1].roster.find((m) => m.speciesId === "gyarados")!.ability).toBe("Intimidate");
  });
});
