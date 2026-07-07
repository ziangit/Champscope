/**
 * Signature model for sprite recognition (pure, no I/O).
 *
 * A template is a small masked color-grid summary of a known sprite (box icon
 * or gen5 battle sprite). A screenshot window is summarized the same way via
 * integral images and compared cell-by-cell, weighting by the template's
 * per-cell opacity so transparent sprite regions never pollute the score.
 * Screenshots are pixel-faithful (photos are out of scope), so this stays
 * reliable without any learned model.
 */

export interface RGBAImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8Array | Uint8ClampedArray;
}

export interface Template {
  /** Species id (toID), e.g. "rotomwash". */
  id: string;
  /** Display species name, e.g. "Rotom-Wash". */
  name: string;
  /** Aspect ratio (w/h) of the artwork's alpha bounding box. */
  ar: number;
  /** Native alpha-bbox size in source pixels — with a global screenshot
   * rendering scale g, the on-screen sprite is (bw*g x bh*g). */
  bw: number;
  bh: number;
  /** gw*gh*3 per-cell masked RGB means, 0-255 (0 where the cell is empty). */
  grid: number[];
  /** gw*gh per-cell opacity percentage 0-100. */
  opa: number[];
  /** Masked overall mean RGB. */
  mean: [number, number, number];
}

/** Crop RGBA artwork to its alpha bounding box (templates are bbox-cropped so
 * every grid cell carries sprite content — sparse masks fit anything). */
export function cropToAlpha(img: RGBAImage): RGBAImage | null {
  let minX = img.width,
    maxX = -1,
    minY = img.height,
    maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] >= 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((minY + y) * img.width + minX) * 4;
    data.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

export interface TemplateSet {
  /** Template artwork size in screenshot pixels at scale 1. */
  tw: number;
  th: number;
  /** Grid dimensions. */
  gw: number;
  gh: number;
  templates: Template[];
}

/** Cells at least this opaque participate in scoring. */
export const MIN_CELL_OPACITY = 45;

/**
 * Compute a template signature from RGBA artwork where alpha marks the mask
 * (matte-flattened sources should pre-set alpha=0 on background pixels).
 */
export function computeSignature(img: RGBAImage, gw: number, gh: number): Pick<Template, "grid" | "opa" | "mean"> {
  const grid = new Array<number>(gw * gh * 3).fill(0);
  const opa = new Array<number>(gw * gh).fill(0);
  let mr = 0,
    mg = 0,
    mb = 0,
    mn = 0;
  for (let cy = 0; cy < gh; cy++) {
    const y0 = Math.floor((cy * img.height) / gh);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * img.height) / gh));
    for (let cx = 0; cx < gw; cx++) {
      const x0 = Math.floor((cx * img.width) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * img.width) / gw));
      let r = 0,
        g = 0,
        b = 0,
        n = 0,
        total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          total++;
          if (img.data[i + 3] < 128) continue;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      }
      const c = cy * gw + cx;
      opa[c] = Math.round((n / total) * 100);
      if (n > 0) {
        grid[c * 3] = Math.round(r / n);
        grid[c * 3 + 1] = Math.round(g / n);
        grid[c * 3 + 2] = Math.round(b / n);
        mr += r;
        mg += g;
        mb += b;
        mn += n;
      }
    }
  }
  return {
    grid,
    opa,
    mean: mn > 0 ? [Math.round(mr / mn), Math.round(mg / mn), Math.round(mb / mn)] : [0, 0, 0],
  };
}

/** Fraction of the template that is opaque at all (empty sheet cells get dropped). */
export function opacityFraction(sig: Pick<Template, "opa">): number {
  return sig.opa.reduce((a, b) => a + b, 0) / (sig.opa.length * 100);
}

/** Per-channel summed-area tables for O(1) rectangle means over a screenshot. */
export interface IntegralImage {
  width: number;
  height: number;
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
  /** Luminance and squared luminance, for O(1) window variance. */
  lum: Float64Array;
  lum2: Float64Array;
}

export function buildIntegral(img: RGBAImage): IntegralImage {
  const { width: w, height: h, data } = img;
  const r = new Float64Array((w + 1) * (h + 1));
  const g = new Float64Array((w + 1) * (h + 1));
  const b = new Float64Array((w + 1) * (h + 1));
  const lum = new Float64Array((w + 1) * (h + 1));
  const lum2 = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rr = 0,
      rg = 0,
      rb = 0,
      rl = 0,
      rl2 = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rr += data[i];
      rg += data[i + 1];
      rb += data[i + 2];
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      rl += l;
      rl2 += l * l;
      const o = (y + 1) * (w + 1) + (x + 1);
      const above = y * (w + 1) + (x + 1);
      r[o] = r[above] + rr;
      g[o] = g[above] + rg;
      b[o] = b[above] + rb;
      lum[o] = lum[above] + rl;
      lum2[o] = lum2[above] + rl2;
    }
  }
  return { width: w, height: h, r, g, b, lum, lum2 };
}

/** Luminance standard deviation of a window in O(1). */
export function windowStdev(ii: IntegralImage, x: number, y: number, w: number, h: number): number {
  const W = ii.width + 1;
  const area = w * h;
  const s = ii.lum[(y + h) * W + (x + w)] - ii.lum[y * W + (x + w)] - ii.lum[(y + h) * W + x] + ii.lum[y * W + x];
  const s2 = ii.lum2[(y + h) * W + (x + w)] - ii.lum2[y * W + (x + w)] - ii.lum2[(y + h) * W + x] + ii.lum2[y * W + x];
  const mean = s / area;
  return Math.sqrt(Math.max(0, s2 / area - mean * mean));
}

function rectMean(ii: IntegralImage, ch: Float64Array, x0: number, y0: number, x1: number, y1: number): number {
  const w = ii.width + 1;
  const area = (x1 - x0) * (y1 - y0);
  return (ch[y1 * w + x1] - ch[y0 * w + x1] - ch[y1 * w + x0] + ch[y0 * w + x0]) / area;
}

/**
 * Grid signature of a screenshot window via the integral image — the window
 * counterpart of computeSignature (no mask: screenshots are opaque).
 * Writes gw*gh*3 values into `out` and returns the window's overall mean.
 */
export function windowGrid(ii: IntegralImage, x: number, y: number, w: number, h: number, gw: number, gh: number, out: Float32Array): [number, number, number] {
  for (let cy = 0; cy < gh; cy++) {
    const y0 = y + Math.floor((cy * h) / gh);
    const y1 = Math.max(y0 + 1, y + Math.floor(((cy + 1) * h) / gh));
    for (let cx = 0; cx < gw; cx++) {
      const x0 = x + Math.floor((cx * w) / gw);
      const x1 = Math.max(x0 + 1, x + Math.floor(((cx + 1) * w) / gw));
      const c = (cy * gw + cx) * 3;
      out[c] = rectMean(ii, ii.r, x0, y0, x1, y1);
      out[c + 1] = rectMean(ii, ii.g, x0, y0, x1, y1);
      out[c + 2] = rectMean(ii, ii.b, x0, y0, x1, y1);
    }
  }
  const mr = rectMean(ii, ii.r, x, y, x + w, y + h);
  const mg = rectMean(ii, ii.g, x, y, x + w, y + h);
  const mb = rectMean(ii, ii.b, x, y, x + w, y + h);
  return [mr, mg, mb];
}

export interface AffineResult {
  /** Opacity-weighted RMSE residual after the affine fit (lower = closer). */
  score: number;
  /** Pooled correlation between template and window structure (0..1). A flat
   * or unrelated window has low correlation even when the residual is small
   * — both must pass for a hit. */
  corr: number;
}

/**
 * Illumination-tolerant template score: fits `win ≈ a·tpl + b_channel` over
 * the template's opaque cells (shared gain a, per-channel bias). This models
 * exactly how game clients draw sprites faded/alpha-blended over a background
 * (Showdown side panels render preview sprites at reduced opacity), while
 * per-cell residual shape still separates species.
 *
 * The fit is TRIMMED: the worst-residual quarter of cells is discarded and
 * the fit redone on the inliers. Preview sprites overlap their neighbors and
 * get partially occluded — a true match has near-zero inlier residual with
 * the contamination concentrated in the trimmed cells, while wrong templates
 * stay uniformly bad. Genuine screenshot sprites land well under score 12
 * with correlation above 0.8.
 */
export function affineScore(tpl: Template, win: Float32Array, minCellOpacity = MIN_CELL_OPACITY, trimFrac = 0.25): AffineResult {
  const first = affineScoreCells(tpl, win, minCellOpacity, null);
  if (!Number.isFinite(first.score) || trimFrac <= 0) return first;
  // Rank cells by residual under the first fit; refit on the best cells.
  const cells = tpl.opa.length;
  const residuals: { c: number; r: number }[] = [];
  for (let c = 0; c < cells; c++) {
    if (tpl.opa[c] < minCellOpacity) continue;
    let r = 0;
    for (let ch = 0; ch < 3; ch++) {
      const d = first.a * (tpl.grid[c * 3 + ch] - first.mt[ch]) - (win[c * 3 + ch] - first.mw[ch]);
      r += d * d;
    }
    residuals.push({ c, r });
  }
  residuals.sort((a, b) => a.r - b.r);
  const keep = new Set(residuals.slice(0, Math.max(8, Math.ceil(residuals.length * (1 - trimFrac)))).map((e) => e.c));
  return affineScoreCells(tpl, win, minCellOpacity, keep);
}

interface AffineFit extends AffineResult {
  a: number;
  mt: [number, number, number];
  mw: [number, number, number];
}

function affineScoreCells(tpl: Template, win: Float32Array, minCellOpacity: number, keep: Set<number> | null): AffineFit {
  const cells = tpl.opa.length;
  const skip = (c: number) => tpl.opa[c] < minCellOpacity || (keep !== null && !keep.has(c));
  // Pass 1: weighted means per channel.
  let weight = 0;
  const mt: [number, number, number] = [0, 0, 0];
  const mw: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < cells; c++) {
    if (skip(c)) continue;
    const o = tpl.opa[c];
    weight += o;
    for (let ch = 0; ch < 3; ch++) {
      mt[ch] += o * tpl.grid[c * 3 + ch];
      mw[ch] += o * win[c * 3 + ch];
    }
  }
  if (weight === 0) return { score: Infinity, corr: 0, a: 1, mt, mw };
  for (let ch = 0; ch < 3; ch++) {
    mt[ch] /= weight;
    mw[ch] /= weight;
  }
  // Pass 2: pooled covariance/variances for the shared gain + correlation.
  let cov = 0;
  let varT = 0;
  let varW = 0;
  for (let c = 0; c < cells; c++) {
    if (skip(c)) continue;
    const o = tpl.opa[c];
    for (let ch = 0; ch < 3; ch++) {
      const dt = tpl.grid[c * 3 + ch] - mt[ch];
      const dw = win[c * 3 + ch] - mw[ch];
      cov += o * dt * dw;
      varT += o * dt * dt;
      varW += o * dw * dw;
    }
  }
  if (varT < 1e-6 || varW < 1e-6) return { score: Infinity, corr: 0, a: 1, mt, mw };
  const corr = cov / Math.sqrt(varT * varW);
  // Fades below ~45% visibility don't happen; a tighter clamp stops the fit
  // from crushing a structured template flat to match smooth backgrounds.
  const a = Math.min(1.4, Math.max(0.45, cov / varT));
  // Pass 3: residual.
  let sse = 0;
  for (let c = 0; c < cells; c++) {
    if (skip(c)) continue;
    const o = tpl.opa[c];
    for (let ch = 0; ch < 3; ch++) {
      const r = a * (tpl.grid[c * 3 + ch] - mt[ch]) - (win[c * 3 + ch] - mw[ch]);
      sse += o * r * r;
    }
  }
  return { score: Math.sqrt(sse / (weight * 3)), corr: Math.max(0, corr), a, mt, mw };
}

/**
 * Coarse per-template luminance shape vector for fast candidate scoring:
 * masked, unit-normalized deviations from the masked mean, on a downsampled
 * cw x ch grid. Correlating it against a window's luminance grid is exactly
 * gain/bias-invariant — faded sprites keep their shape.
 */
export interface CoarseShape {
  /** Downsampled cell indices (mask) and their normalized deviations. */
  idx: Int32Array;
  val: Float32Array;
}

export function coarseShape(tpl: Template, gw: number, gh: number, cw: number, ch: number): CoarseShape | null {
  const lum: number[] = [];
  const mask: number[] = [];
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      // average the fine cells that fall into this coarse cell
      let sum = 0;
      let w = 0;
      for (let fy = Math.floor((cy * gh) / ch); fy < Math.ceil(((cy + 1) * gh) / ch); fy++) {
        for (let fx = Math.floor((cx * gw) / cw); fx < Math.ceil(((cx + 1) * gw) / cw); fx++) {
          const c = fy * gw + fx;
          if (tpl.opa[c] < MIN_CELL_OPACITY) continue;
          const i = c * 3;
          sum += tpl.opa[c] * (0.299 * tpl.grid[i] + 0.587 * tpl.grid[i + 1] + 0.114 * tpl.grid[i + 2]);
          w += tpl.opa[c];
        }
      }
      if (w > 0) {
        mask.push(cy * cw + cx);
        lum.push(sum / w);
      }
    }
  }
  if (mask.length < 4) return null;
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  let norm = 0;
  const dev = lum.map((l) => {
    const d = l - mean;
    norm += d * d;
    return d;
  });
  if (norm < 1e-6) return null; // flat luminance — indistinct
  const inv = 1 / Math.sqrt(norm);
  return { idx: Int32Array.from(mask), val: Float32Array.from(dev.map((d) => d * inv)) };
}

/**
 * Masked cosine correlation between a template's coarse shape and a window's
 * coarse luminance grid (-1..1, higher = more similar in shape).
 */
export function shapeCorrelation(shape: CoarseShape, winLum: Float32Array): number {
  let mean = 0;
  for (let i = 0; i < shape.idx.length; i++) mean += winLum[shape.idx[i]];
  mean /= shape.idx.length;
  let dot = 0;
  let norm = 0;
  for (let i = 0; i < shape.idx.length; i++) {
    const d = winLum[shape.idx[i]] - mean;
    dot += shape.val[i] * d;
    norm += d * d;
  }
  return norm < 1e-6 ? 0 : dot / Math.sqrt(norm);
}

/** Coarse luminance grid of a window via the integral image. */
export function windowLumGrid(ii: IntegralImage, x: number, y: number, w: number, h: number, cw: number, ch: number, out: Float32Array): void {
  const W = ii.width + 1;
  for (let cy = 0; cy < ch; cy++) {
    const y0 = y + Math.floor((cy * h) / ch);
    const y1 = Math.max(y0 + 1, y + Math.floor(((cy + 1) * h) / ch));
    for (let cx = 0; cx < cw; cx++) {
      const x0 = x + Math.floor((cx * w) / cw);
      const x1 = Math.max(x0 + 1, x + Math.floor(((cx + 1) * w) / cw));
      const area = (x1 - x0) * (y1 - y0);
      out[cy * cw + cx] = (ii.lum[y1 * W + x1] - ii.lum[y0 * W + x1] - ii.lum[y1 * W + x0] + ii.lum[y0 * W + x0]) / area;
    }
  }
}
