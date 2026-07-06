import { NextResponse, type NextRequest } from "next/server";
import { matchTeams } from "@/lib/match";

export const dynamic = "force-dynamic";

/**
 * GET /api/match?format=<formatId>&species=a,b,c,d,e,f
 * Species accept any spelling (display names or ids); they are normalized to
 * base-forme ids. Returns { queryIds, exact, partial } — see lib/match.ts.
 */
export async function GET(req: NextRequest) {
  const formatId = req.nextUrl.searchParams.get("format");
  const species = (req.nextUrl.searchParams.get("species") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!formatId || species.length === 0) {
    return NextResponse.json({ error: "format and species (comma-separated) are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await matchTeams(formatId, species));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
