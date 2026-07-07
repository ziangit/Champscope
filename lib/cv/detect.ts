import type { RGBAImage } from "./signature";

/**
 * Bottom-up sprite-region detection (pure, no I/O): sprites are dense
 * high-gradient clusters on locally smooth UI backgrounds. Gradient
 * thresholding + dilation + connected components yields candidate boxes with
 * their TRUE position and size — no multi-scale window search — and the
 * classifier only has to answer "which species, if any, is this box?".
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fraction of the box's pixels that are edge pixels (density prior). */
  density: number;
}

export interface DetectOptions {
  /** Gradient thresholds to run — low catches faint sprites, high separates
   * strong pixel art from soft UI borders it would otherwise merge with. */
  gradientThresholds?: number[];
  /** Dilation radius bridging gaps within one sprite. */
  dilate?: number;
  /** Component bounding-box side limits (pixels). */
  minSide?: number;
  maxSide?: number;
  /** Reject boxes with too few actual edge pixels (thin lines, text strokes). */
  minEdgePixels?: number;
  /** Aspect ratio limits (w/h). */
  minAspect?: number;
  maxAspect?: number;
  /** Cap on returned boxes (largest-density first). */
  maxBoxes?: number;
}

const DEFAULTS: Required<DetectOptions> = {
  gradientThresholds: [20, 48, 90],
  dilate: 3,
  minSide: 14,
  maxSide: 320,
  minEdgePixels: 60,
  minAspect: 0.3,
  maxAspect: 3.4,
  maxBoxes: 96,
};

/** Integral image of edge pixels (gradient above threshold) — O(1) edge
 * counts per window, used to reject mostly-background match windows. */
export function buildEdgeIntegral(img: RGBAImage, threshold = 24): { width: number; height: number; sum: Float64Array } {
  const { width: w, height: h, data } = img;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const inBounds = x > 0 && x < w - 1 && y > 0 && y < h - 1;
      const g = inBounds ? Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + w] - lum[p - w]) : 0;
      run += g > threshold ? 1 : 0;
      sum[(y + 1) * (w + 1) + (x + 1)] = sum[y * (w + 1) + (x + 1)] + run;
    }
  }
  return { width: w, height: h, sum };
}

export function edgeCount(e: { width: number; sum: Float64Array }, x: number, y: number, w: number, h: number): number {
  const W = e.width + 1;
  return e.sum[(y + h) * W + (x + w)] - e.sum[y * W + (x + w)] - e.sum[(y + h) * W + x] + e.sum[y * W + x];
}

export function detectSpriteBoxes(img: RGBAImage, opts?: DetectOptions): Box[] {
  const o = { ...DEFAULTS, ...opts };
  const { width: w, height: h, data } = img;

  // Luminance + gradient magnitude, shared across thresholds.
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const grad = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      grad[p] = Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + w] - lum[p - w]);
    }
  }

  const all: Box[] = [];
  for (const threshold of o.gradientThresholds) {
    all.push(...boxesAtThreshold(grad, w, h, threshold, o));
  }
  // Dedupe near-identical boxes across thresholds (denser one wins).
  all.sort((a, b) => b.density * b.w * b.h - a.density * a.w * a.h);
  const out: Box[] = [];
  for (const b of all) {
    const dup = out.some((k) => {
      const ix = Math.max(0, Math.min(k.x + k.w, b.x + b.w) - Math.max(k.x, b.x));
      const iy = Math.max(0, Math.min(k.y + k.h, b.y + b.h) - Math.max(k.y, b.y));
      return (ix * iy) / Math.min(k.w * k.h, b.w * b.h) > 0.7;
    });
    if (!dup) out.push(b);
    if (out.length >= o.maxBoxes) break;
  }
  return out;
}

function boxesAtThreshold(grad: Float32Array, w: number, h: number, threshold: number, o: Required<DetectOptions>): Box[] {
  const edge = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (grad[p] > threshold) edge[p] = 1;

  // Dilate horizontally then vertically (separable box dilation).
  const dil = new Uint8Array(w * h);
  const r = o.dilate;
  for (let y = 0; y < h; y++) {
    let run = -1;
    for (let x = 0; x < w; x++) {
      if (edge[y * w + x]) run = x;
      if (run >= 0 && x - run <= r) dil[y * w + x] = 1;
    }
    run = -1;
    for (let x = w - 1; x >= 0; x--) {
      if (edge[y * w + x]) run = x;
      if (run >= 0 && run - x <= r) dil[y * w + x] = 1;
    }
  }
  const dil2 = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let run = -1;
    for (let y = 0; y < h; y++) {
      if (dil[y * w + x]) run = y;
      if (run >= 0 && y - run <= r) dil2[y * w + x] = 1;
    }
    run = -1;
    for (let y = h - 1; y >= 0; y--) {
      if (dil[y * w + x]) run = y;
      if (run >= 0 && run - y <= r) dil2[y * w + x] = 1;
    }
  }

  // Connected components (iterative flood fill on the dilated map).
  const seen = new Uint8Array(w * h);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!dil2[start] || seen[start]) continue;
    let minX = w,
      maxX = 0,
      minY = h,
      maxY = 0,
      edges = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p / w) | 0;
      // bbox over EDGE pixels only — dilation just glues the component
      // together and would otherwise pad the box by the dilation radius.
      if (edge[p]) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        edges++;
      }
      if (px > 0 && dil2[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1);
      if (px < w - 1 && dil2[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1);
      if (py > 0 && dil2[p - w] && !seen[p - w]) (seen[p - w] = 1), stack.push(p - w);
      if (py < h - 1 && dil2[p + w] && !seen[p + w]) (seen[p + w] = 1), stack.push(p + w);
    }
    if (maxX < minX || edges < o.minEdgePixels) continue;
    // Components often glue several sprites (or a sprite + neighboring text)
    // together via dilation — re-split the bbox at empty-edge valleys.
    splitBox(edge, w, minX, minY, maxX, maxY, o, boxes, 0);
  }

  boxes.sort((a, b) => b.density * b.w * b.h - a.density * a.w * a.h);
  return boxes.slice(0, o.maxBoxes);
}

/** Best sustained density-step split of a 1D profile: position where band
 * means differ by >= 3x with both bands at least minSide long. */
function bestStep(profile: Int32Array, minSide: number): number | null {
  const n = profile.length;
  if (n < 2 * minSide) return null;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + profile[i];
  let best: { at: number; ratio: number } | null = null;
  for (let at = minSide; at <= n - minSide; at++) {
    const left = prefix[at] / at;
    const right = (prefix[n] - prefix[at]) / (n - at);
    const ratio = Math.max((left + 1) / (right + 1), (right + 1) / (left + 1));
    if (!best || ratio > best.ratio) best = { at, ratio };
  }
  return best && best.ratio >= 3 ? best.at : null;
}

/**
 * Recursively split a bbox along empty-edge valleys, ignoring UI rule lines
 * (rows/columns whose edge pixels span nearly the whole box — strip borders,
 * card outlines, underlines — are chrome, not sprite content).
 */
function splitBox(edge: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number, o: Required<DetectOptions>, out: Box[], depth: number) {
  if (x1 < x0 || y1 < y0) return;
  const bw0 = x1 - x0 + 1;
  const bh0 = y1 - y0 + 1;
  const rowSums = new Int32Array(bh0);
  const colSums = new Int32Array(bw0);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const e = edge[y * w + x];
      rowSums[y - y0] += e;
      colSums[x - x0] += e;
    }
  }
  const lineRow = new Uint8Array(bh0);
  const lineCol = new Uint8Array(bw0);
  for (let y = 0; y < bh0; y++) if (rowSums[y] >= 0.85 * bw0 && bw0 > 2 * o.minSide) lineRow[y] = 1;
  for (let x = 0; x < bw0; x++) if (colSums[x] >= 0.85 * bh0 && bh0 > 2 * o.minSide) lineCol[x] = 1;
  // Effective sums exclude rule lines on the perpendicular axis.
  const effCol = new Int32Array(bw0);
  const effRow = new Int32Array(bh0);
  for (let y = y0; y <= y1; y++) {
    if (lineRow[y - y0]) continue;
    for (let x = x0; x <= x1; x++) {
      if (lineCol[x - x0]) continue;
      const e = edge[y * w + x];
      effCol[x - x0] += e;
      effRow[y - y0] += e;
    }
  }

  // Trim empty margins (on effective sums).
  let ax0 = x0,
    ax1 = x1,
    ay0 = y0,
    ay1 = y1;
  while (ax0 <= ax1 && effCol[ax0 - x0] === 0) ax0++;
  while (ax1 >= ax0 && effCol[ax1 - x0] === 0) ax1--;
  while (ay0 <= ay1 && effRow[ay0 - y0] === 0) ay0++;
  while (ay1 >= ay0 && effRow[ay1 - y0] === 0) ay1--;
  if (ax1 < ax0 || ay1 < ay0) return;
  if (ax0 !== x0 || ax1 !== x1 || ay0 !== y0 || ay1 !== y1) {
    splitBox(edge, w, ax0, ay0, ax1, ay1, o, out, depth); // re-derive sums on the trimmed box
    return;
  }

  const bw = bw0;
  const bh = bh0;
  const fits = bw >= o.minSide && bh >= o.minSide && bw <= o.maxSide && bh <= o.maxSide && bw / bh >= o.minAspect && bw / bh <= o.maxAspect;

  // Widest empty valley (both sides must stay sprite-sized).
  let split: { axis: "x" | "y"; at: number; len: number } | null = null;
  if (depth < 6) {
    for (let x = o.minSide; x <= bw - 1 - o.minSide; x++) {
      if (effCol[x] !== 0) continue;
      let end = x;
      while (end + 1 <= bw - 1 - o.minSide && effCol[end + 1] === 0) end++;
      const len = end - x + 1;
      if (!split || len > split.len) split = { axis: "x", at: x0 + x, len };
      x = end;
    }
    for (let y = o.minSide; y <= bh - 1 - o.minSide; y++) {
      if (effRow[y] !== 0) continue;
      let end = y;
      while (end + 1 <= bh - 1 - o.minSide && effRow[end + 1] === 0) end++;
      const len = end - y + 1;
      if (!split || len > split.len) split = { axis: "y", at: y0 + y, len };
      y = end;
    }
  }

  // No empty valley? Try a density step: a text banner glued onto a sprite
  // row has no gap but a sharp sustained edge-density break between bands.
  if (!split && depth < 6) {
    const step = bestStep(effRow, o.minSide) ?? bestStep(effCol, o.minSide);
    const stepAxis: "x" | "y" = bestStep(effRow, o.minSide) ? "y" : "x";
    if (step !== null) split = { axis: stepAxis, at: (stepAxis === "y" ? y0 : x0) + step, len: 0 };
  }

  // Emit the box itself when plausible — and STILL recurse into splits:
  // a fitting box can be a text banner glued to a sprite; its sub-boxes are
  // extra candidates and the classifier keeps whichever actually matches.
  if (fits) {
    let edges = 0;
    for (let y = 0; y < bh0; y++) if (!lineRow[y]) edges += effRow[y];
    if (edges >= o.minEdgePixels) out.push({ x: x0, y: y0, w: bw, h: bh, density: edges / (bw * bh) });
  }
  if (split && depth < 6) {
    if (split.axis === "x") {
      splitBox(edge, w, x0, y0, split.at - 1, y1, o, out, depth + 1);
      splitBox(edge, w, split.at + split.len, y0, x1, y1, o, out, depth + 1);
    } else {
      splitBox(edge, w, x0, y0, x1, split.at - 1, o, out, depth + 1);
      splitBox(edge, w, x0, split.at + split.len, x1, y1, o, out, depth + 1);
    }
    return;
  }
  // Unsplittable elongated cluster (team previews: sprites touch, no valley,
  // no density step) — emit overlapping square slices along the long axis;
  // the classifier's jitter aligns each slice to its sprite.
  if (!split && depth < 6 && bw / bh >= 1.6 && bh >= o.minSide) {
    for (let x = x0; x + bh <= x1 + 1; x += Math.max(o.minSide, Math.round(bh / 2))) {
      splitBox(edge, w, x, y0, Math.min(x1, x + bh - 1), y1, o, out, depth + 6); // depth+6: slices don't re-split
    }
  } else if (!split && depth < 6 && bh / bw >= 1.6 && bw >= o.minSide) {
    for (let y = y0; y + bw <= y1 + 1; y += Math.max(o.minSide, Math.round(bw / 2))) {
      splitBox(edge, w, x0, y, x1, Math.min(y1, y + bw - 1), o, out, depth + 6);
    }
  }
}
