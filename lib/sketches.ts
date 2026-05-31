/**
 * Sketch_Catalog — single source of truth for the v1 Gallery_App.
 *
 * Wall layout (skipSouthWall, capacities west=9 / north=5 / east=9):
 *
 *   Indices  0– 8 → west wall  — WOMENSWEAR (1,2,6,7,8,9,10,11,12)
 *   Indices  9–13 → north wall — KIDSWEAR | designer | MENSWEAR
 *              9 = 3dress  (KIDSWEAR)
 *             10 = 4dress  (KIDSWEAR)
 *             11 = designer (centre of north wall)
 *             12 = 5dress  (MENSWEAR)
 *             13 = 22dress (MENSWEAR)
 *   Indices 14–22 → east wall  — WOMENSWEAR (13,14,15,16,17,18,19,20,21)
 */

import { assertSketchCatalog, type SketchRecord } from "./sketch-record";

/**
 * Build a SketchRecord for one dress slug, deriving imageSrc, images,
 * and thumbnails from the slug + the count of alternate views on disk.
 * altCount=0 collapses to a single-image record (cover only).
 */
function makeDressRecord(index: number, altCount: number): SketchRecord {
  const slug = `${index}dress`;
  const cover = `/images/shop/items/${slug}/${slug}-cover.webp`;
  const coverThumb = `/images/shop/thumbnails/${slug}/${slug}-cover.webp`;
  const alts = Array.from(
    { length: altCount },
    (_, i) => `/images/shop/items/${slug}/${slug}-${i + 1}.webp`,
  );
  const altThumbs = Array.from(
    { length: altCount },
    (_, i) => `/images/shop/thumbnails/${slug}/${slug}-${i + 1}.webp`,
  );
  return {
    id: slug,
    title: `Style ${String(index).padStart(2, "0")}`,
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: cover,
    images: [cover, ...alts],
    thumbnails: [coverThumb, ...altThumbs],
  };
}

// ---------------------------------------------------------------------------
// West wall — WOMENSWEAR (indices 0–8)
// ---------------------------------------------------------------------------
const WEST_WALL: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [2, 3],
  [6, 1],
  [7, 3],
  [8, 1],
  [9, 1],
  [10, 2],
  [11, 3],
  [12, 2],
];

// ---------------------------------------------------------------------------
// North wall — KIDSWEAR | designer | MENSWEAR (indices 9–13)
// ---------------------------------------------------------------------------
const NORTH_LEFT:  ReadonlyArray<readonly [number, number]> = [[3, 4], [4, 3]];
const NORTH_RIGHT: ReadonlyArray<readonly [number, number]> = [[5, 5], [22, 1]];

const DESIGNER_RECORD: SketchRecord = {
  id: "designer",
  title: "Piyush Bholla",
  date: "2024-01-01",
  description:
    "Founder & Creative Director, GP Fashion. An Indian fashion designer working across kidswear, menswear, and womenswear from a Delhi studio. Trained at NIFT Bengaluru and FIT New York, with a practice grounded in detail, craftsmanship, and the quiet pleasure of well-made clothes. Each collection is a balancing act between tradition and innovation, polish and playfulness — clothes that feel authentic, elegant, and joyful to wear. Philosophy: authenticity woven into every detail.",
  imageSrc: "/images/about/piyush1.jpg",
};

// ---------------------------------------------------------------------------
// East wall — WOMENSWEAR (indices 14–22)
// ---------------------------------------------------------------------------
const EAST_WALL: ReadonlyArray<readonly [number, number]> = [
  [13, 1],
  [14, 1],
  [15, 1],
  [16, 1],
  [17, 1],
  [18, 1],
  [19, 1],
  [20, 4],
  [21, 2],
];

// ---------------------------------------------------------------------------
// Final catalogue — order determines wall placement
// ---------------------------------------------------------------------------
export const sketches: ReadonlyArray<SketchRecord> = [
  // West wall — WOMENSWEAR (indices 0–8)
  ...WEST_WALL.map(([n, alt]) => makeDressRecord(n, alt)),
  // North wall — KIDSWEAR | designer | MENSWEAR (indices 9–13)
  ...NORTH_LEFT.map(([n, alt]) => makeDressRecord(n, alt)),
  DESIGNER_RECORD,
  ...NORTH_RIGHT.map(([n, alt]) => makeDressRecord(n, alt)),
  // East wall — WOMENSWEAR (indices 14–22)
  ...EAST_WALL.map(([n, alt]) => makeDressRecord(n, alt)),
];

// Validate at module load — aborts next build / server start on any violation.
assertSketchCatalog(sketches);
