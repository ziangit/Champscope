import Link from "next/link";
import type { TeamProfileRow } from "@/lib/queries";

/**
 * Origin filter chips. "Ladder" vs "Unrated" splits replay-origin teams by
 * whether any of their games were rated — an unrated game is not ladder
 * evidence. Chips are links that set ?origin= while preserving other params.
 */

// Tailwind needs literal class strings, so each chip carries its own pair.
export const ORIGIN_CHIPS = [
  { value: "", label: "All", active: "bg-ink text-paper", idle: "border-line text-steel hover:border-ink hover:text-ink" },
  { value: "ladder", label: "Ladder", active: "bg-accent text-white", idle: "border-accent/40 text-accent hover:border-accent" },
  { value: "unrated", label: "Unrated", active: "bg-amber-600 text-white", idle: "border-amber-600/40 text-amber-700 hover:border-amber-600" },
  { value: "paste", label: "Pastes", active: "bg-emerald-600 text-white", idle: "border-emerald-600/40 text-emerald-700 hover:border-emerald-600" },
  { value: "tournament", label: "Tournament", active: "bg-violet-600 text-white", idle: "border-violet-600/40 text-violet-700 hover:border-violet-600" },
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
          className={`rounded-full px-3 py-1 font-display text-xs font-semibold uppercase tracking-wide ${
            c.value === current ? c.active : `border bg-card ${c.idle}`
          }`}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}
