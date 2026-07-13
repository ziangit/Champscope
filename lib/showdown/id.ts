/**
 * Showdown's `toID()` convention: lowercase, strip all non-alphanumerics.
 * The single canonical implementation — never reimplement inline.
 */
export function toID(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Canonical replay id for a possibly password-suffixed one. Private replay
 * URLs end in `-<password>pw`; the replay server strips that suffix to look
 * up the replay (and its JSON reports the base id), so the suffixed form
 * must never be used as a database key. Public ids end in the numeric
 * battle number, so a trailing `pw` only ever means password.
 */
export function baseReplayId(id: string): string {
  return id.endsWith("pw") ? id.slice(0, id.lastIndexOf("-")) : id;
}
