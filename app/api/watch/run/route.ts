import { NextResponse, type NextRequest } from "next/server";
import { watchTick } from "@/lib/watch";

export const dynamic = "force-dynamic";
/** Vercel Hobby hard limit is 10 s; leave headroom to persist the cursor. */
export const maxDuration = 10;
const TIME_BUDGET_MS = 7000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Vercel Cron sends no custom header we control; GH Actions passes ?trigger=gh.
  const trigger = req.nextUrl.searchParams.get("trigger") ?? "cron";
  try {
    const result = await watchTick(Date.now() + TIME_BUDGET_MS, trigger);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
