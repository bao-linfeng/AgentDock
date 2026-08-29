/** Serialize a nullable `Date` column to an ISO string (or `undefined`). */
export function toIso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}
