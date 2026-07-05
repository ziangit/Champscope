/**
 * Showdown's `toID()` convention: lowercase, strip all non-alphanumerics.
 * The single canonical implementation — never reimplement inline.
 */
export function toID(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
