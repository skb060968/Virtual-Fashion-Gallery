/**
 * Landing route shell (Requirement 4.1).
 *
 * Server component shell for `/`. The route is a thin wrapper around
 * the `<LandingClient/>` client component declared in
 * `app/landing/LandingClient.tsx`, which owns all browser-only
 * concerns: the `framer-motion` enter/exit transition, the
 * `useReducedMotion()` swap, the `document.fonts.ready` watchdog, the
 * tab-reachable contact link, and the Walkthrough_Engine mount-failure
 * retry flow (Req 4.1, 4.4–4.8, 10.2).
 *
 * Keeping this file a server component means the initial HTML for `/`
 * is streamed without first booting a client runtime, which keeps
 * landing first paint inside the Req 4.1 budget. The
 * `<LandingClient/>` boundary is marked `"use client"` inside its own
 * file — this is the only place the landing surface needs the browser.
 *
 * `<LandingClient/>` calls `useSearchParams()` to read the
 * `?retry=mount` flag set by the mount watchdog (Req 4.8). In the App
 * Router, components that read search params must be wrapped in a
 * `<Suspense>` boundary so static prerendering can stream them; the
 * boundary's fallback is intentionally `null` so the hero paints from
 * the client without a flash of placeholder UI.
 */

import { Suspense } from "react";

import { LandingClient } from "@/app/landing/LandingClient";

export default function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingClient />
    </Suspense>
  );
}
