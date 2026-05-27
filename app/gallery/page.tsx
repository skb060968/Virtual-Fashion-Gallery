/**
 * Gallery route shell (Requirement 4.5).
 *
 * Server component shell for `/gallery`. The route is a thin wrapper
 * around the `<GalleryClient/>` client component declared in
 * `app/gallery/GalleryClient.tsx`, which owns every browser-only
 * concern in the gallery surface: WebGL feature detection, the
 * dynamic mount of `<WalkthroughEngine/>` (so the three.js bundle is
 * never requested on the WebGL_Fallback path), the `<ZoomView/>`
 * overlay, and the local error boundary that swaps to the fallback
 * when `<Canvas onCreated>` throws (Req 5.5, 10.4, 11.5).
 *
 * Keeping this file a server component means navigation into the
 * gallery from the `Landing_Experience` (per Req 4.5, the CTA
 * transitions the Visitor into this route after the framer-motion
 * exit phase) streams the initial HTML without first booting a
 * client runtime. The `"use client"` boundary lives inside
 * `<GalleryClient/>` itself, which is the only place the gallery
 * surface needs the browser.
 *
 * `<GalleryClient/>` does not read search params or any other
 * suspense-bound data on this route, so no `<Suspense>` boundary is
 * needed here (in contrast to `app/page.tsx`, which wraps
 * `<LandingClient/>` because it consumes `useSearchParams()` for the
 * `?retry=mount` flag).
 */

import { GalleryClient } from "@/app/gallery/GalleryClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gallery — Virtual Fashion Design Gallery",
  description:
    "Walk through the virtual fashion design gallery and view the sketches as framed artworks.",
};

export default function GalleryPage() {
  return <GalleryClient />;
}
