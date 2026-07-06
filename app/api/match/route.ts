import { NextResponse, type NextRequest } from "next/server";
import { matchTeams, parsePreviewSpecies } from "@/lib/match";

export const dynamic = "force-dynamic";

/**
 * GET /api/match?format=<formatId>&species=<input>
 * `species` accepts a comma-separated list OR URL-encoded Showdown export /
 * pokepaste text; any spelling is normalized to base-forme ids.
 * Returns { queryIds, exact, partial } — see lib/match.ts.
 */
export async function GET(req: NextRequest) {
  const formatId = req.nextUrl.searchParams.get("format");
  const species = parsePreviewSpecies(req.nextUrl.searchParams.get("species") ?? "");
  if (!formatId || species.length === 0) {
    return NextResponse.json({ error: "format and species (comma-separated) are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await matchTeams(formatId, species));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
