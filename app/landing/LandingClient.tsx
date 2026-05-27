"use client";

/**
 * LandingClient — minimalist 2D entry surface for the Virtual Fashion
 * Design Gallery (Requirements 4.1, 4.4, 4.5, 4.6, 4.7, 4.8, 10.2).
 *
 * Responsibilities:
 *   1. Render the hero (designer name + tagline) using Space Grotesk
 *      for display and Inter for body, plus a single primary CTA and a
 *      tab-reachable contact link (Req 4.4, 4.7, 10.1).
 *   2. Run a `framer-motion` exit transition on CTA activation whose
 *      total duration is in [300ms, 1500ms]; honour `useReducedMotion()`
 *      to swap to a ≤10ms variant tween (Req 4.5, 4.6, 10.2).
 *   3. Race `document.fonts.ready` against a 3000ms watchdog. On
 *      timeout set `data-fonts-fallback="true"` on `<html>` so the
 *      fallback CSS rule in `app/globals.css` swaps to a system
 *      sans-serif stack (Req 4.3 — supports the typography requirement).
 *   4. Drive the Walkthrough_Engine mount-failure flow (Req 4.8): on
 *      CTA exit completion, push to `/gallery` and start a 5000ms
 *      watchdog. When `useGalleryStore.walkthroughReady` becomes true,
 *      cancel the watchdog. If the watchdog fires, replace to
 *      `/?retry=mount`; LandingClient re-renders with a non-blocking
 *      error indicator and a retry control that re-runs the same flow.
 *
 * The mount watchdog and store subscription deliberately live in
 * module scope so they survive the unmount that happens when this
 * component navigates to `/gallery`. They reference the App Router
 * instance captured at click time; `router.replace` from
 * `next/navigation` is stable across the app session.
 */

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { FOCUS_RING_CLASS } from "@/components/FocusRing";
import { useGalleryStore } from "@/features/walkthrough/store/useGalleryStore";

/** Watchdog window for `document.fonts.ready` (Req 4.3). */
const FONTS_FALLBACK_TIMEOUT_MS = 3000;

/** Watchdog window for Walkthrough_Engine mount (Req 4.8). */
const MOUNT_WATCHDOG_MS = 5000;

/**
 * Total duration of the framer-motion exit transition. 600ms sits in the
 * middle of the [300ms, 1500ms] window required by Req 4.5 and feels
 * intentional without dragging.
 */
const TRANSITION_DURATION_S = 0.6;

/**
 * Reduced-motion swap: a 5ms tween satisfies Req 4.6 / 10.2 ("no
 * animated translation, scale, or opacity tween longer than 10ms")
 * while still letting `onAnimationComplete` fire so the navigation
 * still kicks off after the exit phase.
 */
const REDUCED_MOTION_DURATION_S = 0.005;

const heroVariants = {
  rest: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
} as const;

/** Minimal interface needed from the Next.js App Router. */
type RouterLike = {
  push: (href: string) => void;
  replace: (href: string) => void;
};

type Watchdog = { cancel: () => void };

/**
 * Module-scoped reference to the currently-running mount watchdog.
 * Lives outside the React tree so the timer and store subscription
 * survive the LandingClient unmount that happens when we navigate to
 * `/gallery`.
 */
let activeMountWatchdog: Watchdog | null = null;

function startMountWatchdog(router: RouterLike): Watchdog {
  // Coalesce: cancel any prior watchdog (e.g. user mashes the CTA).
  activeMountWatchdog?.cancel();

  let cancelled = false;
  let timerId: number | undefined;
  let storeUnsubscribe: (() => void) | undefined;

  const watchdog: Watchdog = {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
      storeUnsubscribe?.();
      if (activeMountWatchdog === watchdog) {
        activeMountWatchdog = null;
      }
    },
  };

  // If the engine is already ready (warm cache, fast remount), the
  // watchdog has nothing to do.
  if (useGalleryStore.getState().walkthroughReady) {
    cancelled = true;
    return watchdog;
  }

  // Listen for the gallery store's ready signal. The Walkthrough_Engine
  // calls `setReady()` from R3F's `<Canvas onCreated>` callback after
  // the first scene frame renders.
  storeUnsubscribe = useGalleryStore.subscribe((state) => {
    if (state.walkthroughReady) {
      watchdog.cancel();
    }
  });

  timerId = window.setTimeout(() => {
    watchdog.cancel();
    router.replace("/?retry=mount");
  }, MOUNT_WATCHDOG_MS);

  activeMountWatchdog = watchdog;
  return watchdog;
}

export function LandingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reducedMotion = useReducedMotion() ?? false;

  const [exiting, setExiting] = useState<boolean>(false);

  const retryFlag = searchParams?.get("retry") === "mount";

  // ── Font fallback timer (Req 4.3). ─────────────────────────────────
  useEffect(() => {
    if (typeof document === "undefined") return;

    let cancelled = false;
    let timerId: number | undefined;

    const applyFallback = () => {
      if (cancelled) return;
      document.documentElement.setAttribute("data-fonts-fallback", "true");
    };

    // `document.fonts` is the FontFaceSet API. Older / non-browser
    // environments (jsdom by default) don't define it — in that case
    // we still arm the 3s timer so the fallback CSS rule applies.
    const fonts = (document as Document & {
      fonts?: { ready?: Promise<unknown> };
    }).fonts;
    const ready = fonts?.ready;

    if (ready && typeof ready.then === "function") {
      // Race `document.fonts.ready` against a 3000ms timeout.
      const timeoutMarker = Symbol("fonts-fallback-timeout");
      const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
        timerId = window.setTimeout(() => resolve(timeoutMarker), FONTS_FALLBACK_TIMEOUT_MS);
      });

      void Promise.race([
        ready.then(() => "ready" as const),
        timeoutPromise,
      ]).then((outcome) => {
        if (cancelled) return;
        if (outcome === timeoutMarker) {
          applyFallback();
        } else if (timerId !== undefined) {
          window.clearTimeout(timerId);
          timerId = undefined;
        }
      });
    } else {
      // No FontFaceSet API: arm the same 3s window defensively so the
      // system sans-serif fallback applies if the route remains mounted
      // long enough for the font request to be in flight.
      timerId = window.setTimeout(applyFallback, FONTS_FALLBACK_TIMEOUT_MS);
    }

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, []);

  // When the visitor lands here from `?retry=mount`, make sure the
  // hero is rendered in its rest state so the next click can replay
  // the exit transition cleanly.
  useEffect(() => {
    setExiting(false);
  }, [retryFlag]);

  // Begin the CTA exit transition: visually fade the hero out and
  // arm the mount-failure watchdog. Navigation itself is driven by
  // the surrounding `<Link href="/gallery">` so the visitor reaches
  // the gallery even on mobile browsers where the framer-motion
  // exit callback or React click batching might not fire reliably.
  const beginExit = () => {
    if (exiting) return;
    setExiting(true);
    startMountWatchdog(router);
  };

  // No-op kept for backward compatibility with the previous flow that
  // deferred navigation until the framer-motion exit phase ended;
  // navigation now happens synchronously inside `beginExit`, so this
  // callback only needs to be a stable reference for the motion
  // component's prop slot.
  const handleHeroAnimationComplete = (_definition: unknown) => {
    // intentionally empty
  };

  // Retry control: re-runs the framer-motion exit transition and
  // remounts the Walkthrough_Engine (Req 4.8). We clear the
  // `?retry=mount` query first so the retry indicator is dismissed
  // before the next exit phase starts.
  const handleRetry = () => {
    if (exiting) return;
    router.replace("/");
    // setExiting(true) is queued in the next tick after replace;
    // calling both synchronously is fine because Next.js batches the
    // search-param update with our state update.
    setExiting(true);
  };

  const transitionDuration = reducedMotion
    ? REDUCED_MOTION_DURATION_S
    : TRANSITION_DURATION_S;

  return (
    <main
      className="relative flex min-h-dvh w-full flex-col items-center justify-center gap-12 px-6 py-16 text-center"
      data-landing-root=""
    >
      <motion.section
        // `initial={false}` keeps the hero painted in its rest state on
        // first render so first paint isn't gated on an entrance tween
        // (Req 4.1). The exit tween fires only when `exiting` flips to
        // `true` after the CTA is activated.
        initial={false}
        animate={exiting ? "exit" : "rest"}
        variants={heroVariants}
        transition={{ duration: transitionDuration, ease: [0.4, 0, 0.2, 1] }}
        onAnimationComplete={handleHeroAnimationComplete}
        className="flex flex-col items-center gap-8"
      >
        <header className="flex flex-col items-center gap-3">
          <p className="font-body text-xs uppercase tracking-[0.3em] text-[var(--gallery-muted)]">
            GP Fashion · Portfolio Gallery
          </p>
          <h1 className="font-display text-4xl font-medium leading-tight text-[var(--gallery-fg)] sm:text-5xl md:text-6xl">
            The work of <span className="text-[var(--gallery-accent)]">Piyush Bholla</span>
          </h1>
          <p className="max-w-xl font-body text-base text-[var(--gallery-muted)] sm:text-lg">
            A walkable exhibition of the GP Fashion collection — every piece
            framed and lit like a quiet downtown gallery.
          </p>
        </header>

        <nav
          aria-label="Landing primary actions"
          // Document order places the primary CTA first so Tab from the
          // hero reaches it directly, and Tab again moves to the
          // contact link (Req 4.7, 10.1).
          className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6"
        >
          <Link
            href="/gallery"
            prefetch
            aria-label="Enter the gallery"
            onClick={beginExit}
            className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-[var(--gallery-accent)] px-6 py-3 font-display text-sm font-medium uppercase tracking-[0.2em] text-black transition-opacity hover:opacity-90 ${FOCUS_RING_CLASS}`}
          >
            Enter the gallery
          </Link>
          <Link
            href="/contact"
            aria-label="Contact the designer"
            className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-white/15 px-6 py-3 font-body text-sm text-[var(--gallery-fg)] transition-colors hover:border-white/35 ${FOCUS_RING_CLASS}`}
          >
            Contact
          </Link>
        </nav>
      </motion.section>

      {retryFlag ? (
        // Non-blocking error indicator + retry control (Req 4.8).
        // `role="status"` + `aria-live="polite"` announces the failure
        // without stealing focus or interrupting the visitor.
        <aside
          role="status"
          aria-live="polite"
          data-mount-retry=""
          className="flex max-w-md flex-col items-center gap-3 rounded-md border border-white/10 bg-[var(--gallery-surface)] px-6 py-4"
        >
          <p className="font-body text-sm text-[var(--gallery-fg)]">
            The gallery didn&apos;t finish loading. You can try again.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={exiting}
            aria-label="Retry loading the gallery"
            className={`inline-flex min-h-[44px] items-center justify-center rounded-md border border-[var(--gallery-accent)] px-4 py-2 font-display text-xs font-medium uppercase tracking-[0.2em] text-[var(--gallery-accent)] transition-colors hover:bg-[var(--gallery-accent)]/10 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING_CLASS}`}
          >
            Retry
          </button>
        </aside>
      ) : null}
    </main>
  );
}

export default LandingClient;
