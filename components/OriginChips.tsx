import Link from "next/link";
import type { TeamProfileRow } from "@/lib/queries";

/**
 * Origin filter chips. "Ladder" vs "Unrated" splits replay-origin teams by
 * whether any of their games were rated — an unrated game is not ladder
 * evidence. Chips are links that set ?origin= while preserving other params.
 */

// Tailwind needs literal class strings, so each chip carries its own set.
export const ORIGIN_CHIPS = [
  { value: "", label: "All", dot: "bg-ink", active: "bg-ink text-paper shadow-sm" },
  { value: "ladder", label: "Ladder", dot: "bg-accent", active: "bg-accent text-white shadow-sm" },
  { value: "unrated", label: "Unrated", dot: "bg-amber-500", active: "bg-amber-600 text-white shadow-sm" },
  { value: "paste", label: "Pastes", dot: "bg-emerald-500", active: "bg-emerald-600 text-white shadow-sm" },
  { value: "tournament", label: "Tournament", dot: "bg-violet-500", active: "bg-violet-600 text-white shadow-sm" },
] as const;

export type OriginChip = (typeof ORIGIN_CHIPS)[number]["value"];

export function chipValue(raw: string | undefined): OriginChip {
  return ORIGIN_CHIPS.some((c) => c.value === raw) ? (raw as OriginChip) : "";
}

/** Apply a chip filter to already-fetched rows. */
export function filterByChip(teams: TeamProfileRow[], chip: OriginChip): TeamProfileRow[] {
  const rated = (t: TeamProfileRow) => (t.merged_reveals.replays ?? []).some((r) => r.rating !== null);
  switch (chip) {
    case "ladder":
      return teams.filter((t) => (t.origin ?? "replay") === "replay" && rated(t));
    case "unrated":
      return teams.filter((t) => (t.origin ?? "replay") === "replay" && !rated(t));
    case "paste":
      return teams.filter((t) => t.origin === "paste");
    case "tournament":
      return teams.filter((t) => t.origin === "tournament");
    default:
      return teams;
  }
}

/** Per-chip team counts over an unfiltered list. */
export function chipCounts(teams: TeamProfileRow[]): Record<OriginChip, number> {
  const counts = {} as Record<OriginChip, number>;
  for (const c of ORIGIN_CHIPS) counts[c.value] = filterByChip(teams, c.value).length;
  return counts;
}

export function OriginChips({
  path,
  params,
  current,
  counts,
}: {
  path: string;
  params: Record<string, string | undefined>;
  current: OriginChip;
  counts?: Record<OriginChip, number>;
}) {
  const href = (value: OriginChip) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (value) q.set("origin", value);
    else q.delete("origin");
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {ORIGIN_CHIPS.map((c) => {
        const active = c.value === current;
        return (
          <Link
            key={c.value}
            href={href(c.value)}
            className={`inline-flex select-none items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wide transition-colors ${
              active ? c.active : "border border-line bg-card text-ink/80 hover:border-steel hover:bg-paper"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white/80" : c.dot}`} />
            {c.label}
            {counts && (
              <span className={`font-mono text-[10px] font-normal tabular-nums ${active ? "text-white/75" : "text-steel"}`}>{counts[c.value]}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
