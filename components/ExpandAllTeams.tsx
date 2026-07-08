"use client";

/** Expand/collapse every team-card accordion on the page. */
export function ExpandAllTeams() {
  const setAll = (open: boolean) => {
    for (const d of document.querySelectorAll<HTMLDetailsElement>("details[data-team-card]")) d.open = open;
  };
  const cls = "rounded border border-line bg-card px-2.5 py-1 font-mono text-xs text-steel hover:border-steel hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <span className="inline-flex select-none gap-1.5">
      <button type="button" className={cls} onClick={() => setAll(true)}>
        Expand all
      </button>
      <button type="button" className={cls} onClick={() => setAll(false)}>
        Collapse all
      </button>
    </span>
  );
}
