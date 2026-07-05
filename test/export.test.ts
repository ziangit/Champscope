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
      tie: parsed.tie,
    });

    const text = exportMon(profile.mons.staraptor);
    expect(text).toBe(["Staraptor @ Staraptite", "Ability: Intimidate", "- Brave Bird"].join("\n"));
    expect(text).not.toMatch(/EVs|Nature|IVs/); // nothing fabricated

    // A mon with zero reveals exports as just its species line.
    expect(exportMon(profile.mons.venusaur)).toBe("Venusaur");
  });
});
