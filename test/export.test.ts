import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportMon } from "../lib/scout/export";
import { mergeGame, newTeamProfile } from "../lib/scout/merge";
import { parseReplay } from "../lib/scout/parse";
import type { ReplayJSON } from "../lib/showdown/types";

describe("exportMon", () => {
  it("emits only confirmed fields from battle reveals — no fabricated EVs/natures", () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "fixtures", "gen9championsvgc2026regmb-2644523805.json"), "utf8"),
    ) as ReplayJSON;
    const parsed = parseReplay(raw.log, raw);
    const player = parsed.players[0];
    const profile = mergeGame(newTeamProfile(player, parsed.formatId), player, {
      replayId: parsed.replayId,
      uploadTime: parsed.uploadTime,
      rating: parsed.rating,
      tie: parsed.tie,
    });

    const text = exportMon(profile.mons.staraptor);
    expect(text).toBe(["Staraptor @ Staraptite", "Ability: Intimidate", "- Brave Bird"].join("\n"));
    expect(text).not.toMatch(/EVs|Nature|IVs/); // nothing fabricated

    // A mon with zero reveals exports as just its species line.
    expect(exportMon(profile.mons.venusaur)).toBe("Venusaur");
  });

  it("caps the export at the 4 most-used moves so it round-trips the teambuilder", () => {
    const mon = {
      speciesId: "pikachu",
      species: "Pikachu",
      nicknames: [],
      moves: {
        thunderbolt: { name: "Thunderbolt", count: 5, source: "revealed" as const },
        protect: { name: "Protect", count: 4, source: "revealed" as const },
        fakeout: { name: "Fake Out", count: 3, source: "revealed" as const },
        volttackle: { name: "Volt Tackle", count: 2, source: "revealed" as const },
        grassknot: { name: "Grass Knot", count: 1, source: "revealed" as const },
      },
      items: {},
      abilities: {},
      teraTypes: {},
      megaFormes: {},
      setVariation: true,
      timesBrought: 0,
      timesLead: 0,
    };
    expect(exportMon(mon)).toBe(
      ["Pikachu", "- Thunderbolt", "- Protect", "- Fake Out", "- Volt Tackle"].join("\n"),
    );
  });
});
