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
  return [...bySpecies.values()].map((h) => ({
    id: h.t.t.id,
    name: h.t.t.name,
    score: Math.round(h.score * 10) / 10,
    corr: Math.round(h.corr * 100) / 100,
    source: h.t.source,
    x: h.x,
    y: h.y,
    w: h.w,
    h: h.h,
  }));
}
