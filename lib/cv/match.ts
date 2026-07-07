import { buildEdgeIntegral, detectSpriteBoxes, edgeCount, type DetectOptions } from "./detect";
import {
  affineScore,
  buildIntegral,
  coarseShape,
  MIN_CELL_OPACITY,
  shapeCorrelation,
  windowGrid,
  windowLumGrid,
  type CoarseShape,
  type IntegralImage,
  type RGBAImage,
  type Template,
  type TemplateSet,
} from "./signature";

/**
 * Sprite classification (pure, no I/O), built on one strong domain fact:
 * every sprite in a screenshot is rendered at the SAME global scale, and
 * sprites in a preview row share their row height. So instead of sweeping
 * generic windows, each template is evaluated at its own native aspect,
 * sized by shared-height hypotheses derived from the detected boxes, at a
 * few anchored positions per box (sprites share baselines). Scoring is the
 * affine fit (shared gain + per-channel bias — the alpha-blend model) with
 * a mirrored variant (the player's side of the field renders flipped),
 * gated by score, structural correlation, and a decisive-winner margin.
 * Images that match nothing — artwork, photos, unrelated screenshots —
 * produce no hits: that IS the "not recognized" path.
 */

export interface SpriteHit {
  id: string;
  name: string;
  score: number; // affine residual RMSE, lower = stronger
  corr: number; // structural correlation at the accepted alignment
  source: string; // which template set produced the hit
  /** True when the hit came from grid completion (relaxed gates on a slot
   * the layout says must contain a sprite) — review-worthy. */
  inferred?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClassifyOptions {
  /** Default accept gates (overridable per set). */
  maxScore?: number;
  minCorr?: number;
  /** Luminance-shape prefilter floor per evaluation. */
  minSweepCorr?: number;
  /** Species refined per box. */
  refineTop?: number;
  /** Skip templates with fewer opaque cells than this fraction. */
  minCoverage?: number;
  /** Anti-fragment gate: the winner must beat the runner-up species by this
   * refined-score ratio (fragments/texture fit many templates about equally;
   * a true sprite is decisively best). */
  maxMargin?: number;
  detect?: DetectOptions;
  /** Diagnostic sink: receives each box's refined ranking. */
  debug?: (info: { box: Rect; refined: { id: string; score: number; corr: number; rect: Rect }[] }) => void;
}

const DEFAULTS: Required<Omit<ClassifyOptions, "detect" | "debug">> = {
  maxScore: 15,
  minCorr: 0.8,
  minSweepCorr: 0.5,
  refineTop: 14,
  minCoverage: 0.3,
  maxMargin: 0.85,
};

export interface LabeledSet {
  set: TemplateSet;
  source: string;
  /** Per-set accept overrides (icon renders are near-exact; battle sprites
   * suffer neighbor overlap and antialiasing, so they run looser). */
  maxScore?: number;
  minCorr?: number;
}

interface Prepared {
  t: Template;
  source: string;
  maxScore: number;
  minCorr: number;
  shape: CoarseShape;
  /** Low-structure "blob" artwork (Ditto, cocoons…) fits too many things —
   * such templates face much stricter accept gates. */
  blob: boolean;
}

function lumStdev(t: Template): number {
  let n = 0,
    s = 0,
    s2 = 0;
  for (let c = 0; c < t.opa.length; c++) {
    if (t.opa[c] < MIN_CELL_OPACITY) continue;
    const l = 0.299 * t.grid[c * 3] + 0.587 * t.grid[c * 3 + 1] + 0.114 * t.grid[c * 3 + 2];
    n++;
    s += l;
    s2 += l * l;
  }
  if (n === 0) return 0;
  const mean = s / n;
  return Math.sqrt(Math.max(0, s2 / n - mean * mean));
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Scored extends Rect {
  t: Prepared;
  score: number;
  corr: number;
  inferred?: boolean;
}

function overlapFrac(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
}

/** Discrete global rendering scales: browser zoom x device pixel ratio.
 * Every sprite in one screenshot shares one of these. */
const GLOBAL_SCALES = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5];

/** Quantize window dims so templates with similar sizes share cached grids. */
const q4 = (v: number) => Math.max(16, Math.round(v / 4) * 4);

/** Cached window summaries so many templates share one rect computation. */
class WindowCache {
  private grids = new Map<string, { win: Float32Array; mir: Float32Array; lum: Float32Array; lumMir: Float32Array }>();
  constructor(
    private ii: IntegralImage,
    private gw: number,
    private gh: number,
  ) {}

  get(r: Rect) {
    const key = `${r.x},${r.y},${r.w},${r.h}`;
    let e = this.grids.get(key);
    if (!e) {
      const { gw, gh } = this;
      const win = new Float32Array(gw * gh * 3);
      const lum = new Float32Array(gw * gh);
      windowGrid(this.ii, r.x, r.y, r.w, r.h, gw, gh, win);
      windowLumGrid(this.ii, r.x, r.y, r.w, r.h, gw, gh, lum);
      const mir = new Float32Array(gw * gh * 3);
      const lumMir = new Float32Array(gw * gh);
      for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
          const a = (cy * gw + cx) * 3;
          const b = (cy * gw + (gw - 1 - cx)) * 3;
          mir[b] = win[a];
          mir[b + 1] = win[a + 1];
          mir[b + 2] = win[a + 2];
          lumMir[cy * gw + (gw - 1 - cx)] = lum[cy * gw + cx];
        }
      }
      e = { win, mir, lum, lumMir };
      this.grids.set(key, e);
    }
    return e;
  }
}

/** Detect candidate regions and classify against all template sets. */
export function classifyImage(img: RGBAImage, sets: LabeledSet[], opts?: ClassifyOptions): SpriteHit[] {
  const o = { ...DEFAULTS, ...opts };
  const boxes = detectSpriteBoxes(img, opts?.detect);
  if (boxes.length === 0) return [];
  const ii = buildIntegral(img);

  // Prepare templates: coverage filter + luminance shapes (prefilter vectors).
  const prepared: Prepared[] = [];
  let gw = 0,
    gh = 0;
  for (const { set, source, maxScore, minCorr } of sets) {
    gw = set.gw;
    gh = set.gh;
    const cells = set.gw * set.gh;
    for (const t of set.templates) {
      let covered = 0;
      for (const op of t.opa) if (op >= MIN_CELL_OPACITY) covered++;
      if (covered / cells < o.minCoverage) continue;
      const shape = coarseShape(t, set.gw, set.gh, set.gw, set.gh);
      if (!shape) continue;
      const blob = lumStdev(t) < 30;
      const ms = maxScore ?? o.maxScore;
      const mc = minCorr ?? o.minCorr;
      prepared.push({ t, source, maxScore: blob ? Math.min(ms, 5.5) : ms, minCorr: blob ? Math.max(mc, 0.92) : mc, shape, blob });
    }
  }
  if (prepared.length === 0) return [];
  const cache = new WindowCache(ii, gw, gh);
  // A genuine sprite window is dense with pixel-art edges; windows hanging
  // over background are not — gate every hypothesis on edge density.
  const edges = buildEdgeIntegral(img);
  const denseEnough = (x: number, y: number, w: number, h: number) => edgeCount(edges, x, y, w, h) >= Math.max(100, w * h * 0.05);

  const accepted: Scored[] = [];
  for (const box of boxes) {
    // Base pass: every template at its own aspect, sized by each global
    // scale, positioned across the box (touching sprites detect as one
    // cluster, so windows slide within it).
    const bySpecies = new Map<string, { p: Prepared; score: number; rect: Rect }>();
    for (const p of prepared) {
      for (const g of GLOBAL_SCALES) {
        const w = q4(p.t.bw * g);
        const h = q4(p.t.bh * g);
        if (w < 20 || h < 20 || w > img.width || h > img.height) continue;
        // The window must plausibly relate to the cluster: not (much) larger,
        // and at least roughly half its extent along one axis.
        if (h > box.h * 1.25 || w > box.w * 1.25) continue;
        if (h < box.h * 0.45 && w < box.w * 0.45) continue;
        // Detection under-crops sprites whose edges fade into the background,
        // so windows may extend past the box bounds by a fraction of their size.
        const padX = Math.round(w * 0.45);
        const padY = Math.round(h * 0.3);
        const xs: number[] = [];
        const x1 = box.x + box.w - w + padX;
        for (let x = box.x - padX; x <= x1 || x === box.x - padX; x += Math.max(6, Math.round(w / 4))) {
          xs.push(x);
          if (x >= x1) break;
        }
        const ys: number[] = [];
        const y1 = box.y + box.h - h + padY;
        for (let y = box.y - padY; y <= y1 || y === box.y - padY; y += Math.max(6, Math.round(h / 4))) {
          ys.push(y);
          if (y >= y1) break;
        }
        ys.push(box.y + box.h - h); // sprites share baselines — always try bottom-aligned
        for (const y0 of new Set(ys)) {
          for (const x0 of new Set(xs)) {
            const x = Math.min(Math.max(0, x0), img.width - w);
            const y = Math.min(Math.max(0, y0), img.height - h);
            if (!denseEnough(x, y, w, h)) continue;
            const win = cache.get({ x, y, w, h });
            const corr = Math.max(shapeCorrelation(p.shape, win.lum), shapeCorrelation(p.shape, win.lumMir));
            if (corr < o.minSweepCorr) continue;
            const fwd = affineScore(p.t, win.win);
            const rev = affineScore(p.t, win.mir);
            const s = Math.min(fwd.score, rev.score);
            if (!Number.isFinite(s)) continue;
            const cur = bySpecies.get(p.t.id);
            if (!cur || s < cur.score) bySpecies.set(p.t.id, { p, score: s, rect: { x, y, w, h } });
          }
        }
      }
    }
    if (bySpecies.size === 0) continue;
    // Grid-cell scores have a size-dependent floor (large windows average
    // more antialiasing), so small fragment fits out-score large truths.
    // Guarantee tall (row-height) hypotheses a seat alongside the raw top.
    const ranked = [...bySpecies.values()].sort((a, b) => a.score - b.score);
    const tall = ranked.filter((c) => c.rect.h >= box.h * 0.68);
    const contenders: { p: Prepared; score: number; rect: Rect }[] = [];
    for (const c of [...tall.slice(0, o.refineTop), ...ranked]) {
      if (contenders.some((s) => s.p.t.id === c.p.t.id && s.rect.x === c.rect.x && s.rect.y === c.rect.y)) continue;
      contenders.push(c);
      if (contenders.length >= o.refineTop * 2) break;
    }

    // Hill-climb every contender around its best rect with shrinking strides;
    // the refined ranking decides.
    const refined: Scored[] = [];
    for (const c of contenders) {
      // Score starts at Infinity: dx=dy=0/mul=1 re-evaluates the base rect
      // itself, so score and corr always come from a real evaluation.
      let best: Scored = { ...c.rect, t: c.p, score: Infinity, corr: 0 };
      for (const strideFrac of [0.1, 0.05, 0.025]) {
        const from = { x: best.x, y: best.y, w: best.w, h: best.h };
        for (const mul of [0.94, 1, 1.06]) {
          const w = Math.round(from.w * mul);
          const h = Math.round(from.h * mul);
          const stride = Math.max(1, Math.round(w * strideFrac));
          for (let dy = -stride; dy <= stride; dy += stride) {
            for (let dx = -stride; dx <= stride; dx += stride) {
              const x = from.x + dx + Math.round((from.w - w) / 2);
              const y = from.y + dy + Math.round((from.h - h) / 2);
              if (x < 0 || y < 0 || x + w > img.width || y + h > img.height || w < 16 || h < 16) continue;
              const g = cache.get({ x, y, w, h });
              const fwd = affineScore(c.p.t, g.win);
              const rev = affineScore(c.p.t, g.mir);
              const r = rev.score < fwd.score ? rev : fwd;
              if (r.score < best.score) best = { x, y, w, h, t: c.p, score: r.score, corr: r.corr };
            }
          }
        }
      }
      refined.push(best);
    }
    opts?.debug?.({ box, refined: refined.map((r) => ({ id: r.t.t.id, score: r.score, corr: r.corr, rect: { x: r.x, y: r.y, w: r.w, h: r.h } })) });
    // A merged cluster holds several sprites: greedily accept refined hits
    // that pass their gates, ordered by EXPLAINED EDGE MASS (fit quality x
    // edge pixels covered) so a genuine large sprite beats — and its NMS
    // suppresses — the small fragment fits inside it. The margin compares
    // against the best OTHER species contesting the same area.
    const mass = (r: Scored) => edgeCount(edges, r.x, r.y, r.w, r.h) * Math.max(0.05, 1 - r.score / (r.t.maxScore * 1.2));
    refined.sort((a, b) => mass(b) - mass(a));
    const taken: Scored[] = [];
    for (const hit of refined) {
      if (hit.score > hit.t.maxScore || hit.corr < hit.t.minCorr) continue;
      if (!denseEnough(hit.x, hit.y, hit.w, hit.h)) continue; // climbed onto background
      if (taken.some((k) => overlapFrac(k, hit) > 0.45)) continue;
      const rival = refined.find((r) => r.t.t.id !== hit.t.t.id && overlapFrac(r, hit) > 0.4 && r.w * r.h >= hit.w * hit.h * 0.5);
      const second = rival?.score ?? Infinity;
      if (hit.score <= 8 || hit.score / second <= o.maxMargin) taken.push(hit);
    }
    accepted.push(...taken);
  }

  // PASS 2 — scale-anchored rescan. The strongest pass-1 hit fixes the
  // global rendering scale for its template set (every sprite in one
  // screenshot shares it). With the scale known, each template has exactly
  // one window size, so a dense rescan is cheap and alignment is precise —
  // this recovers sprites whose scale hypotheses were missed or out-ranked
  // by fragments in pass 1.
  const anchorBySource = new Map<string, Scored>();
  for (const hit of accepted) {
    if (hit.score > 20 || hit.corr < 0.8) continue;
    const cur = anchorBySource.get(hit.t.source);
    if (!cur || hit.score < cur.score) anchorBySource.set(hit.t.source, hit);
  }
  for (const [source, anchor] of anchorBySource) {
    const g = anchor.h / anchor.t.t.bh;
    const rescued = new Map<string, Scored>();
    for (const p of prepared) {
      if (p.source !== source) continue;
      const w = q4(p.t.bw * g);
      const h = q4(p.t.bh * g);
      if (w < 20 || h < 20 || w > img.width || h > img.height) continue;
      for (const box of boxes) {
        if (h > box.h * 1.6 || w > box.w * 1.6) continue;
        const padX = Math.round(w * 0.45);
        const padY = Math.round(h * 0.35);
        const sx = Math.max(6, Math.round(w / 4));
        const sy = Math.max(6, Math.round(h / 4));
        for (let y0 = box.y - padY; y0 <= box.y + box.h - h + padY; y0 += sy) {
          for (let x0 = box.x - padX; x0 <= box.x + box.w - w + padX; x0 += sx) {
            const x = Math.min(Math.max(0, x0), img.width - w);
            const y = Math.min(Math.max(0, y0), img.height - h);
            if (!denseEnough(x, y, w, h)) continue;
            const win = cache.get({ x, y, w, h });
            const corr = Math.max(shapeCorrelation(p.shape, win.lum), shapeCorrelation(p.shape, win.lumMir));
            if (corr < o.minSweepCorr) continue;
            const fwd = affineScore(p.t, win.win);
            const rev = affineScore(p.t, win.mir);
            const s = Math.min(fwd.score, rev.score);
            if (!Number.isFinite(s)) continue;
            const cur = rescued.get(p.t.id);
            if (!cur || s < cur.score) rescued.set(p.t.id, { x, y, w, h, t: p, score: s, corr: 0 });
          }
        }
      }
    }
    // Hill-climb the rescued species and admit those passing the gates.
    for (const c of [...rescued.values()].sort((a, b) => a.score - b.score).slice(0, 24)) {
      let best: Scored = { ...c, score: Infinity, corr: 0 };
      for (const strideFrac of [0.1, 0.05, 0.025]) {
        const from = { x: best.x, y: best.y, w: best.w, h: best.h };
        for (const mul of [0.94, 1, 1.06]) {
          const w = Math.round(from.w * mul);
          const h = Math.round(from.h * mul);
          const stride = Math.max(1, Math.round(w * strideFrac));
          for (let dy = -stride; dy <= stride; dy += stride) {
            for (let dx = -stride; dx <= stride; dx += stride) {
              const x = from.x + dx + Math.round((from.w - w) / 2);
              const y = from.y + dy + Math.round((from.h - h) / 2);
              if (x < 0 || y < 0 || x + w > img.width || y + h > img.height || w < 16 || h < 16) continue;
              const win = cache.get({ x, y, w, h });
              const fwd = affineScore(c.t.t, win.win);
              const rev = affineScore(c.t.t, win.mir);
              const r = rev.score < fwd.score ? rev : fwd;
              if (r.score < best.score) best = { x, y, w, h, t: c.t, score: r.score, corr: r.corr };
            }
          }
        }
      }
      if (best.score <= best.t.maxScore && best.corr >= best.t.minCorr && denseEnough(best.x, best.y, best.w, best.h)) {
        accepted.push(best);
      }
    }
  }

  // NMS by area (explained-mass order), then keep each species' best hit.
  accepted.sort((a, b) => edgeCount(edges, b.x, b.y, b.w, b.h) * (1 - b.score / (b.t.maxScore * 1.2)) - edgeCount(edges, a.x, a.y, a.w, a.h) * (1 - a.score / (a.t.maxScore * 1.2)));
  const kept: Scored[] = [];
  for (const hit of accepted) {
    if (kept.some((k) => overlapFrac(k, hit) > 0.4)) continue;
    kept.push(hit);
  }
  const bySpecies = new Map<string, Scored>();
  for (const hit of kept) {
    if (!bySpecies.has(hit.t.t.id)) bySpecies.set(hit.t.t.id, hit);
  }
  let final = [...bySpecies.values()];

  // GRID COMPLETION — team UIs lay sprites out on regular grids (side panel
  // 2x3, previews 1x6). With >=2 confident hits the grid is inferable: slots
  // without a hit MUST contain a sprite, so classify them with relaxed gates;
  // hits far off-grid (trainer sprites, decorations) get dropped.
  // Grid anchors must be STRICT finals: artwork also arranges subjects on
  // regular grids (the negative fixture is a 2x3 illustration!), so weaker
  // evidence anchoring a grid hallucinates teams on non-screenshots.
  const anchors = final.filter((h) => h.score <= 9 && h.corr >= 0.85 && !h.t.blob);
  if (anchors.length >= 2 && final.length <= 7) {
    const medW = median(anchors.map((h) => h.w));
    const medH = median(anchors.map((h) => h.h));
    const cols = axisPositions(anchors.map((h) => h.x + h.w / 2), medW * 0.5, img.width, 6);
    const rows = axisPositions(anchors.map((h) => h.y + h.h / 2), medH * 0.5, img.height, 3);
    if (cols.length >= 2 && cols.length * rows.length <= 12) {
      const cellW = Math.round(medW * 1.15);
      const cellH = Math.round(medH * 1.15);
      const cells: Rect[] = [];
      for (const cy of rows) {
        for (const cx of cols) {
          const x = Math.min(Math.max(0, Math.round(cx - cellW / 2)), img.width - cellW);
          const y = Math.min(Math.max(0, Math.round(cy - cellH / 2)), img.height - cellH);
          if (x < 0 || y < 0) continue;
          if (edgeCount(edges, x, y, cellW, cellH) < cellW * cellH * 0.03) continue; // empty slot region
          cells.push({ x, y, w: cellW, h: cellH });
        }
      }
      if (process.env.CV_DEBUG) console.log("grid:", { cols: cols.map(Math.round), rows: rows.map(Math.round), cells: cells.length });
      if (cells.length >= 4) {
        // Drop off-grid hits (e.g. the trainer sprite matching some ball).
        final = final.filter((h) => cells.some((c) => overlapFrac(h, c) > 0.35));
        // Fill empty cells with the best relaxed-gate species.
        for (const cell of cells) {
          if (final.some((h) => overlapFrac(h, cell) > 0.3)) continue;
          const filled = classifyCell(cell, prepared, cache, img, o);
          if (process.env.CV_DEBUG) console.log("cell", JSON.stringify(cell), "→", filled ? `${filled.t.t.id} ${filled.score.toFixed(1)} corr ${filled.corr.toFixed(2)}` : "none");
          if (filled && !final.some((h) => h.t.t.id === filled.t.t.id)) final.push(filled);
        }
      }
    }
  }

  return final.map((h) => ({
    id: h.t.t.id,
    name: h.t.t.name,
    score: Math.round(h.score * 10) / 10,
    corr: Math.round(h.corr * 100) / 100,
    source: h.t.source,
    inferred: h.inferred,
    x: h.x,
    y: h.y,
    w: h.w,
    h: h.h,
  }));
}

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Cluster 1D centers into grid positions, then extend the arithmetic
 * sequence across the image (hits reveal spacing; the grid runs further). */
function axisPositions(centers: number[], tol: number, limit: number, maxPositions: number): number[] {
  const sorted = [...centers].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const c of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && c - last[last.length - 1] <= tol) last.push(c);
    else clusters.push([c]);
  }
  let positions = clusters.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  if (positions.length >= 2) {
    const gaps = positions.slice(1).map((p, i) => p - positions[i]);
    const spacing = median(gaps);
    if (spacing > tol * 1.5) {
      // Fill interior gaps that are multiples of the spacing, then extend outward.
      const filled: number[] = [positions[0]];
      for (let i = 1; i < positions.length; i++) {
        const gap = positions[i] - filled[filled.length - 1];
        const steps = Math.round(gap / spacing);
        for (let k = 1; k < steps; k++) filled.push(filled[filled.length - 1] + spacing);
        filled.push(positions[i]);
      }
      positions = filled;
      while (positions.length < maxPositions && positions[0] - spacing > tol) positions.unshift(positions[0] - spacing);
      while (positions.length < maxPositions && positions[positions.length - 1] + spacing < limit - tol) positions.push(positions[positions.length - 1] + spacing);
    }
  }
  return positions.slice(0, maxPositions);
}

/** Best species for a slot the grid says must hold a sprite (relaxed gates). */
function classifyCell(cell: Rect, prepared: Prepared[], cache: WindowCache, img: RGBAImage, o: Required<Omit<ClassifyOptions, "detect" | "debug">>): Scored | null {
  const cellAr = cell.w / cell.h;
  const base: { p: Prepared; score: number; corr: number }[] = [];
  for (const p of prepared) {
    if (p.t.ar > cellAr * 2 || p.t.ar < cellAr / 2) continue;
    // Sprites sit at unknown size within the slot — base-rank each template
    // across a small size ladder (quantized so rects share the cache).
    let bestR: { score: number; corr: number } | null = null;
    for (const mul of [0.7, 0.85, 1]) {
      const w = q4(cell.w * mul);
      const h = q4(w / p.t.ar);
      const x = Math.max(0, cell.x + Math.round((cell.w - w) / 2));
      const y = Math.max(0, cell.y + Math.round((cell.h - h) / 2));
      if (x + w > img.width || y + h > img.height) continue;
      const g = cache.get({ x, y, w, h });
      const fwd = affineScore(p.t, g.win);
      const rev = affineScore(p.t, g.mir);
      const r = rev.score < fwd.score ? rev : fwd;
      if (Number.isFinite(r.score) && (!bestR || r.score - r.corr * 10 < bestR.score - bestR.corr * 10)) bestR = r;
    }
    if (bestR) base.push({ p, score: bestR.score, corr: bestR.corr });
  }
  // At the (misaligned) cell rect, correlation ranks the right structure
  // higher than raw score does — refine the union of both top lists.
  // Cells are few (<=8 per image), so the contender pool can be deep: base
  // misalignment hides the true template far down the ranking (observed rank
  // ~130 for a match that refines to score 8 / corr 0.9).
  const contenders: typeof base = [];
  const pushTop = (sorted: typeof base) => {
    let added = 0;
    for (const b of sorted) {
      if (contenders.some((c) => c.p.t.id === b.p.t.id)) continue;
      contenders.push(b);
      if (++added >= 80) break;
    }
  };
  pushTop([...base].sort((a, b) => a.score - b.score));
  pushTop([...base].sort((a, b) => b.corr - a.corr));
  pushTop([...base].filter((b) => !b.p.blob).sort((a, b) => b.corr - a.corr));
  // Per-set corr rankings too — one artwork set usually dominates a surface,
  // and cross-set noise can crowd the union lists.
  for (const src of new Set(base.map((b) => b.p.source))) {
    pushTop(base.filter((b) => b.p.source === src).sort((a, b) => b.corr - a.corr));
  }
  if (process.env.CV_DEBUG) {
    const byCorr = [...base].sort((a, b) => b.corr - a.corr);
    for (const id of ["incineroar", "gholdengo", "ninetalesalola"]) {
      const i = byCorr.findIndex((b) => b.p.t.id === id);
      if (i >= 0) console.log(`  base rank of ${id}: corr-rank ${i} (corr ${byCorr[i].corr.toFixed(2)}, score ${byCorr[i].score.toFixed(1)}, set ${byCorr[i].p.source})`);
    }
  }
  // Best VALID candidate: correlation is the hard requirement (the slot
  // demonstrably holds a sprite), then lowest score among those passing.
  let best: Scored | null = null;
  for (const c of contenders) {
    for (const strideFrac of [0.12, 0.06, 0.03]) {
      for (const mul of [0.68, 0.76, 0.85, 0.94, 1, 1.08]) {
        const w = Math.round(cell.w * mul);
        const h = Math.round(w / c.p.t.ar); // window follows the template's aspect
        const stride = Math.max(1, Math.round(w * strideFrac));
        for (let dy = -stride; dy <= stride; dy += stride) {
          for (let dx = -stride; dx <= stride; dx += stride) {
            const x = cell.x + dx + Math.round((cell.w - w) / 2);
            const y = cell.y + dy + Math.round((cell.h - h) / 2);
            if (x < 0 || y < 0 || x + w > img.width || y + h > img.height || w < 14 || h < 14) continue;
            const win = cache.get({ x, y, w, h });
            const fwd = affineScore(c.p.t, win.win);
            const rev = affineScore(c.p.t, win.mir);
            const r = rev.score < fwd.score ? rev : fwd;
            if (r.corr < 0.68 || r.score > 40) continue;
            if (!best || r.score < best.score) best = { x, y, w, h, t: c.p, score: r.score, corr: r.corr, inferred: true };
          }
        }
      }
    }
  }
  if (process.env.CV_DEBUG) console.log("  cell best valid:", best ? `${best.t.t.id} ${best.score.toFixed(1)} corr ${best.corr.toFixed(2)}` : "none");
  return best;
}
