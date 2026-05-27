/**
 * FocusRing helper (Requirement 10.7).
 *
 * Centralises the visible focus indicator used across the Gallery_App so
 * every interactive element on a 2D surface (Landing_Experience,
 * Metadata_Panel, ContactForm, WebGL_Fallback) renders the same
 * amber-on-black `:focus-visible` ring against the dark gallery palette.
 *
 * The Tailwind utility `focus-visible:ring-2 focus-visible:ring-amber-200/80
 * focus-visible:ring-offset-2 focus-visible:ring-offset-black` mirrors the
 * `--focus-ring-*` CSS variables declared in `app/globals.css` so the two
 * sources stay visually aligned.
 *
 * Two ways to consume:
 *
 * 1. Compose into an existing element's className list, which is the
 *    preferred path for buttons, links, and form controls so we don't
 *    introduce an extra wrapper element into the accessibility tree:
 *
 *      <button className={`btn ${FOCUS_RING_CLASS}`}>Save</button>
 *
 * 2. Wrap children with `<FocusRing>` for ad-hoc cases where adding the
 *    class to the underlying element is awkward. The wrapper renders a
 *    `<span>` by default and forwards `className` so callers can extend
 *    the ring with layout utilities.
 */
import type { HTMLAttributes, ReactNode } from "react";

/**
 * Tailwind class string applying the amber `:focus-visible` ring used
 * across the Gallery_App. Exported as a const so it can be composed
 * into any element's `className` without rendering an extra wrapper.
 */
export const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black";

export type FocusRingProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  /**
   * Extra classes appended after the focus-ring utilities so callers can
   * still apply layout, sizing, or colour utilities to the wrapper.
   */
  className?: string;
};

/**
 * Convenience wrapper that applies `FOCUS_RING_CLASS` to a `<span>`
 * around its children. Prefer composing `FOCUS_RING_CLASS` directly onto
 * the focusable element when possible; reach for `<FocusRing>` only when
 * adding the class to the underlying element would be awkward.
 */
export function FocusRing({
  children,
  className,
  ...rest
}: FocusRingProps) {
  const merged = className
    ? `${FOCUS_RING_CLASS} ${className}`
    : FOCUS_RING_CLASS;
  return (
    <span {...rest} className={merged}>
      {children}
    </span>
  );
}

export default FocusRing;
