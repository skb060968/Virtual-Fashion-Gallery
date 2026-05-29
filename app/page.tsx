/**
 * Root route shell — the visitor lands directly on the immersive
 * walkthrough.
 *
 * As of the landing/gallery merge, `/` is the gallery surface itself.
 * The previous `<LandingClient/>` 2D entry page (with its tagline,
 * primary CTA, and `framer-motion` exit transition) has been folded
 * into the Walkthrough_Engine's own foyer + `<EntryOverlay/>`, so
 * visitors see the boutique facade and the "Welcome to the showroom"
 * card on first paint with no extra route hop.
 *
 * Why a thin server-component wrapper:
 *   - Streams the HTML for `/` without first booting a client runtime.
 *   - Keeps the `"use client"` boundary scoped to `<GalleryClient/>`,
 *     which is the only place the gallery surface needs the browser.
 *
 * The legacy `/gallery` route (`app/gallery/page.tsx`) now redirects
 * to `/`, so any deep link or bookmark that pointed at the old URL
 * keeps working. The `<GalleryClient/>` engine error boundary still
 * routes to `<WebGLFallback/>` when WebGL is unavailable (Req 5.5,
 * 10.4), so the merge does not regress on the fallback path.
 */

import { GalleryClient } from "@/app/gallery/GalleryClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Virtual Fashion Design Gallery",
  description:
    "Walk through the GP Fashion collection in a virtual showroom.",
};

export default function HomePage() {
  return <GalleryClient />;
}
