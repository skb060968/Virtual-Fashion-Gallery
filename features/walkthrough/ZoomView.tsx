"use client";

/**
 * Zoom_View — non-immersion-breaking close-up overlay for a single
 * Sketch_Record (Requirement 3).
 *
 * Mounted by `<GalleryClient/>` as a React subtree *above* and
 * *outside* the R3F `<Canvas>`, so the overlay is plain DOM and the
 * underlying Walkthrough_Scene stays mounted in the background
 * (Req 3.4). Activation (`<SketchFrame/>` click / tap / Enter) writes
 * `zoomOpen: true`, `activeRecordId`, and `cameraSnapshotPreZoom` into
 * the gallery store; this component subscribes to those fields and
 * drives the rest of the lifecycle.
 *
 * Responsibilities (mapped to the spec):
 *   - Open/close transitions via `framer-motion` ≤500ms; ≤10ms when
 *     `useReducedMotion()` is true (Req 3.3, 3.6, 10.2).
 *   - Render the same `imageSrc`, `title`, `date`, `medium`, and
 *     `description` as the Metadata_Panel (Req 3.1, 3.8).
 *   - Suppress the description region when the field is the empty
 *     string (Req 3.10).
 *   - 10s image-load watchdog → neutral placeholder while metadata
 *     stays visible and dismiss controls live (Req 3.9).
 *   - Throttle the underlying scene to ≤1 FPS while open by calling
 *     the engine handle's `invalidate()` from a 1Hz `setInterval`
 *     (Req 9.6). The engine itself is responsible for flipping
 *     `frameloop` to `"demand"`.
 *   - Camera input handlers are not rebound here — the Controls
 *     subtree gates input on `zoomOpen`, and `markNavInput()` exists
 *     as defence-in-depth so any leak is detectable.
 *   - Dismiss via close button, `Escape` key, or a documented
 *     swipe-down gesture (Req 3.6).
 *   - On dismiss, if `navDuringZoom === false`, restore the camera
 *     from the captured snapshot exactly (within 1e-6 tolerance) by
 *     handing the snapshot to the engine handle's `restoreCamera`
 *     (Req 3.5, 3.7, 14.3).
 *   - Wrap the overlay in `<ProtectedSurface/>` so right-click and
 *     drag are suppressed on the zoom image just like the in-scene
 *     canvas (Req 6.1, 6.2).
 *   - Trap focus between the close button and the metadata region
 *     while open so screen-reader / keyboard users cannot tab away
 *     into the underlying canvas (Req 10.1).
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FOCUS_RING_CLASS } from "@/components/FocusRing";
import { ProtectedSurface } from "@/components/ProtectedSurface";
import { sketches } from "@/lib/sketches";
import type { SketchRecord } from "@/lib/sketch-record";

import { getEngineHandle } from "./engine-handle";
import { useGalleryStore } from "./store/useGalleryStore";

/** Req 3.3 / 3.6: open/close transitions complete within 500ms. */
const OPEN_DURATION_MS = 320;

/**
 * Req 10.2: under Reduced_Motion_Mode, no animated translation/scale/
 * opacity tween exceeds 10ms. We render at the final state effectively
 * instantaneously.
 */
const REDUCED_MOTION_DURATION_MS = 10;

/** Req 3.9: 10s load watchdog before falling back to placeholder. */
const IMAGE_LOAD_TIMEOUT_MS = 10_000;

/**
 * Req 9.6: while open, throttle the Walkthrough_Scene to at most 1
 * frame per second. The engine flips `frameloop` to `"demand"`; we
 * re-arm a render every 1000ms so it still ticks at exactly the cap.
 */
const SCENE_THROTTLE_INTERVAL_MS = 1000;

/**
 * Min vertical pointer-down → up displacement that counts as a
 * documented "swipe-down" dismiss gesture (Req 3.6). Tuned high enough
 * that an accidental tap or scroll wiggle does not dismiss, but well
 * within reach of a deliberate gesture from anywhere on the overlay.
 */
const SWIPE_DOWN_DISMISS_PX = 80;

/**
 * Selectors over the gallery store. Defined at module scope so each
 * `useGalleryStore` subscription has a stable reference identity and
 * does not force redundant re-renders.
 */
const selectZoomOpen = (s: ReturnType<typeof useGalleryStore.getState>) =>
  s.zoomOpen;
const selectActiveRecordId = (
  s: ReturnType<typeof useGalleryStore.getState>,
) => s.activeRecordId;

/**
 * Resolve a Sketch_Record by id from the catalogue, or `null` if no
 * matching record exists. Used to materialise the active record while
 * the overlay is open. The catalogue is statically imported and
 * validated at module top-level (lib/sketches.ts), so this lookup is a
 * pure data join.
 */
function findRecordById(id: string | null): SketchRecord | null {
  if (!id) return null;
  for (const record of sketches) {
    if (record.id === id) return record;
  }
  return null;
}

export function ZoomView() {
  const zoomOpen = useGalleryStore(selectZoomOpen);
  const activeRecordId = useGalleryStore(selectActiveRecordId);
  const reducedMotion = useReducedMotion() ?? false;

  const record = useMemo(
    () => findRecordById(activeRecordId),
    [activeRecordId],
  );

  return (
    <AnimatePresence>
      {zoomOpen && record ? (
        <ZoomViewOverlay
          key={record.id}
          record={record}
          reducedMotion={reducedMotion}
        />
      ) : null}
    </AnimatePresence>
  );
}

export default ZoomView;

type ZoomViewOverlayProps = {
  record: SketchRecord;
  reducedMotion: boolean;
};

/**
 * The actual overlay subtree. Split out from `<ZoomView/>` so all of
 * the open-only side effects (focus trap, escape listener, scene
 * throttle interval, image watchdog) live behind the
 * `<AnimatePresence>` mount/unmount boundary and are torn down cleanly
 * on dismiss.
 */
function ZoomViewOverlay({
  record,
  reducedMotion,
}: ZoomViewOverlayProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const metadataAnchorRef = useRef<HTMLAnchorElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  /**
   * Records may carry an `images[]` array of alternate full-resolution
   * views (Sketch_Record extension; mirrors the GP Fashion shop detail
   * page). The active image starts at index 0 (the cover, which equals
   * `record.imageSrc`) and updates when the visitor taps a thumbnail.
   * For records without an `images[]` array we fall back to the single
   * `imageSrc` so the overlay still renders.
   */
  const images = useMemo<ReadonlyArray<string>>(
    () =>
      record.images && record.images.length > 0
        ? record.images
        : [record.imageSrc],
    [record],
  );
  const thumbnails = useMemo<ReadonlyArray<string>>(
    () =>
      record.thumbnails && record.thumbnails.length === images.length
        ? record.thumbnails
        : images,
    [record, images],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const activeImageSrc = images[activeIndex] ?? record.imageSrc;
  const hasGallery = images.length > 1;

  /**
   * Image load state machine:
   *   - "loading"     — still waiting for the <img> to fire `onLoad`.
   *   - "loaded"      — image is ready; show it.
   *   - "placeholder" — load failed or the 10s watchdog tripped.
   *
   * Metadata stays visible and dismiss controls stay live in every
   * branch (Req 3.9).
   */
  const [imageStatus, setImageStatus] = useState<
    "loading" | "loaded" | "placeholder"
  >("loading");

  // ---------------------------------------------------------------
  // Dismiss
  // ---------------------------------------------------------------

  /**
   * Single dismiss path used by the close button, Escape key handler,
   * and the swipe-down gesture (Req 3.6). On close, if no navigation
   * input arrived while the overlay was open, restore the camera from
   * the captured pre-zoom snapshot exactly (Req 3.5, 3.7, 14.3) by
   * calling into the engine handle. We read `navDuringZoom` and
   * `cameraSnapshotPreZoom` *before* `closeZoom()` clears them.
   */
  const dismiss = useCallback(() => {
    const state = useGalleryStore.getState();
    if (!state.zoomOpen) return;

    const snapshot = state.cameraSnapshotPreZoom;
    const navDuringZoom = state.navDuringZoom;

    if (snapshot && !navDuringZoom) {
      const engine = getEngineHandle();
      engine?.restoreCamera(snapshot);
    }

    state.closeZoom();
  }, []);

  // ---------------------------------------------------------------
  // Escape key (Req 3.6, 10.1)
  // ---------------------------------------------------------------

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  // ---------------------------------------------------------------
  // Focus trap + initial focus (Req 10.1)
  // ---------------------------------------------------------------

  useEffect(() => {
    // Move focus into the overlay so screen-reader / keyboard users
    // land on the close control first.
    closeButtonRef.current?.focus();
  }, []);

  /**
   * Trap focus between the close button (first focusable) and the
   * metadata "Back to gallery" anchor (last focusable). Tab from the
   * last cycles to the first; Shift+Tab from the first cycles to the
   * last. The two refs are the only focusable elements rendered by
   * the overlay; everything else (image, panel text) is non-tabbable.
   */
  const onOverlayKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") return;
      const first = closeButtonRef.current;
      const last = metadataAnchorRef.current;
      if (!first || !last) return;

      const active = document.activeElement;

      if (event.shiftKey) {
        // Shift+Tab from the first focusable wraps to the last.
        if (active === first || !overlayRef.current?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab from the last focusable wraps to the first.
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [],
  );

  // ---------------------------------------------------------------
  // Scene throttle interval (Req 9.6)
  // ---------------------------------------------------------------

  useEffect(() => {
    // Ask the engine to render at most once per second while the
    // overlay is open. The engine flips `frameloop` to `"demand"` on
    // its own when it observes `zoomOpen === true`; this interval
    // simply re-arms a frame at the cap.
    const id = window.setInterval(() => {
      const engine = getEngineHandle();
      engine?.invalidate();
    }, SCENE_THROTTLE_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, []);

  // ---------------------------------------------------------------
  // Image load watchdog (Req 3.9)
  // ---------------------------------------------------------------

  useEffect(() => {
    setImageStatus("loading");
    const timeoutId = window.setTimeout(() => {
      setImageStatus((prev) => (prev === "loading" ? "placeholder" : prev));
    }, IMAGE_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [record.id, activeIndex]);

  // Reset the active gallery index whenever the record changes so a
  // newly-opened Zoom_View always starts on the cover image.
  useEffect(() => {
    setActiveIndex(0);
  }, [record.id]);

  const onImageLoad = useCallback(() => {
    setImageStatus("loaded");
  }, []);

  const onImageError = useCallback(() => {
    setImageStatus("placeholder");
  }, []);

  // ---------------------------------------------------------------
  // Swipe-down dismiss (Req 3.6)
  // ---------------------------------------------------------------

  const swipeStartYRef = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Track the initial Y so we can detect a deliberate downward
      // gesture on pointer up. We do NOT start tracking on touches
      // that originate on focusable controls — those should activate
      // normally instead of being treated as the start of a swipe.
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a")) {
        swipeStartYRef.current = null;
        return;
      }
      swipeStartYRef.current = event.clientY;
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = swipeStartYRef.current;
      swipeStartYRef.current = null;
      if (start === null) return;
      const delta = event.clientY - start;
      if (delta >= SWIPE_DOWN_DISMISS_PX) {
        dismiss();
      }
    },
    [dismiss],
  );

  const onPointerCancel = useCallback(() => {
    swipeStartYRef.current = null;
  }, []);

  // ---------------------------------------------------------------
  // Animation variants (Req 3.3, 3.6, 10.2)
  // ---------------------------------------------------------------

  const transition = useMemo(
    () => ({
      duration:
        (reducedMotion ? REDUCED_MOTION_DURATION_MS : OPEN_DURATION_MS) /
        1000,
      ease: "easeOut" as const,
    }),
    [reducedMotion],
  );

  const hasDescription = record.description.length > 0;
  const showImage = imageStatus === "loaded";
  const showPlaceholder = imageStatus === "placeholder";

  return (
    <motion.div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="zoom-view-title"
      aria-describedby={hasDescription ? "zoom-view-description" : undefined}
      data-testid="zoom-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition}
      onKeyDown={onOverlayKeyDown}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <ProtectedSurface className="relative flex h-full w-full flex-col">
        {/* Close button — absolutely positioned in the top-right corner
            so it does not consume vertical space. The image and
            metadata column then have the full overlay height to share,
            so nothing scrolls and nothing slides "under" a header
            strip. */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={dismiss}
          aria-label="Close zoom view"
          className={`absolute right-3 top-3 z-10 rounded-full bg-black/55 px-4 py-2 text-sm font-display tracking-wide text-gallery-fg shadow-md backdrop-blur-sm transition-colors hover:bg-black/75 sm:right-6 sm:top-6 ${FOCUS_RING_CLASS}`}
        >
          Close
        </button>

        <div className="flex h-full min-h-0 w-full flex-col items-stretch gap-3 px-4 pb-4 pt-14 sm:flex-row sm:items-stretch sm:justify-center sm:gap-8 sm:px-10 sm:pb-8 sm:pt-16">
          {/* Image surface (Req 3.8, 3.9). `min-h-0` is essential —
              without it a flex column child refuses to shrink below
              its content height and the cover ends up overflowing the
              viewport. */}
          <motion.div
            className="flex min-h-0 w-full flex-col items-center gap-3 sm:max-w-[55%] sm:flex-1"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={transition}
          >
            <div
              className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-md bg-gallery-surface/70 shadow-lg"
              data-testid="zoom-view-image-frame"
            >
              {showImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={activeImageSrc}
                  src={activeImageSrc}
                  alt={record.medium ? `${record.title} \u2014 ${record.medium}` : record.title}
                  className="block h-full max-h-full w-full max-w-full object-contain"
                  draggable={false}
                  onLoad={onImageLoad}
                  onError={onImageError}
                />
              ) : (
                <>
                  {/* The actual <img> stays mounted while loading so the
                      browser can fire load/error and the 10s watchdog
                      can race them. We hide it visually until it's
                      ready to swap in. */}
                  {!showPlaceholder ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={activeImageSrc}
                      src={activeImageSrc}
                      alt=""
                      aria-hidden="true"
                      className="absolute h-px w-px opacity-0"
                      draggable={false}
                      onLoad={onImageLoad}
                      onError={onImageError}
                    />
                  ) : null}
                  <div
                    className="flex h-full w-full items-center justify-center bg-gallery-muted/20 text-sm text-gallery-muted"
                    role="img"
                    aria-label={`Placeholder for ${record.title}`}
                    data-testid="zoom-view-placeholder"
                  >
                    {showPlaceholder ? "Image unavailable" : "Loading…"}
                  </div>
                </>
              )}
            </div>

            {/* Thumbnail strip — only mounted when the record has more
                than one view. The strip is `shrink-0` so it always
                paints below the cover at its natural height. The
                inner padding (`px-1 py-1`) leaves room for the active
                button's outward `ring-2` box-shadow so the gold
                outline does not get clipped at the strip's edges
                (which used to happen on the first / last thumbnails
                under `overflow-x-auto` with no padding). */}
            {hasGallery ? (
              <div
                className="flex w-full max-w-full shrink-0 items-center gap-2 overflow-x-auto px-1 py-1"
                role="tablist"
                aria-label={`${record.title} alternate views`}
                data-testid="zoom-view-thumbnails"
              >
                {images.map((src, idx) => {
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={src}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-label={`View ${idx + 1} of ${images.length}`}
                      onClick={() => setActiveIndex(idx)}
                      className={`relative aspect-[3/4] h-14 flex-shrink-0 overflow-hidden rounded-sm transition-all sm:h-16 ${
                        isActive
                          ? "ring-2 ring-amber-300 shadow-md"
                          : "ring-1 ring-white/20 hover:ring-amber-200/60"
                      } ${FOCUS_RING_CLASS}`}
                      data-testid="zoom-view-thumbnail"
                      data-active={isActive ? "true" : "false"}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnails[idx]}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </motion.div>

          {/* Metadata surface (Req 3.1, 3.8, 3.10). On mobile this
              column sits below the image and is constrained so the
              whole overlay still fits without scrolling. On desktop
              it sits to the right of the image. */}
          <motion.section
            className="flex w-full max-w-md shrink-0 flex-col gap-3 overflow-y-auto text-gallery-fg sm:my-auto sm:max-h-full"
            data-testid="zoom-view-metadata"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={transition}
          >
            <h2
              id="zoom-view-title"
              className="font-display text-2xl tracking-wide text-gallery-fg"
            >
              {record.title}
            </h2>
            {/*
              Single layout for both records:

                - "designer" record carries its role + bio in
                  `description` (the catalogue stores no `medium`).
                - dresses display only the title; descriptions are
                  empty in v1, so the description block elides.

              The Sketch_Record `date` and `medium` fields stay on the
              data layer for future cataloguing or sort orders but are
              no longer painted on the zoom panel.
            */}
            {hasDescription ? (
              <p
                id="zoom-view-description"
                className="font-body text-base leading-relaxed text-gallery-fg"
              >
                {record.description}
              </p>
            ) : null}
            {/*
              Final focusable in the overlay so the focus trap has a
              well-defined "last" element. Rendered as a Next.js
              `<Link>` so navigation to `/contact` stays client-side
              and the gallery store's `lastCameraPose` survives the
              round-trip — when the visitor taps "Back to gallery"
              on the contact page, the engine remounts and seats the
              camera at the same pose they left from, instead of
              teleporting them out to the foyer spawn.
            */}
            <Link
              ref={metadataAnchorRef}
              href="/contact"
              className={`mt-2 inline-flex w-fit items-center text-sm font-display uppercase tracking-wider text-gallery-muted underline underline-offset-4 hover:text-gallery-fg ${FOCUS_RING_CLASS}`}
            >
              Contact the designer
            </Link>
          </motion.section>
        </div>
      </ProtectedSurface>
    </motion.div>
  );
}
