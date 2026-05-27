/**
 * Root layout for the Virtual Fashion Design Gallery.
 *
 * Server component that:
 *   - Loads Space Grotesk (display) and Inter (body) via
 *     `next/font/google`, exposing them through `--font-display` and
 *     `--font-body` CSS variables consumed by Tailwind's `font-display`
 *     / `font-body` utilities and by raw CSS in `globals.css`
 *     (Requirements 4.2, 11.4).
 *   - Imports `app/globals.css` so Tailwind's base/components/utilities
 *     layers, dark gallery palette tokens, font-fallback rule, and
 *     focus-ring defaults apply across every route (Requirement 4.3,
 *     10.7, 11.3).
 *   - Wraps every route's children in `<ReducedMotionProvider>` so the
 *     visitor's OS-level `prefers-reduced-motion` preference is honoured
 *     globally for both 2D framer-motion transitions and 3D ambient
 *     animation (Requirements 4.6, 10.2, 10.3).
 *   - Includes a single `analytics-slot` JSX comment marker — the
 *     designated insertion point a future analytics SDK must use
 *     (Requirement 13.5). This is the only analytics seam in the app.
 */

import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import { ReducedMotionProvider } from "@/components/ReducedMotionProvider";

import "./globals.css";

// Display face — Space Grotesk. Exposed as `--font-display` so the
// Tailwind `font-display` utility (see `tailwind.config.js`) and any raw
// CSS rule resolve to the loaded face when Google Fonts succeeds and
// fall back to the system stack via `globals.css` when the 3s watchdog
// trips.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Body face — Inter. Exposed as `--font-body` for the same reason.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Virtual Fashion Design Gallery",
  description:
    "An immersive 3D walkthrough of fashion sketches presented as framed artworks.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable}`}
    >
      <body className="bg-gallery-bg text-gallery-fg font-body antialiased">
        {/* analytics-slot */}
        <ReducedMotionProvider>{children}</ReducedMotionProvider>
      </body>
    </html>
  );
}
