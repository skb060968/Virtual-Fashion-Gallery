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

export const sketches: ReadonlyArray<SketchRecord> = [
  // Designer portrait — sits first in catalogue order so the placement
  // walk anchors it at the start of the west wall, the first artwork
  // the visitor encounters on their right after stepping through the
  // sliding doors. Click → Zoom_View shows the designer's photograph
  // alongside the same metadata layout as a dress (the zoom panel
  // already renders `title`, `medium`, and `description`).
  {
    id: "designer",
    title: "Piyush Bholla",
    date: "2024-01-01",
    medium: "Founder & Creative Director, GP Fashion",
    description:
      "An Indian fashion designer working across kidswear, menswear, and womenswear from a Delhi studio. Trained at NIFT Bengaluru and FIT New York, with a practice grounded in detail, craftsmanship, and the quiet pleasure of well-made clothes. Each collection is a balancing act between tradition and innovation, polish and playfulness — clothes that feel authentic, elegant, and joyful to wear. Philosophy: authenticity woven into every detail.",
    imageSrc: "/images/about/piyush1.jpg",
  },
  {
    id: "1dress",
    title: "Style 01",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/1dress/1dress-cover.webp",
  },
  {
    id: "2dress",
    title: "Style 02",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/2dress/2dress-cover.webp",
  },
  {
    id: "3dress",
    title: "Style 03",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/3dress/3dress-cover.webp",
  },
  {
    id: "4dress",
    title: "Style 04",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/4dress/4dress-cover.webp",
  },
  {
    id: "5dress",
    title: "Style 05",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/5dress/5dress-cover.webp",
  },
  {
    id: "6dress",
    title: "Style 06",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/6dress/6dress-cover.webp",
  },
  {
    id: "7dress",
    title: "Style 07",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/7dress/7dress-cover.webp",
  },
  {
    id: "8dress",
    title: "Style 08",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/8dress/8dress-cover.webp",
  },
  {
    id: "9dress",
    title: "Style 09",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/9dress/9dress-cover.webp",
  },
  {
    id: "10dress",
    title: "Style 10",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/10dress/10dress-cover.webp",
  },
  {
    id: "11dress",
    title: "Style 11",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/11dress/11dress-cover.webp",
  },
  {
    id: "12dress",
    title: "Style 12",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/12dress/12dress-cover.webp",
  },
  {
    id: "13dress",
    title: "Style 13",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/13dress/13dress-cover.webp",
  },
  {
    id: "14dress",
    title: "Style 14",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/14dress/14dress-cover.webp",
  },
  {
    id: "15dress",
    title: "Style 15",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/15dress/15dress-cover.webp",
  },
  {
    id: "16dress",
    title: "Style 16",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/16dress/16dress-cover.webp",
  },
  {
    id: "17dress",
    title: "Style 17",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/17dress/17dress-cover.webp",
  },
  {
    id: "18dress",
    title: "Style 18",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/18dress/18dress-cover.webp",
  },
  {
    id: "19dress",
    title: "Style 19",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/19dress/19dress-cover.webp",
  },
  {
    id: "20dress",
    title: "Style 20",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/20dress/20dress-cover.webp",
  },
  {
    id: "21dress",
    title: "Style 21",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/21dress/21dress-cover.webp",
  },
  {
    id: "22dress",
    title: "Style 22",
    date: "2024-01-01",
    medium: "Couture portfolio piece",
    description: "",
    imageSrc: "/images/shop/items/22dress/22dress-cover.webp",
  },
];

// Run at module top level so any catalogue violation (missing field, bad date,
// duplicate id, etc.) aborts `next build` and server startup with a diagnostic
// naming the offending record. This is the build/startup gate for Req 8.7/8.8.
assertSketchCatalog(sketches);
