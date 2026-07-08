import Link from "next/link";
import type { TeamProfileRow } from "@/lib/queries";

/**
 * Origin filter chips. "Ladder" vs "Unrated" splits replay-origin teams by
 * whether any of their games were rated — an unrated game is not ladder
 * evidence. Chips are links that set ?origin= while preserving other params.
 */

export const ORIGIN_CHIPS = [
  { value: "", label: "All" },
  { value: "ladder", label: "Ladder" },
  { value: "unrated", label: "Unrated" },
  { value: "paste", label: "Pastes" },
  { value: "tournament", label: "Tournament" },
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

export function OriginChips({ path, params, current }: { path: string; params: Record<string, string | undefined>; current: OriginChip }) {
  const href = (value: OriginChip) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (value) q.set("origin", value);
    else q.delete("origin");
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  };
  return (
    <div className="flex flex-wrap gap-2">
      {ORIGIN_CHIPS.map((c) => (
        <Link
          key={c.value}
          href={href(c.value)}
          className={
            c.value === current
              ? "rounded-full bg-accent px-3 py-1 font-display text-xs font-semibold uppercase tracking-wide text-white"
              : "rounded-full border border-line bg-card px-3 py-1 font-display text-xs font-semibold uppercase tracking-wide text-steel hover:border-steel hover:text-ink"
          }
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}
