/**
 * Sketch_Catalog — single source of truth for the v1 Gallery_App.
 *
 * Per Requirement 8.1 every Sketch_Record consumed by the Gallery_App is
 * sourced from this module's `sketches` export. Per Requirement 13.2 future
 * upload-driven sources (e.g. NextAuth-protected designer uploads or signed
 * asset pipelines) replace this module's internals without touching any
 * Sketch_Frame consumer.
 *
 * Per Requirements 8.7 and 8.8 the catalogue is validated at module top level
 * by `assertSketchCatalog`. Because this file is statically imported during
 * `next build` and at server startup, any duplicate `id`, missing field,
 * out-of-bound value, or non-conformant `date` aborts the build/start with a
 * diagnostic identifying the offender.
 *
 * Per Requirement 8.6 the order of records in this array determines the order
 * in which Sketch_Frames are placed along the Walkthrough_Scene wall layout;
 * adding, editing, or removing entries requires no source changes outside
 * this file or its colocated types module (`./sketch-record.ts`).
 *
 * Catalogue contents:
 *   The 22-dress portfolio sourced from the GP Fashion shop catalogue.
 *   Each entry's `imageSrc` points at the dress's cover image under
 *   `/public/images/shop/items/<slug>/<slug>-cover.webp`. The companion
 *   asset directory (`/public/images/shop/items/<slug>/`) carries the full
 *   resolution renders; `/public/images/shop/thumbnails/<slug>/` holds the
 *   matching downsized previews.
 */

import { assertSketchCatalog, type SketchRecord } from "./sketch-record";

/**
 * Build a `SketchRecord` for one dress slug, deriving `imageSrc`,
 * `images`, and `thumbnails` from the slug + the count of alternate
 * views available on disk.
 *
 * File layout convention (see `/public/images/shop/`):
 *   /items/<slug>/<slug>-cover.webp        ← canonical primary
 *   /items/<slug>/<slug>-1.webp ... -N.webp ← alternate views
 *   /thumbnails/<slug>/<slug>-cover.webp   ← cover preview
 *   /thumbnails/<slug>/<slug>-1.webp ... -N.webp ← alternate previews
 *
 * `altCount` counts the alternate views (excluding the cover). The
 * helper builds `images` as `[cover, alt-1, alt-2, ..., alt-N]` so the
 * cover is always the first entry — which `validateSketchRecord`
 * requires (`images[0] === imageSrc`). The thumbnail array follows the
 * same order so `images[i]` and `thumbnails[i]` always describe the
 * same view.
 *
 * `altCount === 0` collapses to a single-image record (cover only).
 */
function makeDressRecord(
  index: number,
  altCount: number,
): SketchRecord {
  const slug = `${index}dress`;
  const cover = `/images/shop/items/${slug}/${slug}-cover.webp`;
  const coverThumb = `/images/shop/thumbnails/${slug}/${slug}-cover.webp`;
  const alts = Array.from(
    { length: altCount },
    (_, i) => `/images/shop/items/${slug}/${slug}-${i + 1}.webp`,
  );
  const altThumbs = Array.from(
    { length: altCount },
    (_, i) =>
      `/images/shop/thumbnails/${slug}/${slug}-${i + 1}.webp`,
  );
  const images = [cover, ...alts];
  const thumbnails = [coverThumb, ...altThumbs];
  return {
    id: slug,
    title: `Style ${String(index).padStart(2, "0")}`,
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: cover,
    images,
    thumbnails,
  };
}

/**
 * Per-slug count of alternate views available on disk under
 * `/public/images/shop/items/<slug>/`. Manually maintained alongside
 * the asset folders; if a new view is added, bump the matching count
 * and the Zoom_View thumbnail strip will pick it up automatically.
 *
 * Counts taken at the time of writing (2024) by counting webp files
 * per folder and subtracting the cover.
 */
const DRESS_ALT_COUNTS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [2, 3],
  [3, 4],
  [4, 3],
  [5, 5],
  [6, 1],
  [7, 3],
  [8, 1],
  [9, 1],
  [10, 2],
  [11, 3],
  [12, 2],
  [13, 1],
  [14, 1],
  [15, 1],
  [16, 1],
  [17, 1],
  [18, 1],
  [19, 1],
  [20, 4],
  [21, 2],
  [22, 1],
];

/**
 * Index of the designer record inside the published catalogue. Chosen
 * so the placement walk anchors the designer's portrait at the centre
 * of the gallery's north wall (the wall the visitor sees straight
 * ahead after stepping through the sliding doors). With wall
 * capacities of 9 / 5 / 9 (west, north, east), the catalogue indices
 * 0..8 land on the west wall, 9..13 land on the north wall, and
 * 14..22 land on the east wall — so index 11 is the third of the
 * five north-wall frames, the geometric centre. That gives 11 dresses
 * to the visitor's left as they walk in and 11 to their right.
 */
const DESIGNER_CATALOGUE_INDEX = 11;

const DRESS_RECORDS = DRESS_ALT_COUNTS.map(([n, alt]) =>
  makeDressRecord(n, alt),
);

const DESIGNER_RECORD: SketchRecord = {
  id: "designer",
  title: "Piyush Bholla",
  date: "2024-01-01",
  description:
    "Founder & Creative Director, GP Fashion. An Indian fashion designer working across kidswear, menswear, and womenswear from a Delhi studio. Trained at NIFT Bengaluru and FIT New York, with a practice grounded in detail, craftsmanship, and the quiet pleasure of well-made clothes. Each collection is a balancing act between tradition and innovation, polish and playfulness — clothes that feel authentic, elegant, and joyful to wear. Philosophy: authenticity woven into every detail.",
  imageSrc: "/images/about/piyush1.jpg",
};

export const sketches: ReadonlyArray<SketchRecord> = [
  ...DRESS_RECORDS.slice(0, DESIGNER_CATALOGUE_INDEX),
  DESIGNER_RECORD,
  ...DRESS_RECORDS.slice(DESIGNER_CATALOGUE_INDEX),
];

// Run at module top level so any catalogue violation (missing field, bad date,
// duplicate id, etc.) aborts `next build` and server startup with a diagnostic
// naming the offending record. This is the build/startup gate for Req 8.7/8.8.
assertSketchCatalog(sketches);
