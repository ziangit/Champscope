import { describe, expect, it } from "vitest";
import { toID } from "../lib/showdown/id";

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
