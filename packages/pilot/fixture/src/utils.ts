/**
 * String utility functions.
 * NOTE: slugify() is intentionally absent — it is the pilot task.
 */

/** Capitalizes the first character of a string. */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Truncates a string to maxLen characters, appending '...' if cut. */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

/** Converts a string to camelCase. */
export function camelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase());
}
