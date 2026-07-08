import Link from "next/link";

/** Prev/next pager that preserves the whole query string. */
export function Pager({ page, pages, param, path, params }: { page: number; pages: number; param: string; path: string; params: Record<string, string | undefined> }) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set(param, String(p));
    return `${path}?${q.toString()}`;
  };
  return (
    <div className="flex select-none items-center gap-3 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="rounded border border-line bg-card px-3 py-1 text-steel hover:text-ink">
          ← Prev
        </Link>
      ) : (
        <span className="rounded border border-line px-3 py-1 text-steel/40">← Prev</span>
      )}
      <span className="font-mono text-xs text-steel">
        page {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="rounded border border-line bg-card px-3 py-1 text-steel hover:text-ink">
          Next →
        </Link>
      ) : (
        <span className="rounded border border-line px-3 py-1 text-steel/40">Next →</span>
      )}
    </div>
  );
}

export const clampPage = (raw: string | undefined, pages: number) => Math.min(Math.max(1, Number(raw) || 1), Math.max(1, pages));
