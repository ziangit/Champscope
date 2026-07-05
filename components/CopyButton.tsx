"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy export" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded border border-line bg-card px-2 py-1 font-mono text-xs text-steel hover:border-steel hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
