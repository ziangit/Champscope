import { parseExportText } from "../scout/import";
import { queuedJSON, queuedText } from "../showdown/queue";
import { toID } from "../showdown/id";
import { vgcpastesCsvUrl, type VgcpastesSheetConfig } from "./config";
import { parseCSV } from "./csv";
import { storeImportedTeam, type StoreResult } from "./store";

/**
 * VGCPastes repository: Google Sheet (one tab per regulation) -> no-auth CSV
 * export -> pokepast.es/<id>/json -> set importer. Column layout verified
 * live 2026-07-06 (header row 3: Team ID / Full Name / Pokepaste / Date
 * Shared / Tournament / Rank / Link to Source / Owner / Replica Code).
 */

export interface VgcpastesEntry {
  teamId: string;
  pasteUrl: string;
  owner: string;
  fullName: string;
  dateShared?: string;
  event?: string;
  rank?: string;
  sourceLink?: string;
  rentalCode?: string;
}

const blank = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t === "" || t === "-" ? undefined : t;
};

/** Fetch + parse the sheet's CSV into entries (newest first, as the sheet is ordered). */
export async function listVgcpastesEntries(cfg: VgcpastesSheetConfig): Promise<VgcpastesEntry[]> {
  const text = await queuedText(vgcpastesCsvUrl(cfg));
  const rows = parseCSV(text);
  const headerIdx = rows.findIndex((r) => r.includes("Team ID") && r.includes("Pokepaste"));
  if (headerIdx < 0) throw new Error("VGCPastes CSV: header row not found — sheet layout changed?");
  const header = rows[headerIdx];
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const c = {
    teamId: col("Team ID"),
    fullName: col("Full Name"),
    paste: col("Pokepaste"),
    dateShared: col("Date Shared"),
    event: col("Tournament / Event"),
    rank: col("Rank"),
    sourceLink: col("Link to Source"),
    owner: col("Owner"),
    rentalCode: col("Replica Code"),
  };
  const entries: VgcpastesEntry[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const teamId = blank(row[c.teamId]);
    const pasteUrl = blank(row[c.paste]);
    if (!teamId || !pasteUrl || !/pokepast\.es\/[0-9a-f]+/i.test(pasteUrl)) continue;
    entries.push({
      teamId,
      pasteUrl,
      owner: blank(row[c.owner]) ?? "",
      fullName: blank(row[c.fullName]) ?? "",
      dateShared: blank(row[c.dateShared]),
      event: blank(row[c.event]),
      rank: blank(row[c.rank]),
      sourceLink: blank(row[c.sourceLink]),
      rentalCode: blank(row[c.rentalCode]),
    });
  }
  return entries;
}

/** Canonical paste URL = the dedupe key. */
export function pasteKey(pasteUrl: string): string {
  const m = pasteUrl.match(/pokepast\.es\/([0-9a-f]+)/i);
  return m ? `https://pokepast.es/${m[1].toLowerCase()}` : pasteUrl;
}

interface PokepasteJSON {
  author: string | null;
  notes: string | null;
  paste: string;
  title: string | null;
}

/** Fetch one paste and store it as an imported team. */
export async function ingestVgcpastesEntry(entry: VgcpastesEntry, cfg: VgcpastesSheetConfig): Promise<StoreResult> {
  const key = pasteKey(entry.pasteUrl);
  const paste = await queuedJSON<PokepasteJSON>(`${key}/json`);
  const roster = parseExportText(paste.paste);
  if (roster.length === 0) throw new Error(`empty/unparseable paste: ${key}`);

  const credited = entry.owner || entry.fullName || "vgcpastes";
  const sharedMs = entry.dateShared ? Date.parse(entry.dateShared) : NaN;
  return await storeImportedTeam({
    formatId: cfg.formatId,
    origin: "paste",
    userId: toID(credited) || "vgcpastes",
    displayName: entry.fullName || entry.owner || "VGCPastes",
    roster,
    source: {
      key,
      url: key,
      kind: "paste",
      link: entry.sourceLink,
      event: entry.event,
      placing: entry.rank ? Number(entry.rank.replace(/\D/g, "")) || undefined : undefined,
      rentalCode: entry.rentalCode,
      creator: entry.fullName || entry.owner || undefined,
      sharedAt: Number.isFinite(sharedMs) ? Math.floor(sharedMs / 1000) : undefined,
    },
  });
}
