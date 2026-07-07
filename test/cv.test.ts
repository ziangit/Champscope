import { describe, expect, it } from "vitest";
import { detectSpriteBoxes } from "../lib/cv/detect";
import { classifyImage } from "../lib/cv/match";
import { affineScore, computeSignature, cropToAlpha, type RGBAImage, type Template, type TemplateSet } from "../lib/cv/signature";

/** Paint a deterministic block-structured "sprite" into an RGBA canvas
 * (structure at ~8px scale so grid cells carry it, like real sprites). */
function paintSprite(img: RGBAImage, ox: number, oy: number, size: number, fade = 1) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = ((oy + y) * img.width + (ox + x)) * 4;
      const bx = Math.floor(x / 8);
      const by = Math.floor(y / 8);
      const r = ((bx * 7 + by * 13) % 3) * 90 + 40;
      const g = ((bx * 3 + by * 5) % 4) * 60 + 20;
      const b = ((bx + by) % 5) * 45 + 30;
      img.data[i] = Math.round(img.data[i] * (1 - fade) + r * fade);
      img.data[i + 1] = Math.round(img.data[i + 1] * (1 - fade) + g * fade);
      img.data[i + 2] = Math.round(img.data[i + 2] * (1 - fade) + b * fade);
      img.data[i + 3] = 255;
    }
  }
}

function canvas(w: number, h: number, base = 235): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = base;
    data[i + 1] = base;
    data[i + 2] = base + 8;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

function spriteTemplate(id: string, size = 48): Template {
  const art = canvas(size, size, 0);
  art.data.fill(0);
  paintSprite(art, 0, 0, size);
  const cropped = cropToAlpha(art)!;
  const sig = computeSignature(cropped, 10, 10);
  return { id, name: id, ar: 1, bw: cropped.width, bh: cropped.height, ...sig };
}

function noiseTemplate(id: string, seed: number, size = 48): Template {
  const art = canvas(size, size, 0);
  for (let i = 0; i < art.data.length; i += 4) {
    art.data[i] = (i * seed * 31) % 256;
    art.data[i + 1] = (i * seed * 17) % 256;
    art.data[i + 2] = (i * seed * 7) % 256;
    art.data[i + 3] = 255;
  }
  const sig = computeSignature(art, 10, 10);
  return { id, name: id, ar: 1, bw: size, bh: size, ...sig };
}

const SET: TemplateSet = {
  tw: 48,
  th: 48,
  gw: 10,
  gh: 10,
  templates: [spriteTemplate("target"), noiseTemplate("noise1", 3), noiseTemplate("noise2", 11)],
};

describe("cv core", () => {
  it("detects a sprite region on a smooth background", () => {
    const img = canvas(300, 120);
    paintSprite(img, 40, 30, 48);
    const boxes = detectSpriteBoxes(img);
    expect(boxes.length).toBeGreaterThanOrEqual(1);
    const b = boxes[0];
    expect(Math.abs(b.x - 40)).toBeLessThanOrEqual(6);
    expect(Math.abs(b.w - 48)).toBeLessThanOrEqual(12);
  });

  it("classifies the right template and rejects a flat image", () => {
    const img = canvas(300, 120);
    paintSprite(img, 40, 30, 48);
    const hits = classifyImage(img, [{ set: SET, source: "test" }]);
    expect(hits.map((h) => h.id)).toEqual(["target"]);
    expect(hits[0].score).toBeLessThan(15); // within the accept threshold despite ±1px box error

    const flat = canvas(300, 120);
    expect(classifyImage(flat, [{ set: SET, source: "test" }])).toEqual([]);
  });

  it("matches a faded (alpha-blended) sprite via the affine fit", () => {
    const img = canvas(300, 120);
    paintSprite(img, 40, 30, 48, 0.5); // 50% opacity over the background
    const hits = classifyImage(img, [{ set: SET, source: "test" }]);
    expect(hits.map((h) => h.id)).toEqual(["target"]);
  });

  it("affineScore separates matching structure from unrelated noise", () => {
    const win = new Float32Array(SET.templates[0].grid);
    const self = affineScore(SET.templates[0], win);
    expect(self.score).toBeLessThan(0.5);
    expect(self.corr).toBeGreaterThan(0.99);
    const cross = affineScore(SET.templates[1], win);
    expect(cross.corr).toBeLessThan(0.5);
  });
});
