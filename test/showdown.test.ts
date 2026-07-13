import { describe, expect, it } from "vitest";
import { baseReplayId, toID } from "../lib/showdown/id";

describe("toID", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(toID("YOASOBI stan")).toBe("yoasobistan");
    expect(toID("s4m1_jaw3d")).toBe("s4m1jaw3d");
    expect(toID("Flutter Mane")).toBe("fluttermane");
    expect(toID("Landorus-Therian")).toBe("landorustherian");
    expect(toID("Ogerpon-Wellspring")).toBe("ogerponwellspring");
    expect(toID("café ñoño 42!")).toBe("cafoo42");
  });
});

describe("baseReplayId", () => {
  it("strips the -<password>pw suffix of private replay ids", () => {
    expect(baseReplayId("gen9championsvgc2026regmb-2648274338-iav28e1bjq2fevx8jw0kcqta7d8ddscpw")).toBe(
      "gen9championsvgc2026regmb-2648274338",
    );
  });

  it("leaves public replay ids untouched", () => {
    expect(baseReplayId("gen9championsvgc2026regmb-2644520954")).toBe("gen9championsvgc2026regmb-2644520954");
  });
});
