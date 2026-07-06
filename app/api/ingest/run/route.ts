import { NextResponse, type NextRequest } from "next/server";
import { ingestTick } from "@/lib/sources/worker";

export const dynamic = "force-dynamic";
/** Vercel Hobby hard limit is 10 s; leave headroom to persist the cursor. */
export const maxDuration = 10;
const TIME_BUDGET_MS = 7000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const trigger = req.nextUrl.searchParams.get("trigger") ?? "adhoc";
  try {
    const result = await ingestTick(Date.now() + TIME_BUDGET_MS, trigger);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
