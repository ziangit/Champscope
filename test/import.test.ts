import { describe, expect, it } from "vitest";
import { exportMon, exportTeam } from "../lib/scout/export";
import { normalizePokedataSpecies, packStats, parseExportSet, parseExportText, pokedataToReveals } from "../lib/scout/import";
import { mergeImportedTeam, newImportedProfile } from "../lib/scout/merge";
import { teamFingerprint } from "../lib/scout/formes";

/** Verbatim from pokepast.es/ec3f1186fd68b9ba/json (trailing double spaces included). */
const PASTE = [
  "Gardevoir @ Gardevoirite  ",
  "Ability: Telepathy  ",
  "Level: 50  ",
  "EVs: 16 HP / 5 Def / 17 SpA / 1 SpD / 27 Spe  ",
  "Modest Nature  ",
  "- Hyper Voice  ",
  "- Psyshock  ",
  "- Vacuum Wave  ",
  "- Protect  ",
  "",
  "Grimmsnarl (M) @ Roseli Berry  ",
  "Ability: Prankster  ",
  "Level: 50  ",
  "IVs: 0 Atk  ",
  "- Foul Play  ",
  "- Parting Shot  ",
].join("\n");

describe("parseExportText", () => {
  it("parses a real pokepaste into sheet-grade reveals", () => {
    const mons = parseExportText(PASTE);
    expect(mons).toHaveLength(2);
    const [gard, grimm] = mons;
    expect(gard.species).toBe("Gardevoir");
    expect(gard.item).toBe("Gardevoirite");
    expect(gard.ability).toBe("Telepathy");
    expect(gard.level).toBe(50);
    expect(gard.nature).toBe("Modest");
    expect(gard.evs).toBe("16,,5,17,1,27"); // HP,Atk,Def,SpA,SpD,Spe — packed like the parser's sheet EVs
    expect(gard.moves).toEqual(["Hyper Voice", "Psyshock", "Vacuum Wave", "Protect"]);
    expect(gard.source).toBe("sheet");
    expect(gard.fieldSources.item).toBe("sheet");
    expect(gard.fieldSources["move:hypervoice"]).toBe("sheet");
    expect(grimm.gender).toBe("M");
    expect(grimm.ivs).toBe(",0,,,,");
    expect(grimm.evs).toBeUndefined(); // absent line stays absent — never fabricated
  });

  it("handles nicknames, missing items, and slashed move options", () => {
    const mon = parseExportSet(["Chomper (Garchomp) (F)", "Ability: Rough Skin", "- Protect / Detect", "- Earthquake"].join("\n"));
    expect(mon).toMatchObject({ species: "Garchomp", nickname: "Chomper", gender: "F", item: undefined });
    expect(mon?.moves).toEqual(["Protect", "Earthquake"]);
  });

  it("round-trips through export.ts", () => {
    const mons = parseExportText(PASTE);
    const profile = mergeImportedTeam(newImportedProfile("tester", "Tester", "fmt", mons), mons, {
      key: "https://pokepast.es/ec3f1186fd68b9ba",
      url: "https://pokepast.es/ec3f1186fd68b9ba",
      kind: "paste",
      sharedAt: 1751500000,
    });
    const text = exportMon(profile.mons.gardevoir);
    expect(text).toBe(
      [
        "Gardevoir @ Gardevoirite",
        "Ability: Telepathy",
        "EVs: 16 HP / 5 Def / 17 SpA / 1 SpD / 27 Spe",
        "Modest Nature",
        "- Hyper Voice",
        "- Psyshock",
        "- Vacuum Wave",
        "- Protect",
      ].join("\n"),
    );
    // Re-importing the export yields the same set again (fixpoint).
    const again = parseExportText(exportTeam(Object.values(profile.mons)));
    expect(again.map((m) => m.species).sort()).toEqual(["Gardevoir", "Grimmsnarl"]);
    expect(again.find((m) => m.species === "Gardevoir")?.evs).toBe("16,,5,17,1,27");
  });

  it("mergeImportedTeam is idempotent per source key", () => {
    const mons = parseExportText(PASTE);
    const src = { key: "k1", url: "u", kind: "paste" as const, sharedAt: 100 };
    const profile = newImportedProfile("tester", "Tester", "fmt", mons);
    mergeImportedTeam(profile, mons, src);
    mergeImportedTeam(profile, mons, src);
    expect(profile.sources).toHaveLength(1);
    expect(profile.mons.gardevoir.moves.hypervoice.count).toBe(1);
  });
});

describe("parsePreviewSpecies", () => {
  it("accepts full export/pokepaste text and plain species lists alike", async () => {
    const { parsePreviewSpecies } = await import("../lib/match");
    expect(parsePreviewSpecies(PASTE)).toEqual(["Gardevoir", "Grimmsnarl"]);
    expect(parsePreviewSpecies("Charizard, Basculegion, Kingambit")).toEqual(["Charizard", "Basculegion", "Kingambit"]);
    expect(parsePreviewSpecies("Charizard\nBasculegion\n")).toEqual(["Charizard", "Basculegion"]);
    // Itemless export (still has Ability/move lines) goes through the importer.
    expect(parsePreviewSpecies("Incineroar\nAbility: Intimidate\n- Fake Out")).toEqual(["Incineroar"]);
  });
});

describe("packStats", () => {
  it("packs stat lines positionally with blanks for defaults", () => {
    expect(packStats("252 HP / 4 SpA / 252 Spe")).toBe("252,,,4,,252");
    expect(packStats("0 Atk")).toBe(",0,,,,");
    expect(packStats("garbage")).toBeUndefined();
  });
});

describe("normalizePokedataSpecies", () => {
  it("maps every bracket variant observed in real pokedata responses to its Showdown name", () => {
    const cases: [string, string][] = [
      ["Basculegion [Male]", "Basculegion"],
      ["Basculegion [Female]", "Basculegion-F"],
      ["Arcanine [Hisuian Form]", "Arcanine-Hisui"],
      ["Ninetales [Alolan Form]", "Ninetales-Alola"],
      ["Slowking [Galarian Form]", "Slowking-Galar"],
      ["Rotom [Wash Rotom]", "Rotom-Wash"],
      ["Rotom [Heat Rotom]", "Rotom-Heat"],
      ["Lycanroc [Dusk Form]", "Lycanroc-Dusk"],
      ["Lycanroc [Midday Form]", "Lycanroc"],
      ["Maushold [Family of Four]", "Maushold-Four"],
      ["Maushold [Family of Three]", "Maushold"],
      ["Floette [Eternal Flower]", "Floette-Eternal"],
      ["Sinistcha [Masterpiece Form]", "Sinistcha-Masterpiece"],
      ["Sinistcha [Unremarkable Form]", "Sinistcha"],
      ["Tauros [Paldean Form - Aqua Breed]", "Tauros-Paldea-Aqua"],
      ["Zoroark [Hisuian Form]", "Zoroark-Hisui"],
      ["Kommo-o", "Kommo-o"],
      ["Urshifu [Rapid Strike Style]", "Urshifu-Rapid-Strike"],
      ["Urshifu [Single Strike Style]", "Urshifu"],
      ["Indeedee [Female]", "Indeedee-F"],
      ["Tornadus [Incarnate Forme]", "Tornadus"],
    ];
    for (const [input, want] of cases) expect(normalizePokedataSpecies(input), input).toBe(want);
  });
});

describe("pokedataToReveals", () => {
  it("converts an official sheet and lands in the same fingerprint space as replays", () => {
    // Trimmed from the real NAIC 2026 decklists response (champion's team, first 2 mons).
    const decklist = [
      { id: "6", name: "Charizard", ability: "Blaze", item: "Charizardite Y", stat_alignment: "Modest", badges: ["Heat Wave", "Solar Beam", "Weather Ball", "Protect"] },
      { id: "902", name: "Basculegion [Male]", ability: "Adaptability", item: "Focus Sash", stat_alignment: "Adamant", badges: ["Wave Crash", "Last Respects", "Aqua Jet", "Protect"] },
    ];
    const reveals = pokedataToReveals(decklist);
    expect(reveals[1].species).toBe("Basculegion");
    expect(reveals[0].nature).toBe("Modest");
    expect(reveals[0].evs).toBeUndefined(); // official OTS carry no EVs — never fabricated
    expect(reveals[0].fieldSources.ability).toBe("sheet");
    // Same fingerprint as the identical roster written with Showdown names.
    expect(teamFingerprint(reveals.map((r) => r.species))).toBe(teamFingerprint(["Charizard", "Basculegion"]));
    // The export of an EV-less sheet has no EV/nature fabrication beyond the sheet's nature.
    const profile = mergeImportedTeam(newImportedProfile("t", "T", "fmt", reveals), reveals, { key: "k", url: "u", kind: "tournament", sharedAt: 1 });
    expect(exportMon(profile.mons.charizard)).not.toMatch(/EVs|IVs/);
    expect(exportMon(profile.mons.charizard)).toContain("Modest Nature");
  });
});
