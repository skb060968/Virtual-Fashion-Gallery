/**
 * Sketch_Record — single typed entry in the Sketch_Catalog (Requirement 8).
 *
 * Field bounds and shapes are enforced at build/startup by `assertSketchCatalog`,
 * which is invoked at module top level from `lib/sketches.ts` so any violation
 * aborts both `next build` and server startup with a diagnostic identifying the
 * offending `id` and field.
 */

export type SketchRecord = {
  /** Stable identifier; pairwise distinct across the catalogue. 1–64 chars. */
  id: string;
  /** Human-readable display title. 1–120 chars. */
  title: string;
  /** ISO 8601 calendar date YYYY-MM-DD. */
  date: string;
  /** Medium descriptor, e.g. "graphite on paper". 1–80 chars. */
  medium: string;
  /** Long-form description. 0–2000 chars. Empty string suppresses the field in panels. */
  description: string;
  /** "/sketches/foo.jpg" under /public, or "https://..." absolute URL. */
  imageSrc: string;
};

/**
 * Field length bounds for a Sketch_Record. The bounds are inclusive on both
 * ends (so `id.min = 1` means the empty string is rejected, and `id.max = 64`
 * accepts a string of exactly 64 characters).
 */
export const SKETCH_BOUNDS = {
  id: { min: 1, max: 64 },
  title: { min: 1, max: 120 },
  medium: { min: 1, max: 80 },
  description: { min: 0, max: 2000 },
} as const;

/** `^/.+` (relative path under /public) OR `^https://.+` (absolute URL). */
const IMAGE_SRC_RE = /^(?:\/.+|https:\/\/.+)$/;

/** Strict `YYYY-MM-DD` shape; calendar validity is checked separately. */
const DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ValidateOk = { ok: true; value: SketchRecord };
export type ValidateErr = { ok: false; errors: Record<string, string> };
export type ValidateResult = ValidateOk | ValidateErr;

/**
 * Validate an unknown value against the Sketch_Record contract.
 *
 * Returns `{ ok: true, value }` if every field is present, of the right type,
 * within bounds, and conforms to its shape rule (date / imageSrc). Otherwise
 * returns `{ ok: false, errors }` where `errors` maps field names to a short
 * human-readable message. All failing fields are reported in a single pass so
 * the caller can surface them together.
 */
export function validateSketchRecord(value: unknown): ValidateResult {
  const errors: Record<string, string> = {};

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: { _root: "must be an object" } };
  }

  const record = value as Record<string, unknown>;

  // id
  if (typeof record.id !== "string") {
    errors.id = "must be a string";
  } else if (
    record.id.length < SKETCH_BOUNDS.id.min ||
    record.id.length > SKETCH_BOUNDS.id.max
  ) {
    errors.id = `length must be between ${SKETCH_BOUNDS.id.min} and ${SKETCH_BOUNDS.id.max} characters`;
  }

  // title
  if (typeof record.title !== "string") {
    errors.title = "must be a string";
  } else if (
    record.title.length < SKETCH_BOUNDS.title.min ||
    record.title.length > SKETCH_BOUNDS.title.max
  ) {
    errors.title = `length must be between ${SKETCH_BOUNDS.title.min} and ${SKETCH_BOUNDS.title.max} characters`;
  }

  // medium
  if (typeof record.medium !== "string") {
    errors.medium = "must be a string";
  } else if (
    record.medium.length < SKETCH_BOUNDS.medium.min ||
    record.medium.length > SKETCH_BOUNDS.medium.max
  ) {
    errors.medium = `length must be between ${SKETCH_BOUNDS.medium.min} and ${SKETCH_BOUNDS.medium.max} characters`;
  }

  // description
  if (typeof record.description !== "string") {
    errors.description = "must be a string";
  } else if (
    record.description.length < SKETCH_BOUNDS.description.min ||
    record.description.length > SKETCH_BOUNDS.description.max
  ) {
    errors.description = `length must be between ${SKETCH_BOUNDS.description.min} and ${SKETCH_BOUNDS.description.max} characters`;
  }

  // date — shape + calendar validity
  if (typeof record.date !== "string") {
    errors.date = "must be a string";
  } else if (!DATE_SHAPE_RE.test(record.date)) {
    errors.date = "must match YYYY-MM-DD";
  } else if (!isCalendarValidDate(record.date)) {
    errors.date = "must be a valid calendar date";
  }

  // imageSrc
  if (typeof record.imageSrc !== "string") {
    errors.imageSrc = "must be a string";
  } else if (!IMAGE_SRC_RE.test(record.imageSrc)) {
    errors.imageSrc = "must start with '/' or 'https://'";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: record as SketchRecord };
}

/**
 * `YYYY-MM-DD` is calendar-valid iff `Date.UTC(yyyy, mm-1, dd)` reconstructs the
 * same components after round-tripping through `Date`. This catches inputs like
 * `2023-02-30` or `2023-13-01` that match the shape regex but do not name a
 * real day.
 */
function isCalendarValidDate(s: string): boolean {
  const yyyy = Number(s.slice(0, 4));
  const mm = Number(s.slice(5, 7));
  const dd = Number(s.slice(8, 10));
  const ms = Date.UTC(yyyy, mm - 1, dd);
  if (Number.isNaN(ms)) return false;
  const d = new Date(ms);
  return (
    d.getUTCFullYear() === yyyy &&
    d.getUTCMonth() === mm - 1 &&
    d.getUTCDate() === dd
  );
}

/**
 * Validate the entire catalogue. Throws an `Error` whose message names the
 * offending `id` and field on the first violation it finds.
 *
 * Two failure classes:
 *   1. Per-record validation failure (delegates to `validateSketchRecord`).
 *   2. Pairwise duplicate `id` across records.
 *
 * Per-record violations are surfaced first (records are checked in array
 * order); duplicate ids are surfaced after every record passes individual
 * validation.
 */
export function assertSketchCatalog(
  records: ReadonlyArray<SketchRecord>,
): void {
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const result = validateSketchRecord(record);
    if (!result.ok) {
      const idLabel =
        record && typeof (record as { id?: unknown }).id === "string"
          ? (record as { id: string }).id
          : `<index ${i}>`;
      const [field, message] = Object.entries(result.errors)[0];
      throw new Error(
        `Invalid Sketch_Record id="${idLabel}": field "${field}" ${message}`,
      );
    }
  }

  const seen = new Map<string, number>();
  for (let i = 0; i < records.length; i++) {
    const id = records[i].id;
    const prior = seen.get(id);
    if (prior !== undefined) {
      throw new Error(
        `Duplicate Sketch_Record id="${id}" at indices ${prior} and ${i}`,
      );
    }
    seen.set(id, i);
  }
}
