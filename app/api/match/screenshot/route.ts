import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import icons from "@/data/cv/icons.json";
import gen5 from "@/data/cv/gen5.json";
import ani from "@/data/cv/ani.json";
import dex from "@/data/cv/dex.json";
import { recognizeTeam, type TemplateSets } from "@/lib/cv/recognize";
import type { TemplateSet } from "@/lib/cv/signature";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** Screenshots only (photos are out of scope); anything bigger is not a screenshot. */
const MAX_BYTES = 8 * 1024 * 1024;
/** Downscale very large screenshots — sprites stay well above template scale. */
const MAX_WIDTH = 1800;

const sets: TemplateSets = { icons: icons as TemplateSet, gen5: gen5 as TemplateSet, ani: ani as TemplateSet, dex: dex as TemplateSet };

/**
 * POST { image: "data:image/png;base64,..." } -> tiered species extraction.
 * The image is processed in memory and never persisted; recognition is
 * classical sprite matching (no LLM, no external calls). All failure modes
 * (artwork, photos, unrelated images, undecodable input) return the same
 * recognized:false result.
 */
export async function POST(req: NextRequest) {
  let body: { image?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected JSON body { image: dataURL }" }, { status: 400 });
  }
  const dataUrl = body.image ?? "";
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/") || comma < 0) {
    return NextResponse.json({ error: "image must be a data URL" }, { status: 400 });
  }
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "image empty or too large (8 MB max)" }, { status: 400 });
  }

  try {
    const img = sharp(bytes, { limitInputPixels: 4000 * 4000 });
    const meta = await img.metadata();
    const resized = meta.width && meta.width > MAX_WIDTH ? img.resize({ width: MAX_WIDTH }) : img;
    const { data, info } = await resized.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const result = recognizeTeam({ width: info.width, height: info.height, data }, sets);
    return NextResponse.json(result);
  } catch {
    // Undecodable input is just another face of "not a screenshot".
    return NextResponse.json({ recognized: false, tier: "none", species: [] });
  }
}
