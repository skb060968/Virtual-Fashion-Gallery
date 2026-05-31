/**
 * Dress_Meta — type, validation schema, and file loader for the
 * per-dress metadata stored in
 * `/public/images/shop/meta/<slug>/meta.json`.
 *
 * `loadDressMeta` is intended for build-time use only (Next.js Server
 * Components / generateStaticParams). It reads the JSON file via
 * `fs/promises` and validates it through Zod, returning `null` on any
 * failure so callers can surface a 404 cleanly.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema & type
// ---------------------------------------------------------------------------

export const DRESS_CATEGORIES = ["KIDSWEAR", "MENSWEAR", "WOMENSWEAR"] as const;
export type DressCategory = (typeof DRESS_CATEGORIES)[number];

export const DressMetaSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(DRESS_CATEGORIES),
});

export type DressMeta = z.infer<typeof DressMetaSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true iff the given record id belongs to a dress entry
 * (matches the pattern `<digits>dress`, e.g. "1dress", "22dress").
 * The designer record and any other non-dress ids return false.
 */
export function isDressRecord(id: string): boolean {
  return /^\d+dress$/.test(id);
}

// ---------------------------------------------------------------------------
// File loader (build-time / Node.js only)
// ---------------------------------------------------------------------------

/**
 * Read and validate the `meta.json` for the given dress slug.
 *
 * Resolves the file at:
 *   `<project-root>/public/images/shop/meta/<slug>/meta.json`
 *
 * Returns the validated `DressMeta` on success, or `null` if:
 *   - the file does not exist (ENOENT)
 *   - the JSON is malformed
 *   - the parsed object fails Zod validation
 *
 * Callers should treat `null` as a 404 signal.
 */
export async function loadDressMeta(slug: string): Promise<DressMeta | null> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const filePath = join(
    process.cwd(),
    "public",
    "images",
    "shop",
    "meta",
    slug,
    "meta.json",
  );

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = DressMetaSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
