"use client";

import { useRef, useState } from "react";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "done"; tier: string; names: string[] } | { kind: "error"; message: string };

/**
 * Screenshot upload for /match: reads the file locally, posts it to
 * /api/match/screenshot, and fills the species textarea with the extracted
 * team for the user to review/correct before matching. Digital screenshots
 * only — photos and artwork come back "not recognized" by design.
 */
export function ScreenshotInput({ textareaId }: { textareaId: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus({ kind: "busy" });
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("could not read file"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/match/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      const result = (await res.json()) as { recognized: boolean; tier: string; species: { name: string }[] };
      if (!result.recognized) {
        setStatus({ kind: "error", message: "Couldn't recognize a competitive team — upload a screenshot (not a photo or artwork), or type the species instead." });
        return;
      }
      const names = result.species.map((s) => s.name);
      const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
      if (textarea) textarea.value = names.join(", ");
      setStatus({ kind: "done", tier: result.tier, names });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "upload failed" });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="text-sm">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-line bg-card px-3 py-1.5 text-steel hover:text-ink">
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        {status.kind === "busy" ? "Reading screenshot…" : "Upload a Showdown screenshot"}
      </label>
      <span className="ml-2 rounded bg-accent/10 px-1 font-mono text-[10px] uppercase text-accent" title="Sprite recognition is precision-tuned: what it finds is reliable, but crowded battle previews may only be partially extracted — add the rest by hand.">
        experimental
      </span>
      {status.kind === "done" && (
        <p className="mt-1 text-xs text-steel">
          Found {status.names.length} Pokémon{status.tier === "partial" ? " — fewer than 4, add the rest before matching" : ""}: {status.names.join(", ")}. Review (recognition is best-effort), fix any misreads, then hit Match.
        </p>
      )}
      {status.kind === "error" && <p className="mt-1 text-xs text-loss">{status.message}</p>}
    </div>
  );
}
