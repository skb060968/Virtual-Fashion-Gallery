"use client";

/**
 * GalleryClient — the client-side switch between the immersive
 * Walkthrough_Engine and the static WebGL_Fallback (Requirements 5.5,
 * 10.4, 11.5).
 *
 * Mounted by the gallery route shell at `app/gallery/page.tsx`. This
 * component is the single point at which the gallery decides whether
 * to load the three.js / R3F bundle or to render the static catalogue
 * surface instead.
 *
 * Decision flow:
 *
 *   1. On first client-side render, call `detectWebGL()` (Req 10.4).
 *      The helper is SSR-safe and never throws — it returns `false`
 *      from the server and during the brief detecting phase, and
 *      returns the real probe result after hydration.
 *
 *   2. If `detectWebGL()` returns `false`, render `<WebGLFallback/>`
 *      and *do not* reference `WalkthroughEngine` at all. The engine
 *      and overlay are imported via `next/dynamic` with `ssr: false`,
 *      which:
 *        - Splits three.js, @react-three/fiber, @react-three/drei,
 *          @react-three/postprocessing, framer-motion's R3F bridge,
 *          and the entire `features/walkthrough/` subtree into a
 *          separate JS chunk.
 *        - Never requests that chunk on the fallback path because the
 *          dynamic component is never rendered, and the `ssr: false`
 *          flag means it is also never bundled into the SSR HTML.
 *      The end result is that the fallback page weight is
 *      independent of the 3D bundle (Req 11.5 keeps three.js a
 *      single-major declared dependency, but the bundle still must
 *      not load when WebGL is unavailable; this is the seam that
 *      enforces it).
 *
 *   3. If `detectWebGL()` returns `true`, mount the dynamically
 *      imported `<WalkthroughEngine onReady={…}/>` together with the
 *      `<ZoomView/>` overlay. The overlay is a sibling of the engine
 *      (rather than a child) so its DOM lives outside the R3F
 *      `<Canvas>` subtree, which is what `engine-handle.ts` requires.
 *
 *   4. If anything inside the engine subtree throws — most importantly
 *      `<Canvas onCreated>` throwing during WebGLRenderer construction
 *      because the browser advertised WebGL but failed to create a
 *      context — the local error boundary catches it and flips
 *      `engineFailed` to `true`, which renders `<WebGLFallback/>`
 *      instead. This satisfies the "on `<Canvas onCreated>` throw,
 *      swap to `<WebGLFallback/>`" rule (Req 10.4).
 *
 * Note on SSR: this component is `"use client"`, but Next.js still
 * runs its render on the server during the initial HTML pass. The
 * detection effect runs only on the client, so during SSR (and the
 * first client render before `useEffect` fires) we render an empty
 * placeholder. This avoids briefly painting the fallback before
 * detection has actually run.
 */

import dynamic from "next/dynamic";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

import { WebGLFallback } from "@/components/WebGLFallback";
import { detectWebGL } from "@/lib/webgl";

// ---------------------------------------------------------------------------
// Dynamic imports — the three.js bundle is gated behind these so it is
// never requested on the WebGL_Fallback path.
// ---------------------------------------------------------------------------

/**
 * The Walkthrough_Engine hosts the R3F `<Canvas>`. Imported with
 * `ssr: false` so the SSR HTML never references three.js / R3F (which
 * would either fail server-side or pull the 3D bundle into the
 * initial document). On the fallback path, the dynamic component is
 * never rendered, so its chunk is never fetched.
 */
const WalkthroughEngine = dynamic(
  () => import("@/features/walkthrough/WalkthroughEngine"),
  { ssr: false },
);

/**
 * The Zoom_View overlay renders above (and outside) the `<Canvas>`,
 * but it still depends on `framer-motion` and on the gallery store —
 * both of which are part of the same feature subtree. Loading it
 * dynamically alongside the engine keeps it co-located in the same
 * code-split chunk, which is what we want: the overlay is only useful
 * when the engine is mounted, and it must not load on the fallback
 * path.
 */
const ZoomView = dynamic(
  () => import("@/features/walkthrough/ZoomView"),
  { ssr: false },
);

/**
 * Entry overlay (foyer button + nav hint). Loaded alongside the
 * engine so its bundle is split with the rest of the walkthrough
 * surface. Lives outside the `<Canvas>` because it's plain DOM.
 */
const EntryOverlay = dynamic(
  () => import("@/features/walkthrough/EntryOverlay"),
  { ssr: false },
);

/**
 * On-screen joystick UI for coarse-pointer (touch) devices. Renders
 * outside the `<Canvas>` because R3F's reconciler only knows about
 * THREE primitives — a `<div>` returned from inside the Canvas
 * subtree throws "Div is not part of the THREE namespace". The
 * matching `<TouchControls/>` mounts INSIDE the Canvas (via the
 * Controls router) and reads the joystick axis through a shared
 * module-scoped ref.
 */
const TouchJoystick = dynamic(
  () =>
    import("@/features/walkthrough/Controls/TouchControls").then(
      (mod) => ({ default: mod.TouchJoystick }),
    ),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Engine error boundary
// ---------------------------------------------------------------------------

type EngineErrorBoundaryProps = {
  children: ReactNode;
  /**
   * Called once when a downstream error is caught. The parent uses
   * this to flip the gallery into the fallback path. The boundary
   * itself never re-renders its children after an error — it returns
   * `null` so the failed subtree is fully torn down.
   */
  onError: (error: Error, info: ErrorInfo) => void;
};

type EngineErrorBoundaryState = {
  hasError: boolean;
};

/**
 * Local error boundary scoped to the `<WalkthroughEngine/>` +
 * `<ZoomView/>` subtree. React's only documented mechanism for
 * catching a thrown error from a render path or lifecycle (including
 * `<Canvas>`'s `onCreated` callback bubbling up) is a class component
 * with `getDerivedStateFromError` / `componentDidCatch`. We keep the
 * boundary minimal and inline so the fallback decision lives entirely
 * in this single file.
 */
class EngineErrorBoundary extends Component<
  EngineErrorBoundaryProps,
  EngineErrorBoundaryState
> {
  state: EngineErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): EngineErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the failure so a developer inspecting the console can
    // see why the gallery degraded. The user-facing surface is the
    // WebGL_Fallback, not a console message, so this is informational
    // only.
    if (typeof console !== "undefined") {
      console.warn("[gallery] engine subtree threw, falling back", error);
    }
    this.props.onError(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Returning `null` ensures the failed engine subtree is fully
      // unmounted. The parent component renders `<WebGLFallback/>` on
      // the next render once `engineFailed` flips to `true`.
      return null;
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// GalleryClient
// ---------------------------------------------------------------------------

/**
 * Three-state detection model.
 *
 *   - "detecting"   — initial render before the client-side effect
 *                     runs. We render an empty placeholder so the
 *                     fallback does not flash before detection.
 *   - "available"   — `detectWebGL()` returned `true` on the client.
 *   - "unavailable" — `detectWebGL()` returned `false`. We render
 *                     `<WebGLFallback/>` and never load the engine.
 */
type DetectionStatus = "detecting" | "available" | "unavailable";

export function GalleryClient() {
  const [status, setStatus] = useState<DetectionStatus>("detecting");

  /**
   * Set to `true` if the engine subtree throws (most importantly,
   * `<Canvas onCreated>` failing during WebGLRenderer construction
   * even though `detectWebGL()` had reported the API as available).
   * Once this flips, the gallery renders `<WebGLFallback/>` for the
   * remainder of the route's lifetime.
   */
  const [engineFailed, setEngineFailed] = useState<boolean>(false);

  // ----- WebGL feature detection (client-only) -----------------------------
  useEffect(() => {
    // `detectWebGL()` is SSR-safe: it returns `false` on the server.
    // Running it in `useEffect` guarantees we only consult the real
    // probe result after hydration, which is what the WebGL_Fallback
    // path requires (Req 10.4).
    setStatus(detectWebGL() ? "available" : "unavailable");
  }, []);

  // ----- onReady handler ---------------------------------------------------
  /**
   * `<WalkthroughEngine/>` invokes `onReady` once the R3F `<Canvas>`
   * has reported `onCreated` AND the first scene frame has rendered
   * (the engine schedules the call from a double-rAF inside
   * `handleCreated`). The engine also flips
   * `useGalleryStore.walkthroughReady` to `true` on the same tick,
   * which is what `<LandingClient/>`'s mount watchdog actually
   * subscribes to (Req 4.8). Passing the prop here keeps the contract
   * symmetric and gives a future caller (e.g. an analytics hook at
   * the Req 13.5 seam) a non-store path to listen for readiness.
   */
  const handleEngineReady = useCallback(() => {
    // No-op in v1: LandingClient consumes the readiness signal via
    // the gallery store. Defining the callback explicitly (rather
    // than omitting the prop) makes the integration point obvious to
    // future readers.
  }, []);

  const handleEngineError = useCallback(() => {
    setEngineFailed(true);
  }, []);

  // ----- SSR / pre-hydration placeholder -----------------------------------
  if (status === "detecting") {
    // Visible loading indicator so a slow chunk fetch (e.g. mobile
    // browser hitting the dev server over the local network) doesn't
    // present a totally blank black page. As soon as the WebGL probe
    // runs in `useEffect`, this state is replaced.
    return (
      <div
        data-gallery-client="detecting"
        className="fixed inset-0 flex items-center justify-center bg-[var(--gallery-bg)] text-[var(--gallery-fg)]"
      >
        <p className="font-display text-sm uppercase tracking-[0.3em] text-[var(--gallery-muted)]">
          Loading gallery…
        </p>
      </div>
    );
  }

  // ----- Fallback path -----------------------------------------------------
  // Reached when the browser does not support WebGL OR when the
  // engine subtree threw during construction (Req 10.4). On this
  // path we never touch `WalkthroughEngine` or `ZoomView`, so their
  // dynamic chunks are never fetched.
  if (status === "unavailable" || engineFailed) {
    return <WebGLFallback />;
  }

  // ----- Engine path -------------------------------------------------------
  // WebGL is available and no error has been observed. Mount the
  // dynamically-loaded engine plus the Zoom_View overlay. The
  // overlay is a sibling of the engine so its DOM lives outside the
  // `<Canvas>` subtree (which `engine-handle.ts` relies on).
  //
  // The wrapper is `fixed inset-0` so the R3F `<Canvas>` has a real
  // viewport-sized box to fill. R3F sizes itself from its parent's
  // bounding rect; without an explicit fixed/absolute box the parent
  // collapses to `auto` height under flow layout, the WebGL canvas
  // renders 0×0, and drei `<Html transform>` panels project to a
  // degenerate camera matrix (which manifests as overlapping text at
  // the top of the screen).
  return (
    <div
      data-gallery-client="engine"
      className="fixed inset-0 overflow-hidden"
    >
      <EngineErrorBoundary onError={handleEngineError}>
        <WalkthroughEngine onReady={handleEngineReady} />
        <ZoomView />
        <EntryOverlay />
        <TouchJoystick />
      </EngineErrorBoundary>
    </div>
  );
}

export default GalleryClient;
